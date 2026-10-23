"""Score logged picks and analyst calls against real daily bars (pure functions) and compute metrics.

Daily bars cannot order intrabar events: when one bar touches both stop and target, the stop is assumed
first. Bars used for scoring are always on or after the decision session, so there is no look-ahead.
"""
from __future__ import annotations

import math
from datetime import date
from typing import Any

from . import config as C

Bars = list[dict[str, Any]]


def _walk(side: str, fill: float, stop: float, target: float, bars: Bars, max_days: int
          ) -> tuple[str, float, str] | None:
    """Return (exit_date, exit_price, reason) or None while the trade is still open."""
    for i, b in enumerate(bars[:max_days]):
        hit_stop = b["low"] <= stop if side == "BUY" else b["high"] >= stop
        hit_target = b["high"] >= target if side == "BUY" else b["low"] <= target
        if hit_stop:
            # A gap through the stop fills at the open, not the stop.
            px = min(stop, b["open"]) if side == "BUY" else max(stop, b["open"])
            return b["date"], px, "STOP"
        if hit_target:
            return b["date"], target, "TARGET"
    if len(bars) >= max_days:
        last = bars[max_days - 1]
        return last["date"], last["close"], "TIME_EXIT"
    return None


def score_equity_pick(pick: dict[str, Any], bars: Bars) -> dict[str, Any] | None:
    """`bars` are the symbol's bars dated on/after the pick's run_date. Returns field updates or None."""
    if not bars:
        return None
    first = bars[0]
    if first["date"] != pick["run_date"]:
        return {"status": "NOT_FILLED", "exit_reason": "NO_BAR_FOR_SESSION"}
    side, ref, op = pick["side"], pick["ref"], first["open"]
    if pick["category"] == "INTRADAY":
        detail_gap = pick.get("max_gap") or C.INTRADAY_MAX_GAP
        if abs(op / ref - 1) > detail_gap:
            return {"status": "NOT_FILLED", "exit_reason": "GAP_TOO_LARGE"}
    elif side == "BUY" and op > pick["entry"]:
        return {"status": "NOT_FILLED", "exit_reason": "OPEN_ABOVE_ENTRY_LIMIT"}
    shift = op - ref
    stop, target = pick["stop"] + shift, pick["target"] + shift
    out = _walk(side, op, stop, target, bars, int(pick["max_hold_days"]))
    qty = math.floor(C.NOTIONAL_PER_PICK_INR / op)
    fields: dict[str, Any] = {"fill_date": first["date"], "fill_price": op, "qty": qty, "notional": qty * op}
    if out is None:
        return {**fields, "status": "OPEN"}
    exit_date, exit_px, reason = out
    sign = 1 if side == "BUY" else -1
    gross = sign * (exit_px - op) * qty
    costs = C.COST_PER_SIDE[pick["category"]] * (op + exit_px) * qty
    return {**fields, "status": "CLOSED", "exit_date": exit_date, "exit_price": round(exit_px, 2),
            "exit_reason": reason, "gross_pnl": round(gross, 2), "costs": round(costs, 2),
            "net_pnl": round(gross - costs, 2)}


def score_etf(pick: dict[str, Any], bars: Bars, exit_on: tuple[str, float] | None) -> dict[str, Any] | None:
    """ETF holdings fill at the decision-day open and exit at the open of the day the next switch fills."""
    if not bars:
        return None
    if bars[0]["date"] != pick["run_date"]:
        return {"status": "NOT_FILLED", "exit_reason": "NO_BAR_FOR_SESSION"}
    op = bars[0]["open"]
    qty = math.floor(C.NOTIONAL_PER_PICK_INR / op)
    fields: dict[str, Any] = {"fill_date": bars[0]["date"], "fill_price": op, "qty": qty, "notional": qty * op}
    if exit_on is None:
        return {**fields, "status": "OPEN"}
    exit_date, exit_px = exit_on
    gross = (exit_px - op) * qty
    costs = C.COST_PER_SIDE["ETF"] * (op + exit_px) * qty
    return {**fields, "status": "CLOSED", "exit_date": exit_date, "exit_price": exit_px, "exit_reason": "SWITCH",
            "gross_pnl": round(gross, 2), "costs": round(costs, 2), "net_pnl": round(gross - costs, 2)}


