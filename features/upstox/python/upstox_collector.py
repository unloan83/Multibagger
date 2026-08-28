from __future__ import annotations

import gzip
import json
import logging
import threading
import time
import urllib.request
from functools import lru_cache
from datetime import datetime, timezone
from typing import Any, Callable
from zoneinfo import ZoneInfo

import pandas as pd

from engine.config import Settings
from engine.store import MarketStore
from scripts.telegram_notify import send_telegram_message
from features.upstox.python.websocket_handler import reconnect_with_backoff


LOG = logging.getLogger("multibagger.upstox")
IST = ZoneInfo("Asia/Kolkata")
INSTRUMENTS_URL = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz"



@lru_cache(maxsize=1)
def nse_instrument_master() -> tuple[dict[str, Any], ...]:
    with urllib.request.urlopen(INSTRUMENTS_URL, timeout=30) as response:
        return tuple(json.loads(gzip.decompress(response.read())))


def resolve_upstox_instruments(settings: Settings, store: MarketStore) -> dict[str, str]:
    rows = nse_instrument_master()
    wanted = set(settings.symbols())
    fno = {
        str(row.get("underlying_symbol")) for row in rows
        if row.get("segment") == "NSE_FO" and row.get("instrument_type") == "FUT"
        and row.get("underlying_type") == "EQUITY" and row.get("underlying_symbol")
    }
    equities = {
        str(row["instrument_key"]): str(row["trading_symbol"])
        for row in rows
        if row.get("segment") == "NSE_EQ" and row.get("instrument_type") == "EQ"
        and row.get("trading_symbol") in wanted and row.get("trading_symbol") in fno
        and row.get("instrument_key")
    }
    minimum = min(100, len(wanted))
    if len(equities) < minimum:
        raise RuntimeError(f"Only {len(equities)} NIFTY-500 F&O equities resolved; refusing partial paper feed")
    market_index = next((
        row for row in rows
        if row.get("instrument_key") == settings.market_index_instrument_key
    ), None)
    if not market_index:
        raise RuntimeError("NIFTY 50 index instrument is unavailable; direction classification must fail closed")
    volatility_index = next((row for row in rows if row.get("instrument_key") == settings.vix_instrument_key), None)
    if not volatility_index:
        raise RuntimeError("India VIX instrument is unavailable; regime classification must fail closed")
    # The direction gate is mandatory, so warm-up/backfill must seed the market
    # index before spending broker rate-limit budget on the wider equity universe.
    selected = {
        settings.market_index_instrument_key: settings.market_index_symbol,
        settings.vix_instrument_key: settings.vix_symbol,
        **equities,
    }
    with store.connect() as con:
        con.execute("DELETE FROM instruments WHERE exchange='NSE'")
        for key, symbol in selected.items():
            con.execute("INSERT OR REPLACE INTO instruments VALUES (?, ?, ?, 'NSE', ?)", [key, symbol, symbol, datetime.now(timezone.utc)])
    return selected


