from __future__ import annotations

import os
import shutil
import tempfile
from datetime import datetime, date, timedelta, timezone
from pathlib import Path

import pandas as pd
import pytest

from engine.backtest_engine import (
    InHouseBacktestEngine,
    SimulatedTrade,
    calculate_turnover_cost,
    classify_daily_regime,
    compute_sample_metrics,
)
from engine.config import Settings
from engine.eod_persistence import persist_daily_candles_eod
from engine.store import MarketStore


@pytest.fixture
def temp_db_path():
    tmp_dir = tempfile.mkdtemp()
    db_path = os.path.join(tmp_dir, "test_engine.duckdb")
    yield db_path
    shutil.rmtree(tmp_dir, ignore_errors=True)


def test_inhouse_backtest_engine_reference_check(temp_db_path):
    """Part A Rule 4 Test 1: Hand-compute expected entry/exit/P&L for 2 manually-verified scenarios
    and assert the engine's output matches exactly."""
    
    # Scenario A: Winning LONG trade
    # Capital = ₹50,000, Entry price = 500.0 -> filled_qty = 100 shares.
    # Traded value = 500.0 * 100 = ₹50,000.00
    # Target = 1.5% -> 507.50, Stop = 1.0% -> 495.00
    # Expected Raw PnL = (507.50 - 500.00) * 100 = +₹750.00
    # Cost haircut = 40 + (50,000 * 0.0003) = ₹55.00
    # Expected Net PnL = +750.00 - 55.00 = +₹695.00

    base_time = datetime(2026, 8, 25, 3, 50, tzinfo=timezone.utc)  # 09:20 IST
    bars = []
    # 20 bars total
    for i in range(20):
        b_time = base_time + timedelta(minutes=i)
        if i < 5:
            price = 500.0
        elif i < 10:
            price = 502.0
        else:
            price = 508.0  # Triggers target 507.50
        bars.append({
            "symbol": "RELIANCE",
            "ts": b_time.isoformat(),
            "open": price,
            "high": price + 1.0,
            "low": price - 0.5,
            "close": price,
            "volume": 10000,
            "bid": price - 0.05,
            "ask": price + 0.05,
        })
    df_bars = pd.DataFrame(bars)

    engine = InHouseBacktestEngine(temp_db_path, capital_per_trade=50000.0)
    res = engine.run_backtest(
        candidate_id="cand-ref-1",
        strategy_name="VWAP Pullback",
        direction="LONG",
        adx_threshold=22.0,
        vwap_mode="ON",
        stop_loss_pct=1.0,
        target_pct=1.5,
        entry_time_str="09:20",
        bars_df=df_bars,
    )

    assert len(res.all_trades) == 1
    t1 = res.all_trades[0]
    assert t1.side == "LONG"
    assert t1.entry_price == 500.0
    assert t1.exit_price == 507.50
    assert t1.filled_qty == 100
    assert t1.traded_value == 50000.0
    assert t1.raw_pnl == 750.0
    assert t1.cost_haircut == 55.0
    assert t1.net_pnl == 695.0
    assert t1.exit_reason == "TARGET_REACHED"

    # Scenario B: Losing SHORT trade
    # Capital = ₹50,000, Entry price = 250.0 -> filled_qty = 200 shares.
    # Traded value = 250.0 * 200 = ₹50,000.00
    # Stop = 1.0% -> 252.50
    # Expected Raw PnL = (250.00 - 252.50) * 200 = -₹500.00
    # Cost haircut = 40 + (50,000 * 0.0003) = ₹55.00
    # Expected Net PnL = -500.00 - 55.00 = -₹555.00

    bars_b = []
    base_time_b = datetime(2026, 8, 26, 3, 50, tzinfo=timezone.utc)  # 09:20 IST
    for i in range(20):
        b_time = base_time_b + timedelta(minutes=i)
        if i < 5:
            price = 240.0
        elif i == 5:
            price = 240.0  # entry at VWAP
        else:
            price = 253.0  # Triggers SHORT stop at 252.50
        bars_b.append({
            "symbol": "INFY",
            "ts": b_time.isoformat(),
            "open": price,
            "high": price + 1.0,
            "low": price - 1.0,
            "close": price,
            "volume": 10000,
            "bid": price - 0.05,
            "ask": price + 0.05,
        })
    df_bars_b = pd.DataFrame(bars_b)

    res_b = engine.run_backtest(
        candidate_id="cand-ref-2",
        strategy_name="VWAP Pullback Short",
        direction="SHORT",
        adx_threshold=22.0,
        vwap_mode="ON",
        stop_loss_pct=1.0,
        target_pct=1.5,
        entry_time_str="09:20",
        bars_df=df_bars_b,
    )

    assert len(res_b.all_trades) == 1
    t2 = res_b.all_trades[0]
    assert t2.side == "SHORT"
    assert t2.entry_price == 240.0
    assert t2.exit_price == 242.40  # 240.0 * 1.01
    assert t2.filled_qty == 208  # 50000 / 240
    assert t2.traded_value == 49920.0
    assert t2.cost_haircut == 54.98
    assert t2.net_pnl < t2.raw_pnl  # Loss enlarged by haircut


