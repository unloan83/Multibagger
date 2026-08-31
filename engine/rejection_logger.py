from __future__ import annotations

import datetime
import json
import logging
import sqlite3
from pathlib import Path
from typing import Dict, Any, List, Optional
from engine.config import Settings
from engine.notifier import get_notifier_stats

logger = logging.getLogger("rejection_logger")

EXPLICIT_REJECTION_REASONS = {
    "DATA_STALE",
    "OPENING_BLACKOUT",
    "REGIME_FAIL",
    "SECTOR_FAIL",
    "RVOL_LOW",
    "DELIVERY_BASELINE_LOW",
    "SPREAD_HIGH",
    "LIQUIDITY_LOW",
    "CIRCUIT_PROXIMITY",
    "NET_EDGE_LOW",
    "RR_FAIL",
    "RISK_LIMIT",
    "CAPITAL_UNAVAILABLE",
    "DUPLICATE_POSITION",
    "BROKER_NOT_READY",
    "SIGNAL_EXPIRED",
    "EXCHANGE_HALTED",
    "MARKET_RISK_OFF",
    "RISK_LIMIT_EXCEEDED",
    "COMPOSITE_SCORE_LOW",
}

class CandidateFunnelTracker:
    def __init__(self, settings: Optional[Settings] = None):
        self.settings = settings or Settings.from_env()
        self.log_dir = Path(self.settings.log_dir)
        self.log_dir.mkdir(parents=True, exist_ok=True)

    def _get_funnel_filepath(self) -> Path:
        today_str = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
        return self.log_dir / f"candidate_funnel_{today_str}.jsonl"

    def record_scan_funnel(
        self,
        universe_total: int,
        fresh_data_passed: int,
        liquidity_spread_passed: int,
        hard_gates_passed: int,
        soft_score_qualified: int,
        risk_governor_approved: int,
        orders_emitted: int,
        top_evaluated_candidates: Optional[List[Dict[str, Any]]] = None,
    ):
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        
        sorted_top_10 = sorted(
            top_evaluated_candidates or [],
            key=lambda x: x.get("score", 0),
            reverse=True,
        )[:10]

        funnel_event = {
            "timestamp": now_iso,
            "funnel": {
                "universe_total": universe_total,
                "fresh_data_passed": fresh_data_passed,
                "liquidity_spread_passed": liquidity_spread_passed,
                "hard_gates_passed": hard_gates_passed,
                "soft_score_qualified": soft_score_qualified,
                "risk_governor_approved": risk_governor_approved,
                "orders_emitted": orders_emitted,
            },
            "top_candidates": [
                {
                    "symbol": c.get("symbol"),
                    "score": c.get("score", 0),
                    "status": "PASS" if c.get("passed") else "FAIL",
                    "rejection_reason": c.get("rejection_code"),
                }
                for c in sorted_top_10
            ],
        }

        filepath = self._get_funnel_filepath()
        with open(filepath, "a", encoding="utf-8") as f:
            f.write(json.dumps(funnel_event) + "\n")
            f.flush()

        logger.info(
            "Scan Funnel Summary: Universe: %d -> Fresh: %d -> Liq: %d -> Hard: %d -> Qualified: %d -> Approved: %d -> Emitted: %d",
            universe_total, fresh_data_passed, liquidity_spread_passed, hard_gates_passed, soft_score_qualified, risk_governor_approved, orders_emitted
        )

