#!/usr/bin/env python3
"""
Multibagger Forensic Agent CLI Runner (v2.0)
============================================
CLI entry point for the Hardened Forensic Agent.

Usage:
  python scripts/run_forensic_agent.py [mode] [options]

Modes:
  audit       -- Full review: 26 checks + 9 pipeline stages + injections + recovery + red-team (default)
  premarket   -- Pre-market operational gate A (checks PREMARKET_READY)
  runtime     -- Runtime operational gate B (checks RUNTIME_HEALTH)
  session     -- Session operational gate C (checks SESSION_EVIDENCE)
  inject-only -- Injections + Recovery + Red-Team traps only

Exit Codes:
  0 -- Verification PASSED for requested gate / mode
  1 -- Critical FAILURE or REGRESSION_DETECTED
  2 -- UNREADY / NOT_VERIFIED / BLOCKED gate
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def main() -> int:
    mode = sys.argv[1].lower() if len(sys.argv) > 1 else "audit"
    valid_modes = {"audit", "premarket", "runtime", "session", "quick", "inject-only"}
    if mode not in valid_modes:
        print(f"Error: Invalid mode '{mode}'. Choose from: {', '.join(sorted(valid_modes))}")
        return 2

    try:
        from engine.forensic_agent.core import ForensicAgent
        agent = ForensicAgent()
        report_text, review_id, verdicts = agent.run_audit(mode=mode)

        print(f"\nReview ID: {review_id}")
        print(report_text)

        # Operational Gate Exit Codes
        if mode == "premarket":
            ready = verdicts.get("PREMARKET_READY") == "YES"
            print(f"\n[CLI GATE: PREMARKET_READY] Status = {verdicts.get('PREMARKET_READY')}")
            return 0 if ready else 2

        elif mode == "runtime":
            health = verdicts.get("RUNTIME_HEALTH") == "PASS"
            print(f"\n[CLI GATE: RUNTIME_HEALTH] Status = {verdicts.get('RUNTIME_HEALTH')}")
            return 0 if health else 2

        elif mode == "session":
            evidence = verdicts.get("SESSION_EVIDENCE") == "COMPLETE"
            print(f"\n[CLI GATE: SESSION_EVIDENCE] Status = {verdicts.get('SESSION_EVIDENCE')}")
            return 0 if evidence else 2

        else:
            # Audit mode exit code
            ready = verdicts.get("READY_TO_TRADE") == "YES"
            logic_trust = verdicts.get("FORENSIC_LOGIC_TRUST") == "TRUSTED"
            escaped = verdicts.get("FALSE_PASS_TRAPS_ESCAPED", 0)

            if ready and logic_trust and escaped == 0:
                return 0
            elif verdicts.get("FORENSIC_LOGIC_TRUST") == "NOT_TRUSTED" or escaped > 0:
                print(f"\n[CLI GATE] Exit code 1: FORENSIC_LOGIC_TRUST = {verdicts.get('FORENSIC_LOGIC_TRUST')} ({escaped} escaped traps)")
                return 1
            else:
                print(f"\n[CLI GATE] Exit code 2: READY_TO_TRADE = {verdicts.get('READY_TO_TRADE')} (PREMARKET_READY={verdicts.get('PREMARKET_READY')}, RUNTIME_HEALTH={verdicts.get('RUNTIME_HEALTH')})")
                return 2

    except Exception as e:
        print(f"\nCRITICAL ERROR running ForensicAgent: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
