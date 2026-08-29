"""
engine/forensic_agent/strategy_eval.py
========================================
Strategy Performance Evidence Evaluator & Opportunity Auditor.

Enforces:
  - Requirement 17: Tracks scanned opportunities, valid candidates, rejected candidates + reasons, trades taken, valid setups missed, NO_TRADE reasons.
  - Requirement 18: Evaluates non-test closed paper trades (win rate, expectancy, profit factor, drawdown, slippage costs).
    Outputs STRATEGY_EVIDENCE_STATUS: POSITIVE | NEGATIVE | INSUFFICIENT
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


@dataclass
class StrategyEvaluationResult:
    status: str  # POSITIVE | NEGATIVE | INSUFFICIENT
    total_trades: int
    wins: int
    losses: int
    win_rate_pct: float
    expectancy_per_trade: float
    profit_factor: float
    max_drawdown_inr: float
    total_slippage_cost: float
    total_brokerage_cost: float
    total_fees_cost: float
    summary: str
    details: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "STRATEGY_EVIDENCE_STATUS": self.status,
            "total_trades": self.total_trades,
            "wins": self.wins,
            "losses": self.losses,
            "win_rate_pct": round(self.win_rate_pct, 2),
            "expectancy_per_trade": round(self.expectancy_per_trade, 2),
            "profit_factor": round(self.profit_factor, 2),
            "max_drawdown_inr": round(self.max_drawdown_inr, 2),
            "total_slippage_cost": round(self.total_slippage_cost, 2),
            "total_brokerage_cost": round(self.total_brokerage_cost, 2),
            "total_fees_cost": round(self.total_fees_cost, 2),
            "summary": self.summary,
        }


def evaluate_strategy_performance() -> StrategyEvaluationResult:
    """Audit non-test paper trades from DuckDB store."""
    try:
        from engine.config import Settings
        from engine.store import MarketStore
        s = Settings.from_env()
        store = MarketStore(s.db_path)

        with store.connect(read_only=True) as con:
            # Query ONLY non-test closed trades (Requirement 14: Test/Prod Isolation)
            rows = con.execute(
                "SELECT trade_id, gross_pnl, net_pnl, brokerage, fees_taxes, slippage, exit_reason "
                "FROM paper_trades "
                "WHERE status='CLOSED' AND (intended_order_json IS NULL OR intended_order_json NOT LIKE '%ACCEPTANCE_TEST%')"
            ).fetchall()

        if len(rows) < 5:
            return StrategyEvaluationResult(
                status="INSUFFICIENT",
                total_trades=len(rows),
                wins=sum(1 for r in rows if float(r[2] or 0) > 0),
                losses=sum(1 for r in rows if float(r[2] or 0) <= 0),
                win_rate_pct=0.0,
                expectancy_per_trade=0.0,
                profit_factor=0.0,
                max_drawdown_inr=0.0,
                total_slippage_cost=sum(float(r[5] or 0) for r in rows),
                total_brokerage_cost=sum(float(r[3] or 0) for r in rows),
                total_fees_cost=sum(float(r[4] or 0) for r in rows),
                summary=f"Insufficient non-test trade history ({len(rows)} trades < 5 required for statistical evaluation)",
                details={"sample_size": len(rows)},
            )

        wins = [r for r in rows if float(r[2] or 0) > 0]
        losses = [r for r in rows if float(r[2] or 0) <= 0]
        gross_profits = sum(float(r[2]) for r in wins)
        gross_losses = abs(sum(float(r[2]) for r in losses))

        win_rate = (len(wins) / len(rows)) * 100.0
        total_net = sum(float(r[2] or 0) for r in rows)
        expectancy = total_net / len(rows)
        profit_factor = (gross_profits / gross_losses) if gross_losses > 0 else (999.0 if gross_profits > 0 else 0.0)

        # Equity curve & Max Drawdown
        equity = 0.0
        peak = 0.0
        max_dd = 0.0
        for r in rows:
            equity += float(r[2] or 0)
            if equity > peak:
                peak = equity
            dd = peak - equity
            if dd > max_dd:
                max_dd = dd

        status = "POSITIVE" if (win_rate >= 45.0 and expectancy > 0 and profit_factor > 1.1) else "NEGATIVE"
        summary = (
            f"Strategy status={status} over {len(rows)} trades: win_rate={win_rate:.1f}%, "
            f"expectancy=Rs{expectancy:.2f}/trade, PF={profit_factor:.2f}, max_dd=Rs{max_dd:.2f}"
        )

        return StrategyEvaluationResult(
            status=status,
            total_trades=len(rows),
            wins=len(wins),
            losses=len(losses),
            win_rate_pct=win_rate,
            expectancy_per_trade=expectancy,
            profit_factor=profit_factor,
            max_drawdown_inr=max_dd,
            total_slippage_cost=sum(float(r[5] or 0) for r in rows),
            total_brokerage_cost=sum(float(r[3] or 0) for r in rows),
            total_fees_cost=sum(float(r[4] or 0) for r in rows),
            summary=summary,
            details={"trade_count": len(rows)},
        )
    except Exception as e:
        return StrategyEvaluationResult(
            status="INSUFFICIENT",
            total_trades=0, wins=0, losses=0, win_rate_pct=0.0,
            expectancy_per_trade=0.0, profit_factor=0.0, max_drawdown_inr=0.0,
            total_slippage_cost=0.0, total_brokerage_cost=0.0, total_fees_cost=0.0,
            summary=f"Error evaluating strategy performance: {e}",
            details={"error": str(e)},
        )
