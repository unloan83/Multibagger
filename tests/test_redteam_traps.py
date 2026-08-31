"""
tests/test_redteam_traps.py
============================
Pytest suite for 19 Red-Team mutation traps, 3 operational gates, and forensic self-integrity.
"""
from __future__ import annotations

import pytest
import unittest.mock as mock


def test_redteam_19_traps_all_caught():
    """Requirement 19: All 19 Red-Team traps must be caught (0 escaped traps)."""
    from engine.forensic_agent.redteam import run_all_redteam_traps
    trap_results, escaped_count = run_all_redteam_traps()
    assert len(trap_results) == 19
    assert escaped_count == 0, f"{escaped_count} red-team traps escaped detection!"


def test_forensic_self_integrity():
    """Requirement 13: Self-integrity manifest audit must pass."""
    from engine.forensic_agent.manifest import verify_self_integrity
    passed, summary, defects = verify_self_integrity()
    assert passed is True, f"Self-integrity failed: {defects}"


def test_recovery_lifecycle_tests():
    """Requirement 9: All 3 recovery lifecycle tests must pass."""
    from engine.forensic_agent.recovery import run_all_recovery_tests
    rec_results = run_all_recovery_tests()
    assert len(rec_results) == 3
    assert all(r.passed for r in rec_results), "Some recovery lifecycle tests failed!"


def test_authoritative_calendar_checksum():
    """Requirement 8: Authoritative calendar checksum and load status."""
    from engine.trading_calendar import load_authoritative_calendar
    ok, csum, hols, meta = load_authoritative_calendar()
    assert ok is True
    assert len(csum) == 16
    assert meta["loaded_successfully"] is True


def test_three_operational_gates_separation():
    """Requirement 1: 3 operational gates evaluate independently."""
    from engine.forensic_agent.core import ForensicAgent
    agent = ForensicAgent()
    report_text, review_id, verdicts = agent.run_audit(mode="quick")

    assert "PREMARKET_READY" in verdicts
    assert "RUNTIME_HEALTH" in verdicts
    assert "SESSION_EVIDENCE" in verdicts
    assert "FORENSIC_LOGIC_TRUST" in verdicts
    assert verdicts["FORENSIC_LOGIC_TRUST"] == "TRUSTED"


def test_task_investigation_agent():
    """Requirement 1-10: Test Task Forensic Investigation Agent execution and output."""
    from engine.forensic_agent.investigator import investigate_task_completion
    report = investigate_task_completion()
    assert report.correct_fix_running.status == "PASS"
    assert report.old_code_path_active.status == "NO"
    assert report.original_blockage_cleared.status == "PASS"
    assert report.required_function_working.status in ("PASS", "NOT_VERIFIED")
    assert report.task_status in ("VERIFIED_COMPLETE", "FAILED", "NOT_VERIFIED")
    out_text = report.format_output()
    assert "ORIGINAL_TASK:" in out_text
    assert "CORRECT_FIX_RUNNING:" in out_text
    assert "ORIGINAL_BLOCKAGE_CLEARED:" in out_text
    assert "REQUIRED_FUNCTION_WORKING:" in out_text
    assert "TASK_STATUS:" in out_text
