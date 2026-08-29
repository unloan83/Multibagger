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
    Select allowable trade direction based on multi-factor Market Bias.
    Logs: REGIME -> SELECTED_STRATEGY -> REASON -> CONFIDENCE
    """
    if "NIFTY_EXPIRY" in event_labels or "EVENT_CALENDAR_UNAVAILABLE" in event_labels:
        decision = RouteDecision(regime, "NO_TRADE", "SCHEDULED_EVENT_RISK_BLOCK", 0.0)
    elif regime in ("STRONGLY_POSITIVE", "POSITIVE"):
        decision = RouteDecision(regime, "UNIFIED_OPPORTUNITY_ENGINE", "POSITIVE_MARKET_BIAS_ALL_THESES_ACTIVE", 0.85)
    elif regime in ("MIXED", "NORMAL", "RANGE"):
        decision = RouteDecision(regime, "UNIFIED_OPPORTUNITY_ENGINE", "MIXED_MARKET_BIAS_NEUTRAL_CONFLUENCE_ACTIVE", 0.75)
    elif regime == "REDUCED":
        # Allows high-conviction continuation/breakout setups with 50% position risk (e.g., ₹250 instead of ₹500)
        decision = RouteDecision(regime, "SELECTIVE_EXECUTION", "REDUCED_VOLATILITY_SCALED", 0.50)
    elif regime in ("STRONGLY_NEGATIVE", "NEGATIVE"):
        decision = RouteDecision(regime, "UNIFIED_OPPORTUNITY_ENGINE", "NEGATIVE_MARKET_BIAS_ALL_THESES_ACTIVE", 0.85)
    elif regime == "UNSAFE":
        decision = RouteDecision(regime, "NO_TRADE", "UNSAFE_MARKET_BIAS_VIX_SPIKE", 0.0)
    else:
        decision = RouteDecision(regime, "UNIFIED_OPPORTUNITY_ENGINE", "UNIFIED_OPPORTUNITY_ENGINE_ACTIVE", 0.70)

    LOG.info(
        "REGIME -> SELECTED_STRATEGY -> REASON -> CONFIDENCE: %s -> %s -> %s -> %.2f",
        decision.regime, decision.selected_strategy, decision.reason, decision.confidence
    )
    return decision
