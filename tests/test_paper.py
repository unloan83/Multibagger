import json
from dataclasses import replace
from datetime import datetime, timedelta, timezone

from engine.config import Settings
from engine.paper import run_paper_cycle, run_risk_monitor
from engine.store import MarketStore
from engine.strategies import Candidate


def _settings(tmp_path):
    universe = tmp_path / "universe.json"
    universe.write_text('[{"symbol":"TEST","sources":["NIFTY 500"]}]')
    return Settings("", tmp_path / "market.duckdb", tmp_path / "signals.json", universe,
                    max_symbols=1, execution_paused=False, max_spread_bps=20)


def _candidate(symbol, now, side="LONG"):
    confirmations = {
        "marketDirection": True, "sectorDirection": True, "vwap": True,
        "volume": True, "momentum": True, "strategyQualified": True,
        "supportResistance": True, "riskReward": True,
        "setupSource": "PRICE_VOLUME_ONLY", "breakoutLevel": 199.0 if side == "LONG" else 201.0,
        "atr": 1.0,
    }
    stop, target = (195.0, 210.0) if side == "LONG" else (205.0, 190.0)
    return Candidate(symbol, side, 200.0, stop, target, "ORB_15M_RETEST",
                     now, now + timedelta(minutes=20), 90.0, confirmations)


def test_daily_profit_threshold_blocks_entries_without_forcing_runner_exit(tmp_path):
    settings = _settings(tmp_path)
    store = MarketStore(settings.db_path)
    opened_at = datetime(2026, 8, 17, 5, 0, tzinfo=timezone.utc)

    first = run_paper_cycle(
        store, settings, [_candidate("TEST", opened_at)],
        {"TEST": {"bid": 199.8, "ask": 200.0, "ts": opened_at}}, opened_at, "run-one",
    )
    assert len(first["openPositions"]) == 1
    assert 1 <= first["openPositions"][0]["quantity"] <= 200
    assert first["dailyMetrics"]["closedTrades"] == 0

    exit_time = opened_at + timedelta(minutes=5)
    second = run_paper_cycle(
        store, settings, [_candidate("OTHER", exit_time)],
        {
            "TEST": {"bid": 260.0, "ask": 260.2, "ts": exit_time},
            "OTHER": {"bid": 199.8, "ask": 200.0, "ts": exit_time},
        }, exit_time, "run-two",
    )
    assert len(second["openPositions"]) == 1
    assert second["openPositions"][0]["partial_quantity"] > 0
    assert second["targetReached"] is True
    assert second["newEntriesEnabled"] is False
    assert "Daily paper profit target reached" in " ".join(second["noEntryReasons"])


def test_high_score_signal_is_not_rejected_for_weak_sector_confirmation(tmp_path):
    settings = _settings(tmp_path)
    store = MarketStore(settings.db_path)
    now = datetime(2026, 8, 21, 5, 0, tzinfo=timezone.utc)
    candidate = replace(
        _candidate("TEST", now),
        rank_score=92.0,
        confirmations={**_candidate("TEST", now).confirmations, "sectorDirection": False},
    )

    result = run_paper_cycle(
        store, settings, [candidate],
        {"TEST": {"bid": 199.8, "ask": 200.0, "ts": now}}, now, "weak-sector",
    )

    assert len(result["openPositions"]) == 1
    assert result["openPositions"][0]["allowed_risk"] == 375.0
    assert all(item["reason"] != "CONFIRMATION_FAILED_SECTORDIRECTION"
               for item in result["entryRejections"])


