from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

LOG = logging.getLogger("multibagger.challenger")


@dataclass
class StrategyVersion:
    version: str
    parameters: dict[str, Any]
    reason_for_change: str
    evidence: str
    is_production: bool = False


class ChallengerEngine:
    """Manages CURRENT production vs CHALLENGER configurations and promotion gating."""

    def __init__(self, current_version: str = "v1.2-production-safe"):
        self.production_config = StrategyVersion(
            version=current_version,
            parameters={
                "min_score": 50.0,
                "target_reward_risk_multiple": 2.0,
                "max_risk_per_trade": 500.0,
                "daily_loss_limit": 1000.0,
            },
            reason_for_change="Baseline production configuration",
            evidence="Unit & scenario tests passed",
            is_production=True,
        )
        self.challenger_config: StrategyVersion | None = None

    def propose_challenger(self, new_version: str, proposed_params: dict[str, Any], reason: str) -> StrategyVersion:
        self.challenger_config = StrategyVersion(
            version=new_version,
            parameters=proposed_params,
            reason_for_change=reason,
            evidence="Pending replay validation",
            is_production=False,
        )
        LOG.info("Challenger configuration proposed: %s", new_version)
        return self.challenger_config

    def evaluate_and_promote(self, replay_results: dict[str, Any]) -> tuple[bool, StrategyVersion]:
        """
        Promotes challenger only with robust evidence:
        - Adequate sample count (trades >= 5)
        - Positive net PnL & Positive Expectancy
        - Win rate >= 50% & Profit Factor > 1.2
        - Max Drawdown <= INR 1,000
        - Baseline outperformance (outperformed_baseline is True)
        - Not driven by a single outlier trade (single_trade_outlier is False)
        """
        if not self.challenger_config:
            return False, self.production_config

        trades = int(replay_results.get("trades", 0))
        sessions_count = int(replay_results.get("sessions_count", 1))
        regimes_count = int(replay_results.get("regimes_count", 1))
        win_rate = float(replay_results.get("win_rate_pct", 0.0))
        net_pnl = float(replay_results.get("net_pnl", -1.0))
        expectancy = float(replay_results.get("expectancy", 0.0))
        profit_factor = float(replay_results.get("profit_factor", 0.0))
        max_dd = float(replay_results.get("max_drawdown_inr", 9999.0))
        outperformed = bool(replay_results.get("outperformed_baseline", True))
        is_outlier = bool(replay_results.get("single_trade_outlier", False))
        is_bug_fix = bool(replay_results.get("is_bug_fix", False))
        changes_behavior = bool(replay_results.get("changes_trading_behavior", True))

        # Bug fix bypass: Allowed ONLY if it fixes infrastructure/data bug without altering strategy entry/exit behavior
        bug_fix_bypass = is_bug_fix and not changes_behavior

        sample_adequate = (trades >= 20 and sessions_count >= 2 and regimes_count >= 2) or bug_fix_bypass

        meets_criteria = (
            sample_adequate and
            win_rate >= 50.0 and
            net_pnl > 0 and
            expectancy > 0 and
            profit_factor > 1.2 and
            max_dd <= 1000.0 and
            outperformed and
            not is_outlier
        )


        if meets_criteria:
            promoted = StrategyVersion(
                version=self.challenger_config.version,
                parameters=self.challenger_config.parameters,
                reason_for_change=self.challenger_config.reason_for_change,
                evidence=f"Replay Passed: Trades={trades}, WinRate={win_rate:.1f}%, PF={profit_factor:.2f}, PnL=INR {net_pnl:.2f}",
                is_production=True,
            )
            self.production_config = promoted
            self.challenger_config = None
            LOG.info("Challenger PROMOTED to production: %s", promoted.version)
            return True, promoted
        else:
            LOG.warning(
                "Challenger REJECTED: Trades=%d, WinRate=%.1f%%, PF=%.2f, PnL=INR %.2f. Production remains %s",
                trades, win_rate, profit_factor, net_pnl, self.production_config.version
            )
            self.challenger_config = None
            return False, self.production_config

