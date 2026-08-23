from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pandas as pd
import pytest

from engine.config import Settings
from engine.paper import _dynamic_risk, _regular_exit_reason, run_paper_cycle
from engine.regime_detector import detect_opening_market_gate
from engine.scanner import _sector_qualified
from engine.store import MarketStore
from engine.strategies import Candidate, active_agent


def _settings(tmp_path):
    universe = tmp_path / "universe.json"
    universe.write_text('[{"symbol":"TEST","sources":["NIFTY 500"]}]')
    return Settings("", tmp_path / "market.duckdb", tmp_path / "signals.json", universe,
                    max_symbols=1, execution_paused=False, require_setup_confirmation=False)


def _candidate(symbol, now, agent, stop=195.0):
    return Candidate(symbol, "LONG", 200.0, stop, 220.0, f"{agent}_TEST", now,
                     now + timedelta(minutes=20), 100.0,
                     {"agent": agent, "regime": "NORMAL", "atr": 1.0})


def _quote(now, bid=199.9, ask=200.0, **extra):
    return {"bid": bid, "ask": ask, "ts": now, **extra}


def test_agent_windows_are_isolated_and_exhaustive():
    assert active_agent(datetime(2026, 8, 24, 4, 0, tzinfo=timezone.utc)) == "ALPHA"
    assert active_agent(datetime(2026, 8, 24, 5, 29, tzinfo=timezone.utc)) == "ALPHA"
    assert active_agent(datetime(2026, 8, 24, 5, 30, tzinfo=timezone.utc)) == "BETA"
    assert active_agent(datetime(2026, 8, 24, 8, 0, tzinfo=timezone.utc)) == "GAMMA"
    assert active_agent(datetime(2026, 8, 24, 9, 30, tzinfo=timezone.utc)) is None
    assert _sector_qualified("GAMMA", "RANGE", None) is True
    assert _sector_qualified("GAMMA", "BULLISH", 1) is False
    assert _sector_qualified("ALPHA", "BULLISH", 3) is True
    assert _sector_qualified("BETA", "BEARISH", 4) is False


def test_agent_exit_rules_are_independent(tmp_path):
    settings = _settings(tmp_path)
    now = datetime(2026, 8, 24, 5, 0, tzinfo=timezone.utc)
    base = {"side": "LONG", "entry_quote": 200.0, "stop_price": 195.0,
            "original_stop_price": 195.0, "trading_day": now.date(),
            "opened_at": now - timedelta(minutes=5), "break_even_stop": False,
            "intended_order_json": "{}"}
    assert _regular_exit_reason({**base, "agent": "ALPHA"},
                                _quote(now, bid=199.0, ema9_5m=200.0,
                                       five_minute_closes=[199.0]), now, settings) == "ALPHA_EMA9_5M_CLOSE"
    assert _regular_exit_reason({**base, "agent": "BETA"},
                                _quote(now, bid=198.0, vwap=199.5,
                                       five_minute_closes=[199.0, 198.0]), now, settings) == "BETA_TWO_5M_VWAP_CLOSES"
    gamma = {**base, "agent": "GAMMA",
             "intended_order_json": '{"signal":{"confirmations":{"mean":201}}}'}
    assert _regular_exit_reason(gamma, _quote(now, bid=201.0, vwap=202.0,
                                              five_minute_closes=[201.0]), now, settings) == "GAMMA_MEAN_VWAP_RECROSS"


def test_risk_caps_and_scale_out(tmp_path):
    settings = _settings(tmp_path)
    store = MarketStore(settings.db_path)
    opened = datetime(2026, 8, 24, 4, 30, tzinfo=timezone.utc)
    result = run_paper_cycle(store, settings, [_candidate("TEST", opened, "ALPHA")],
                             {"TEST": _quote(opened)}, opened, "entry")
    trade = result["openPositions"][0]
    assert trade["allowed_risk"] <= 500
    assert trade["quantity"] * abs(trade["entry_quote"] - trade["original_stop_price"]) <= 500

    partial_at = opened + timedelta(minutes=5)
    result = run_paper_cycle(store, settings, [],
                             {"TEST": _quote(partial_at, bid=207.6, ask=207.7)}, partial_at, "partial")
    trade = result["openPositions"][0]
    assert trade["partial_quantity"] == trade["initial_quantity"] // 2
    assert trade["stop_price"] >= trade["entry_quote"]
    assert trade["break_even_stop"] is True
    exit_at = partial_at + timedelta(minutes=5)
    result = run_paper_cycle(store, settings, [],
                             {"TEST": _quote(exit_at, bid=trade["stop_price"] - 0.01,
                                              ask=trade["stop_price"])}, exit_at, "exit")
    closed = result["recentClosedTrades"][0]
    assert closed["exit_reason"] == "BREAK_EVEN_STOP"
    assert closed["no_scale_out_pnl"] != 0
    assert "noScaleOutExpectancy" in result["dailyMetrics"]


