from __future__ import annotations

import logging
from typing import NamedTuple

LOG = logging.getLogger("multibagger.router")


class RouteDecision(NamedTuple):
    regime: str
    selected_strategy: str
    reason: str
    confidence: float


def route_strategy(regime: str, event_labels: tuple[str, ...] = ()) -> RouteDecision:
    """
    Select strategy dynamically based on current market regime.
    Logs: REGIME -> SELECTED_STRATEGY -> REASON -> CONFIDENCE
    """
    if "NIFTY_EXPIRY" in event_labels or "EVENT_CALENDAR_UNAVAILABLE" in event_labels:
        decision = RouteDecision(regime, "NO_TRADE", "SCHEDULED_EVENT_RISK_BLOCK", 0.0)
    elif regime in ("STRONG_TREND_UP", "STRONG_TREND_DOWN"):
        decision = RouteDecision(regime, "ALPHA", "STRONG_TREND_VWAP_PULLBACK_CONTINUATION", 0.85)
    elif regime == "WEAK_TREND":
        decision = RouteDecision(regime, "BETA", "WEAK_TREND_MOMENTUM_BREAKOUT", 0.70)
    elif regime in ("RANGE", "LOW_VOLATILITY"):
        decision = RouteDecision(regime, "GAMMA", "RANGE_BOUND_MEAN_REVERSION", 0.65)
    elif regime == "REVERSAL":
        decision = RouteDecision(regime, "DELTA", "CONFIRMED_EXTREME_REVERSAL", 0.60)
    elif regime == "HIGH_VOLATILITY":
        decision = RouteDecision(regime, "NO_TRADE", "HIGH_VOLATILITY_SAFETY_PAUSE", 0.0)
    else:
        decision = RouteDecision(regime, "NO_TRADE", "UNFAVORABLE_OR_STALE_MARKET_REGIME", 0.0)

    LOG.info(
        "REGIME -> SELECTED_STRATEGY -> REASON -> CONFIDENCE: %s -> %s -> %s -> %.2f",
        decision.regime, decision.selected_strategy, decision.reason, decision.confidence
    )
    return decision