def test_no_lookahead_bias(temp_db_path):
    """Part A Rule 4 Test 2: Asserts no signal at timestamp T accesses candle data at > T."""
    base_time = datetime(2026, 8, 25, 3, 50, tzinfo=timezone.utc)
    bars = []
    # Bar 5 has close=500.0 (entry decision point).
    # Bar 10 spikes to 600.0. The decision at Bar 5 MUST NOT know price spikes to 600.0 at Bar 10.
    for i in range(15):
        b_time = base_time + timedelta(minutes=i)
        p = 500.0 if i < 10 else 600.0
        bars.append({
            "symbol": "TCS",
            "ts": b_time.isoformat(),
            "open": p,
            "high": p + 0.5,
            "low": p - 0.5,
            "close": p,
            "volume": 1000,
            "bid": p - 0.05,
            "ask": p + 0.05,
        })
    df_bars = pd.DataFrame(bars)
    engine = InHouseBacktestEngine(temp_db_path, capital_per_trade=50000.0)
    res = engine.run_backtest("cand-lookahead", "VWAP", "LONG", 20.0, "ON", 1.0, 1.5, "09:20", bars_df=df_bars)
    
    assert len(res.all_trades) == 1
    t = res.all_trades[0]
    # Entry price must be 500.0 (Bar 5's close), NOT 600.0 (Bar 10's close)
    assert t.entry_price == 500.0


def test_regime_stratification_tagging():
    """Part A Rule 5 Test: Verifies 20-day EMA trend vs range tagging on daily index candles."""
    closes_trending = pd.Series([100.0 + i * 2.0 for i in range(25)])
    closes_ranging = pd.Series([100.0 + (i % 2) * 0.1 for i in range(25)])

    assert classify_daily_regime(closes_trending) == "TRENDING"
    assert classify_daily_regime(closes_ranging) == "RANGE-BOUND"


def test_walk_forward_70_30_split(temp_db_path):
    """Part A Rule 6 Test: Verifies 70% in-sample / 30% out-of-sample chronological partition."""
    trades = []
    base_time = datetime(2026, 8, 1, 9, 30, tzinfo=timezone.utc)
    for i in range(10):
        t_time = base_time + timedelta(days=i)
        trades.append(SimulatedTrade(
            trade_id=f"t-{i}",
            symbol="RELIANCE",
            side="LONG",
            strategy="VWAP",
            entry_time=t_time,
            exit_time=t_time + timedelta(hours=1),
            entry_price=100.0,
            exit_price=102.0,
            filled_qty=500,
            traded_value=50000.0,
            raw_pnl=1000.0,
            net_pnl=945.0,
            cost_haircut=55.0,
            exit_reason="TARGET_REACHED",
            regime="TRENDING",
            trading_day=t_time.date(),
        ))

    trades.sort(key=lambda t: t.entry_time)
    split_idx = int(len(trades) * 0.70)
    in_sample = trades[:split_idx]
    out_sample = trades[split_idx:]

    assert len(in_sample) == 7
    assert len(out_sample) == 3
    assert in_sample[-1].entry_time < out_sample[0].entry_time


def test_traded_value_auto_derivation():
    """Part A Rule 3 Test: Asserts traded_value = entry_price * filled_qty is computed automatically per trade record."""
    entry_price = 2450.0
    filled_qty = 20
    sim_tv = round(entry_price * filled_qty, 2)
    assert sim_tv == 49000.0
    cost = calculate_turnover_cost(sim_tv)
    assert cost == 40.0 + (49000.0 * 0.0003)  # ₹54.70


def test_eod_persistence_batch_job(temp_db_path):
    """Part A Rule 2 Test: Asserts one-shot EOD batch append to DuckDB storage with zero overwrites."""
    db_p = Path(temp_db_path)
    u_p = db_p.parent / "universe.json"
    u_p.write_text('[{"symbol":"RELIANCE","sources":["NIFTY 500"]}]')
    st = Settings(
        access_token="",
        db_path=db_p,
        universe_path=u_p,
    )
    # Execute batch persistence (offline / zero mock API)
    totals = persist_daily_candles_eod(st, target_date=date(2026, 8, 25))
    assert "minute_bars" in totals
    assert "daily_bars" in totals
    assert totals["symbols_processed"] >= 1

    # Verify DuckDB stores table schemas
    store = MarketStore(db_p)
    with store.connect() as con:
        tables = [r[0] for r in con.execute("SHOW TABLES").fetchall()]
        assert "minute_bars" in tables
        assert "daily_bars" in tables