def test_aggregate_open_risk_cap_rejects_second_agent(tmp_path):
    settings = _settings(tmp_path)
    store = MarketStore(settings.db_path)
    alpha_at = datetime(2026, 8, 24, 4, 30, tzinfo=timezone.utc)
    run_paper_cycle(store, settings, [_candidate("ALPHA", alpha_at, "ALPHA")],
                    {"ALPHA": _quote(alpha_at)}, alpha_at, "alpha")
    beta_at = datetime(2026, 8, 24, 5, 30, tzinfo=timezone.utc)
    result = run_paper_cycle(store, settings, [_candidate("BETA", beta_at, "BETA")],
                             {"ALPHA": _quote(beta_at), "BETA": _quote(beta_at)}, beta_at, "beta")
    assert len(result["openPositions"]) == 1
    assert result["entryRejections"][0]["reason"] == "AGGREGATE_OPEN_RISK_CAP"


def test_dynamic_risk_stays_between_250_and_500(tmp_path):
    settings = _settings(tmp_path)
    assert [_dynamic_risk(pnl, settings) for pnl in (-900, -100, 0, 2500, 3500)] == [250, 375, 500, 375, 250]


@pytest.mark.parametrize("pnl", [4000.0, -1000.0])
def test_daily_breakers_block_new_trades_without_quota_entries(tmp_path, pnl):
    settings = _settings(tmp_path)
    store = MarketStore(settings.db_path)
    now = datetime(2026, 8, 24, 4, 30, tzinfo=timezone.utc)
    run_paper_cycle(store, settings, [_candidate("OLD", now, "ALPHA")],
                    {"OLD": _quote(now)}, now, "old")
    with store.connect() as con:
        con.execute("UPDATE paper_trades SET status='CLOSED',net_pnl=?,closed_at=?", [pnl, now])
    result = run_paper_cycle(store, settings, [_candidate("NEW", now, "ALPHA")],
                             {"NEW": _quote(now)}, now, "new")
    assert result["openPositions"] == []
    assert result["newEntriesEnabled"] is False


def test_opening_gate_does_not_kill_on_low_vix_alone(tmp_path):
    settings = _settings(tmp_path)
    now = datetime(2026, 8, 24, 4, 0, tzinfo=timezone.utc)
    start = now - timedelta(minutes=15)
    index = pd.DataFrame([{
        "ts": start + timedelta(minutes=i), "open": 22000 + i * 2,
        "high": 22005 + i * 2, "low": 21995 + i * 2, "close": 22002 + i * 2,
        "volume": 1000 + i * 10,
    } for i in range(15)])
    vix = pd.DataFrame([{"ts": start + timedelta(minutes=i), "close": 10.5, "volume": 1}
                        for i in range(15)])
    gate = detect_opening_market_gate(index, vix, 1.8, settings, now)
    assert gate.regime != "NO_TRADE"


def test_live_trading_environment_is_rejected(monkeypatch):
    monkeypatch.setenv("ENABLE_LIVE_TRADING", "true")
    with pytest.raises(RuntimeError, match="paper-only"):
        Settings.from_env()


def test_stale_and_excessive_spread_fail_closed(tmp_path):
    settings = _settings(tmp_path)
    store = MarketStore(settings.db_path)
    now = datetime(2026, 8, 24, 4, 30, tzinfo=timezone.utc)
    stale = run_paper_cycle(store, settings, [_candidate("STALE", now, "ALPHA")],
                            {"STALE": _quote(now - timedelta(minutes=10))}, now, "stale")
    assert stale["openPositions"] == []
    wide = run_paper_cycle(store, settings, [_candidate("WIDE", now, "ALPHA")],
                           {"WIDE": _quote(now, bid=199.0, ask=200.0)}, now, "wide")
    assert wide["entryRejections"][0]["reason"] == "EXCESSIVE_LIVE_SPREAD"