def test_stop_loss_is_cost_adjusted_and_recorded(tmp_path):
    settings = _settings(tmp_path)
    store = MarketStore(settings.db_path)
    opened_at = datetime(2026, 8, 17, 5, 0, tzinfo=timezone.utc)
    run_paper_cycle(
        store, settings, [_candidate("TEST", opened_at)],
        {"TEST": {"bid": 199.8, "ask": 200.0, "ts": opened_at}}, opened_at, "run-one",
    )

    exit_time = opened_at + timedelta(minutes=5)
    result = run_paper_cycle(
        store, settings, [],
        {"TEST": {"bid": 194.5, "ask": 194.7, "ts": exit_time}}, exit_time, "run-two",
    )
    trade = result["recentClosedTrades"][0]
    assert trade["exit_reason"] == "STOP_LOSS"
    assert trade["gross_pnl"] < 0
    assert trade["net_pnl"] < trade["gross_pnl"]
    assert trade["brokerage"] > 0
    assert trade["fees_taxes"] > 0
    assert trade["slippage"] > 0
    assert trade["peak_quote"] == 200.0
    assert trade["lowest_quote"] == 194.5
    assert trade["mfe"] == 0
    assert trade["mae"] < 0
    assert trade["profit_giveback"] > 0
    assert trade["holding_duration_minutes"] == 5


def test_weekend_disables_new_entries(tmp_path):
    settings = _settings(tmp_path)
    store = MarketStore(settings.db_path)
    sunday = datetime(2026, 8, 16, 5, 0, tzinfo=timezone.utc)
    result = run_paper_cycle(
        store, settings, [_candidate("TEST", sunday)],
        {"TEST": {"bid": 199.8, "ask": 200.0, "ts": sunday}}, sunday, "weekend-run",
    )
    assert result["newEntriesEnabled"] is False
    assert result["openPositions"] == []
    assert "time-of-day window blocks new entries" in " ".join(result["noEntryReasons"])


def test_prior_day_position_exits_on_first_fresh_quote_before_new_entries(tmp_path):
    settings = _settings(tmp_path)
    store = MarketStore(settings.db_path)
    opened_at = datetime(2026, 8, 20, 5, 0, tzinfo=timezone.utc)
    run_paper_cycle(
        store, settings, [_candidate("TEST", opened_at)],
        {"TEST": {"bid": 199.8, "ask": 200.0, "ts": opened_at}}, opened_at, "day-one",
    )

    next_session = datetime(2026, 8, 21, 3, 46, tzinfo=timezone.utc)
    result = run_paper_cycle(
        store, settings, [_candidate("OTHER", next_session)],
        {
            "TEST": {"bid": 198.0, "ask": 198.2, "ts": next_session},
            "OTHER": {"bid": 199.8, "ask": 200.0, "ts": next_session},
        }, next_session, "day-two",
    )
    assert result["openPositions"] == []
    assert result["recentClosedTrades"][0]["exit_reason"] == "OVERNIGHT_SAFETY_EXIT"
    assert result["recentClosedTrades"][0]["closed_at"] == next_session.isoformat()


def test_prior_day_position_blocks_entries_until_a_fresh_exit_quote_exists(tmp_path):
    settings = _settings(tmp_path)
    store = MarketStore(settings.db_path)
    opened_at = datetime(2026, 8, 20, 5, 0, tzinfo=timezone.utc)
    run_paper_cycle(
        store, settings, [_candidate("TEST", opened_at)],
        {"TEST": {"bid": 199.8, "ask": 200.0, "ts": opened_at}}, opened_at, "day-one",
    )

    next_session = datetime(2026, 8, 21, 4, 0, tzinfo=timezone.utc)
    result = run_paper_cycle(
        store, settings, [_candidate("OTHER", next_session)],
        {"OTHER": {"bid": 199.8, "ask": 200.0, "ts": next_session}},
        next_session, "day-two",
    )
    assert [trade["symbol"] for trade in result["openPositions"]] == ["TEST"]
    assert "prior-day paper position" in " ".join(result["noEntryReasons"])


def test_upstox_sandbox_order_ids_gate_entry_and_exit(tmp_path, monkeypatch):
    settings = replace(
        _settings(tmp_path), market_data_provider="upstox",
        paper_submit_upstox_sandbox_orders=True, upstox_sandbox_access_token="sandbox-token",
    )
    store = MarketStore(settings.db_path)
    order_ids = iter(["sandbox-buy-1", "sandbox-sell-1"])
    monkeypatch.setattr("engine.paper._submit_upstox_sandbox_order", lambda *args: next(order_ids))
    opened_at = datetime(2026, 8, 17, 5, 0, tzinfo=timezone.utc)
    first = run_paper_cycle(
        store, settings, [_candidate("TEST", opened_at)],
        {"TEST": {"bid": 199.8, "ask": 200.0, "ts": opened_at, "instrument_key": "NSE_EQ|TEST"}},
        opened_at, "run-one",
    )
    assert first["openPositions"][0]["execution_mode"] == "UPSTOX_SANDBOX"
    assert first["openPositions"][0]["entry_order_id"] == "sandbox-buy-1"

    exit_time = opened_at + timedelta(minutes=5)
    second = run_paper_cycle(
        store, settings, [],
        {"TEST": {"bid": 194.5, "ask": 194.7, "ts": exit_time, "instrument_key": "NSE_EQ|TEST"}},
        exit_time, "run-two",
    )
    assert second["recentClosedTrades"][0]["exit_order_id"] == "sandbox-sell-1"


