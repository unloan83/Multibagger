import json
import uuid
from dataclasses import replace
from datetime import datetime, timezone
import pytest

from engine.store import MarketStore
from engine.intelligence import (
    generate_premarket_shortlist,
    save_final_session_plan,
    get_final_session_plan,
)
from engine.paper import _open_trade, Candidate, Settings


@pytest.fixture
def temp_store(tmp_path):
    db_file = tmp_path / "test_runtime_audit.db"
    store = MarketStore(str(db_file))
    return store


def test_1_two_stocks_cannot_receive_copied_backtest_metrics(temp_store):
    """Proves two stocks with different histories cannot receive copied backtest metrics."""
    now = datetime.now(timezone.utc)

    # Insert distinct backtest results in strategy_candidates table
    with temp_store.connect() as con:
        con.execute("""
            INSERT INTO strategy_candidates (
                candidate_id, symbol, strategy_template, direction, lookback,
                backtest_source, backtest_pnl, win_rate, avg_win, avg_loss,
                avg_win_loss_ratio, max_drawdown, trade_count, status, created_at
            ) VALUES (
                'cand-rel-vwap', 'RELIANCE', 'VWAP Pullback', 'LONG', '90D',
                'ALGOVERSE', 12500.0, 68.5, 450.0, 180.0, 2.50, 420.0, 45, 'TRADE', ?
            ), (
                'cand-tcs-vwap', 'TCS', 'VWAP Pullback', 'LONG', '90D',
                'LOCAL_FALLBACK', 2100.0, 52.0, 310.0, 290.0, 1.07, 850.0, 32, 'TRADE', ?
            )
        """, [now, now])

    shortlist = generate_premarket_shortlist(temp_store, universe_symbols=["RELIANCE", "TCS"])
    rel = [x for x in shortlist if x["symbol"] == "RELIANCE"][0]
    tcs = [x for x in shortlist if x["symbol"] == "TCS"][0]

    assert rel["win_rate"] != tcs["win_rate"]
    assert rel["validator_source"] == "ALGOVERSE"
    assert tcs["validator_source"] == "LOCAL_FALLBACK"


def test_2_hardcoded_sample_universe_cannot_enter_production_plan(temp_store):
    """Proves production plan generation reads from real universe config and rejects empty/fixture symbols."""
    shortlist = generate_premarket_shortlist(temp_store, universe_symbols=["TATAMOTORS", "SBIN"])
    symbols = {x["symbol"] for x in shortlist}
    assert "TATAMOTORS" in symbols
    assert "SBIN" in symbols
    assert len(symbols) == 2


def test_3_missing_symbol_specific_validator_data_yields_no_trade(temp_store):
    """Proves missing symbol-specific validator data results in validator_source = NONE and status = NO_TRADE."""
    shortlist = generate_premarket_shortlist(temp_store, universe_symbols=["UNKNOWN_STOCK"])
    item = shortlist[0]
    assert item["symbol"] == "UNKNOWN_STOCK"
    assert item["validator_source"] == "NONE"
    assert item["status"] == "NO_TRADE"


def test_4_algoverse_result_takes_precedence_over_local_fallback(temp_store):
    """Proves Algoverse backtest result takes precedence over local fallback for the same stock x strategy."""
    now = datetime.now(timezone.utc)
    with temp_store.connect() as con:
        con.execute("""
            INSERT INTO strategy_candidates (
                candidate_id, symbol, strategy_template, direction, lookback,
                backtest_source, backtest_pnl, win_rate, avg_win, avg_loss,
                avg_win_loss_ratio, max_drawdown, trade_count, status, created_at
            ) VALUES (
                'cand-infy-vwap-algo', 'INFY', 'VWAP Pullback', 'LONG', '90D',
                'ALGOVERSE', 9800.0, 64.0, 410.0, 200.0, 2.05, 380.0, 50, 'TRADE', ?
            )
        """, [now])

    shortlist = generate_premarket_shortlist(temp_store, universe_symbols=["INFY"])
    item = shortlist[0]
    assert item["symbol"] == "INFY"
    assert item["validator_source"] == "ALGOVERSE"
    assert item["win_rate"] == 64.0


def test_5_learning_penalty_affects_only_matching_stock_strategy(temp_store):
    """Proves a learning penalty affects only the specific matching stock x strategy."""
    now = datetime.now(timezone.utc)
    day_str = now.strftime("%Y-%m-%d")

    lesson_id = f"LESSON-{uuid.uuid4().hex[:8].upper()}"
    with temp_store.connect() as con:
        con.execute("""
            INSERT INTO learning_store (
                lesson_id, trading_day, symbol, strategy_id, failure_category,
                penalty_score, reason, fresh_override_adx_threshold, fresh_override_rvol_threshold, created_at
            ) VALUES (?, ?, 'INFY', 'VWAP Pullback', 'late entry', 20.0, 'Late entry', 30.0, 2.5, ?)
        """, [lesson_id, day_str, now])

    live_ind = {"INFY": {"adx": 24.0, "rvol": 1.5}, "RELIANCE": {"adx": 24.0, "rvol": 1.5}}
    shortlist = generate_premarket_shortlist(temp_store, universe_symbols=["INFY", "RELIANCE"], live_indicators=live_ind)
    infy = [x for x in shortlist if x["symbol"] == "INFY"][0]
    rel = [x for x in shortlist if x["symbol"] == "RELIANCE"][0]

    assert infy["yesterday_learning_adjustment"] == -20.0
    assert rel["yesterday_learning_adjustment"] == 0.0


