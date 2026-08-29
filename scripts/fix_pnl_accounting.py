#!/usr/bin/env python3
"""
Audited P&L Accounting Correction Script
==========================================
Explicit, audited migration script to correct historical P&L accounting discrepancies.

Logs every correction to logs/audit_pnl_migration.log with:
  - trade_id
  - original_net_pnl, original_brokerage, original_fees, original_slippage
  - corrected_net_pnl, corrected_brokerage, corrected_fees, corrected_slippage
  - reason
  - review_id
  - timestamp_utc
  - code_fix_reference
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

AUDIT_LOG_PATH = ROOT / "logs" / "audit_pnl_migration.log"


def audit_and_correct_pnl(review_id: str = "FA-AUDIT-MIGRATION", apply_fix: bool = False) -> list[dict]:
    from engine.config import Settings
    from engine.store import MarketStore

    s = Settings.from_env()
    store = MarketStore(s.db_path)
    records: list[dict] = []

    with store.connect(read_only=not apply_fix) as con:
        rows = con.execute(
            "SELECT trade_id, gross_pnl, brokerage, fees_taxes, slippage, net_pnl, intended_order_json "
            "FROM paper_trades WHERE status='CLOSED'"
        ).fetchall()

        for tid, gross, brok, fees, slip, rec_net, json_str in rows:
            calc_net = float(gross or 0.0) - float(brok or 0.0) - float(fees or 0.0) - float(slip or 0.0)
            diff = abs(calc_net - float(rec_net or 0.0))

            if diff > 0.01:
                # Check if intended_order_json has modeled round trip cost
                corr_brok = float(brok or 0.0)
                corr_fees = float(fees or 0.0)
                corr_slip = float(slip or 0.0)
                corr_net = float(rec_net or 0.0)

                if json_str:
                    try:
                        data = json.loads(json_str)
                        cost = data.get("modeledRoundTripCost", {})
                        if cost.get("total"):
                            corr_brok = float(cost.get("brokerage", 40.0))
                            corr_fees = float(cost.get("feesTaxes", corr_fees))
                            corr_slip = float(cost.get("slippageImpact", corr_slip))
                            corr_net = float(gross or 0.0) - corr_brok - corr_fees - corr_slip
                    except Exception:
                        pass

                entry = {
                    "timestamp_utc": datetime.now(timezone.utc).isoformat(),
                    "review_id": review_id,
                    "trade_id": tid,
                    "original": {
                        "gross_pnl": float(gross or 0.0),
                        "net_pnl": float(rec_net or 0.0),
                        "brokerage": float(brok or 0.0),
                        "fees_taxes": float(fees or 0.0),
                        "slippage": float(slip or 0.0),
                    },
                    "corrected": {
                        "gross_pnl": float(gross or 0.0),
                        "net_pnl": round(corr_net, 4),
                        "brokerage": round(corr_brok, 4),
                        "fees_taxes": round(corr_fees, 4),
                        "slippage": round(corr_slip, 4),
                    },
                    "reason": "Stored cost columns were entry-only values; updated to round-trip total costs",
                    "code_fix_reference": "engine/paper.py:L565-L570 cost columns update in paused exit branch",
                }
                records.append(entry)

                if apply_fix:
                    con.execute(
                        "UPDATE paper_trades SET brokerage=?, fees_taxes=?, slippage=?, net_pnl=? WHERE trade_id=?",
                        [round(corr_brok, 4), round(corr_fees, 4), round(corr_slip, 4), round(corr_net, 4), tid],
                    )

    # Log audited migration entries
    if records and apply_fix:
        AUDIT_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with AUDIT_LOG_PATH.open("a", encoding="utf-8") as f:
            for rec in records:
                f.write(json.dumps(rec) + "\n")

    return records


def main() -> int:
    apply = "--apply" in sys.argv
    records = audit_and_correct_pnl(apply_fix=apply)
    if not records:
        print("P&L Accounting Audit: 0 discrepancies found across closed trades.")
        return 0

    print(f"P&L Accounting Audit: {len(records)} discrepancies found.")
    for r in records:
        print(f"  Trade {r['trade_id']}: net_pnl {r['original']['net_pnl']} -> {r['corrected']['net_pnl']} ({r['reason']})")

    if not apply:
        print("\nRun with '--apply' to execute audited DB migration and append audit log.")
    else:
        print(f"\nMigration applied! Audit log written to {AUDIT_LOG_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
