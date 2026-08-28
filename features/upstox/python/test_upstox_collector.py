import sys
import threading
import gzip
import json
from datetime import datetime, timezone
from types import SimpleNamespace

import duckdb
import pytest

from features.upstox.python.upstox_collector import (
    UpstoxTickWriter,
    _assert_stream_freshness,
    _failure_dependency,
    collect_upstox,
    nse_instrument_master,
    resolve_upstox_instruments,
)


def test_fetch_failures_are_classified_without_false_websocket_incidents():
    assert _failure_dependency(duckdb.IOException("write lock")) == "DATABASE"
    assert _failure_dependency(RuntimeError("HTTP 401 Unauthorized")) == "AUTH"
    assert _failure_dependency(RuntimeError("HTTP 503")) == "MARKET_DATA"


class Store:
    def __init__(self):
        self.rows = []

    def upsert_bars(self, frame):
        self.rows.extend(frame.to_dict("records"))
        return len(frame)


class InstrumentStore:
    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        def execute(self, *_args):
            return self

    def connect(self):
        return self.Connection()


def test_market_index_is_resolved_first_for_direction_warmup(monkeypatch):
    nse_instrument_master.cache_clear()
    rows = [
        {"segment": "NSE_EQ", "instrument_type": "EQ", "trading_symbol": "ONE", "instrument_key": "NSE_EQ|ONE"},
        {"segment": "NSE_FO", "instrument_type": "FUT", "underlying_type": "EQUITY", "underlying_symbol": "ONE"},
        {"instrument_key": "NSE_INDEX|Nifty 50", "trading_symbol": "Nifty 50"},
        {"instrument_key": "NSE_INDEX|India VIX", "trading_symbol": "India VIX"},
    ]
    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        def read(self):
            return gzip.compress(json.dumps(rows).encode())

    response = Response()
    monkeypatch.setattr("urllib.request.urlopen", lambda *_args, **_kwargs: response)
    settings = SimpleNamespace(
        symbols=lambda: ["ONE"], max_symbols=1,
        market_index_instrument_key="NSE_INDEX|Nifty 50", market_index_symbol="NIFTY 50",
        vix_instrument_key="NSE_INDEX|India VIX", vix_symbol="INDIA VIX",
    )
    resolved = resolve_upstox_instruments(settings, InstrumentStore())
    assert next(iter(resolved.items())) == ("NSE_INDEX|Nifty 50", "NIFTY 50")


def test_upstox_v3_tick_is_batched_with_executable_quote():
    store = Store()
    writer = UpstoxTickWriter(store, {"NSE_EQ|TEST": "TEST"})
    writer.on_message({"feeds": {"NSE_EQ|TEST": {"fullFeed": {"marketFF": {
        "marketLevel": {"bidAskQuote": [{"bidP": 199.8, "askP": 200.0}]},
        "marketOHLC": {"ohlc": [{"interval": "I1", "ts": "1786944600000", "open": 198,
                                     "high": 201, "low": 197, "close": 199.9, "vol": 1000}]},
    }}}}})
    assert writer.flush() == 1
    assert store.rows[0]["symbol"] == "TEST"
    assert store.rows[0]["bid"] == 199.8
    assert store.rows[0]["ask"] == 200.0


def test_rest_equity_symbol_key_maps_to_canonical_instrument_key():
    store = Store()
    writer = UpstoxTickWriter(store, {"NSE_EQ|INE002A01018": "RELIANCE"})

    writer.ingest_quotes_dict({
        "NSE_EQ:RELIANCE": {
            "last_price": 1400.0,
            "ohlc": {"open": 1390.0, "high": 1410.0, "low": 1385.0, "close": 1400.0},
            "volume": 1000,
            "depth": {
                "buy": [{"price": 1399.9}],
                "sell": [{"price": 1400.1}],
            },
        },
    })

    assert writer.flush() == 1
    assert store.rows[0]["instrument_key"] == "NSE_EQ|INE002A01018"
    assert store.rows[0]["symbol"] == "RELIANCE"


def test_upstox_v3_index_tick_is_stored_without_order_book():
    store = Store()
    writer = UpstoxTickWriter(store, {"NSE_INDEX|Nifty 50": "NIFTY 50"})
    writer.on_message({"feeds": {"NSE_INDEX|Nifty 50": {"fullFeed": {"indexFF": {
        "marketOHLC": {"ohlc": [{"interval": "I1", "ts": "1786944600000", "open": 24500,
                                     "high": 24510, "low": 24490, "close": 24505, "vol": 0}]},
    }}}}})
    assert writer.flush() == 1
    assert store.rows[0]["symbol"] == "NIFTY 50"
    assert store.rows[0]["bid"] is None and store.rows[0]["ask"] is None


