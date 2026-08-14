from datetime import datetime, timedelta, timezone

from engine.store import MarketStore


def _row(ts):
    return {
        "instrument_key": "4.1!1", "symbol": "TEST", "ts": ts,
        "open": 200.0, "high": 201.0, "low": 199.0, "close": 200.5,
        "volume": 1000, "bid": 200.4, "ask": 200.5, "received_at": datetime.now(timezone.utc),
    }


def test_single_bar_upsert_and_retention(tmp_path):
    store = MarketStore(tmp_path / "market.duckdb")
    now = datetime.now(timezone.utc)
    store.upsert_bar(_row(now - timedelta(days=15)))
    store.upsert_bar(_row(now))
    assert store.prune(14) == 1
    assert len(store.bars("TEST")) == 1
    assert len(store.bars_for_symbols(["TEST"])) == 1
    assert store.bars_for_symbols([]).empty
