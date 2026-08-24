from datetime import datetime, timedelta, timezone
import threading
import time

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
    store.upsert_bar(_row(now - timedelta(days=36)))
    store.upsert_bar(_row(now))
    assert store.prune(35) == 1
    assert len(store.bars("TEST")) == 1
    assert len(store.bars_for_symbols(["TEST"])) == 1
    assert store.bars_for_symbols([]).empty


def test_scan_snapshot_excludes_bars_after_its_as_of_time(tmp_path):
    store = MarketStore(tmp_path / "market.duckdb")
    now = datetime.now(timezone.utc)
    store.upsert_bar(_row(now - timedelta(minutes=1)))
    store.upsert_bar(_row(now + timedelta(minutes=1)))
    assert list(store.bars("TEST", through=now).ts) == [now - timedelta(minutes=1)]
    assert list(store.bars_for_symbols(["TEST"], through=now).ts) == [now - timedelta(minutes=1)]


def test_connections_are_serialized_across_store_instances(monkeypatch, tmp_path):
    active = 0
    maximum_active = 0
    counter_lock = threading.Lock()
    first_entered = threading.Event()
    release_first = threading.Event()
    second_entered = threading.Event()

    class Connection:
        def close(self):
            nonlocal active
            with counter_lock:
                active -= 1

    def connect(_path):
        nonlocal active, maximum_active
        with counter_lock:
            active += 1
            maximum_active = max(maximum_active, active)
        return Connection()

    monkeypatch.setattr("engine.store.duckdb.connect", connect)
    first = object.__new__(MarketStore)
    first.path = tmp_path / "market.duckdb"
    second = object.__new__(MarketStore)
    second.path = first.path

    def hold_first_connection():
        with first.connect():
            first_entered.set()
            release_first.wait(timeout=2)

    def open_second_connection():
        with second.connect():
            second_entered.set()

    first_thread = threading.Thread(target=hold_first_connection)
    second_thread = threading.Thread(target=open_second_connection)
    first_thread.start()
    assert first_entered.wait(timeout=2)
    second_thread.start()
    time.sleep(0.05)
    assert not second_entered.is_set()
    assert maximum_active == 1
    release_first.set()
    first_thread.join(timeout=2)
    second_thread.join(timeout=2)
    assert second_entered.is_set()
    assert maximum_active == 1