def score_option_pick(detail: dict[str, Any], nifty_bars_after_fill: Bars) -> dict[str, Any] | None:
    """Held to expiry; settlement approximated by the Nifty close on expiry day."""
    expiry = detail["expiry"]
    settle_bar = next((b for b in nifty_bars_after_fill if b["date"] == expiry), None)
    if settle_bar is None:
        if any(b["date"] > expiry for b in nifty_bars_after_fill):
            return {"status": "CLOSED_UNSCORED", "exit_reason": "NO_EXPIRY_BAR"}
        return None
    from .signals import spread_value_at_expiry
    value = spread_value_at_expiry(detail["structure"], detail["buy_strike"], detail["sell_strike"],
                                   settle_bar["close"])
    units = detail["lot_size"]
    gross = (value - detail["debit"]) * units
    costs = 2 * C.OPTIONS_COST_PER_ORDER_INR + 2 * C.OPTIONS_SLIPPAGE_PER_LEG_INR_PER_UNIT * units
    return {"status": "CLOSED", "exit_date": expiry, "exit_price": round(value, 2), "exit_reason": "EXPIRY",
            "gross_pnl": round(gross, 2), "costs": round(costs, 2), "net_pnl": round(gross - costs, 2)}


def score_call(call: dict[str, Any], bars: Bars, max_days: int) -> dict[str, Any] | None:
    """Analyst call: enters at the open of the first session after publication, with the analyst's own levels."""
    if not bars:
        return None
    side, op = call["side"], bars[0]["open"]
    stop, target = call["stop"], call["target"]
    # Brokerage calls give no stop: they are scored on target-or-time only (stop 0 never triggers).
    target_only = stop <= 0
    if target_only:
        stop = -math.inf if side == "BUY" else math.inf
    beyond_target = op >= target if side == "BUY" else op <= target
    beyond_stop = op <= stop if side == "BUY" else op >= stop
    if beyond_target or beyond_stop:
        return {"status": "NOT_FILLED", "exit_reason": "GAP_PAST_LEVEL", "fill_date": bars[0]["date"]}
    out = _walk(side, op, stop, target, bars, max_days)
    fields = {"fill_date": bars[0]["date"], "fill_price": op}
    if out is None:
        return {**fields, "status": "OPEN"}
    exit_date, exit_px, reason = out
    # R: move in the called direction per unit of risk; for target-only calls, per unit of the predicted move
    # (1.0 = target reached, negative = price went the other way).
    risk = abs(target - op) if target_only else abs(op - stop)
    r = ((exit_px - op) if side == "BUY" else (op - exit_px)) / risk if risk > 0 else 0.0
    return {**fields, "status": "CLOSED", "exit_date": exit_date, "exit_price": round(exit_px, 2),
            "exit_reason": reason, "r_multiple": round(r, 3)}


def metrics(closed: list[dict[str, Any]], capital: float = C.PAPER_CAPITAL_INR) -> dict[str, Any]:
    """Net-of-cost scorecard for closed picks of one category (or all)."""
    n = len(closed)
    if n == 0:
        return {"closed": 0}
    nets = [p["net_pnl"] for p in sorted(closed, key=lambda p: (p["exit_date"], p["id"]))]
    wins = [x for x in nets if x > 0]
    losses = [x for x in nets if x <= 0]
    peak = cum = mdd = 0.0
    for x in nets:
        cum += x
        peak = max(peak, cum)
        mdd = max(mdd, peak - cum)
    first = min(date.fromisoformat(p["fill_date"]) for p in closed)
    last = max(date.fromisoformat(p["exit_date"]) for p in closed)
    span = max((last - first).days + 1, 1)
    deployed = sum((p.get("notional") or 0) * ((date.fromisoformat(p["exit_date"]) -
                    date.fromisoformat(p["fill_date"])).days + 1) for p in closed)
    return {
        "closed": n,
        "net_pnl": round(sum(nets), 2),
        "gross_pnl": round(sum(p["gross_pnl"] for p in closed), 2),
        "costs": round(sum(p["costs"] for p in closed), 2),
        "win_rate": round(len(wins) / n, 3),
        "profit_factor": round(sum(wins) / -sum(losses), 3) if losses and sum(losses) < 0 else None,
        "expectancy": round(sum(nets) / n, 2),
        "max_drawdown": round(mdd, 2),
        "capital_utilisation": round(deployed / (capital * span), 4),
    }


def analyst_weights(closed_calls: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Shrunk mean R per analyst. An analyst influences picks only once proven on enough calls."""
    by: dict[str, list[float]] = {}
    for c in closed_calls:
        by.setdefault(c["analyst"], []).append(c["r_multiple"])
    out = {}
    for name, rs in by.items():
        n = len(rs)
        mean_r = sum(rs) / n
        shrunk = mean_r * n / (n + C.ANALYST_SHRINK_K)
        out[name] = {"calls": n, "mean_r": round(mean_r, 3), "shrunk_r": round(shrunk, 3),
                     "hit_rate": round(sum(r > 0 for r in rs) / n, 3),
                     "proven": n >= C.ANALYST_MIN_CALLS and shrunk >= C.ANALYST_MIN_SHRUNK_R}
    return out


def kill_check(m: dict[str, Any]) -> str | None:
    if m.get("closed", 0) >= C.KILL_MIN_CLOSED and m["expectancy"] <= 0:
        return f"FAILED: {m['closed']} closed picks, net expectancy {m['expectancy']} <= 0"
    return None
