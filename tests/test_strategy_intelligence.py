from __future__ import annotations

import os
import shutil
import tempfile
import pytest
import pandas as pd
from datetime import datetime, timezone

from engine.intelligence import (
    StrategyCandidateParams,
    StrategyCandidate,
    generate_candidate_parameter_sets,
    evaluate_candidate_backtest,
    rank_and_filter_candidates,
    save_candidates_to_store,
    get_candidates_from_store,
    set_active_strategy,
    deactivate_active_strategy,
    get_active_strategy,
    run_strategy_intelligence_pipeline,
    import_algoverse_backtest_result,
    apply_algoverse_haircut,
)
from engine.notifier import send_strategy_proposal_telegram_alert, handle_telegram_callback
from engine.paper_engine import PaperExecutionEngine
from engine.config import Settings
from engine.strategies import evaluate_opportunity


@pytest.fixture
def temp_db():
    tmp_dir = tempfile.mkdtemp()
    db_path = os.path.join(tmp_dir, "test_multibagger.db")
    yield db_path
    shutil.rmtree(tmp_dir, ignore_errors=True)


def test_turnover_cost_haircut_enlarges_losses():
    """Fix 1 Test: Asserts that on a losing trade, post-cost loss is strictly LARGER than pre-cost loss (never smaller)."""
    raw_loss = -200.0
    trade_count = 1
    post_cost_pnl = apply_algoverse_haircut(raw_loss, trade_count, traded_value=100000.0)

    # Post-cost loss MUST be larger (more negative) than raw pre-cost loss
    assert post_cost_pnl < raw_loss
    assert post_cost_pnl == -270.0  # -200 - (40 + 30) = -270.0


def test_traded_value_haircut_differentiation():
    """Requirement check: Two candidates with identical raw_pnl and trade_count but different traded_value (e.g. ₹50,000 vs ₹200,000) get different post-haircut P&L."""
    raw_pnl = 5000.0
    trade_count = 30

    cand_50k = StrategyCandidate(
        candidate_id="cand-50k",
        name="Candidate 50k Traded Value",
        params=StrategyCandidateParams(22.0, "ON", 1.0, 1.5, "09:20", direction="LONG"),
        backtest_source="ALGOVERSE",
        backtest_pnl=raw_pnl,
        win_rate=60.0,
        trade_count=trade_count,
        traded_value=50000.0,
    )

    cand_200k = StrategyCandidate(
        candidate_id="cand-200k",
        name="Candidate 200k Traded Value",
        params=StrategyCandidateParams(22.0, "ON", 1.0, 1.5, "09:20", direction="LONG"),
        backtest_source="ALGOVERSE",
        backtest_pnl=raw_pnl,
        win_rate=60.0,
        trade_count=trade_count,
        traded_value=200000.0,
    )

    pnl_50k = apply_algoverse_haircut(cand_50k.backtest_pnl, cand_50k.trade_count, cand_50k.traded_value)
    pnl_200k = apply_algoverse_haircut(cand_200k.backtest_pnl, cand_200k.trade_count, cand_200k.traded_value)

    # Cost per trade for 50k = 40 + 50000*0.0003 = 55. Total cost = 30 * 55 = 1650. Post PnL = 5000 - 1650 = 3350.
    # Cost per trade for 200k = 40 + 200000*0.0003 = 100. Total cost = 30 * 100 = 3000. Post PnL = 5000 - 3000 = 2000.
    assert pnl_50k == 3350.0
    assert pnl_200k == 2000.0
    assert pnl_50k != pnl_200k
    assert pnl_50k > pnl_200k


from datetime import datetime, timezone, timedelta

def test_atr_5m_intraday_timeframe_enforcement():
    """Fix 2 Test: Synthetic price series where daily ATR and 5-min ATR produce different pass/fail outcomes, asserting 5-min ATR is used."""
    now = datetime.now(timezone.utc)
    bars = []
    for i in range(30):
        bar_dt = now - timedelta(minutes=(29 - i) * 5)
        c_price = 2460.0 if i == 29 else 2450.0
        h_price = 2461.0 if i == 29 else 2452.0
        bars.append({
            "ts": bar_dt.isoformat(),
            "open": 2450.0,
            "high": h_price,
            "low": 2448.0,
            "close": c_price,
            "volume": 10000,
            "session": now.date(),
        })
    df = pd.DataFrame(bars)
    df["symbol"] = "RELIANCE"
    df["atr_5m"] = 2.0   # 5-min ATR = 2.0 (vwap ~2450.3 + 2.5*2.0 = 2455.3 < 2460.0 -> REJECTS)
    df["atr"] = 50.0      # Daily ATR = 50.0 (vwap ~2450.3 + 2.5*50.0 = 2575.3 > 2460.0 -> WOULD PASS)

    settings = Settings.from_env()
    eval_res = evaluate_opportunity(
        frame=df,
        settings=settings,
        market_bias="POSITIVE",
        now=now,
    )
    assert eval_res is not None
    assert eval_res.status == "AVOID"
    assert "EXHAUSTION_VWAP_OVEREXTENSION" in eval_res.why_not_executable


