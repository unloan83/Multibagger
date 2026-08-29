"""
tests/test_forensic_injection.py
==================================
Pytest suite for the 8 controlled failure injection scenarios (INJ-01 through INJ-08).
All tests are sandboxed and must pass (verifying fail-closed behavior).
"""
from __future__ import annotations

import pytest
from engine.forensic_agent.injection import (
    inj01_missing_token,
    inj02_expired_token_401,
    inj03_api_timeout,
    inj04_stale_data,
    inj05_zero_tick_feed,
    inj06_db_unavailable,
    inj07_scanner_stalled,
    inj08_risk_breach,
    run_all_injections,
)


def test_inj01_missing_token():
    res = inj01_missing_token()
    assert res.passed is True
    assert res.injection_id == "INJ-01"


def test_inj02_expired_token_401():
    res = inj02_expired_token_401()
    assert res.passed is True
    assert res.injection_id == "INJ-02"


def test_inj03_api_timeout():
    res = inj03_api_timeout()
    assert res.passed is True
    assert res.injection_id == "INJ-03"


def test_inj04_stale_data():
    res = inj04_stale_data()
    assert res.passed is True
    assert res.injection_id == "INJ-04"


def test_inj05_zero_tick_feed():
    res = inj05_zero_tick_feed()
    assert res.passed is True
    assert res.injection_id == "INJ-05"


def test_inj06_db_unavailable():
    res = inj06_db_unavailable()
    assert res.passed is True
    assert res.injection_id == "INJ-06"


def test_inj07_scanner_stalled():
    res = inj07_scanner_stalled()
    assert res.passed is True
    assert res.injection_id == "INJ-07"


def test_inj08_risk_breach():
    res = inj08_risk_breach()
    assert res.passed is True
    assert res.injection_id == "INJ-08"


def test_all_injections_run():
    results = run_all_injections()
    assert len(results) == 8
    failed = [r for r in results if not r.passed]
    assert len(failed) == 0, f"Injections failed: {[f.name for f in failed]}"