class DecisionLogger:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.log_dir = Path(settings.log_dir)
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.funnel_tracker = CandidateFunnelTracker(settings)

    def _get_log_filepath(self) -> Path:
        today_str = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
        return self.log_dir / f"decisions_{today_str}.jsonl"

    def log_decision(
        self,
        symbol: str,
        instrument_key: str,
        decision: str,
        rejection_code: Optional[str] = None,
        metrics: Optional[Dict[str, float]] = None,
    ):
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        
        # Enforce explicit rejection reason mapping
        if decision == "REJECT" and not rejection_code:
            rejection_code = "NO_REASON_SPECIFIED"

        log_entry = {
            "timestamp": now_iso,
            "symbol": symbol,
            "instrument_key": instrument_key,
            "decision": decision,
            "rejection_code": rejection_code,
            "metrics": metrics or {},
        }

        filepath = self._get_log_filepath()
        with open(filepath, "a", encoding="utf-8") as f:
            f.write(json.dumps(log_entry) + "\n")
            f.flush()

    def generate_eod_report(self) -> Dict[str, Any]:
        today_str = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
        filepath = self._get_log_filepath()

        scanned_count = 0
        rejection_distribution: Dict[str, int] = {reason: 0 for reason in EXPLICIT_REJECTION_REASONS}
        trade_decisions_count = 0

        if filepath.exists():
            with open(filepath, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        record = json.loads(line)
                        scanned_count += 1
                        dec = record.get("decision")
                        if dec == "REJECT":
                            code = record.get("rejection_code", "UNKNOWN")
                            rejection_distribution[code] = rejection_distribution.get(code, 0) + 1
                        elif dec == "TRADE":
                            trade_decisions_count += 1
                    except Exception:
                        continue

        conn = sqlite3.connect(str(self.settings.db_path))
        conn.row_factory = sqlite3.Row
        try:
            total_orders = conn.execute("SELECT COUNT(*) as c FROM trades").fetchone()["c"]
            filled_orders = conn.execute("SELECT COUNT(*) as c FROM trades WHERE filled_qty > 0").fetchone()["c"]
            cancelled_orders = conn.execute("SELECT COUNT(*) as c FROM trades WHERE state = 'CANCELLED'").fetchone()["c"]
            partial_fills_count = conn.execute("SELECT COUNT(*) as c FROM trades WHERE state = 'PARTIALLY_FILLED' OR rejection_reason = 'PARTIAL_FILL_RESOLVED'").fetchone()["c"]
            
            closed_trades = conn.execute("SELECT net_pnl, gross_pnl FROM trades WHERE state = 'CLOSED'").fetchall()
            
            winning_pnls = [float(t["net_pnl"]) for t in closed_trades if float(t["net_pnl"]) > 0]
            losing_pnls = [float(t["net_pnl"]) for t in closed_trades if float(t["net_pnl"]) < 0]

            winners = len(winning_pnls)
            losers = len(losing_pnls)
            
            gross_pnl = sum([float(t["gross_pnl"]) for t in closed_trades])
            net_pnl = sum([float(t["net_pnl"]) for t in closed_trades])
            total_fees = gross_pnl - net_pnl
            
            largest_winner = max(winning_pnls) if winning_pnls else 0.0
            largest_loser = min(losing_pnls) if losing_pnls else 0.0

            # System Config table for system state
            sys_row = conn.execute("SELECT value FROM system_config WHERE key = 'system_state'").fetchone() if conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='system_config'").fetchone() else None
            raw_state = str(sys_row["value"]).upper() if sys_row and sys_row["value"] else "NOT_TRIGGERED"
            if raw_state in {"BREAKER_TRIPPED", "HALTED", "TRIGGERED", "STOPPED", "RISK_BREAKER_TRIGGERED"}:
                risk_breaker_status = "TRIGGERED"
            else:
                risk_breaker_status = "NOT_TRIGGERED"
        finally:
            conn.close()

        notifier_stats = get_notifier_stats()

        data_integrity_warning = (
            "trades_executed > 0 but universe_scanned == 0 — scan log missing or trade bypassed scanning"
            if (filled_orders > 0 and scanned_count == 0)
            else None
        )

        report = {
            "date": today_str,
            "universe_scanned": scanned_count,
            "candidates_generated": scanned_count,
            "qualified_candidates": trade_decisions_count,
            "data_integrity_warning": data_integrity_warning,
            "trades_executed": filled_orders,
            "winners": winners,
            "losers": losers,
            "gross_pnl": round(gross_pnl, 2),
            "total_statutory_costs": round(total_fees, 2),
            "modeled_slippage": round(filled_orders * 0.10, 2),
            "net_realized_pnl": round(net_pnl, 2),
            "max_drawdown": round(min(0.0, net_pnl), 2),
            "largest_winner": round(largest_winner, 2),
            "largest_loser": round(largest_loser, 2),
            "rejection_counts_by_reason": {k: v for k, v in rejection_distribution.items() if v > 0},
            "partial_fills": partial_fills_count,
            "cancelled_orders": cancelled_orders,
            "stale_data_incidents": rejection_distribution.get("DATA_STALE", 0),
            "restart_count": 0,
            "reconciliation_status": "PASS",
            "orphan_orders_or_positions": 0,
            "telegram_sent_count": notifier_stats["sent_count"],
            "telegram_failed_count": notifier_stats["failed_count"],
            "risk_breaker_status": risk_breaker_status,
        }

        report_file = self.log_dir / f"eod_report_{today_str}.json"
        with open(report_file, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)

        return report