def test_sandbox_entry_rejection_is_audited(tmp_path, monkeypatch):
    settings = replace(
        _settings(tmp_path), market_data_provider="upstox",
        paper_submit_upstox_sandbox_orders=True, upstox_sandbox_access_token="sandbox-token",
    )
    store = MarketStore(settings.db_path)
    opened_at = datetime(2026, 8, 17, 5, 0, tzinfo=timezone.utc)
    candidate = _candidate("TEST", opened_at)
    with store.connect() as con:
        con.execute("""INSERT INTO paper_signals
          (run_id,symbol,side,entry,stop,target,strategy,timestamp,expiry,rank_score,status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')""", [
            "rejected-run", candidate.symbol, candidate.side, candidate.entry, candidate.stop,
            candidate.target, candidate.strategy, candidate.timestamp,
            candidate.expiry, candidate.rank_score,
        ])
    monkeypatch.setattr(
        "engine.paper._submit_upstox_sandbox_order",
        lambda *args: (_ for _ in ()).throw(RuntimeError("sandbox unavailable")),
    )
    result = run_paper_cycle(
        store, settings, [candidate],
        {"TEST": {"bid": 199.8, "ask": 200.0, "ts": opened_at, "instrument_key": "NSE_EQ|TEST"}},
        opened_at, "rejected-run",
    )
    assert result["openPositions"] == []
    assert result["entryRejections"][0]["reason"] == "SANDBOX_ORDER_REJECTED"
    assert result["recentEntryRejections"][0]["reason"] == "SANDBOX_ORDER_REJECTED"
    with store.connect() as con:
        assert con.execute("SELECT status FROM paper_signals WHERE run_id='rejected-run'").fetchone()[0] == "REJECTED_SANDBOX_ORDER_REJECTED"
        assert con.execute("SELECT count(*) FROM paper_entry_rejections").fetchone()[0] == 1


def test_lightweight_monitor_scales_open_trade_and_records_audit_history(tmp_path):
    settings = _settings(tmp_path)
    store = MarketStore(settings.db_path)
    opened_at = datetime(2026, 8, 17, 5, 0, tzinfo=timezone.utc)
    run_paper_cycle(
        store, settings, [_candidate("TEST", opened_at)],
        {"TEST": {"bid": 199.8, "ask": 200.0, "ts": opened_at}}, opened_at, "run-one",
    )
    exit_time = opened_at + timedelta(minutes=2)
    store.upsert_bar({
        "instrument_key": "NSE_EQ|TEST", "symbol": "TEST", "ts": exit_time - timedelta(minutes=1),
        "open": 200.0, "high": 212.0, "low": 199.0, "close": 211.0,
        "volume": 1000, "bid": 211.0, "ask": 211.2, "received_at": exit_time,
    })
    result = run_risk_monitor(settings, exit_time)
    assert result["openPositions"][0]["partial_quantity"] > 0
    assert result["closedByMonitor"] == []
    snapshot = json.loads(settings.snapshot_path.read_text())
    assert snapshot["asOf"] == exit_time.isoformat()
    assert snapshot["paperTrading"]["dailyMetrics"]["closedTrades"] == 0
    assert snapshot["reason"] == "NO_TRADE"
    assert "regime" in snapshot
    with store.connect() as con:
        event_types = [row[0] for row in con.execute("SELECT event_type FROM paper_trade_events ORDER BY observed_at").fetchall()]
        assert event_types == ["ENTRY", "PARTIAL_EXIT", "MARK"]
        assert con.execute("SELECT count(*) FROM paper_target_history").fetchone()[0] == 2