class UpstoxTickWriter:
    def __init__(self, store: MarketStore, instruments: dict[str, str]):
        self.store = store
        self.instruments = instruments
        self.pending: dict[tuple[str, datetime], dict[str, Any]] = {}
        self.lock = threading.Lock()
        self.quote_ticks = 0
        self.candle_ticks = 0
        self.started_monotonic = time.monotonic()
        self.last_reconnect_monotonic = self.started_monotonic
        self.last_quote_monotonic: float = self.started_monotonic
        self.last_candle_monotonic: float | None = None
        self.last_candle_timestamp_by_key: dict[str, datetime] = {}

    def mark_reconnect(self) -> None:
        self.last_reconnect_monotonic = time.monotonic()

    def on_message(self, message: dict[str, Any]) -> None:
        received = datetime.now(timezone.utc)
        for key, feed in (message.get("feeds") or {}).items():
            symbol = self.instruments.get(key)
            if not symbol:
                continue
            full_feed = feed.get("fullFeed") or {}
            market_full = full_feed.get("marketFF") or {}
            index_full = full_feed.get("indexFF") or {}
            full = market_full or index_full
            if not full:
                continue
            ltpc = full.get("ltpc") or {}
            ltp = _positive_float(ltpc.get("ltp"))
            quotes = ((market_full.get("marketLevel") or {}).get("bidAskQuote") or [])
            best = quotes[0] if quotes else {}
            bid, ask = _positive_float(best.get("bidP")), _positive_float(best.get("askP"))

            # Any LTP tick or executable order book depth update increments quote_ticks
            if ltp is not None or (bid is not None and ask is not None):
                self.quote_ticks += 1
                self.last_quote_monotonic = time.monotonic()

            candles = ((full.get("marketOHLC") or {}).get("ohlc") or [])
            minute = next((bar for bar in candles if bar.get("interval") == "I1"), None)
            if not minute:
                continue
            # Index feeds have OHLC but no executable order book. Equities must
            # still have a valid spread before their candles are accepted.
            if market_full and (bid is None or ask is None or ask <= bid):
                continue
            timestamp = pd.to_datetime(int(minute["ts"]), unit="ms", utc=True).to_pydatetime()
            row = {
                "instrument_key": key, "symbol": symbol, "ts": timestamp,
                "open": float(minute["open"]), "high": float(minute["high"]),
                "low": float(minute["low"]), "close": float(minute["close"]),
                "volume": max(0, int(minute.get("vol") or 0)), "bid": bid, "ask": ask,
                "received_at": received,
            }
            with self.lock:
                self.pending[(key, timestamp)] = row
            self.candle_ticks += 1
            self.last_candle_monotonic = time.monotonic()
            self.last_candle_timestamp_by_key[key] = timestamp

    def ingest_quotes_dict(self, quotes: dict[str, Any]) -> None:
        received = datetime.now(timezone.utc)
        for raw_key, quote in quotes.items():
            key = raw_key.replace(":", "|")
            symbol = self.instruments.get(key)
            if not symbol:
                continue
            last_price = _positive_float(quote.get("last_price"))
            ohlc = quote.get("ohlc") or {}
            depth = quote.get("depth") or {}
            bids = depth.get("buy") or []
            asks = depth.get("sell") or []
            bid = _positive_float(bids[0].get("price")) if bids else last_price
            ask = _positive_float(asks[0].get("price")) if asks else last_price

            if last_price is not None or (bid is not None and ask is not None):
                self.quote_ticks += 1
                self.last_quote_monotonic = time.monotonic()

            open_p = _positive_float(ohlc.get("open")) or last_price
            high_p = _positive_float(ohlc.get("high")) or last_price
            low_p = _positive_float(ohlc.get("low")) or last_price
            close_p = _positive_float(ohlc.get("close")) or last_price

            if None in (open_p, high_p, low_p, close_p):
                continue

            ts = received.replace(second=0, microsecond=0)
            row = {
                "instrument_key": key, "symbol": symbol, "ts": ts,
                "open": open_p, "high": high_p, "low": low_p, "close": close_p,
                "volume": max(0, int(quote.get("volume") or 0)),
                "bid": bid if bid is not None else last_price,
                "ask": ask if ask is not None else last_price,
                "received_at": received,
            }
            with self.lock:
                self.pending[(key, ts)] = row
            self.candle_ticks += 1
            self.last_candle_monotonic = time.monotonic()
            self.last_candle_timestamp_by_key[key] = ts

    def flush(self) -> int:
        with self.lock:
            rows = list(self.pending.values())
            self.pending.clear()
        if not rows:
            return 0
        try:
            count = self.store.upsert_bars(pd.DataFrame(rows))
            if count > 0:
                LOG.debug("Data written to DuckDB: %d bars upserted", count)
            return count
        except Exception:
            with self.lock:
                for row in rows:
                    self.pending[(row["instrument_key"], row["ts"])] = row
            raise


