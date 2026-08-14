from datetime import datetime, timedelta, timezone

import pandas as pd

from engine.config import Settings
from engine.strategies import scan_symbol


def settings(tmp_path):
    universe = tmp_path / "universe.json"
    universe.write_text('[{"symbol":"TEST","sources":["NIFTY 500"]}]')
    return Settings("", tmp_path / "test.duckdb", tmp_path / "signals.json", universe,
                    max_symbols=1, min_daily_value=1, min_relative_volume=1, max_spread_bps=20)


def bars(now, stale=False, wide_spread=False):
    rows = []
    end = now - timedelta(minutes=10) if stale else now
    for day in range(2):
        base = end - timedelta(days=1-day, minutes=19)
        for minute in range(20):
            price = 200 + minute * 0.02
            if day == 1 and minute == 19:
                price = 203
            rows.append({"instrument_key":"NSE_EQ|TEST", "symbol":"TEST",
                "ts": base + timedelta(minutes=minute),
                "open":price-.05, "high":price+.1, "low":price-.1, "close":price,
                "volume":1000 if day == 0 else 1500, "bid":price-.02,
                "ask":price + (0.5 if wide_spread else .02), "received_at":now})
    return pd.DataFrame(rows)


def test_stale_data_is_no_trade(tmp_path):
    now = datetime.now(timezone.utc)
    assert scan_symbol(bars(now, stale=True), settings(tmp_path), now) == []


def test_wide_spread_is_no_trade(tmp_path):
    now = datetime.now(timezone.utc)
    assert scan_symbol(bars(now, wide_spread=True), settings(tmp_path), now) == []


def test_orb_uses_atr_risk_levels(tmp_path):
    now = datetime.now(timezone.utc)
    signals = scan_symbol(bars(now), settings(tmp_path), now)
    assert any(signal.strategy == "ORB_15M" for signal in signals)
    signal = signals[0]
    assert signal.stop < signal.entry < signal.target
    assert round((signal.target - signal.entry) / (signal.entry - signal.stop), 6) == 2


def test_price_outside_configured_cmp_range_is_no_trade(tmp_path):
    now = datetime.now(timezone.utc)
    frame = bars(now)
    frame.loc[:, ["open", "high", "low", "close", "bid", "ask"]] += 600
    assert scan_symbol(frame, settings(tmp_path), now) == []