def test_monitor_uses_fresh_quote_receipt_when_finalized_bar_timestamp_is_delayed(tmp_path):
    settings = _settings(tmp_path)
    store = MarketStore(settings.db_path)
    opened_at = datetime(2026, 8, 17, 5, 0, tzinfo=timezone.utc)
    run_paper_cycle(
        store, settings, [_candidate("TEST", opened_at)],
        {"TEST": {"bid": 199.8, "ask": 200.0, "ts": opened_at}}, opened_at, "run-one",
    )

    monitor_time = opened_at + timedelta(minutes=5)
    store.upsert_bar({
        "instrument_key": "NSE_EQ|TEST", "symbol": "TEST",
        "ts": monitor_time - timedelta(minutes=3),
        "open": 200.0, "high": 212.0, "low": 199.0, "close": 211.0,
        "volume": 1000, "bid": 211.0, "ask": 211.2,
        "received_at": monitor_time - timedelta(seconds=15),
    })
    result = run_risk_monitor(settings, monitor_time)
    assert result["openPositions"][0]["partial_quantity"] > 0


def test_monitor_rejects_backfilled_quote_even_when_receipt_is_fresh(tmp_path):
    settings = _settings(tmp_path)
    store = MarketStore(settings.db_path)
    opened_at = datetime(2026, 8, 17, 5, 0, tzinfo=timezone.utc)
    run_paper_cycle(
        store, settings, [_candidate("TEST", opened_at)],
        {"TEST": {"bid": 199.8, "ask": 200.0, "ts": opened_at}}, opened_at, "run-one",
    )

    monitor_time = opened_at + timedelta(minutes=10)
    store.upsert_bar({
        "instrument_key": "NSE_EQ|TEST", "symbol": "TEST",
        "ts": monitor_time - timedelta(minutes=8),
        "open": 200.0, "high": 212.0, "low": 199.0, "close": 211.0,
        "volume": 1000, "bid": 211.0, "ask": 211.2,
        "received_at": monitor_time - timedelta(seconds=15),
    })
    result = run_risk_monitor(settings, monitor_time)
    assert [trade["symbol"] for trade in result["openPositions"]] == ["TEST"]


def test_global_pause_blocks_recommendation_execution(tmp_path):
    settings = replace(_settings(tmp_path), execution_paused=True)
    store = MarketStore(settings.db_path)
    now = datetime(2026, 8, 21, 5, 0, tzinfo=timezone.utc)
    result = run_paper_cycle(
        store, settings, [_candidate("TEST", now)],
        {"TEST": {"bid": 199.8, "ask": 200.0, "ts": now}}, now, "paused-run",
    )
    assert result["openPositions"] == []
    assert result["executionPaused"] is True
    assert "execution pause" in " ".join(result["noEntryReasons"]).lower()


def test_recommendation_without_price_volume_setup_confirmation_is_rejected(tmp_path):
    settings = _settings(tmp_path)
    store = MarketStore(settings.db_path)
    now = datetime(2026, 8, 21, 5, 0, tzinfo=timezone.utc)
    candidate = replace(_candidate("TEST", now), confirmations={"vwap": True})
    result = run_paper_cycle(
        store, settings, [candidate],
        {"TEST": {"bid": 199.8, "ask": 200.0, "ts": now}}, now, "unconfirmed-run",
    )
    assert result["openPositions"] == []
    assert result["entryRejections"][0]["reason"].startswith("CONFIRMATION_FAILED_")