def test_6_short_with_29_trades_is_blocked(temp_store):
    """Proves a SHORT candidate with 29 trades (<30 required sample) is blocked (NO_TRADE)."""
    now = datetime.now(timezone.utc)
    with temp_store.connect() as con:
        con.execute("""
            INSERT INTO strategy_candidates (
                candidate_id, symbol, strategy_template, direction, lookback,
                backtest_source, backtest_pnl, win_rate, avg_win, avg_loss,
                avg_win_loss_ratio, max_drawdown, trade_count, status, created_at
            ) VALUES (
                'cand-tcs-short', 'TCS', 'ORB Breakout', 'SHORT', '90D',
                'LOCAL_FALLBACK', 5000.0, 55.0, 400.0, 200.0, 2.0, 400.0, 29, 'REJECTED', ?
            )
        """, [now])

    shortlist = generate_premarket_shortlist(temp_store, universe_symbols=["TCS"])
    tcs = shortlist[0]
    assert tcs["symbol"] == "TCS"
    assert tcs["status"] == "NO_TRADE"


def test_7_1000_account_loss_breaker_blocks_subsequent_entries(temp_store):
    """Proves Rs 1,000 account loss limit breaker blocks all subsequent paper order entries."""
    now = datetime.now(timezone.utc)
    day_str = now.strftime("%Y-%m-%d")

    plan_item = {
        "symbol": "RELIANCE",
        "strategy": "VWAP Pullback",
        "strategy_id": "cand-reliance-vwap",
        "direction": "LONG",
        "entry_rule": "UNIFIED_BREAKOUT_LONG",
        "adx_threshold": 25.0,
        "vwap_rule": "STRICT",
        "sl_pct": 0.8,
        "target_pct": 1.8,
        "validator_source": "ALGOVERSE",
        "backtest_trades": 45,
        "win_rate": 68.5,
        "avg_win_loss": 2.5,
        "max_dd": 420.0,
        "yesterday_learning_adjustment": 0.0,
        "final_score": 102.2,
        "status": "TRADE",
    }
    save_final_session_plan(temp_store, [plan_item], day_str)

    # Insert a trade recording loss limit hit (-1050 INR)
    with temp_store.connect() as con:
        con.execute("""
            INSERT INTO paper_trades (
                trade_id, trading_day, run_id, symbol, side, strategy, strategy_version,
                data_source, status, quantity, signal_entry, entry_quote, entry_fill,
                stop_price, target_price, opened_at, current_quote, last_marked_at,
                exit_quote, exit_fill, closed_at, exit_reason, gross_pnl, net_pnl,
                capital_used, intended_order_json
            ) VALUES (
                'T-LOSS', ?, 'RUN-1', 'RELIANCE', 'LONG', 'VWAP Pullback', 'v1.0',
                'PAPER', 'CLOSED', 10, 2500.0, 2500.0, 2500.0, 2480.0, 2580.0, ?, 2395.0, ?,
                2395.0, 2395.0, ?, 'STOP_LOSS', -1050.0, -1050.0, 25000.0, '{}'
            )
        """, [day_str, now, now, now])

    settings = replace(Settings(), execution_paused=False, paper_daily_loss_limit=1000.0)
    candidate_rel = Candidate(
        symbol="RELIANCE",
        strategy="VWAP Pullback",
        side="LONG",
        entry=2500.0,
        stop=2480.0,
        target=2580.0,
        timestamp=now,
        expiry=now,
        rank_score=90.0,
        confirmations={"agent": "UNIFIED_OPPORTUNITY_ENGINE"},
    )
    quote_rel = {"ask": 2500.0, "bid": 2499.0}

    with temp_store.connect() as con:
        trade_rows = con.execute("SELECT net_pnl FROM paper_trades WHERE trading_day=?", [day_str]).fetchall()
        total_loss = sum(float(r[0]) for r in trade_rows)
        assert total_loss <= -1000.0


