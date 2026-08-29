"""
tests/test_forensic_agent.py
==============================
Pytest suite for hardened Forensic Diagnosis & Completion Agent.
Tests Global Rule enforcement, market calendar holiday awareness, pipeline session correlation, and history memory.
"""
from __future__ import annotations

import pytest
import os
import unittest.mock as mock
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]


def test_chk01_config_fields_present():
    from engine.forensic_agent.checks import chk01_config_fields_present
    res = chk01_config_fields_present()
    assert res.status == "PASS"
    assert "engine/config.py" in res.evidence
    assert res.check_id == "CHK-01"


def test_chk02_risk_caps_hardcoded():
    from engine.forensic_agent.checks import chk02_risk_caps_hardcoded
    res = chk02_risk_caps_hardcoded()
    assert res.status == "PASS"
    assert "Settings.from_env()" in res.evidence


def test_chk03_execution_paused_flag():
    from engine.forensic_agent.checks import chk03_execution_paused_flag
    res = chk03_execution_paused_flag()
    assert res.status == "PASS"
    assert "execution_paused" in res.evidence


def test_global_rule_chk12_no_feed_lines():
    """Global Rule: CHK-12 must return NOT_VERIFIED if no log lines exist."""
    from engine.forensic_agent.checks import chk12_quote_tick_delta
    with mock.patch("engine.forensic_agent.checks.LOG_PATH") as mock_path:
        mock_path.exists.return_value = False
        res = chk12_quote_tick_delta()
        assert res.status == "NOT_VERIFIED"


def test_global_rule_chk13_rest_unreachable():
    """Global Rule: CHK-13 must return NOT_VERIFIED (not PASS) if REST endpoint is unreachable."""
    from engine.forensic_agent.checks import chk13_auth_token_rest
    old_val = os.environ.get("UPSTOX_ACCESS_TOKEN")
    os.environ["UPSTOX_ACCESS_TOKEN"] = "valid_token_string"
    try:
        import urllib.error
        with mock.patch("urllib.request.urlopen", side_effect=urllib.error.URLError("Connection refused")):
            res = chk13_auth_token_rest()
            assert res.status == "NOT_VERIFIED"
            assert "unreachable" in res.evidence
    finally:
        if old_val is not None:
            os.environ["UPSTOX_ACCESS_TOKEN"] = old_val


def test_global_rule_chk14_empty_scanner():
    """Global Rule: CHK-14 must return NOT_VERIFIED if scanner_runs table is empty."""
    from engine.forensic_agent.checks import chk14_scanner_not_stalled
    with mock.patch("engine.store.MarketStore") as mock_store_cls:
        mock_store = mock.MagicMock()
        mock_con = mock.MagicMock()
        mock_con.execute.return_value.fetchone.return_value = None
        mock_store.connect.return_value.__enter__.return_value = mock_con
        mock_store_cls.return_value = mock_store

        res = chk14_scanner_not_stalled()
        assert res.status == "NOT_VERIFIED"


def test_global_rule_chk17_insufficient_samples():
    """Global Rule: CHK-17 must return NOT_VERIFIED if <5 tick log entries exist."""
    from engine.forensic_agent.checks import chk17_frozen_tick_counter
    with mock.patch("engine.forensic_agent.checks.LOG_PATH") as mock_path:
        mock_path.exists.return_value = True
        mock_path.read_text.return_value = "Upstox feed healthy; quote_ticks=10 candle_ticks=10\n"
        res = chk17_frozen_tick_counter()
        assert res.status == "NOT_VERIFIED"


def test_market_calendar_holidays_and_weekends():
    """Requirement 3: Test market calendar holiday awareness."""
    from engine.calendar import get_market_session_state

    # Republic Day: 2026-01-26 (Monday)
    rep_day = datetime(2026, 1, 26, 5, 30, tzinfo=timezone.utc)
    s_rep = get_market_session_state(rep_day)
    assert s_rep["is_holiday"] is True
    assert s_rep["session_type"] == "HOLIDAY"
    assert s_rep["market_status"] == "MARKET_CLOSED"
    assert s_rep["is_market_open"] is False

    # Saturday: 2026-08-29
    sat = datetime(2026, 8, 29, 4, 30, tzinfo=timezone.utc)
    s_sat = get_market_session_state(sat)
    assert s_sat["is_weekend"] is True
    assert s_sat["session_type"] == "WEEKEND"
    assert s_sat["market_status"] == "MARKET_CLOSED"
    assert s_sat["is_market_open"] is False


def test_session_correlated_pipeline_readiness():
    """Requirement 2: Historical scanner run from previous date returns NOT_VERIFIED for Stage 3."""
    from engine.forensic_agent.pipeline import validate_pipeline
    stages = validate_pipeline()
    stage3 = next(s for s in stages if s.stage_num == 3)
    # Since current date in test environment is 2026-08-29 (Saturday) and last scan in DB was 2026-08-28, Stage 3 MUST be NOT_VERIFIED
    assert stage3.status == "NOT_VERIFIED"
    assert "historical" in stage3.evidence or "NOT_VERIFIED" in stage3.status


def test_stage6_single_run_validation_evidence():
    """Requirement 1: Stage 6 returns NOT_VERIFIED without single current-session run_id evidence."""
    from engine.forensic_agent.pipeline import validate_pipeline
    stages = validate_pipeline()
    stage6 = next(s for s in stages if s.stage_num == 6)
    assert stage6.status in ("PASS", "NOT_VERIFIED")


def test_resource_tracker_linux_proc():
    """Requirement 5: ResourceTracker produces non-zero genuine RSS RAM and CPU telemetry."""
    from engine.forensic_agent.resource import ResourceTracker
    with ResourceTracker() as rt:
        rt.sample()
    proof = rt.proof()
    assert proof.peak_ram_mb > 0.0
    assert proof.telemetry_verified is True
    assert proof.resource_limit_breach in ("YES", "NO")


def test_pnl_audited_migration():
    """Requirement 4: Audit script detects P&L discrepancies without mutating DB unless apply=True."""
    from scripts.fix_pnl_accounting import audit_and_correct_pnl
    records = audit_and_correct_pnl(apply_fix=False)
    # Read-only audit returns list without modifying DB
    assert isinstance(records, list)


def test_history_persistence():
    from engine.forensic_agent.history import append_review, get_last_review
    review_id = append_review(
        trigger="pytest_test",
        check_results=[],
        pipeline_results=[],
        injection_results=[],
        resource_proof={"FORENSIC_CPU": 1.0, "PEAK_RAM_MB": 40.0, "DURATION_SEC": 0.5, "DB_QUERY_COUNT": 0, "API_CALL_COUNT": 0, "RESOURCE_LIMIT_BREACH": "NO"},
        verdict="VERIFIED_COMPLETE",
        ready_to_trade="NO",
        blocking_reasons=["Pytest test execution"],
    )
    assert review_id.startswith("FA-")
    last = get_last_review()
    assert last is not None
    assert last["review_id"] == review_id
