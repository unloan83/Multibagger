"""
engine/forensic_agent/core.py
===============================
Forensic Agent Master Orchestrator (v2.0).

Coordinates checks, self-integrity, branch-aware pipeline validation, failure injections,
recovery lifecycle testing, strategy evaluation, red-team mutation traps, and 15-verdicts report formatting.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from engine.forensic_agent.checks import run_all_checks
from engine.forensic_agent.manifest import verify_self_integrity
from engine.forensic_agent.pipeline import validate_pipeline
from engine.forensic_agent.injection import run_all_injections
from engine.forensic_agent.recovery import run_all_recovery_tests
from engine.forensic_agent.strategy_eval import evaluate_strategy_performance
from engine.forensic_agent.redteam import run_all_redteam_traps
from engine.forensic_agent.resource import ResourceTracker
from engine.forensic_agent.history import append_review, get_open_critical_incidents
from engine.forensic_agent.report import evaluate_final_verdicts, format_final_forensic_report

LOG = logging.getLogger("multibagger.forensic_agent.core")


class ForensicAgent:
    """Master Forensic Diagnosis & Completion Agent."""

    def __init__(self) -> None:
        self.tracker = ResourceTracker()

    def run_audit(
        self,
        mode: str = "audit",
        invalidate_prior_review_id: str | None = None,
        invalidation_reason: str = "",
    ) -> tuple[str, str, dict[str, Any]]:
        """
        Run full forensic audit.
        Returns: (report_text: str, review_id: str, verdicts: dict)
        """
        with self.tracker:
            # 1. Verify Self-Integrity
            self_integrity = verify_self_integrity()

            # 2. Run 26 Forensic Checks
            check_objs = run_all_checks()
            check_results = [c.to_dict() for c in check_objs]
            self.tracker.count_db_query(3)

            # 3. Validate 9 Pipeline Stages (Branch-Aware & Correlated)
            pipeline_objs = validate_pipeline()
            pipeline_results = [p.to_dict() for p in pipeline_objs]
            self.tracker.count_db_query(4)

            # 4. Failure Injections & Recovery Tests
            if mode in ("audit", "inject-only"):
                injection_objs = run_all_injections()
                injection_results = [i.to_dict() for i in injection_objs]
                recovery_objs = run_all_recovery_tests()
                recovery_results = [r.to_dict() for r in recovery_objs]
                self.tracker.count_api_call(1)
            else:
                injection_results = []
                recovery_results = []

            # 5. Red-Team Mutation Traps
            if mode in ("audit", "inject-only"):
                trap_objs, escaped_count = run_all_redteam_traps()
                redteam_results = ([t.to_dict() for t in trap_objs], escaped_count)
            else:
                redteam_results = ([], 0)

            # 6. Strategy Performance Evaluation
            strat_eval = evaluate_strategy_performance().to_dict()
            self.tracker.count_db_query(2)

            # 7. Get open critical incidents
            open_incidents = get_open_critical_incidents()

            # 8. Measure Resource Proof
            self.tracker.sample()
            resource_proof = self.tracker.proof().to_dict()

            # 9. Evaluate Final Verdicts
            verdicts = evaluate_final_verdicts(
                check_results=check_results,
                pipeline_results=pipeline_results,
                recovery_results=recovery_results,
                resource_proof=resource_proof,
                self_integrity=self_integrity,
                strategy_eval=strat_eval,
                redteam_results=redteam_results,
                open_critical_incidents=open_incidents,
            )

            # 10. Format Structured Report
            report_text = format_final_forensic_report(
                verdicts=verdicts,
                check_results=check_results,
                pipeline_results=pipeline_results,
                recovery_results=recovery_results,
                resource_proof=resource_proof,
                strategy_eval=strat_eval,
                redteam_traps=redteam_results,
            )

            # 11. Record Review History
            review_id = append_review(
                trigger=f"cli_{mode}",
                check_results=check_results,
                pipeline_results=pipeline_results,
                injection_results=injection_results,
                resource_proof=resource_proof,
                verdict=verdicts["STATIC_HEALTH"],
                ready_to_trade=verdicts["READY_TO_TRADE"],
                blocking_reasons=verdicts.get("pm_blockers", []),
            )

            return report_text, review_id, verdicts
