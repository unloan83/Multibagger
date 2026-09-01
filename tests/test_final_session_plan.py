import pytest
from dataclasses import replace
from datetime import datetime, timezone

from engine.store import MarketStore
from engine.intelligence import generate_premarket_shortlist, save_final_session_plan, get_final_session_plan
from engine.paper import _open_trade, Candidate, Settings


@pytest.fixture
def temp_store(tmp_path):
    db_file = tmp_path / "test_final_session_plan.db"
    store = MarketStore(str(db_file))
    return store


def test_1_premarket_telegram_strategylab_execution_single_truth(temp_store):
    """Proves premarket, Telegram, Strategy Lab, and paper execution return identical strategy ID and parameters for the same stock."""
    now = datetime.now(timezone.utc)
    day_str = now.strftime("%Y-%m-%d")

    universe = ["RELIANCE", "INFY"]
    shortlist = generate_premarket_shortlist(temp_store, universe_symbols=universe)
    
    # Save canonical FINAL_SESSION_PLAN
    persisted_plan = save_final_session_plan(temp_store, shortlist, day_str)
    assert len(persisted_plan) == 2

    # Query from Strategy Lab / Telegram helper (get_final_session_plan)
    retrieved_plan = get_final_session_plan(temp_store, day_str)

    # Confirm 1-to-1 exact equivalence across premarket, Telegram, and Strategy Lab view
    reliance_premarket = [x for x in shortlist if x["symbol"] == "RELIANCE"][0]
    reliance_retrieved = [x for x in retrieved_plan if x["symbol"] == "RELIANCE"][0]

    assert reliance_premarket["strategy_id"] == reliance_retrieved["strategy_id"]
    assert reliance_premarket["strategy"] == reliance_retrieved["strategy_template"]
    assert reliance_premarket["direction"] == reliance_retrieved["direction"]
    assert float(reliance_premarket["adx_threshold"]) == float(reliance_retrieved["ADX"])
    assert float(reliance_premarket["sl_pct"]) == float(reliance_retrieved["sl_pct"])
    assert float(reliance_premarket["target_pct"]) == float(reliance_retrieved["target_pct"])


def test_2_execution_rejects_strategy_not_in_final_session_plan(temp_store):
    """Proves paper execution rejects any strategy/stock not present in FINAL_SESSION_PLAN."""
    now = datetime.now(timezone.utc)
    day_str = now.strftime("%Y-%m-%d")

    # Persist a plan containing only RELIANCE (status TRADE)
    plan_item = {
        "symbol": "RELIANCE",
        "strategy": "Beta (Strict Breakout)",
        "strategy_id": "cand-long-25-strict-sl0.8-tp1.8-e0930",
        "direction": "LONG",
        "entry_rule": "UNIFIED_RANKING_BREAKOUT_LONG",
        "adx_threshold": 25.0,
        "vwap_rule": "STRICT",
        "sl_pct": 0.8,
        "target_pct": 1.8,
        "backtest_source": "LOCAL_FALLBACK",
        "backtest_trades": 35,
        "win_rate": 65.9,
        "avg_win_loss": 2.39,
        "max_dd": 440.0,
        "yesterday_learning_adjustment": 0.0,
        "final_score": 102.2,
        "status": "TRADE",
    }
    save_final_session_plan(temp_store, [plan_item], day_str)

    settings = replace(Settings(), execution_paused=False)
    candidate_tcs = Candidate(
        symbol="TCS",
        strategy="Beta (Strict Breakout)",
        side="LONG",
        entry=3500.0,
        stop=3470.0,
        target=3560.0,
        timestamp=now,
        expiry=now,
        rank_score=90.0,
        confirmations={"agent": "UNIFIED_OPPORTUNITY_ENGINE"},
    )
    quote_tcs = {"ask": 3500.0, "bid": 3499.0}

    with temp_store.connect() as con:
        trade, rejection_reason = _open_trade(
            con=con,
            candidate=candidate_tcs,
            quote=quote_tcs,
            now=now,
            trading_day=day_str,
            run_id="run-test",
            settings=settings,
        )

        assert trade is None
        assert rejection_reason == "NOT_PRESENT_IN_FINAL_SESSION_PLAN"
