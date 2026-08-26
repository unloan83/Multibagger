from __future__ import annotations

import logging
import re
import signal
import threading
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from typing import Any

import pandas as pd
import socketio

from engine.config import Settings
from engine.store import MarketStore
from features.upstox.python.websocket_handler import reconnect_with_backoff


LOG = logging.getLogger("multibagger.breeze")
IST = ZoneInfo("Asia/Kolkata")


def resolve_breeze_instruments(client: Any, settings: Settings, store: MarketStore) -> dict[str, dict[str, str]]:
    """Resolve NSE symbols through the SDK's bundled ICICI instrument master."""
    resolved: dict[str, dict[str, str]] = {}
    with store.connect() as con:
        cached_rows = con.execute("""
          SELECT instrument_key, symbol, name FROM instruments
          WHERE exchange='NSE' AND updated_at >= now() - INTERVAL '30 days'
        """).fetchall()
    cached = {str(symbol): (str(token), str(stock_code)) for token, symbol, stock_code in cached_rows
              if stock_code and re.fullmatch(r"4\.1!\d+", str(token))}
    for symbol in settings.symbols():
        if symbol in cached:
            token, stock_code = cached[symbol]
            resolved[token] = {"symbol": symbol, "stock_code": stock_code}
            continue
        result = client.get_names(exchange_code="NSE", stock_code=symbol)
        if not isinstance(result, dict) or not result.get("isec_token_level1") or not result.get("isec_stock_code"):
            LOG.warning("Breeze could not resolve NSE symbol %s", symbol)
            continue
        token = str(result["isec_token_level1"])
        if not re.fullmatch(r"4\.1!\d+", token):
            LOG.warning("Breeze returned an ambiguous token for NSE symbol %s; skipping it", symbol)
            continue
        resolved[token] = {
            "symbol": symbol,
            "stock_code": str(result["isec_stock_code"]),
        }
    minimum = max(1, int(settings.max_symbols * 0.8))
    if len(resolved) < minimum:
        raise RuntimeError(
            f"Only {len(resolved)}/{settings.max_symbols} Breeze symbols resolved; refusing partial paper feed"
        )
    now = datetime.now(timezone.utc)
    with store.connect() as con:
        con.execute("DELETE FROM instruments WHERE exchange = 'NSE'")
        for token, item in resolved.items():
            con.execute(
                "INSERT OR REPLACE INTO instruments VALUES (?, ?, ?, 'NSE', ?)",
                [token, item["symbol"], item["stock_code"], now],
            )
    return resolved


class BreezeTickWriter:
    def __init__(self, store: MarketStore, instruments: dict[str, dict[str, str]]):
        self.store = store
        self.by_token = instruments
        self.by_code = {item["stock_code"]: (token, item["symbol"]) for token, item in instruments.items()}
        self.latest_quotes: dict[str, tuple[float | None, float | None]] = {}
        self.pending_bars: dict[tuple[str, datetime], dict[str, Any]] = {}
        self.pending_lock = threading.Lock()
        self.received = 0
        self.quote_ticks = 0
        self.candle_ticks = 0
        self.last_quote_monotonic: float | None = None
        self.last_candle_monotonic: float | None = None

    def on_ticks(self, tick: dict[str, Any]) -> None:
        try:
            if tick.get("interval") == "1minute":
                self._write_candle(tick)
            elif tick.get("quotes") == "Quotes Data":
                self._remember_quote(tick)
        except Exception:
            LOG.exception("Rejected malformed Breeze tick")

    def _remember_quote(self, tick: dict[str, Any]) -> None:
        token = str(tick.get("symbol", ""))
        item = self.by_token.get(token)
        if not item:
            return
        self.latest_quotes[item["symbol"]] = (_positive_float(tick.get("bPrice")), _positive_float(tick.get("sPrice")))
        self.received += 1
        self.quote_ticks += 1
        self.last_quote_monotonic = time.monotonic()

    def _write_candle(self, tick: dict[str, Any]) -> None:
        code = str(tick.get("stock_code", "")).upper()
        resolved = self.by_code.get(code)
        if not resolved:
            return
        token, symbol = resolved
        values = [_positive_float(tick.get(name)) for name in ("open", "high", "low", "close")]
        if any(value is None for value in values):
            return
        timestamp = _india_timestamp(str(tick.get("datetime", "")))
        bid, ask = self.latest_quotes.get(symbol, (None, None))
        row = {
            "instrument_key": token,
            "symbol": symbol,
            "ts": timestamp,
            "open": values[0],
            "high": values[1],
            "low": values[2],
            "close": values[3],
            "volume": max(0, int(float(tick.get("volume") or 0))),
            "bid": bid,
            "ask": ask,
            "received_at": datetime.now(timezone.utc),
        }
        with self.pending_lock:
            self.pending_bars[(token, timestamp)] = row
        self.received += 1
        self.candle_ticks += 1
        self.last_candle_monotonic = time.monotonic()

    def flush(self) -> int:
        with self.pending_lock:
            rows = list(self.pending_bars.values())
            self.pending_bars.clear()
        if not rows:
            return 0
        try:
            return self.store.upsert_bars(pd.DataFrame(rows))
        except Exception:
            with self.pending_lock:
                for row in rows:
                    self.pending_bars[(row["instrument_key"], row["ts"])] = row
            raise


