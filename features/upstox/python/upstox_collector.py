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
import duckdb

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
        self.rest_key_aliases: dict[str, str] = {}
        for instrument_key, symbol in instruments.items():
            segment, separator, _token = instrument_key.partition("|")
            self.rest_key_aliases[instrument_key] = instrument_key
            if separator:
                self.rest_key_aliases[f"{segment}:{symbol}"] = instrument_key
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
            key = self.rest_key_aliases.get(raw_key)
            if not key:
                continue
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

    def check_health(self, monotonic_now: float | None = None, wall_now: datetime | None = None) -> tuple[bool, str]:
        """
        Production Feed Health Check:
        Requires active tick flow and non-zero tick counts during active market hours.
        Process alive != data healthy.
        Zero or frozen tick condition automatically returns False (DATA_UNHEALTHY).
        """
        from engine.trading_calendar import get_market_session_state
        m_now = monotonic_now if monotonic_now is not None else time.monotonic()
        w_now = wall_now if wall_now is not None else datetime.now(timezone.utc)
        session = get_market_session_state(w_now)

        if self.quote_ticks == 0 and self.candle_ticks == 0:
            if session["is_market_open"]:
                return False, "DATA_UNHEALTHY: 0 quote_ticks and 0 candle_ticks during active market session"
            else:
                return False, f"DATA_UNAVAILABLE: 0 ticks recorded ({session['session_type']})"

        if session["is_market_open"]:
            quote_age = m_now - self.last_quote_monotonic if self.last_quote_monotonic else 9999.0
            if quote_age > 120.0:
                return False, f"DATA_UNHEALTHY: Quote ticks frozen (no new ticks for {quote_age:.1f}s)"

        return True, f"DATA_HEALTHY: quote_ticks={self.quote_ticks}, candle_ticks={self.candle_ticks}"


def collect_upstox(settings: Settings, on_market_data: Callable[[], None] | None = None) -> None:
    if not settings.access_token:
        raise RuntimeError("UPSTOX_ACCESS_TOKEN is required")
    if settings.market_data_provider != "upstox":
        raise RuntimeError("Upstox collector requires MARKET_DATA_PROVIDER=upstox")

    store = MarketStore(settings.db_path)
    instruments = resolve_upstox_instruments(settings, store)
    writer = UpstoxTickWriter(store, instruments)
    stop = threading.Event()

    from engine.degraded import DEGRADED_MANAGER

    LOG.info("Upstox market-data collector active (REST Market Quote Engine)")

    last_log = time.monotonic()
    while not stop.wait(3):
        try:
            quotes = fetch_upstox_quotes_rest(settings.access_token, list(instruments.keys()))
            if quotes:
                writer.ingest_quotes_dict(quotes)
                flushed = writer.flush()
                if flushed and on_market_data:
                    on_market_data()

                now = time.monotonic()
                is_healthy, health_reason = writer.check_health(now, datetime.now(timezone.utc))

                if is_healthy:
                    DEGRADED_MANAGER.report_recovery("DATABASE")
                    DEGRADED_MANAGER.report_recovery("AUTH")
                    DEGRADED_MANAGER.report_recovery("MARKET_DATA")
                    if now - last_log >= 60:
                        LOG.info("Upstox feed healthy; quote_ticks=%d candle_ticks=%d", writer.quote_ticks, writer.candle_ticks)
                        last_log = now
                else:
                    if now - last_log >= 60:
                        LOG.warning("Upstox feed UNHEALTHY: %s", health_reason)
                        last_log = now
                    DEGRADED_MANAGER.report_failure("MARKET_DATA", health_reason)
        except Exception as error:
            LOG.warning("Upstox market-data fetch error: %s", error)
            dependency = _failure_dependency(error)
            reason = (
                "Upstox authorization failed (HTTP 401)"
                if dependency == "AUTH"
                else f"Upstox market-data fetch error: {error}"
            )
            DEGRADED_MANAGER.report_failure(dependency, reason)


def _failure_dependency(error: Exception) -> str:
    if isinstance(error, duckdb.Error):
        return "DATABASE"
    if "401" in str(error):
        return "AUTH"
    return "MARKET_DATA"


def fetch_upstox_quotes_rest(access_token: str, instrument_keys: list[str]) -> dict[str, Any]:
    """Fetch live quotes via Upstox REST API in batches of 50 instrument keys using ThreadPoolExecutor with rate limiting."""
    import urllib.request, urllib.parse, json, time, threading
    from urllib.error import HTTPError
    from concurrent.futures import ThreadPoolExecutor, as_completed
    results: dict[str, Any] = {}
    headers = {
        'Authorization': f'Bearer {access_token}',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }
    batch_size = 50
    chunks = [instrument_keys[i:i + batch_size] for i in range(0, len(instrument_keys), batch_size)]

    rate_limit_lock = threading.Lock()
    last_req_time = [0.0]

    def _fetch_chunk(chunk: list[str]) -> dict[str, Any]:
        encoded_chunk = [urllib.parse.quote(k, safe='|:') for k in chunk]
        url = f"https://api.upstox.com/v2/market-quote/quotes?instrument_key={','.join(encoded_chunk)}"

        for attempt in range(1, 4):
            with rate_limit_lock:
                now_t = time.monotonic()
                elapsed = now_t - last_req_time[0]
                if elapsed < 0.10:
                    time.sleep(0.10 - elapsed)
                last_req_time[0] = time.monotonic()

            try:
                req = urllib.request.Request(url, headers=headers)
                with urllib.request.urlopen(req, timeout=10) as resp:
                    data = json.load(resp)
                    if data.get("status") == "success" and data.get("data"):
                        return data["data"]
            except HTTPError as http_err:
                if http_err.code == 429 and attempt < 3:
                    backoff = 0.5 * (2 ** (attempt - 1))
                    time.sleep(backoff)
                    continue
                LOG.debug("Failed to fetch Upstox quotes batch (HTTP %s): %s", getattr(http_err, 'code', 'error'), http_err)
                break
            except Exception as e:
                LOG.debug("Failed to fetch Upstox quotes batch: %s", e)
                break
        return {}

    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(_fetch_chunk, chunk) for chunk in chunks]
        for future in as_completed(futures):
            try:
                res = future.result()
                if res:
                    results.update(res)
            except Exception as exc:
                LOG.debug("Upstox quote worker exception: %s", exc)

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
