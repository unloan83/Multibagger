"""Pure signal functions. Inputs are point-in-time bars (oldest first) known before the open."""
from __future__ import annotations

from dataclasses import dataclass, field
from statistics import median
from typing import Any

from . import config as C

Bars = list[dict[str, Any]]


def sma(values: list[float], n: int) -> float | None:
    return sum(values[-n:]) / n if len(values) >= n else None


def atr(bars: Bars, n: int = 14) -> float | None:
    if len(bars) < n + 1:
        return None
    trs = [max(b["high"] - b["low"], abs(b["high"] - p["close"]), abs(b["low"] - p["close"]))
           for p, b in zip(bars[-n - 1:-1], bars[-n:])]
    return sum(trs) / n


@dataclass
class Mood:
    state: str  # RISK_ON | NEUTRAL | RISK_OFF
    score: int
    nifty_close: float
    nifty_above_200dma: bool
    vix: float
    high_vol: bool
    breadth_pct: float | None
    fii_dii_net_cr: float | None
    reasons: list[str] = field(default_factory=list)


def market_mood(nifty: Bars, vix: Bars, breadth_pct: float | None,
                fii_dii_net_cr: float | None) -> Mood:
    closes = [b["close"] for b in nifty]
    close = closes[-1]
    s20, s50, s200 = sma(closes, 20), sma(closes, 50), sma(closes, 200)
    s20_prev = sma(closes[:-5], 20)
    if None in (s20, s50, s200, s20_prev) or len(vix) < 6:
        raise ValueError("MOOD_INPUT_SHORT_HISTORY")
    score, reasons = 0, []
    trend = (close > s20) + (close > s50) + (s20 > s20_prev) - 1.5  # type: ignore[operator]
    if trend > 0:
        score += 1; reasons.append("NIFTY_TREND_UP")
    else:
        score -= 1; reasons.append("NIFTY_TREND_DOWN")
    v, v5 = vix[-1]["close"], vix[-6]["close"]
    if v > C.VIX_HIGH or v > v5 * 1.15:
        score -= 1; reasons.append("VIX_ELEVATED_OR_RISING")
    elif v < v5 * 0.95:
        score += 1; reasons.append("VIX_FALLING")
    if breadth_pct is not None:
        if breadth_pct >= 60:
            score += 1; reasons.append("BREADTH_STRONG")
        elif breadth_pct <= 40:
            score -= 1; reasons.append("BREADTH_WEAK")
    else:
        reasons.append("BREADTH_UNAVAILABLE")
    if fii_dii_net_cr is not None:
        if fii_dii_net_cr > 0:
            score += 1; reasons.append("FII_DII_NET_BUY")
        elif fii_dii_net_cr < 0:
            score -= 1; reasons.append("FII_DII_NET_SELL")
    else:
        reasons.append("FII_DII_UNAVAILABLE")
    state = "RISK_ON" if score >= 2 else "RISK_OFF" if score <= -2 else "NEUTRAL"
    return Mood(state, score, close, close > s200, v, v > C.VIX_HIGH, breadth_pct, fii_dii_net_cr, reasons)


def breadth(universe_bars: dict[str, Bars]) -> float | None:
    flags = []
    for bars in universe_bars.values():
        closes = [b["close"] for b in bars]
        s50 = sma(closes, 50)
        if s50 is not None:
            flags.append(closes[-1] > s50)
    return round(100.0 * sum(flags) / len(flags), 1) if len(flags) >= 50 else None


@dataclass
class StockStats:
    symbol: str
    close: float
    atr14: float
    r20: float
    r12_1: float
    above_20_50: bool
    above_200: bool
    near_high: bool
    turnover_ok: bool


def stock_stats(symbol: str, bars: Bars) -> StockStats | None:
    if len(bars) < C.MIN_HISTORY_BARS:
        return None
    closes = [b["close"] for b in bars]
    a = atr(bars)
    s20, s50, s200 = sma(closes, 20), sma(closes, 50), sma(closes, 200)
    if not a or not s20 or not s50 or not s200 or closes[-253] <= 0 or closes[-21] <= 0:
        return None
    turnover = median(b["close"] * b["volume"] for b in bars[-20:])
    return StockStats(
        symbol=symbol, close=closes[-1], atr14=a,
        r20=closes[-1] / closes[-21] - 1, r12_1=closes[-22] / closes[-253] - 1,
        above_20_50=closes[-1] > s20 > s50, above_200=closes[-1] > s200,
        near_high=closes[-1] >= 0.95 * max(closes[-252:]),
        turnover_ok=turnover >= C.MIN_MEDIAN_TURNOVER_INR,
    )