def collect_breeze(settings: Settings) -> None:
    if not all((settings.breeze_api_key, settings.breeze_api_secret, settings.breeze_session_token)):
        raise RuntimeError("BREEZE_API_KEY, BREEZE_API_SECRET and BREEZE_SESSION_TOKEN are required")
    if settings.market_data_provider != "breeze":
        raise RuntimeError("Breeze collector requires MARKET_DATA_PROVIDER=breeze")

    from breeze_connect import BreezeConnect

    store = MarketStore(settings.db_path)
    client = BreezeConnect(api_key=settings.breeze_api_key)
    client.generate_session(
        api_secret=settings.breeze_api_secret,
        session_token=settings.breeze_session_token,
    )
    instruments = resolve_breeze_instruments(client, settings, store)
    writer = BreezeTickWriter(store, instruments)
    client.on_ticks = writer.on_ticks
    client.ws_connect()

    tokens = list(instruments)
    quote_result = client.subscribe_feeds(stock_token=tokens)
    if not _subscription_ok(quote_result):
        raise RuntimeError(f"Breeze quote subscription failed: {quote_result}")
    ohlc_client = _connect_ohlc_stream(client, tokens, writer)
    LOG.info(
        "Breeze paper feed subscribed to %d NSE symbols (quotes=%s, candles=%s)",
        len(tokens), _subscription_ok(quote_result), ohlc_client.connected,
    )

    stop = threading.Event()

    def request_stop(_signum: int, _frame: Any) -> None:
        stop.set()

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    last_health_log = time.monotonic()
    while not stop.wait(1):
        try:
            writer.flush()
        except Exception:
            LOG.exception("Breeze candle batch flush failed")
        if time.monotonic() - last_health_log >= 60:
            _assert_stream_freshness(writer, settings, time.monotonic(), datetime.now(timezone.utc))
            LOG.info(
                "Breeze paper feed healthy; quote_ticks=%d candle_ticks=%d",
                writer.quote_ticks, writer.candle_ticks,
            )
            last_health_log = time.monotonic()
    writer.flush()
    ohlc_client.disconnect()
    client.ws_disconnect()


def _positive_float(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _india_timestamp(value: str) -> datetime:
    parsed = pd.Timestamp(value)
    if parsed.tzinfo is None:
        parsed = parsed.tz_localize("Asia/Kolkata")
    return parsed.tz_convert("UTC").to_pydatetime()


def _subscription_ok(result: Any) -> bool:
    return isinstance(result, dict) and "success" in str(result.get("message", "")).lower()


def _assert_stream_freshness(writer: BreezeTickWriter, settings: Settings, monotonic_now: float,
                             wall_now: datetime) -> None:
    """Fail the worker so systemd reconnects when an active NSE stream silently stalls."""
    local = wall_now.astimezone(IST)
    minute = local.hour * 60 + local.minute
    if local.weekday() >= 5 or not 9 * 60 + 16 <= minute <= 15 * 60 + 30:
        return
    # No data at all can be a market holiday. Once either stream has become active,
    # both feeds must remain current during the session.
    if writer.last_quote_monotonic is None and writer.last_candle_monotonic is None:
        return
    limit = settings.candle_watchdog_seconds
    if writer.last_quote_monotonic is None or monotonic_now - writer.last_quote_monotonic > limit:
        raise RuntimeError("Breeze quote stream is stale; restarting the paper worker")
    if writer.last_candle_monotonic is None or monotonic_now - writer.last_candle_monotonic > limit:
        raise RuntimeError("Breeze one-minute candle stream is stale; restarting the paper worker")


def _connect_ohlc_stream(client: Any, tokens: list[str], writer: BreezeTickWriter, attempts: int = 10) -> socketio.Client:
    """Connect to Breeze's documented OHLC Socket.IO channel with exponential backoff."""
    def try_connect() -> socketio.Client:
        stream = socketio.Client(reconnection=True, reconnection_attempts=0)

        @stream.event
        def connect() -> None:
            stream.emit("join", tokens)

        @stream.on("1MIN")
        def on_minute(data: str) -> None:
            writer.on_ticks(client.parse_ohlc_data(data))

        stream.connect(
            "https://breezeapi.icicidirect.com",
            socketio_path="ohlcvstream",
            headers={"User-Agent": "python-socketio[client]/socket"},
            auth={"user": client.user_id, "token": client.session_key},
            transports=["websocket"],
            wait_timeout=20,
        )
        if stream.connected:
            return stream
        raise RuntimeError("Breeze socket stream created but not connected")

    return reconnect_with_backoff(try_connect, max_attempts=attempts, logger=LOG)

