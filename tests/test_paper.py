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
    return Settings("", tmp_path / "market.duckdb", tmp_path / "signals.json", universe, max_symbols=1)


def _candidate(symbol, now):
    return Candidate(symbol, 200.0, 195.0, 210.0, "ORB_15M", now, now + timedelta(minutes=20), 90.0)


def test_automatic_paper_entry_exit_and_daily_target_lock(tmp_path):
    settings = _settings(tmp_path)
    store = MarketStore(settings.db_path)
    opened_at = datetime(2026, 8, 17, 5, 0, tzinfo=timezone.utc)

    first = run_paper_cycle(
        store, settings, [_candidate("TEST", opened_at)],
        {"TEST": {"bid": 199.8, "ask": 200.0, "ts": opened_at}}, opened_at, "run-one",
    )
    assert len(first["openPositions"]) == 1
    assert first["openPositions"][0]["quantity"] == 500
    assert first["dailyMetrics"]["closedTrades"] == 0

    exit_time = opened_at + timedelta(minutes=5)
    second = run_paper_cycle(
        store, settings, [_candidate("OTHER", exit_time)],
        {
            "TEST": {"bid": 211.0, "ask": 211.2, "ts": exit_time},
            "OTHER": {"bid": 199.8, "ask": 200.0, "ts": exit_time},
        }, exit_time, "run-two",
    )
    assert second["openPositions"] == []
    assert second["dailyMetrics"]["closedTrades"] == 1
    assert second["dailyMetrics"]["netPnl"] >= settings.paper_daily_profit_target
    assert second["targetReached"] is True
    assert second["newEntriesEnabled"] is False
    assert second["recentClosedTrades"][0]["exit_reason"] == "PROFIT_TARGET"
    assert "Daily paper profit target reached" in " ".join(second["noEntryReasons"])


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
    assert "Outside the automatic paper-entry window" in " ".join(result["noEntryReasons"])


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
        {"TEST": {"bid": 211.0, "ask": 211.2, "ts": exit_time, "instrument_key": "NSE_EQ|TEST"}},
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
        con.execute("INSERT INTO paper_signals VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')", [
            "rejected-run", candidate.symbol, candidate.entry, candidate.stop,
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


def test_lightweight_monitor_exits_open_trade_and_records_audit_history(tmp_path):
    settings = _settings(tmp_path)
    store = MarketStore(settings.db_path)
    opened_at = datetime(2026, 8, 17, 5, 0, tzinfo=timezone.utc)
    run_paper_cycle(
        store, settings, [_candidate("TEST", opened_at)],
        {"TEST": {"bid": 199.8, "ask": 200.0, "ts": opened_at}}, opened_at, "run-one",
    )
    exit_time = opened_at + timedelta(minutes=2)
    store.upsert_bar({
        "instrument_key": "NSE_EQ|TEST", "symbol": "TEST", "ts": exit_time,
        "open": 200.0, "high": 212.0, "low": 199.0, "close": 211.0,
        "volume": 1000, "bid": 211.0, "ask": 211.2, "received_at": exit_time,
    })
    result = run_risk_monitor(settings, exit_time)
    assert result["openPositions"] == []
    assert result["recentClosedTrades"][0]["exit_reason"] == "PROFIT_TARGET"
    assert result["closedByMonitor"][0]["trade_id"] == result["recentClosedTrades"][0]["trade_id"]
    snapshot = json.loads(settings.snapshot_path.read_text())
    assert snapshot["asOf"] == exit_time.isoformat()
    assert snapshot["paperTrading"]["dailyMetrics"]["closedTrades"] == 1
    assert snapshot["reason"] == "NO_TRADE"
    with store.connect() as con:
        event_types = [row[0] for row in con.execute("SELECT event_type FROM paper_trade_events ORDER BY observed_at").fetchall()]
        assert event_types == ["ENTRY", "EXIT"]
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
    assert result["openPositions"] == []
    assert result["recentClosedTrades"][0]["exit_reason"] == "PROFIT_TARGET"


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
