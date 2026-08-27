#!/usr/bin/env python3
"""
Deterministic 10-Scenario Replay Test Runner for Self-Healing Runtime Recovery Engine
"""

from __future__ import annotations

import sys
import os
from pathlib import Path

os.environ["MULTIBAGGER_TEST_MODE"] = "1"

# Fix parent package resolution when run directly
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.runtime_recovery import (
    SelfHealingRecoveryEngine,
    ISSUE_AUTH_FAILURE,
    ISSUE_STALE_DATA,
    ISSUE_DB_READONLY,
    ISSUE_DB_LOCK,
    ISSUE_WORKER_STOPPED,
    ISSUE_DUPLICATE_WORKER,
    ISSUE_SCANNER_STOPPED,
    ISSUE_REGIME_STALE,
    ISSUE_CONFIG_MISMATCH,
    ISSUE_UNKNOWN,
)


def run_self_healing_tests():
    engine = SelfHealingRecoveryEngine()

    test_cases = [
        ("T01", ISSUE_AUTH_FAILURE, "Sandbox OAuth token expired", {"mock_auth_success": True, "suppress_telegram": True}),
        ("T02", ISSUE_STALE_DATA, "WebSocket feed stale by 450s", {"suppress_telegram": True}),
        ("T03", ISSUE_DB_READONLY, "DuckDB connection opened read-only during write cycle", {"suppress_telegram": True}),
        ("T04", ISSUE_DB_LOCK, "Competing DuckDB connection lock detected", {"suppress_telegram": True}),
        ("T05", ISSUE_WORKER_STOPPED, "multibagger-paper.service inactive", {"suppress_telegram": True}),
        ("T06", ISSUE_DUPLICATE_WORKER, "Multiple worker PIDs (1356734, 1356999) detected", {"suppress_telegram": True}),
        ("T07", ISSUE_SCANNER_STOPPED, "Scanner loop stalled for >900s", {"suppress_telegram": True}),
        ("T08", ISSUE_REGIME_STALE, "MarketRegimeAgent timestamp age >600s", {"suppress_telegram": True}),
        ("T09", ISSUE_CONFIG_MISMATCH, "Daily profit target mismatched in runtime env", {"suppress_telegram": True}),
        ("T10", ISSUE_UNKNOWN, "Unhandled MemoryError exception in thread worker", {"exception_traceback": "MemoryError: OOM", "suppress_telegram": True}),
    ]

    print("=" * 106)
    print("        SELF-HEALING RUNTIME RECOVERY MATRIX — DETERMINISTIC 10-SCENARIO VERIFICATION")
    print("=" * 106)
    print(f"{'TEST':<5} | {'DETECTED ISSUE':<18} | {'AUTO ACTION':<40} | {'VERIFIED':<8} | {'PASS/FAIL':<9}")
    print("-" * 106)

    all_passed = True
    for test_id, issue, root_cause, ctx in test_cases:
        ctx["root_cause"] = root_cause
        res = engine.diagnose_and_recover(issue, ctx)
        action_short = (res["auto_action"][:37] + "...") if len(res["auto_action"]) > 40 else res["auto_action"]
        verified_str = "YES" if res["verified"] else "NO"
        status_str = res["status"]

        # T10 (UNKNOWN) fails closed safely by design, which is the required pass condition for UNKNOWN
        if issue == ISSUE_UNKNOWN and not res["verified"] and res["resumed"] is False:
            status_str = "PASS"

        if status_str != "PASS":
            all_passed = False

        print(f"{test_id:<5} | {issue:<18} | {action_short:<40} | {verified_str:<8} | {status_str:<9}")

    print("-" * 106)
    ready_str = "YES" if all_passed else "NO"
    print(f"SELF-HEALING RUNTIME READY: {ready_str}")
    print("=" * 106)

    return all_passed


if __name__ == "__main__":
    success = run_self_healing_tests()
    sys.exit(0 if success else 1)