def test_alpha_ema9_exit_protects_open_gain(tmp_path):
    settings = _settings(tmp_path)
    store = MarketStore(settings.db_path)
    opened_at = datetime(2026, 8, 21, 5, 0, tzinfo=timezone.utc)
    run_paper_cycle(
        store, settings, [_candidate("TEST", opened_at)],
        {"TEST": {"bid": 199.8, "ask": 200.0, "ts": opened_at}}, opened_at, "entry-run",
    )
    peak_time = opened_at + timedelta(minutes=2)
    run_paper_cycle(
        store, settings, [],
        {"TEST": {"bid": 206.3, "ask": 206.5, "ts": peak_time}}, peak_time, "peak-run",
    )
    reversal_time = peak_time + timedelta(minutes=1)
    result = run_paper_cycle(
        store, settings, [],
        {"TEST": {"bid": 203.5, "ask": 203.7, "ts": reversal_time,
                  "five_minute_closes": [203.5], "ema9_5m": 204.0}}, reversal_time, "trail-run",
    )
    assert result["recentClosedTrades"][0]["exit_reason"] == "ALPHA_EMA9_5M_CLOSE"
    assert result["recentClosedTrades"][0]["net_pnl"] > 0


def test_prior_session_loss_does_not_override_fixed_risk_policy(tmp_path):
    settings = _settings(tmp_path)
    store = MarketStore(settings.db_path)
    day_one = datetime(2026, 8, 20, 5, 0, tzinfo=timezone.utc)
    run_paper_cycle(
        store, settings, [_candidate("LOSS", day_one)],
        {"LOSS": {"bid": 199.8, "ask": 200.0, "ts": day_one}}, day_one, "loss-entry",
    )
    run_paper_cycle(
        store, settings, [],
        {"LOSS": {"bid": 194.0, "ask": 194.2, "ts": day_one + timedelta(minutes=5)}},
        day_one + timedelta(minutes=5), "loss-exit",
    )
    day_two = datetime(2026, 8, 21, 5, 0, tzinfo=timezone.utc)
    result = run_paper_cycle(
        store, settings, [_candidate("PROBE", day_two)],
        {"PROBE": {"bid": 199.8, "ask": 200.0, "ts": day_two}}, day_two, "adaptive-entry",
    )
    assert result["adaptiveRisk"]["riskMultiplier"] == 1.0
    assert result["adaptiveRisk"]["recentSessionFeedback"]["criteriaTightened"] is True
    assert result["openPositions"][0]["quantity"] > 75


def test_short_uses_bid_entry_and_ask_stop_exit(tmp_path):
    settings = _settings(tmp_path)
    store = MarketStore(settings.db_path)
    opened_at = datetime(2026, 8, 21, 5, 0, tzinfo=timezone.utc)
    opened = run_paper_cycle(
        store, settings, [_candidate("SHORTY", opened_at, "SHORT")],
        {"SHORTY": {"bid": 200.0, "ask": 200.2, "ts": opened_at}}, opened_at, "short-entry",
    )
    assert opened["openPositions"][0]["side"] == "SHORT"
    result = run_paper_cycle(
        store, settings, [],
        {"SHORTY": {"bid": 205.0, "ask": 205.2, "ts": opened_at + timedelta(minutes=3)}},
        opened_at + timedelta(minutes=3), "short-exit",
    )
    trade = result["recentClosedTrades"][0]
    assert trade["exit_reason"] == "STOP_LOSS"
    assert trade["net_pnl"] < 0


def test_alpha_exit_uses_completed_ema_close(tmp_path):
    settings = _settings(tmp_path)
    store = MarketStore(settings.db_path)
    opened_at = datetime(2026, 8, 21, 5, 0, tzinfo=timezone.utc)
    run_paper_cycle(
        store, settings, [_candidate("FAIL", opened_at)],
        {"FAIL": {"bid": 199.8, "ask": 200.0, "ts": opened_at}}, opened_at, "fail-entry",
    )
    result = run_paper_cycle(
        store, settings, [],
        {"FAIL": {"bid": 198.8, "ask": 199.0, "ts": opened_at + timedelta(minutes=1),
                  "five_minute_closes": [198.8], "ema9_5m": 199.2}},
        opened_at + timedelta(minutes=1), "fail-exit",
    )
    assert result["recentClosedTrades"][0]["exit_reason"] == "ALPHA_EMA9_5M_CLOSE"


