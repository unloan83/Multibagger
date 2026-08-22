from datetime import datetime, timedelta, timezone

import pandas as pd

from engine.config import Settings
from engine.regime_detector import detect_regime
from engine.strategies import classify_price_trend, enrich, scan_symbol


def settings(tmp_path):
    universe = tmp_path / "universe.json"
    universe.write_text('[{"symbol":"TEST","sources":["NIFTY 500"]}]')
    return Settings(
        access_token="",
        db_path=tmp_path / "test.duckdb",
        snapshot_path=tmp_path / "signals.json",
        universe_path=universe,
        max_symbols=1,
        min_daily_value=1,
        min_relative_volume=1,
        max_spread_bps=20,
        min_intraday_atr_pct=0.05,
        max_breakout_extension_atr=2.1,
        min_atr_stop_pct=0.1,
        min_confluence_score=50.0,
        min_average_volume=1,
        min_average_daily_range_pct=0.01,
    )


def bars(now, stale=False, wide_spread=False):
    rows = []
    end = now - timedelta(minutes=10) if stale else now
    for day in range(2):
        base = end - timedelta(days=1-day, minutes=19)
        for minute in range(20):
            price = 200 + minute * 0.02
            if day == 1 and minute == 16:
                price = 200.9
            elif day == 1 and minute == 17:
                price = 200.45
            elif day == 1 and minute == 18:
                price = 200.7
            elif day == 1 and minute == 19:
                price = 200.9
            rows.append({"instrument_key":"NSE_EQ|TEST", "symbol":"TEST",
                "ts": base + timedelta(minutes=minute),
                "open":price-.05, "high":price+.1, "low":price-.1, "close":price,
                "volume":1000 if day == 0 else (3500 if minute == 19 else 1500), "bid":price-.02,
                "ask":price + (0.5 if wide_spread else .02), "received_at":now})
    return pd.DataFrame(rows)


def test_stale_data_is_no_trade(tmp_path):
    now = datetime.now(timezone.utc)
    assert scan_symbol(bars(now, stale=True), settings(tmp_path), now) == []


def test_wide_spread_is_no_trade(tmp_path):
    now = datetime.now(timezone.utc)
    assert scan_symbol(bars(now, wide_spread=True), settings(tmp_path), now) == []


def test_trending_strategy_uses_atr_risk_levels(tmp_path):
    now = datetime.now(timezone.utc)
    signals = scan_symbol(bars(now), settings(tmp_path), now, regime="TRENDING")
    assert any(signal.strategy == "VWAP_PULLBACK_CONTINUATION" for signal in signals)
    signal = signals[0]
    assert signal.stop < signal.entry < signal.target
    assert round((signal.target - signal.entry) / (signal.entry - signal.stop), 6) == 2


def test_price_outside_configured_cmp_range_is_no_trade(tmp_path):
    now = datetime.now(timezone.utc)
    frame = bars(now)
    frame.loc[:, ["open", "high", "low", "close", "bid", "ask"]] += 600
    assert scan_symbol(frame, settings(tmp_path), now) == []


def test_reverse_orb_conditions_create_only_short_setup(tmp_path):
    now = datetime.now(timezone.utc)
    frame = bars(now)
    old_high, old_low = frame.high.copy(), frame.low.copy()
    old_bid, old_ask = frame.bid.copy(), frame.ask.copy()
    for column in ("open", "close"):
        frame[column] = 400 - frame[column]
    frame["high"], frame["low"] = 400 - old_low, 400 - old_high
    frame["bid"], frame["ask"] = 400 - old_ask, 400 - old_bid
    signals = scan_symbol(frame, settings(tmp_path), now, regime="TRENDING")
    assert signals and {signal.side for signal in signals} == {"SHORT"}


def test_range_is_explicit_no_direction(tmp_path):
    now = datetime.now(timezone.utc)
    frame = enrich(bars(now))
    frame.loc[frame.index[-4:], "close"] = frame.iloc[:15].close.mean()
    assert classify_price_trend(frame, now, 120) == "RANGE"


def test_regime_fails_closed_when_required_inputs_are_missing(tmp_path):
    now = datetime.now(timezone.utc)
    result = detect_regime(pd.DataFrame(), pd.DataFrame(), None, settings(tmp_path), now)
    assert result.regime == "TRANSITION"
    assert "REGIME_INPUT_UNAVAILABLE" in result.skip_reasons


def test_vix_above_20_forces_high_vol_no_trade(tmp_path):
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    rows = []
    for minute in range(30):
        price = 22000 + minute
        rows.append({"ts": now - timedelta(minutes=29-minute), "open": price - 1,
                     "high": price + 2, "low": price - 2, "close": price})
    vix = pd.DataFrame([{"ts": now, "close": 21.0}])
    result = detect_regime(pd.DataFrame(rows), vix, 2.0, settings(tmp_path), now)
    assert result.regime == "HIGH_VOL"
    assert "VIX_ABOVE_20" in result.skip_reasons