def test_sector_strength_single_rs_rule():
    """Fix 3 Test: Single gating rule Sector RS >= +0.20% gating metric."""
    now = datetime.now(timezone.utc)
    bars = []
    for i in range(30):
        bar_dt = now - timedelta(minutes=(29 - i) * 5)
        bars.append({
            "ts": bar_dt.isoformat(),
            "open": 2450.0,
            "high": 2451.0,
            "low": 2449.0,
            "close": 2450.0,
            "volume": 10000,
            "session": now.date(),
        })
    df = pd.DataFrame(bars)
    df["symbol"] = "RELIANCE"
    df["atr_5m"] = 2.0
    df["atr"] = 2.0
    df["vwap"] = 2450.0
    df["bb_lower"] = 2445.0
    df["bb_upper"] = 2455.0

    settings = Settings.from_env()

    # Case A: Sector RS = +0.15% (< +0.20% threshold) -> Must be REJECTED regardless of rank
    df["sector_rs"] = 0.15
    eval_fail = evaluate_opportunity(
        frame=df,
        settings=settings,
        market_bias="POSITIVE",
        now=now,
    )
    assert eval_fail is not None
    assert eval_fail.status == "AVOID"
    assert "SECTOR_STRENGTH_FAILED" in eval_fail.why_not_executable


def test_long_rejection_29_trades():
    """Fix 4 Test: LONG signal with 29 trades is strictly rejected (sample < 30 threshold)."""
    cand_long_29 = StrategyCandidate(
        candidate_id="cand-long-29",
        name="Long 29 Trades",
        params=StrategyCandidateParams(22.0, "ON", 1.0, 1.5, "09:20", direction="LONG"),
        backtest_source="ALGOVERSE",
        backtest_pnl=6000.0,
        win_rate=65.0,
        avg_win=400.0,
        avg_loss=200.0,
        max_drawdown=400.0,
        trade_count=29,  # Exactly 29 trades (< 30 required limit)
    )

    ranked = rank_and_filter_candidates([cand_long_29])
    assert cand_long_29.status == "REJECTED"
    assert any("LONG_INSUFFICIENT_SAMPLE" in r for r in cand_long_29.rejection_reasons)


def test_continuous_mid_candle_account_loss_breaker(temp_db):
    """Fix 5 Test: Mid-candle unrealized P&L breach crossing -₹1,000 immediately halts new entries."""
    temp_dir = os.path.dirname(temp_db)
    sqlite_path = os.path.join(temp_dir, "test_sqlite.db")

    engine = PaperExecutionEngine(db_path=sqlite_path)

    # Before breach: P&L is -₹500 -> Entry allowed
    engine.account_unrealized_pnl_override = -500.0
    assert engine.get_account_realized_plus_unrealized_pnl() == -500.0

    # Simulate mid-candle unrealized breach crossing -₹1,000 (e.g. -₹1,050)
    engine.account_unrealized_pnl_override = -1050.0

    # New entry MUST be halted immediately
    res = engine.execute_paper_buy("tr-mid-candle-001", "NSE_INDEX", 10, 100.0, 99.0)
    assert res["status"] == "BLOCKED_DAILY_LOSS_BREAKER"


def test_short_rejection_29_trades():
    cand_short_29 = StrategyCandidate(
        candidate_id="cand-short-29",
        name="Short 29 Trades",
        params=StrategyCandidateParams(25.0, "STRICT", 1.0, 1.5, "09:30", direction="SHORT"),
        backtest_source="ALGOVERSE",
        backtest_pnl=6000.0,
        win_rate=65.0,
        avg_win=400.0,
        avg_loss=200.0,
        max_drawdown=400.0,
        trade_count=29,
    )

    ranked = rank_and_filter_candidates([cand_short_29])
    assert cand_short_29.status == "REJECTED"
    assert any("SHORT_INSUFFICIENT_SAMPLE" in r for r in cand_short_29.rejection_reasons)