def test_upstox_v3_equity_tick_without_executable_quote_is_rejected():
    store = Store()
    writer = UpstoxTickWriter(store, {"NSE_EQ|TEST": "TEST"})
    writer.on_message({"feeds": {"NSE_EQ|TEST": {"fullFeed": {"marketFF": {
        "marketOHLC": {"ohlc": [{"interval": "I1", "ts": "1786944600000", "open": 198,
                                     "high": 201, "low": 197, "close": 199.9, "vol": 1000}]},
    }}}}})
    assert writer.flush() == 0


def test_upstox_watchdog_detects_stalled_candles():
    writer = UpstoxTickWriter(Store(), {})
    writer.started_monotonic = 700
    writer.last_reconnect_monotonic = 700
    writer.last_quote_monotonic = 1_000
    writer.last_candle_monotonic = 700
    market_time = datetime(2026, 8, 17, 4, 30, tzinfo=timezone.utc)
    settings = _watchdog_settings()
    with pytest.raises(RuntimeError, match="candle stream is stale"):
        _assert_stream_freshness(writer, settings, 1_000, market_time)


def test_upstox_watchdog_detects_stream_that_never_produces_ticks():
    writer = UpstoxTickWriter(Store(), {})
    writer.started_monotonic = 700
    writer.last_reconnect_monotonic = 700
    writer.last_quote_monotonic = None
    market_time = datetime(2026, 8, 17, 4, 30, tzinfo=timezone.utc)
    with pytest.raises(RuntimeError, match="produced no usable ticks"):
        _assert_stream_freshness(writer, _watchdog_settings(), 1_000, market_time)


def test_upstox_watchdog_detects_missing_mandatory_index_candles():
    writer = UpstoxTickWriter(Store(), {})
    writer.started_monotonic = 700
    writer.last_reconnect_monotonic = 700
    writer.last_quote_monotonic = 1_000
    writer.last_candle_monotonic = 1_000
    market_time = datetime(2026, 8, 17, 4, 30, tzinfo=timezone.utc)
    with pytest.raises(RuntimeError, match="mandatory NIFTY 50 feed produced no"):
        _assert_stream_freshness(writer, _watchdog_settings(), 1_000, market_time)


def _watchdog_settings():
    return SimpleNamespace(
        candle_watchdog_seconds=180,
        market_index_instrument_key="NSE_INDEX|Nifty 50", market_index_symbol="NIFTY 50",
        vix_instrument_key="NSE_INDEX|India VIX", vix_symbol="INDIA VIX",
    )


def test_async_upstox_connect_stays_alive_until_reconnects_are_exhausted(monkeypatch, tmp_path):
    connected = threading.Event()
    streamers = []

    class FakeStreamer:
        def __init__(self, *_args):
            self.listeners = {}
            streamers.append(self)

        def on(self, event, listener):
            self.listeners[event] = listener

        def auto_reconnect(self, *_args):
            pass

        def connect(self):
            self.listeners["open"]()
            connected.set()

        def disconnect(self):
            pass

    fake_upstox = SimpleNamespace(
        Configuration=lambda: SimpleNamespace(access_token=None),
        ApiClient=lambda config: config,
        MarketDataStreamerV3=FakeStreamer,
    )
    monkeypatch.setitem(sys.modules, "upstox_client", fake_upstox)
    monkeypatch.setattr("features.upstox.python.upstox_collector.MarketStore", lambda _path: Store())
    monkeypatch.setattr(
        "features.upstox.python.upstox_collector.resolve_upstox_instruments",
        lambda _settings, _store: {"NSE_EQ|TEST": "TEST"},
    )
    settings = SimpleNamespace(
        access_token="token", market_data_provider="upstox", db_path=tmp_path / "market.duckdb",
        candle_watchdog_seconds=180,
    )
    errors = []
    thread = threading.Thread(target=lambda: _capture_error(errors, collect_upstox, settings))
    thread.start()
    assert connected.wait(timeout=2)
    assert thread.is_alive()
    streamers[0].listeners["autoReconnectStopped"]("retry limit reached")
    thread.join(timeout=2)
    assert not thread.is_alive()
    assert len(errors) == 1
    assert "reconnects exhausted" in str(errors[0])


def _capture_error(errors, function, *args):
    try:
        function(*args)
    except Exception as error:
        errors.append(error)