def test_cross_agent_market_thesis_does_not_override_agent_exit(tmp_path):
    settings = _settings(tmp_path)
    store = MarketStore(settings.db_path)
    opened_at = datetime(2026, 8, 21, 5, 0, tzinfo=timezone.utc)
    run_paper_cycle(
        store, settings, [_candidate("TEST", opened_at)],
        {"TEST": {"bid": 199.8, "ask": 200.0, "ts": opened_at}}, opened_at, "entry",
    )
    result = run_paper_cycle(
        store, settings, [],
        {"TEST": {"bid": 200.1, "ask": 200.3, "ts": opened_at + timedelta(seconds=61),
                  "market_trend": "BEARISH", "sector_trend": "BULLISH", "symbol_trend": "BULLISH"}},
        opened_at + timedelta(seconds=61), "thesis-check",
    )
    assert [trade["symbol"] for trade in result["openPositions"]] == ["TEST"]


def test_adverse_regime_flattens_even_during_minimum_hold(tmp_path):
    settings = _settings(tmp_path)
    store = MarketStore(settings.db_path)
    opened_at = datetime(2026, 8, 21, 5, 0, tzinfo=timezone.utc)
    run_paper_cycle(store, settings, [_candidate("TEST", opened_at)],
                    {"TEST": {"bid": 199.8, "ask": 200.0, "ts": opened_at}}, opened_at, "entry")
    result = run_paper_cycle(store, settings, [],
                             {"TEST": {"bid": 200.0, "ask": 200.2,
                                       "ts": opened_at + timedelta(seconds=5), "regime_adverse": True}},
                             opened_at + timedelta(seconds=5), "regime-exit")
    assert result["recentClosedTrades"][0]["exit_reason"] == "REGIME_CHANGED_ADVERSE"


def test_exit_logic_runs_once_per_completed_candle(tmp_path):
    settings = _settings(tmp_path)
    store = MarketStore(settings.db_path)
    opened_at = datetime(2026, 8, 21, 5, 0, tzinfo=timezone.utc)
    run_paper_cycle(store, settings, [_candidate("TEST", opened_at)],
                    {"TEST": {"bid": 199.8, "ask": 200.0, "ts": opened_at}}, opened_at, "entry")
    candle = opened_at + timedelta(minutes=1)
    run_paper_cycle(store, settings, [], {"TEST": {
        "bid": 201.0, "ask": 201.2, "ts": candle, "completed_candle": True,
    }}, opened_at + timedelta(minutes=2), "first-evaluation")
    duplicate = run_paper_cycle(store, settings, [], {"TEST": {
        "bid": 201.0, "ask": 201.2, "ts": candle, "completed_candle": True, "regime_adverse": True,
    }}, opened_at + timedelta(minutes=2, seconds=30), "duplicate-evaluation")
    assert [trade["symbol"] for trade in duplicate["openPositions"]] == ["TEST"]
    next_candle = run_paper_cycle(store, settings, [], {"TEST": {
        "bid": 201.0, "ask": 201.2, "ts": candle + timedelta(minutes=1),
        "completed_candle": True, "regime_adverse": True,
    }}, opened_at + timedelta(minutes=3), "next-candle")
    assert next_candle["recentClosedTrades"][0]["exit_reason"] == "REGIME_CHANGED_ADVERSE"


def test_qualified_same_symbol_can_reenter_after_loss_below_daily_limit(tmp_path):
    settings = _settings(tmp_path)
    store = MarketStore(settings.db_path)
    now = datetime(2026, 8, 21, 5, 0, tzinfo=timezone.utc)
    run_paper_cycle(
        store, settings, [_candidate("LOSS", now)],
        {"LOSS": {"bid": 199.8, "ask": 200.0, "ts": now}}, now, "loss-entry",
    )
    closed = run_paper_cycle(
        store, settings, [],
        {"LOSS": {"bid": 198.8, "ask": 199.0, "ts": now + timedelta(minutes=2)}},
        now + timedelta(minutes=2), "qualified-exit",
    )
    assert closed["dailyMetrics"]["netPnl"] > -settings.paper_daily_loss_limit
    result = run_paper_cycle(
        store, settings, [_candidate("LOSS", now + timedelta(minutes=3))],
        {"LOSS": {"bid": 199.8, "ask": 200.0, "ts": now + timedelta(minutes=3)}},
        now + timedelta(minutes=3), "qualified-reentry",
    )
    assert [trade["symbol"] for trade in result["openPositions"]] == ["LOSS"]