def collect_upstox(settings: Settings, on_market_data: Callable[[], None] | None = None) -> None:
    if not settings.access_token:
        raise RuntimeError("UPSTOX_ACCESS_TOKEN is required")
    if settings.market_data_provider != "upstox":
        raise RuntimeError("Upstox collector requires MARKET_DATA_PROVIDER=upstox")
    import upstox_client

    store = MarketStore(settings.db_path)
    instruments = resolve_upstox_instruments(settings, store)
    config = upstox_client.Configuration()
    config.access_token = settings.access_token
    # Explicitly subscribe all instruments to Upstox V3 "full" mode (LTP + Depth + OHLC)
    streamer = upstox_client.MarketDataStreamerV3(
        upstox_client.ApiClient(config), list(instruments), "full",
    )
    writer = UpstoxTickWriter(store, instruments)
    failure: list[Exception] = []
    stop = threading.Event()
    opened = threading.Event()

    from engine.degraded import DEGRADED_MANAGER

    def fail(error: Exception) -> None:
        if not failure:
            failure.append(error)
        stop.set()
        try:
            streamer.disconnect()
        except Exception:
            pass

    def on_error(error: object) -> None:
        LOG.warning("Upstox market-data stream error: %s", error)
        now = time.monotonic()
        if "401 Unauthorized" in str(error):
            DEGRADED_MANAGER.report_failure("AUTH", "Upstox market-data stream authorization failed (HTTP 401)")
        elif now - writer.last_quote_monotonic >= 15.0:
            DEGRADED_MANAGER.report_failure("WEBSOCKET", f"Upstox market-data stream error: {error}")

    def on_reconnect_stopped(reason: object) -> None:
        LOG.warning("Upstox market-data reconnects stopped: %s", reason)
        now = time.monotonic()
        if now - writer.last_quote_monotonic >= 15.0:
            DEGRADED_MANAGER.report_failure("WEBSOCKET", f"Upstox market-data reconnects stopped: {reason}")

    def monitor() -> None:
        last_log = time.monotonic()
        while not stop.wait(1):
            try:
                flushed = writer.flush()
                if flushed and on_market_data:
                    on_market_data()
                now = time.monotonic()
                _assert_stream_freshness(writer, settings, now, datetime.now(timezone.utc))
                DEGRADED_MANAGER.report_recovery("WEBSOCKET")
                if now - last_log >= 60:
                    LOG.info("Upstox feed healthy; quote_ticks=%d candle_ticks=%d", writer.quote_ticks, writer.candle_ticks)
                    last_log = now
            except Exception as error:
                now = time.monotonic()
                if now - writer.last_quote_monotonic >= 15.0:
                    DEGRADED_MANAGER.report_failure("WEBSOCKET", f"Upstox market-data stream delayed or stale: {error}")
                else:
                    DEGRADED_MANAGER.report_recovery("WEBSOCKET")

    def on_open() -> None:
        opened.set()
        writer.mark_reconnect()

    streamer.on("open", on_open)
    streamer.on("message", writer.on_message)
    streamer.on("error", on_error)
    streamer.on("autoReconnectStopped", on_reconnect_stopped)
    streamer.auto_reconnect(True, 5, 20)
    watcher = threading.Thread(target=monitor, name="upstox-feed-monitor", daemon=True)
    watcher.start()

    def rest_poller() -> None:
        """Fallback REST API Quote Polling loop when WebSocket stream is delayed/disconnected."""
        last_poll = 0.0
        while not stop.wait(1):
            now = time.monotonic()
            if now - last_poll < 5.0:
                continue
            last_poll = now
            # If WebSocket stream has not received fresh quotes in last 10 seconds, poll REST API
            if now - writer.last_quote_monotonic >= 10.0:
                try:
                    quotes = fetch_upstox_quotes_rest(settings.access_token, list(instruments.keys()))
                    if quotes:
                        writer.ingest_quotes_dict(quotes)
                        flushed = writer.flush()
                        if flushed and on_market_data:
                            on_market_data()
                        DEGRADED_MANAGER.report_recovery("WEBSOCKET")
                except Exception as poll_err:
                    LOG.debug("REST quote poller error: %s", poll_err)

    poller_thread = threading.Thread(target=rest_poller, name="upstox-rest-poller", daemon=True)
    poller_thread.start()

    def do_connect() -> None:
        opened.clear()
        try:
            streamer.connect()
            opened.wait(timeout=10)
        except Exception as conn_err:
            LOG.warning("WebSocket connect attempt error (REST fallback active): %s", conn_err)

    try:
        do_connect()
        while not stop.wait(1):
            pass
    finally:
        stop.set()
        try:
            streamer.disconnect()
        except Exception:
            pass
        watcher.join(timeout=5)
        poller_thread.join(timeout=5)
        writer.flush()
    if failure:
        raise failure[0]