def _pick(category: str, symbol: str, side: str, entry: float, stop: float, target: float,
          score: float, why: list[str], **extra: Any) -> dict[str, Any]:
    # Levels are set from the last close ("ref"); scoring shifts them to the actual fill price.
    return {"category": category, "symbol": symbol, "side": side, "ref": round(extra.pop("ref"), 2),
            "entry": round(entry, 2),
            "stop": round(stop, 2), "target": round(target, 2), "score": round(score, 4),
            "reasons": why, **extra}


def short_term_picks(stats: list[StockStats], mood: Mood, negative: set[str],
                     analyst_boost: dict[str, float]) -> tuple[list[dict[str, Any]], str | None]:
    if mood.state == "RISK_OFF":
        return [], "MOOD_RISK_OFF"
    cands = []
    for s in stats:
        if not (s.turnover_ok and s.above_20_50 and s.near_high and s.r20 > 0) or s.symbol in negative:
            continue
        score = s.r20 / (s.atr14 / s.close) + analyst_boost.get(s.symbol, 0.0)
        cands.append((score, s))
    cands.sort(key=lambda t: t[0], reverse=True)
    picks = []
    for score, s in cands[:C.MAX_PICKS["SHORT_TERM"]]:
        why = ["MOMENTUM_20D", "ABOVE_20_50_DMA", "NEAR_52W_HIGH", f"MOOD_{mood.state}"]
        if s.symbol in analyst_boost:
            why.append("PROVEN_ANALYST_BUY")
        picks.append(_pick("SHORT_TERM", s.symbol, "BUY", s.close * (1 + C.SHORT_TERM_ENTRY_SLACK),
                           s.close - 2 * s.atr14, s.close + 4 * s.atr14, score, why,
                           max_hold_days=C.MAX_HOLD_DAYS["SHORT_TERM"], ref=s.close))
    return picks, None if picks else "NO_QUALIFYING_MOMENTUM"


def long_term_picks(stats: list[StockStats], mood: Mood, negative: set[str],
                    analyst_boost: dict[str, float], first_session_of_month: bool
                    ) -> tuple[list[dict[str, Any]], str | None]:
    if not first_session_of_month:
        return [], "REBALANCE_MONTHLY_ONLY"
    # 12-1 momentum had the best tested net result; its weakness was drawdown, so only buy in an index uptrend.
    if not mood.nifty_above_200dma:
        return [], "NIFTY_BELOW_200DMA"
    cands = [(s.r12_1 + analyst_boost.get(s.symbol, 0.0), s) for s in stats
             if s.turnover_ok and s.above_200 and s.r12_1 > 0 and s.symbol not in negative]
    cands.sort(key=lambda t: t[0], reverse=True)
    picks = [_pick("LONG_TERM", s.symbol, "BUY", s.close * 1.02, s.close * 0.85, s.close * 1.40, score,
                   ["MOMENTUM_12_1", "ABOVE_200DMA", "NIFTY_ABOVE_200DMA"],
                   max_hold_days=C.MAX_HOLD_DAYS["LONG_TERM"], ref=s.close)
             for score, s in cands[:C.MAX_PICKS["LONG_TERM"]]]
    return picks, None if picks else "NO_QUALIFYING_MOMENTUM"


