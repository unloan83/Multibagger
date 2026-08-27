"""
Pytest unit tests for Self-Healing Runtime Recovery Engine
"""

import pytest
from engine.runtime_recovery import (
    SelfHealingRecoveryEngine,
    ISSUE_AUTH_FAILURE,
    ISSUE_STALE_DATA,
    ISSUE_DB_READONLY,
    ISSUE_DB_LOCK,
    ISSUE_WORKER_STOPPED,
    ISSUE_DUPLICATE_WORKER,
    ISSUE_SCANNER_STOPPED,
    ISSUE_API_DISCONNECTED,
    ISSUE_REGIME_STALE,
    ISSUE_CONFIG_MISMATCH,
    ISSUE_UNKNOWN,
)


def test_self_healing_recovery_rate_limit():
    engine = SelfHealingRecoveryEngine()
    issue = ISSUE_STALE_DATA
    ctx = {"suppress_telegram": True}

    # Attempt 1, 2, 3
    for _ in range(3):
        assert engine.can_attempt_recovery(issue) is True
        res = engine.diagnose_and_recover(issue, ctx)
        assert res["status"] == "PASS"

    # Attempt 4 should hit rate limit (max 3 per 30 mins)
    assert engine.can_attempt_recovery(issue) is False
    res = engine.diagnose_and_recover(issue, ctx)
    assert res["status"] == "FAIL"
    assert "RATE_LIMIT_EXCEEDED" in res["root_cause"]


def test_self_healing_forbidden_when_daily_loss_breaker_hit():
    engine = SelfHealingRecoveryEngine()
    res = engine.diagnose_and_recover(ISSUE_WORKER_STOPPED, {
        "daily_loss_breaker_hit": True,
        "suppress_telegram": True
    })
    assert res["status"] == "FAIL"
    assert res["resumed"] is False
    assert "Hard Daily Loss Breaker Hit" in res["root_cause"]


def test_self_healing_unknown_fails_closed():
    engine = SelfHealingRecoveryEngine()
    res = engine.diagnose_and_recover(ISSUE_UNKNOWN, {
        "exception_traceback": "Uncaught Exception",
        "suppress_telegram": True
    })
    assert res["resumed"] is False
    assert res["verified"] is False
    assert res["status"] == "PASS"