def fetch_upstox_quotes_rest(access_token: str, instrument_keys: list[str]) -> dict[str, Any]:
    """Fetch live quotes via Upstox REST API in batches of 50 instrument keys."""
    import urllib.request, urllib.parse, json
    results: dict[str, Any] = {}
    headers = {
        'Authorization': f'Bearer {access_token}',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }
    batch_size = 50
    for i in range(0, len(instrument_keys), batch_size):
        chunk = instrument_keys[i:i + batch_size]
        encoded_chunk = [urllib.parse.quote(k, safe='|:') for k in chunk]
        url = f"https://api.upstox.com/v2/market-quote/quotes?instrument_key={','.join(encoded_chunk)}"
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.load(resp)
                if data.get("status") == "success" and data.get("data"):
                    results.update(data["data"])
        except Exception as e:
            LOG.debug("Failed to fetch Upstox quotes batch: %s", e)
    return results


def _assert_stream_freshness(writer: UpstoxTickWriter, settings: Settings, monotonic_now: float,
                             wall_now: datetime) -> None:
    local = wall_now.astimezone(IST)
    minute = local.hour * 60 + local.minute
    if local.weekday() >= 5 or not 9 * 60 + 16 <= minute <= 15 * 60 + 30:
        return

    # Diagnostic logging for stream freshness
    quote_age = (monotonic_now - writer.last_quote_monotonic) if writer.last_quote_monotonic is not None else 0.0
    if quote_age > 60.0:
        LOG.warning("Stream freshness warning: last_quote_age=%.1f seconds", quote_age)
    else:
        LOG.debug("Stream freshness: last_quote_age=%.1f seconds", quote_age)

    # Stale threshold set to 120 seconds (2 minutes) to prevent crashes on brief network hiccups
    limit = max(float(settings.candle_watchdog_seconds), 120.0)

    # Grace period: Skip freshness assertions for 60 seconds after a connection/reconnection
    if monotonic_now - writer.last_reconnect_monotonic < 60.0:
        return

    quote_stale = (
        writer.last_quote_monotonic is None
        or (monotonic_now - writer.last_quote_monotonic > limit)
    )
    candle_stale = (
        writer.last_candle_monotonic is None
        or (monotonic_now - writer.last_candle_monotonic > limit)
    )

    if quote_stale and candle_stale:
        if monotonic_now - writer.last_reconnect_monotonic > limit:
            raise RuntimeError("Upstox market-data stream produced no usable ticks; restarting the paper worker")
        LOG.warning("Upstox market-data stream delayed under 120s threshold; waiting for recovery...")
        return

    if candle_stale:
        if monotonic_now - writer.last_reconnect_monotonic > limit:
            raise RuntimeError("Upstox one-minute candle stream is stale; restarting the paper worker")
        LOG.warning("Upstox candle stream delayed under 120s threshold; waiting for recovery...")
        return

    if quote_stale:
        LOG.warning("Upstox quote stream stale, but candle stream healthy. Continuing.")

    for key, label in (
        (settings.market_index_instrument_key, settings.market_index_symbol),
        (settings.vix_instrument_key, settings.vix_symbol),
    ):
        timestamp = writer.last_candle_timestamp_by_key.get(key)
        if timestamp is None:
            if monotonic_now - writer.started_monotonic > limit:
                raise RuntimeError(f"mandatory {label} feed produced no one-minute candles")
            continue
        age = (wall_now.astimezone(timezone.utc) - timestamp.astimezone(timezone.utc)).total_seconds()
        if age < 0 or age > limit:
            raise RuntimeError(f"mandatory {label} one-minute candle is stale ({age:.0f}s old)")


def _positive_float(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None
