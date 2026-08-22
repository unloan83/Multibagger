from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from .config import Settings
from .replay import replay_recorded_entries
from .store import MarketStore


STRATEGY = "ORB_15M_RETEST_ALIGNED"


def walk_forward(settings: Settings, start: str, end: str, windows: int = 6,
                 calc_bootstrap: bool = True) -> dict:
    """Compatibility entry point for the point-in-time losing-session replay.

    `windows` and `calc_bootstrap` remain accepted for callers of the former
    PyBroker layer. The v3 core has one strategy and deliberately does not run
    the retired ORB-cross/VWAP-continuation models.
    """
    del windows, calc_bootstrap
    store = MarketStore(settings.db_path)
    with store.connect() as con:
        available = con.execute(
            "SELECT count(*), count(DISTINCT symbol) FROM minute_bars WHERE ts BETWEEN ? AND ?",
            [start, end],
        ).fetchone()
    if not available or available[0] == 0:
        raise RuntimeError("No Upstox minute bars exist for the requested replay range")

    replay = replay_recorded_entries(settings, date.fromisoformat(start), date.fromisoformat(end))
    pnl = [float(session["replayNetPnl"]) for session in replay["sessions"]]
    equity = peak = maximum_drawdown = 0.0
    for value in pnl:
        equity += value
        peak = max(peak, equity)
        maximum_drawdown = max(maximum_drawdown, peak - equity)
    positive = sum(value for value in pnl if value > 0)
    negative = abs(sum(value for value in pnl if value < 0))
    summary = {
        "trades": sum(int(session["replayTrades"]) for session in replay["sessions"]),
        "return_pct": round(equity / settings.paper_portfolio_capital * 100, 4),
        "max_drawdown_pct": round(maximum_drawdown / settings.paper_portfolio_capital * 100, 4),
        "profit_factor": round(positive / negative, 4) if negative else (None if positive else 0),
    }
    with store.connect() as con:
        con.execute("INSERT INTO validation_results VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
            str(uuid.uuid4()), STRATEGY, start, end, start, end, summary["trades"],
            summary["return_pct"], summary["max_drawdown_pct"], summary["profit_factor"],
            datetime.now(timezone.utc),
        ])
    return {
        "source": replay["source"],
        "method": replay["method"],
        "available_bars": int(available[0]),
        "available_symbols": int(available[1]),
        "strategies": {STRATEGY: summary},
        "sessions": replay["sessions"],
        "limitations": replay["limitations"],
    }
