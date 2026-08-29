"""
engine/forensic_agent/history.py
===================================
Persistent forensic memory management.

Manages two files:
  data/FORENSIC_AGENT_HISTORY.json  -- per-review record + PREVIOUS_VERDICT_INVALIDATED
  data/FORENSIC_FAILURE_MEMORY.json -- unique failure fingerprints for recurrence detection

Key rules:
- Before every review: load both, re-test active fingerprints
- CRITICAL fingerprint recurrence = automatic NOT_READY
- False PASS/READY correction = PREVIOUS_VERDICT_INVALIDATED record + new fingerprint
- Never delete history. Append only.
- Blunder chain: BLUNDER -> WHY_MISSED -> CORRECTION -> NEW_CHECK -> RETEST -> PROOF -> CLOSED/MONITORING
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

LOG = logging.getLogger("multibagger.forensic_agent.history")

ROOT = Path(__file__).resolve().parents[2]
HISTORY_PATH = ROOT / "data" / "FORENSIC_AGENT_HISTORY.json"
MEMORY_PATH = ROOT / "data" / "FORENSIC_FAILURE_MEMORY.json"
REGISTER_PATH = ROOT / "data" / "SELF_LEARNING_FAILURE_REGISTER.json"
LOG_PATH = ROOT / "logs" / "forensic_agent.log"

VERDICTS = frozenset({"VERIFIED_COMPLETE", "PARTIALLY_VERIFIED", "FAILED", "NOT_VERIFIED", "REGRESSION_DETECTED", "PASS", "FAIL"})
READY_VALUES = frozenset({"YES", "NO"})


# ---------------------------------------------------------------------------
# Log helpers
# ---------------------------------------------------------------------------

def _log_jsonl(event: dict[str, Any]) -> None:
    """Append a structured JSON-lines entry to forensic_agent.log."""
    try:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(event, default=str) + "\n"
        with LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(line)
    except Exception as e:
        LOG.error("Cannot write forensic_agent.log: %s", e)


# ---------------------------------------------------------------------------
# History (FORENSIC_AGENT_HISTORY.json)
# ---------------------------------------------------------------------------

def _load_history() -> dict[str, Any]:
    if not HISTORY_PATH.exists():
        return {"schema_version": "1.0", "reviews": []}
    try:
        return json.loads(HISTORY_PATH.read_text())
    except Exception as e:
        LOG.error("Cannot load FORENSIC_AGENT_HISTORY: %s", e)
        return {"schema_version": "1.0", "reviews": []}


def _save_history(data: dict[str, Any]) -> None:
    try:
        HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
        HISTORY_PATH.write_text(json.dumps(data, indent=2, default=str))
    except Exception as e:
        LOG.error("Cannot save FORENSIC_AGENT_HISTORY: %s", e)


def append_review(
    trigger: str,
    check_results: list[dict],
    pipeline_results: list[dict],
    injection_results: list[dict],
    resource_proof: dict,
    verdict: str,
    ready_to_trade: str,
    blocking_reasons: list[str],
    previous_verdict_invalidated: dict | None = None,
    started_at: datetime | None = None,
    duration_sec: float = 0.0,
) -> str:
    """Append a review record; return its review_id."""
    assert verdict in VERDICTS, f"Invalid verdict: {verdict}"
    assert ready_to_trade in READY_VALUES, f"Invalid ready_to_trade: {ready_to_trade}"

    data = _load_history()
    reviews: list[dict] = data.get("reviews", [])

    # Assign sequential review ID
    existing_nums = [
        int(r["review_id"].replace("FA-", ""))
        for r in reviews
        if r.get("review_id", "").startswith("FA-") and r["review_id"][3:].isdigit()
    ]
    next_num = max(existing_nums, default=0) + 1
    review_id = f"FA-{next_num:04d}"
    now_str = (started_at or datetime.now(timezone.utc)).isoformat()

    record: dict[str, Any] = {
        "review_id": review_id,
        "trigger": trigger,
        "started_at": now_str,
        "duration_sec": round(duration_sec, 2),
        "check_results": check_results,
        "pipeline_results": pipeline_results,
        "injection_results": injection_results,
        "resource_proof": resource_proof,
        "verdict": verdict,
        "ready_to_trade": ready_to_trade,
        "blocking_reasons": blocking_reasons,
        "previous_verdict_invalidated": previous_verdict_invalidated,
    }

    reviews.append(record)
    data["reviews"] = reviews
    data["last_updated"] = datetime.now(timezone.utc).isoformat()
    _save_history(data)

    _log_jsonl({
        "event": "REVIEW_COMPLETE",
        "review_id": review_id,
        "trigger": trigger,
        "verdict": verdict,
        "ready_to_trade": ready_to_trade,
        "duration_sec": round(duration_sec, 2),
        "blocking_count": len(blocking_reasons),
    })

    LOG.info("Forensic review %s complete: verdict=%s ready=%s", review_id, verdict, ready_to_trade)
    return review_id


def get_last_review() -> dict | None:
    """Return the most recent review record, or None."""
    data = _load_history()
    reviews = data.get("reviews", [])
    return reviews[-1] if reviews else None


def get_prior_verdict(review_id: str) -> dict | None:
    """Return a specific review by ID."""
    data = _load_history()
    for r in data.get("reviews", []):
        if r.get("review_id") == review_id:
            return r
    return None


def record_verdict_invalidation(
    prior_review_id: str,
    reason: str,
    impact: str,
    correction: str,
    new_check_id: str,
) -> dict:
    """
    Record that a prior PASS/READY verdict was wrong.
    Returns a PREVIOUS_VERDICT_INVALIDATED dict to embed in the current review.
    This is itself treated as a CRITICAL forensic incident.
    """
    invalidation: dict[str, Any] = {
        "prior_review_id": prior_review_id,
        "reason": reason,
        "impact": impact,
        "correction": correction,
        "new_check_id": new_check_id,
        "blunder_chain": {
            "BLUNDER": f"Prior review {prior_review_id} issued incorrect PASS/READY",
            "WHY_MISSED": reason,
            "CORRECTION": correction,
            "NEW_CHECK": new_check_id,
            "RETEST": "PENDING — will be verified in next review",
            "PROOF": "TBD",
            "STATUS": "MONITORING",
        },
        "recorded_at": datetime.now(timezone.utc).isoformat(),
    }
    _log_jsonl({
        "event": "VERDICT_INVALIDATED",
        "prior_review_id": prior_review_id,
        "reason": reason,
        "new_check_id": new_check_id,
    })
    LOG.warning("VERDICT INVALIDATED: prior review %s was wrong. Reason: %s", prior_review_id, reason)
    return invalidation


# ---------------------------------------------------------------------------
# Failure Memory (FORENSIC_FAILURE_MEMORY.json)
# ---------------------------------------------------------------------------

def _load_memory() -> dict[str, Any]:
    if not MEMORY_PATH.exists():
        return {"schema_version": "1.0", "fingerprints": []}
    try:
        return json.loads(MEMORY_PATH.read_text())
    except Exception as e:
        LOG.error("Cannot load FORENSIC_FAILURE_MEMORY: %s", e)
        return {"schema_version": "1.0", "fingerprints": []}


def _save_memory(data: dict[str, Any]) -> None:
    try:
        MEMORY_PATH.parent.mkdir(parents=True, exist_ok=True)
        MEMORY_PATH.write_text(json.dumps(data, indent=2, default=str))
    except Exception as e:
        LOG.error("Cannot save FORENSIC_FAILURE_MEMORY: %s", e)


def record_fingerprint(
    check_id: str,
    symptom_pattern: str,
    severity: str = "HIGH",
    regression_check: str | None = None,
    detail: str = "",
) -> str:
    """
    Record a unique failure fingerprint. If matching fingerprint exists as active, increment recurrence.
    Returns fingerprint ID.
    """
    data = _load_memory()
    fps: list[dict] = data.get("fingerprints", [])
    now_str = datetime.now(timezone.utc).isoformat()
    today = datetime.now(timezone.utc).date().isoformat()

    # Dedup by check_id + symptom_pattern prefix
    for fp in fps:
        if fp.get("check_id") == check_id and fp.get("symptom_pattern", "")[:60] == symptom_pattern[:60]:
            fp["last_seen"] = today
            fp["recurrence_count"] = fp.get("recurrence_count", 0) + 1
            if fp.get("resolution") is None and fp.get("severity") == "CRITICAL":
                fp["status"] = "ACTIVE_CRITICAL"
            _save_memory(data)
            _log_jsonl({
                "event": "FINGERPRINT_RECURRENCE",
                "fp_id": fp["fp_id"],
                "check_id": check_id,
                "recurrence_count": fp["recurrence_count"],
            })
            LOG.warning("Failure fingerprint %s recurred (count=%d)", fp["fp_id"], fp["recurrence_count"])
            return fp["fp_id"]

    # New fingerprint
    existing_nums = [
        int(fp["fp_id"].replace("FP-", ""))
        for fp in fps
        if fp.get("fp_id", "").startswith("FP-") and fp["fp_id"][3:].isdigit()
    ]
    fp_id = f"FP-{max(existing_nums, default=0) + 1:03d}"

    fp_rec: dict[str, Any] = {
        "fp_id": fp_id,
        "check_id": check_id,
        "symptom_pattern": symptom_pattern,
        "severity": severity,
        "first_seen": today,
        "last_seen": today,
        "recurrence_count": 0,
        "resolution": None,
        "regression_check": regression_check,
        "detail": detail,
        "status": "ACTIVE_CRITICAL" if severity == "CRITICAL" else "ACTIVE",
    }
    fps.append(fp_rec)
    data["fingerprints"] = fps
    data["last_updated"] = now_str
    _save_memory(data)
    _log_jsonl({"event": "FINGERPRINT_NEW", "fp_id": fp_id, "check_id": check_id, "severity": severity})
    return fp_id


def get_active_critical_fingerprints() -> list[dict]:
    """Return all ACTIVE_CRITICAL fingerprints that are unresolved."""
    data = _load_memory()
    return [
        fp for fp in data.get("fingerprints", [])
        if fp.get("status") == "ACTIVE_CRITICAL" and fp.get("resolution") is None
    ]


def resolve_fingerprint(fp_id: str, resolution: str) -> None:
    """Mark a fingerprint as resolved."""
    data = _load_memory()
    for fp in data.get("fingerprints", []):
        if fp.get("fp_id") == fp_id:
            fp["resolution"] = resolution
            fp["status"] = "RESOLVED"
            fp["resolved_at"] = datetime.now(timezone.utc).isoformat()
            break
    _save_memory(data)


# ---------------------------------------------------------------------------
# SELF_LEARNING_FAILURE_REGISTER reader (read-only for forensic checks)
# ---------------------------------------------------------------------------

def load_failure_register() -> dict[str, Any]:
    if not REGISTER_PATH.exists():
        return {"incidents": [], "summary": {}}
    try:
        return json.loads(REGISTER_PATH.read_text())
    except Exception as e:
        LOG.error("Cannot load SELF_LEARNING_FAILURE_REGISTER: %s", e)
        return {"incidents": [], "summary": {}}


def get_open_critical_incidents() -> list[dict]:
    """Return all OPEN CRITICAL incidents from the failure register."""
    register = load_failure_register()
    return [
        inc for inc in register.get("incidents", [])
        if inc.get("status") == "OPEN" and inc.get("severity") == "CRITICAL"
    ]
