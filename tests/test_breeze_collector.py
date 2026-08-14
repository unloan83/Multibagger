from datetime import timezone

from engine.breeze_collector import BreezeTickWriter, _india_timestamp, _subscription_ok
from engine.breeze_backfill import _history_timestamp, _two_day_chunks
from datetime import date


class Store:
    def __init__(self):
        self.rows = []

    def upsert_bars(self, frame):
        self.rows.extend(frame.to_dict("records"))
        return len(frame)


def test_breeze_quote_and_candle_are_joined():
    store = Store()
    writer = BreezeTickWriter(store, {"4.1!2885": {"symbol": "RELIANCE", "stock_code": "RELIND"}})
    writer.on_ticks({"quotes": "Quotes Data", "symbol": "4.1!2885", "bPrice": 1200, "sPrice": 1200.2})
    writer.on_ticks({"interval": "1minute", "stock_code": "RELIND", "open": "1199", "high": "1201",
                     "low": "1198", "close": "1200", "volume": "1000", "datetime": "2026-08-13 10:04:00"})
    assert len(store.rows) == 0
    assert writer.flush() == 1
    assert len(store.rows) == 1
    assert store.rows[0]["symbol"] == "RELIANCE"
    assert store.rows[0]["bid"] == 1200
    assert store.rows[0]["ask"] == 1200.2
    assert store.rows[0]["ts"].tzinfo == timezone.utc


def test_breeze_candle_batch_deduplicates_same_minute():
    store = Store()
    writer = BreezeTickWriter(store, {"4.1!2885": {"symbol": "RELIANCE", "stock_code": "RELIND"}})
    candle = {"interval": "1minute", "stock_code": "RELIND", "open": "1199", "high": "1201",
              "low": "1198", "close": "1200", "volume": "1000", "datetime": "2026-08-13 10:04:00"}
    writer.on_ticks(candle)
    writer.on_ticks({**candle, "close": "1200.5"})
    assert writer.flush() == 1
    assert store.rows[0]["close"] == 1200.5


def test_india_timestamp_is_converted_to_utc():
    assert _india_timestamp("2026-08-13 10:04:00").isoformat() == "2026-08-13T04:34:00+00:00"


def test_subscription_requires_success_message():
    assert _subscription_ok({"message": "Stock subscribed successfully"})
    assert not _subscription_ok("Exception while subscribing to feeds")


def test_breeze_backfill_chunks_and_timestamp():
    assert list(_two_day_chunks(date(2026, 8, 6), date(2026, 8, 10))) == [
        (date(2026, 8, 6), date(2026, 8, 7)),
        (date(2026, 8, 8), date(2026, 8, 9)),
        (date(2026, 8, 10), date(2026, 8, 10)),
    ]
    assert _history_timestamp("2026-08-13 10:04:00").isoformat() == "2026-08-13T04:34:00+00:00"
