from __future__ import annotations

from .strategy_router import RouteDecision, route_strategy

def route_market_regime(regime: str, event_labels: tuple[str, ...] = ()) -> RouteDecision:
    """Wrapper function routing market regime to trade decision."""
    return route_strategy(regime, event_labels)

__all__ = ["RouteDecision", "route_strategy", "route_market_regime"]
