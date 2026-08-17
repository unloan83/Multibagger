from __future__ import annotations

import gzip
import json
import logging
import threading
import time
import urllib.request
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd

from engine.config import Settings
from engine.store import MarketStore


LOG = logging.getLogger("multibagger.upstox")
IST = ZoneInfo("Asia/Kolkata")
INSTRUMENTS_URL = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz"


def resolve_upstox_instruments(settings: Settings, store: MarketStore) -> dict[str, str]:
    with urllib.request.urlopen(INSTRUMENTS_URL, timeout=30) as response:
        rows = json.loads(gzip.decompress(response.read()))
    wanted = set(settings.symbols())
    selected = {
        str(row["instrument_key"]): str(row["trading_symbol"])
        for row in rows
        if row.get("segment") == "NSE_EQ" and row.get("instrument_type") == "EQ"
        and row.get("trading_symbol") in wanted and row.get("instrument_key")
    }
    minimum = max(1, int(settings.max_symbols * 0.8))
    if len(selected) < minimum:
        raise RuntimeError(f"Only {len(selected)}/{settings.max_symbols} Upstox symbols resolved; refusing partial paper feed")
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
        self.last_quote_monotonic: float | None = None
        self.last_candle_monotonic: float | None = None

    def on_message(self, message: dict[str, Any]) -> None:
        received = datetime.now(timezone.utc)
        for key, feed in (message.get("feeds") or {}).items():
            symbol = self.instruments.get(key)
            if not symbol:
                continue
            full = (feed.get("fullFeed") or {}).get("marketFF") or {}
            quotes = ((full.get("marketLevel") or {}).get("bidAskQuote") or [])
            best = quotes[0] if quotes else {}
            bid, ask = _positive_float(best.get("bidP")), _positive_float(best.get("askP"))
            if bid is not None and ask is not None and ask > bid:
                self.quote_ticks += 1
                self.last_quote_monotonic = time.monotonic()
            candles = ((full.get("marketOHLC") or {}).get("ohlc") or [])
            minute = next((bar for bar in candles if bar.get("interval") == "I1"), None)
            if not minute or bid is None or ask is None or ask <= bid:
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


def collect_upstox(settings: Settings) -> None:
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
                writer.flush()
                now = time.monotonic()
                _assert_stream_freshness(writer, settings, now, datetime.now(timezone.utc))
                if now - last_log >= 60:
                    LOG.info("Upstox feed healthy; quote_ticks=%d candle_ticks=%d", writer.quote_ticks, writer.candle_ticks)
                    last_log = now
            except Exception as error:
                fail(error)

    streamer.on("open", lambda: opened.set())
    streamer.on("message", writer.on_message)
    streamer.on("error", on_error)
    streamer.on("autoReconnectStopped", on_reconnect_stopped)
    streamer.auto_reconnect(True, 5, 20)
    watcher = threading.Thread(target=monitor, name="upstox-feed-monitor", daemon=True)
    watcher.start()
    try:
        streamer.connect()
        if not opened.wait(timeout=60):
            fail(RuntimeError("Upstox market-data stream did not open within 60 seconds"))
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
    limit = settings.candle_watchdog_seconds
    if writer.last_quote_monotonic is None and writer.last_candle_monotonic is None:
        if monotonic_now - writer.started_monotonic > limit:
            raise RuntimeError("Upstox market-data stream produced no usable ticks; restarting the paper worker")
        return
    if writer.last_quote_monotonic is None or monotonic_now - writer.last_quote_monotonic > limit:
        raise RuntimeError("Upstox quote stream is stale; restarting the paper worker")
    if writer.last_candle_monotonic is None or monotonic_now - writer.last_candle_monotonic > limit:
        raise RuntimeError("Upstox one-minute candle stream is stale; restarting the paper worker")


def _positive_float(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None