def intraday_picks(stats_by_symbol: dict[str, StockStats], fno: set[str], mood: Mood,
                   catalysts: dict[str, int], analyst_side: dict[str, str], macro_event_today: bool
                   ) -> tuple[list[dict[str, Any]], str | None]:
    """Needs a catalyst (news or proven analyst) aligned with market direction; indicators alone lost money."""
    if macro_event_today:
        return [], "MACRO_EVENT_DAY"
    if mood.high_vol:
        return [], "VIX_HIGH"
    if mood.state == "NEUTRAL":
        return [], "NO_MARKET_DIRECTION"
    want = "BUY" if mood.state == "RISK_ON" else "SELL"
    cands = []
    for sym, s in stats_by_symbol.items():
        if sym not in fno or not s.turnover_ok:
            continue
        news = catalysts.get(sym, 0)
        side = analyst_side.get(sym) or ("BUY" if news > 0 else "SELL" if news < 0 else None)
        if side != want:
            continue
        cands.append((abs(news) + (2 if sym in analyst_side else 0), s))
    cands.sort(key=lambda t: t[0], reverse=True)
    picks = []
    for score, s in cands[:C.MAX_PICKS["INTRADAY"]]:
        risk = 0.5 * s.atr14
        sign = 1 if want == "BUY" else -1
        picks.append(_pick("INTRADAY", s.symbol, want, s.close, s.close - sign * risk, s.close + sign * 2 * risk,
                           score, ["NEWS_OR_ANALYST_CATALYST", f"MOOD_{mood.state}"],
                           max_hold_days=1, max_gap=C.INTRADAY_MAX_GAP, ref=s.close))
    return picks, None if picks else "NO_ALIGNED_CATALYST"


def etf_pick(mood: Mood, current: str | None) -> tuple[list[dict[str, Any]], str | None]:
    """Idle money: index ETF in an uptrend that is not risk-off, otherwise the liquid ETF. Emits only on a switch."""
    want = C.ETF_RISK if mood.nifty_above_200dma and mood.state != "RISK_OFF" else C.ETF_IDLE
    if want == current:
        return [], f"HOLD_{want}"
    return [{"category": "ETF", "symbol": want, "side": "BUY", "entry": 0.0, "stop": 0.0, "target": 0.0,
             "score": 0.0, "reasons": [f"SWITCH_TO_{want}", f"MOOD_{mood.state}"]}], None


def options_direction(mood: Mood) -> str | None:
    if mood.state == "RISK_ON":
        return "BULL_CALL"
    if mood.state == "RISK_OFF":
        return "BEAR_PUT"
    return None


def select_spread(chain: list[dict[str, Any]], structure: str, width: float = C.OPTIONS_WIDTH_POINTS
                  ) -> tuple[dict[str, Any] | None, str | None]:
    """Pick an ATM debit spread from live quotes: buy at ask, sell at bid; reward must cover risk."""
    if not chain:
        return None, "OPTION_CHAIN_EMPTY"
    spot = chain[0]["spot"]
    if spot <= 0:
        return None, "OPTION_SPOT_MISSING"
    by_strike = {r["strike"]: r for r in chain}
    atm = min(by_strike, key=lambda k: abs(k - spot))
    side = "ce" if structure == "BULL_CALL" else "pe"
    far = atm + width if structure == "BULL_CALL" else atm - width
    if far not in by_strike:
        return None, "OPTION_STRIKE_MISSING"
    buy, sell = by_strike[atm][side], by_strike[far][side]
    if not buy or not sell or buy["ask"] <= 0 or sell["bid"] <= 0:
        return None, "OPTION_QUOTE_MISSING"
    for leg in (buy, sell):
        mid = (leg["ask"] + leg["bid"]) / 2
        if leg["bid"] <= 0 or (leg["ask"] - leg["bid"]) / mid > C.OPTIONS_MAX_LEG_SPREAD:
            return None, "OPTION_SPREAD_TOO_WIDE"
    debit = buy["ask"] - sell["bid"]
    if debit <= 0 or debit > width * C.OPTIONS_MAX_DEBIT_FRACTION:
        return None, "OPTION_DEBIT_TOO_HIGH"
    return {"structure": structure, "buy_strike": atm, "sell_strike": far, "debit": round(debit, 2),
            "max_profit": round(width - debit, 2), "spot": spot,
            "buy_key": buy["key"], "sell_key": sell["key"]}, None


def spread_value_at_expiry(structure: str, buy_strike: float, sell_strike: float, settle: float) -> float:
    if structure == "BULL_CALL":
        return max(0.0, min(settle, sell_strike) - buy_strike)
    return max(0.0, buy_strike - max(settle, sell_strike))
