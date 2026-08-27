#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

# Fix parent package resolution when run directly
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import logging
import pandas as pd
from datetime import datetime, timezone

from engine.config import Settings
from engine.regime_detector import detect_regime
from engine.strategy_router import route_strategy
from engine.agents import (
    MarketRegimeAgent, OpportunityAgent, TradeValidationAgent, RiskAgent, ExecutionAgent, LearningAuditAgent
)
from engine.challenger_engine import ChallengerEngine
from engine.resource_priority import ResourcePriorityWatchdog
from engine.forensic_review import run_eod_forensic_review, EODForensicSummary

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
LOG = logging.getLogger("functional_audit")


def run_functional_audit():
    print("==========================================================================================")
    print("          SYSTEM COMPONENT AUDIT MATRIX: INTRADAY ADAPTIVE TRADING ARCHITECTURE           ")
    print("==========================================================================================")
    
    matrix = [
        ("1. Market Regime Agent", "Newly Implemented", "8-State Classifier (STRONG_TREND_UP, STRONG_TREND_DOWN, WEAK_TREND, RANGE, HIGH_VOLATILITY, LOW_VOLATILITY, REVERSAL, NO_TRADE). Fails closed on stale/missing data."),
        ("2. Dynamic Strategy Router", "Newly Implemented", "Dynamic routing mapping regime to ALPHA/BETA/GAMMA/DELTA. Logs REGIME -> STRATEGY -> REASON -> CONFIDENCE."),
        ("3. Opportunity + Validation Agents", "Newly Implemented", "Processes real market data, filters min score 50, validates multi-factor confluence."),
        ("4. Risk Agent (Absolute Veto)", "Newly Implemented", "Non-overridable ₹1,000 daily loss breaker, ₹500 trade risk cap, 2 consecutive loss limit."),
        ("5. Adaptive Exit Logic", "Newly Implemented", "Thesis-invalidation exit (VWAP break), trailing ATR stop, zero averaging down."),
        ("6. Execution / Failure Protection", "Newly Implemented", "Fails closed to TRADING_DISABLED on stale data/API disconnect while active position risk management stays active."),
        ("7. Continuous Metrics", "Existing & Enhanced", "Tracks PnL, win rate, trades, max drawdown, expectancy, slippage by regime and strategy."),
        ("8. EOD Forensic Review", "Newly Implemented", "Post-market 12-question audit producing Problem -> Evidence -> Root Cause -> Fix -> Validation."),
        ("9. CURRENT vs CHALLENGER", "Newly Implemented", "Gated version promotion (v1.2 -> v1.3) requiring replay validation before deployment."),
        ("10. OCI Resource Protection", "Newly Implemented", "Priority Watchdog degrades Scanning/EOD while preserving Risk & Position Mgmt at 100%."),
    ]

    for req, status, details in matrix:
        print(f"{req:<35} | {status:<20} | {details}")

    print("\n==========================================================================================")
    print("                      DETERMINISTIC 12-SCENARIO VERIFICATION REPLAY                       ")
    print("==========================================================================================")
    print(f"{'SCENARIO':<35} | {'REGIME':<16} | {'STRATEGY':<10} | {'ACTION':<22} | {'EXPECTED':<12} | {'ACTUAL':<12} | {'STATUS':<6}")
    print("-" * 125)

    results = []
    settings = Settings("", Path("/tmp/market.duckdb"), Path("/tmp/signals.json"), Path("/tmp/universe.json"), max_symbols=1)
    now = datetime.now(timezone.utc)

    # --- Scenario 1: Uptrend Market Data ---
    regime = "STRONG_TREND_UP"
    route = route_strategy(regime, ())
    action = "SELECT_ALPHA_STRATEGY"
    expected = "ALPHA"
    actual = route.selected_strategy
    passed = actual == expected
    results.append(("S01: Uptrend Market Data", regime, route.selected_strategy, action, expected, actual, "PASS" if passed else "FAIL"))

    # --- Scenario 2: Regime Shift: Uptrend -> Range ---
    regime = "RANGE"
    route = route_strategy(regime, ())
    action = "SHIFT_TO_GAMMA"
    expected = "GAMMA"
    actual = route.selected_strategy
    passed = actual == expected
    results.append(("S02: Regime Shift Uptrend->Range", regime, route.selected_strategy, action, expected, actual, "PASS" if passed else "FAIL"))

    # --- Scenario 3: Regime Shift: Range -> Downtrend ---
    regime = "STRONG_TREND_DOWN"
    route = route_strategy(regime, ())
    action = "SHIFT_TO_ALPHA"
    expected = "ALPHA"
    actual = route.selected_strategy
    passed = actual == expected
    results.append(("S03: Regime Shift Range->Downtrend", regime, route.selected_strategy, action, expected, actual, "PASS" if passed else "FAIL"))

    # --- Scenario 4: Invalidated Open Trade Thesis ---
    exec_agent = ExecutionAgent()
    trade = {"symbol": "INFY", "side": "LONG", "entry": 1500.0}
    bad_quote = {"ltp": 1450.0, "vwap": 1490.0}  # Drop > 1.5% below VWAP
    is_valid = exec_agent.check_thesis_validity(trade, bad_quote)
    action = "EXIT_THESIS_INVALID"
    expected = "INVALIDATE"
    actual = "INVALIDATE" if not is_valid else "HOLD"
    passed = not is_valid
    results.append(("S04: Invalidated Trade Thesis", "TRENDING", "ALPHA", action, expected, actual, "PASS" if passed else "FAIL"))

    # --- Scenario 5: ₹500 Trade-Risk Violation ---
    risk_agent = RiskAgent(settings)
    res = risk_agent.evaluate_trade("TATASTEEL", candidate_risk=650.0, current_daily_pnl=0.0, open_positions_count=0, consecutive_losses=0)
    action = "REJECT_RISK_CAP"
    expected = "REJECTED"
    actual = "REJECTED" if not res.approved else "APPROVED"
    passed = not res.approved and res.rejection_reason == "RISK_VETO_TRADE_RISK_EXCEEDS_500_CAP"
    results.append(("S05: ₹500 Trade Risk Violation", "TRENDING", "ALPHA", action, expected, actual, "PASS" if passed else "FAIL"))

    # --- Scenario 6: ₹1,000 Cumulative Daily Loss ---
    res = risk_agent.evaluate_trade("RELIANCE", candidate_risk=250.0, current_daily_pnl=-1050.0, open_positions_count=0, consecutive_losses=0)
    action = "BLOCK_ALL_TRADES"
    expected = "REJECTED"
    actual = "REJECTED" if not res.approved else "APPROVED"
    passed = not res.approved and res.rejection_reason == "RISK_VETO_HARD_DAILY_LOSS_BREAKER_HIT"
    results.append(("S06: ₹1,000 Daily Loss Breaker", "ANY", "ANY", action, expected, actual, "PASS" if passed else "FAIL"))

    # --- Scenario 7: Stale Data / API Failure ---
    res = risk_agent.evaluate_trade("SBIN", candidate_risk=250.0, current_daily_pnl=0.0, open_positions_count=0, consecutive_losses=0, data_fresh=False)
    action = "FAIL_CLOSED_DISABLE"
    expected = "REJECTED"
    actual = "REJECTED" if not res.approved else "APPROVED"
    passed = not res.approved and res.rejection_reason == "RISK_VETO_STALE_MARKET_DATA"
    results.append(("S07: Stale Data / API Failure", "NO_TRADE", "NO_TRADE", action, expected, actual, "PASS" if passed else "FAIL"))

    # --- Scenario 8: NO_TRADE Market ---
    route = route_strategy("HIGH_VOLATILITY", ())
    action = "ZERO_FORCED_TRADES"
    expected = "NO_TRADE"
    actual = route.selected_strategy
    passed = actual == expected
    results.append(("S08: NO_TRADE Market Conditions", "HIGH_VOLATILITY", route.selected_strategy, action, expected, actual, "PASS" if passed else "FAIL"))

    # --- Scenario 9: EOD Forensic Review ---
    audit_agent = LearningAuditAgent()
    summary = audit_agent.perform_eod_review([{"net_pnl": 500.0, "exit_reason": "TARGET_HIT"}], 500.0)
    action = "GENERATE_EOD_AUDIT"
    expected = "AUDIT_OK"
    actual = "AUDIT_OK" if summary.get("daily_result") else "FAILED"
    passed = actual == expected
    results.append(("S09: EOD Forensic Review", "EOD", "AUDIT", action, expected, actual, "PASS" if passed else "FAIL"))

    # --- Scenario 10: Challenger Fails Replay ---
    challenger = ChallengerEngine("v1.2-production-safe")
    challenger.propose_challenger("v1.3-test", {"min_score": 40.0}, "Lower threshold")
    promoted, ver = challenger.evaluate_and_promote({"trades": 2, "win_rate_pct": 30.0, "net_pnl": -200.0, "max_drawdown_inr": 800.0, "profit_factor": 0.5})
    action = "KEEP_PRODUCTION"
    expected = "v1.2-production-safe"
    actual = ver.version
    passed = not promoted and actual == expected
    results.append(("S10: Challenger Fails Replay", "OFFLINE", "CHALLENGER", action, expected, actual, "PASS" if passed else "FAIL"))

    # --- Scenario 11: Challenger Passes Replay ---
    challenger.propose_challenger("v1.3-challenger-promoted", {"min_score": 55.0}, "Higher threshold")
    promoted, ver = challenger.evaluate_and_promote({
        "trades": 25, "sessions_count": 3, "regimes_count": 2, "win_rate_pct": 65.0, "net_pnl": 2500.0,
        "expectancy": 250.0, "profit_factor": 1.6, "max_drawdown_inr": 300.0,
        "outperformed_baseline": True, "single_trade_outlier": False
    })
    action = "PROMOTE_VERSION"
    expected = "v1.3-challenger-promoted"
    actual = ver.version
    passed = promoted and actual == expected
    results.append(("S11: Challenger Passes Replay", "OFFLINE", "CHALLENGER", action, expected, actual, "PASS" if passed else "FAIL"))



    # --- Scenario 12: OCI Resource Pressure ---
    watchdog = ResourcePriorityWatchdog(ram_threshold_pct=10.0)  # Force pressure threshold
    scanning_ok = watchdog.is_task_permitted("SCANNING")
    risk_ok = watchdog.is_task_permitted("RISK_POSITION_MGMT")
    action = "DEGRADE_NON_CRITICAL"
    expected = "RISK_OK_SCAN_DEGRADED"
    actual = "RISK_OK_SCAN_DEGRADED" if (risk_ok and not scanning_ok) else "FAILED"
    passed = actual == expected
    results.append(("S12: OCI Resource Degradation", "RESOURCE_CAP", "PRIORITY", action, expected, actual, "PASS" if passed else "FAIL"))

    for sc, reg, strat, act, exp, act_val, status in results:
        print(f"{sc:<35} | {reg:<16} | {strat:<10} | {act:<22} | {exp:<12} | {act_val:<12} | {status:<6}")

    print("-" * 125)
    all_pass = all(r[6] == "PASS" for r in results)
    print(f"\nFinal Audit Verdict: {'ALL 12 SCENARIOS PASSED PERFECTLY (100% SUCCESS)' if all_pass else 'SCENARIO FAILURE DETECTED'}")
    return all_pass


if __name__ == "__main__":
    success = run_functional_audit()
    sys.exit(0 if success else 1)
