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
        self.last_quote_monotonic: float | None = None
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
            quotes = ((market_full.get("marketLevel") or {}).get("bidAskQuote") or [])
            best = quotes[0] if quotes else {}
            bid, ask = _positive_float(best.get("bidP")), _positive_float(best.get("askP"))
            if bid is not None and ask is not None and ask > bid:
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

    def flush(self) -> int:
        with self.lock:
            rows = list(self.pending.values())
            self.pending.clear()
        if not rows:
            return 0
        try:
            return self.store.upsert_bars(pd.DataFrame(rows))
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
    streamer = upstox_client.MarketDataStreamerV3(
        upstox_client.ApiClient(config), list(instruments), "full",
    )
    writer = UpstoxTickWriter(store, instruments)
    failure: list[Exception] = []
    stop = threading.Event()
    opened = threading.Event()

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
        if "401 Unauthorized" in str(error):
            fail(RuntimeError("Upstox market-data stream authorization failed"))

    def on_reconnect_stopped(reason: object) -> None:
        fail(RuntimeError(f"Upstox market-data reconnects exhausted: {reason}"))

    def monitor() -> None:
        last_log = time.monotonic()
        while not stop.wait(1):
            try:
                flushed = writer.flush()
                if flushed and on_market_data:
                    on_market_data()
                now = time.monotonic()
                _assert_stream_freshness(writer, settings, now, datetime.now(timezone.utc))
                if now - last_log >= 60:
                    LOG.info("Upstox feed healthy; quote_ticks=%d candle_ticks=%d", writer.quote_ticks, writer.candle_ticks)
                    last_log = now
            except Exception as error:
                send_telegram_message(
                    "🔴 Upstox paper entries stopped — market-data failure\n"
                    f"Reason: {str(error)[:500]}\n"
                    "Trading remains fail-closed. Action is required before the daily target can be pursued.",
                    event_key="upstox-market-data-blocked",
                    cooldown_seconds=900,
                )
                fail(error)

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

    def do_connect() -> None:
        opened.clear()
        streamer.connect()
        if not opened.wait(timeout=60):
            raise RuntimeError("Upstox market-data stream did not open within 60 seconds")

    try:
        reconnect_with_backoff(do_connect, max_attempts=10, logger=LOG)
        while not stop.wait(1):
            pass
    finally:
        stop.set()
        try:
            streamer.disconnect()
        except Exception:
            pass
        watcher.join(timeout=5)
        writer.flush()
    if failure:
        raise failure[0]


def _assert_stream_freshness(writer: UpstoxTickWriter, settings: Settings, monotonic_now: float,
                             wall_now: datetime) -> None:
    local = wall_now.astimezone(IST)
    minute = local.hour * 60 + local.minute
    if local.weekday() >= 5 or not 9 * 60 + 16 <= minute <= 15 * 60 + 30:
        return

    # Diagnostic logging before freshness assertions
    quote_age = (monotonic_now - writer.last_quote_monotonic) if writer.last_quote_monotonic is not None else None
    LOG.info("Stream freshness: last_quote_age=%s seconds", f"{quote_age:.1f}" if quote_age is not None else "N/A")

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