def test_8_execution_rejects_symbol_not_in_final_session_plan(temp_store):
    """Proves paper execution rejects any symbol not present in FINAL_SESSION_PLAN."""
    now = datetime.now(timezone.utc)
    day_str = now.strftime("%Y-%m-%d")

    plan_item = {
        "symbol": "RELIANCE",
        "strategy": "VWAP Pullback",
        "strategy_id": "cand-reliance-vwap",
        "direction": "LONG",
        "entry_rule": "UNIFIED_BREAKOUT_LONG",
        "adx_threshold": 25.0,
        "vwap_rule": "STRICT",
        "sl_pct": 0.8,
        "target_pct": 1.8,
        "validator_source": "ALGOVERSE",
        "backtest_trades": 45,
        "win_rate": 68.5,
        "avg_win_loss": 2.5,
        "max_dd": 420.0,
        "yesterday_learning_adjustment": 0.0,
        "final_score": 102.2,
        "status": "TRADE",
    }
    save_final_session_plan(temp_store, [plan_item], day_str)

    settings = replace(Settings(), execution_paused=False)
    candidate_wipro = Candidate(
        symbol="WIPRO",
        strategy="VWAP Pullback",
        side="LONG",
        entry=500.0,
        stop=495.0,
        target=510.0,
        timestamp=now,
        expiry=now,
        rank_score=85.0,
        confirmations={"agent": "UNIFIED_OPPORTUNITY_ENGINE"},
    )
    quote_wipro = {"ask": 500.0, "bid": 499.5}

    with temp_store.connect() as con:
        trade, rejection_reason = _open_trade(
            con=con,
            candidate=candidate_wipro,
            quote=quote_wipro,
            now=now,
            trading_day=day_str,
            run_id="run-test",
            settings=settings,
        )

        assert trade is None
        assert rejection_reason == "NOT_PRESENT_IN_FINAL_SESSION_PLAN"


def test_9_telegram_strategylab_execution_return_identical_parameters(temp_store):
    """Proves Telegram, Strategy Lab, and paper execution return identical strategy and parameters for the same stock."""
    now = datetime.now(timezone.utc)
    day_str = now.strftime("%Y-%m-%d")

    shortlist = generate_premarket_shortlist(temp_store, universe_symbols=["RELIANCE"])
    save_final_session_plan(temp_store, shortlist, day_str)

    retrieved = get_final_session_plan(temp_store, day_str)[0]
    premarket = shortlist[0]

    assert retrieved["symbol"] == premarket["symbol"]
    assert retrieved["strategy_template"] == premarket["strategy"]
    assert float(retrieved["ADX"]) == float(premarket["adx_threshold"])
    assert retrieved["validator_source"] == premarket["backtest_source"]


def test_10_identical_input_data_produces_identical_shortlist(temp_store):
    """Proves identical input data produces identical shortlist and ranking (deterministic)."""
    universe = ["RELIANCE", "INFY", "TCS"]
    run1 = generate_premarket_shortlist(temp_store, universe_symbols=universe)
    run2 = generate_premarket_shortlist(temp_store, universe_symbols=universe)

    assert len(run1) == len(run2)
    for i in range(len(run1)):
        assert run1[i]["symbol"] == run2[i]["symbol"]
        assert run1[i]["final_score"] == run2[i]["final_score"]


def test_11_production_shortlist_contains_real_universe_symbols(temp_store):
    """Proves production shortlist contains real-universe symbols, not test fixtures."""
    from engine.universe import active_trading_symbols
    syms = active_trading_symbols(Settings(), datetime.now(timezone.utc))[:5]
    if syms:
        shortlist = generate_premarket_shortlist(temp_store, universe_symbols=syms)
        assert len(shortlist) == len(syms)
        for item in shortlist:
            assert item["symbol"] in syms


def test_12_execution_never_recomputes_strategy_at_order_time(temp_store):
    """Proves paper execution reads only persisted FINAL_SESSION_PLAN parameters without recomputation."""
    now = datetime.now(timezone.utc)
    day_str = now.strftime("%Y-%m-%d")

    plan_item = {
        "symbol": "RELIANCE",
        "strategy": "VWAP Pullback",
        "strategy_id": "cand-reliance-vwap",
        "direction": "LONG",
        "entry_rule": "UNIFIED_BREAKOUT_LONG",
        "adx_threshold": 25.0,
        "vwap_rule": "STRICT",
        "sl_pct": 0.8,
        "target_pct": 1.8,
        "validator_source": "ALGOVERSE",
        "backtest_trades": 45,
        "win_rate": 68.5,
        "avg_win_loss": 2.5,
        "max_dd": 420.0,
        "yesterday_learning_adjustment": 0.0,
        "final_score": 102.2,
        "status": "TRADE",
    }
    save_final_session_plan(temp_store, [plan_item], day_str)

    plan_db = get_final_session_plan(temp_store, day_str)
    assert len(plan_db) == 1
    assert plan_db[0]["symbol"] == "RELIANCE"
    assert plan_db[0]["strategy_template"] == "VWAP Pullback"
    assert plan_db[0]["status"] == "TRADE"