def test_short_approval_30_trades():
    cand_short_30 = StrategyCandidate(
        candidate_id="cand-short-30",
        name="Short 30 Trades",
        params=StrategyCandidateParams(25.0, "STRICT", 1.0, 1.5, "09:30", direction="SHORT"),
        backtest_source="ALGOVERSE",
        backtest_pnl=6000.0,
        win_rate=65.0,
        avg_win=400.0,
        avg_loss=200.0,
        max_drawdown=400.0,
        trade_count=30,
    )

    ranked = rank_and_filter_candidates([cand_short_30])
    assert cand_short_30.status == "PROPOSED"
    assert cand_short_30.rank == 1


def test_algoverse_failure_insufficient_fallback_resolves_no_trade():
    cand_fallback_empty = StrategyCandidate(
        candidate_id="cand-fallback-insufficient",
        name="Unvalidated Fallback Candidate",
        params=StrategyCandidateParams(22.0, "ON", 1.0, 1.5, "09:20", direction="LONG"),
        backtest_source="LOCAL_FALLBACK",
        backtest_pnl=0.0,
        win_rate=0.0,
        trade_count=3,
    )

    ranked = rank_and_filter_candidates([cand_fallback_empty])
    assert cand_fallback_empty.status == "REJECTED"
    assert any("UNVALIDATED_INSUFFICIENT_FALLBACK_DATA" in r or "LOW_SAMPLE_SIZE" in r for r in cand_fallback_empty.rejection_reasons)


def test_deterministic_ranking_reproducibility():
    cand_a = StrategyCandidate(
        candidate_id="cand-a",
        name="Candidate A",
        params=StrategyCandidateParams(22.0, "ON", 1.0, 1.5, "09:20", direction="LONG"),
        backtest_source="ALGOVERSE",
        backtest_pnl=4000.0,
        win_rate=60.0,
        avg_win=300.0,
        avg_loss=150.0,
        max_drawdown=300.0,
        trade_count=30,
    )
    cand_b = StrategyCandidate(
        candidate_id="cand-b",
        name="Candidate B",
        params=StrategyCandidateParams(25.0, "STRICT", 1.0, 1.5, "09:30", direction="LONG"),
        backtest_source="ALGOVERSE",
        backtest_pnl=4000.0,
        win_rate=60.0,
        avg_win=300.0,
        avg_loss=150.0,
        max_drawdown=300.0,
        trade_count=30,
    )

    ranked_run1 = rank_and_filter_candidates([cand_b, cand_a])
    ids_run1 = [c.candidate_id for c in ranked_run1]

    ranked_run2 = rank_and_filter_candidates([cand_a, cand_b])
    ids_run2 = [c.candidate_id for c in ranked_run2]

    assert ids_run1 == ids_run2
    assert ids_run1[0] == "cand-a"


def test_position_cannot_open_without_explicit_telegram_approval(temp_db, monkeypatch):
    """Enforces Part 2 Requirement: Asserts that running pipeline DOES NOT automatically activate/open strategy.
    Strategy remains NO_TRADE / unapproved until explicit Telegram callback 'cb:accept:<id>' is invoked."""
    monkeypatch.setenv("STRICT_STRATEGY_GATE", "1")
    ranked = run_strategy_intelligence_pipeline(temp_db)
    assert len(ranked) > 0

    # 1. Verify NO strategy is active automatically
    active_before = get_active_strategy(temp_db)
    assert active_before is None

    # 2. Verify top candidate status is PROPOSED (not ACCEPTED)
    top_cand = next(c for c in ranked if c.status != "REJECTED")
    assert top_cand.status == "PROPOSED"

    # 3. Attempting paper buy without approval returns BLOCKED_NO_STRATEGY_APPROVAL
    sqlite_db = os.path.join(os.path.dirname(temp_db), "test_paper_state.db")
    engine = PaperExecutionEngine(db_path=sqlite_db)
    engine.market_db_path = temp_db
    assert engine.is_strategy_approved() is False

    res_buy = engine.execute_paper_buy(
        trade_id="tr-test-unapproved",
        instrument_key="NSE_EQ|INE002A01018",
        qty=10,
        buy_limit=2450.0,
        ask=2450.0
    )
    assert res_buy["status"] == "BLOCKED_NO_STRATEGY_APPROVAL"
    assert res_buy["filled_qty"] == 0

    # 4. Explicitly send Telegram approval callback
    res_cb = handle_telegram_callback(f"cb:accept:{top_cand.candidate_id}", temp_db)
    assert "Strategy accepted" in res_cb

    # 5. Verify strategy is now ACTIVE and approved after explicit approval
    active_after = get_active_strategy(temp_db)
    assert active_after is not None
    assert active_after["candidate_id"] == top_cand.candidate_id
    assert active_after["approved_by"] == "TELEGRAM"
    assert engine.is_strategy_approved() is True

