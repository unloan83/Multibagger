from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
from ta.volatility import AverageTrueRange

from .config import Settings


@dataclass(frozen=True)
class Candidate:
    symbol: str
    entry: float
    stop: float
    target: float
    strategy: str
    timestamp: datetime
    expiry: datetime
    rank_score: float
    confirmations: dict[str, object] = field(default_factory=dict)


def enrich(frame: pd.DataFrame) -> pd.DataFrame:
    df = frame.copy().sort_values("ts")
    typical = (df.high + df.low + df.close) / 3
    sessions = pd.to_datetime(df.ts, utc=True).dt.tz_convert("Asia/Kolkata").dt.date
    df["session"] = sessions
    cumulative_value = (typical * df.volume).groupby(sessions).cumsum()
    cumulative_volume = df.volume.groupby(sessions).cumsum().replace(0, np.nan)
    df["vwap"] = cumulative_value / cumulative_volume
    df["atr"] = AverageTrueRange(df.high, df.low, df.close, window=14, fillna=False).average_true_range()
    return df


def scan_symbol(frame: pd.DataFrame, settings: Settings, now: datetime | None = None,
                frame_is_enriched: bool = False) -> list[Candidate]:
    now = now or datetime.now(timezone.utc)
    if len(frame) < 30:
        return []
    df = frame.copy().sort_values("ts") if frame_is_enriched else enrich(frame)
    last = df.iloc[-1]
    bar_time = pd.Timestamp(last.ts).to_pydatetime()
    if bar_time.tzinfo is None:
        bar_time = bar_time.replace(tzinfo=timezone.utc)
    if (now - bar_time.astimezone(timezone.utc)).total_seconds() > settings.stale_seconds:
        return []
    today = last.session
    session = df[df.session == today]
    if len(session) < 16 or not np.isfinite(last.atr) or last.atr <= 0:
        return []
    bid, ask = float(last.bid or 0), float(last.ask or 0)
    if bid <= 0 or ask <= bid:
        return []
    spread_bps = (ask - bid) / ((ask + bid) / 2) * 10_000
    prior = df[df.session != today]
    daily_value = (prior.close * prior.volume).groupby(prior.session).sum().tail(5).mean()
    minute = len(session) - 1
    comparable = prior.groupby("session").nth(minute).volume if len(prior) else pd.Series(dtype=float)
    rvol = float(last.volume) / float(comparable.tail(5).mean()) if len(comparable) and comparable.tail(5).mean() > 0 else 0
    if not settings.min_price <= float(last.close) <= settings.max_price or daily_value < settings.min_daily_value or rvol < settings.min_relative_volume or spread_bps > settings.max_spread_bps:
        return []
    entry, atr = float(ask), float(last.atr)
    vwap_val = float(last.vwap)
    stop = min(entry - settings.atr_stop_multiple * atr, vwap_val * 0.998)
    stop_distance_pct = (entry - stop) / entry * 100
    if stop_distance_pct < settings.min_atr_stop_pct:
        return []
    target = entry + settings.reward_risk * (entry - stop)
    expiry = now + timedelta(minutes=settings.signal_expiry_minutes)

    # Technical setup score ranks already-qualified setups; it is never an
    # execution trigger by itself.  The scanner adds market and sector breadth
    # confirmation before the paper engine independently revalidates the quote.
    # Factor A: Technical Momentum & RVOL Surge (35 pts)
    volume_component = min(rvol / 4.0, 1.0) * 35.0

    # Factor B: Price Trend & VWAP Distance (25 pts)
    trend_component = min(max((entry - vwap_val) / atr, 0.0), 1.0) * 25.0

    # Factor C: Session Progression & Intraday Structure (25 pts)
    closes_recent = session.close.tail(5)
    ema_slope_positive = closes_recent.iloc[-1] > closes_recent.mean()
    structure_component = 25.0 if ema_slope_positive and entry > vwap_val else 10.0

    # Factor D: Microstructure & Spread Quality (15 pts)
    spread_component = max(0.0, 1.0 - spread_bps / settings.max_spread_bps) * 15.0

    score = round(volume_component + trend_component + structure_component + spread_component, 4)
    min_score = getattr(settings, "min_confluence_score", 80.0)
    if score < min_score:
        return []
    opening = session.iloc[:15]
    orb_high = float(opening.high.max())
    previous = session.iloc[-2]
    prior_session = prior[prior.session == prior.session.iloc[-1]] if len(prior) else prior
    prior_high = float(prior_session.high.max()) if len(prior_session) else float("inf")
    resistance_clear = prior_high <= entry or prior_high >= target
    volume_confirmed = float(last.volume) >= max(1.1 * float(session.volume.tail(6).iloc[:-1].mean()), 1.0)
    momentum_confirmed = (
        float(last.close) > float(previous.high)
        and float(last.close) > float(closes_recent.mean())
        and 0 < (entry - vwap_val) / atr <= 2.5
    )
    base_confirmations: dict[str, object] = {
        "vwap": bool(float(last.close) > vwap_val),
        "volume": volume_confirmed,
        "momentum": momentum_confirmed,
        "supportResistance": resistance_clear,
        "riskReward": round((target - entry) / (entry - stop), 3) >= settings.reward_risk,
        "relativeVolume": round(rvol, 3),
        "spreadBps": round(spread_bps, 3),
        "vwapPrice": round(vwap_val, 4),
        "priorSessionHigh": None if not np.isfinite(prior_high) else round(prior_high, 4),
    }
    results: list[Candidate] = []
    post_open = session.iloc[15:-1]
    breakout_indices = post_open.index[post_open.close > orb_high * 1.0005].tolist()
    breakout_retest = False
    if breakout_indices:
        after_breakout = session.loc[breakout_indices[0]:].iloc[:-1]
        breakout_retest = bool(((after_breakout.low <= orb_high * 1.002) & (after_breakout.close >= orb_high)).any())
    if breakout_retest and float(last.close) > float(previous.high) and float(last.close) > vwap_val:
        confirmations = {**base_confirmations, "breakoutRetest": True, "setup": "ORB_BREAKOUT_RETEST"}
        if all(bool(confirmations[key]) for key in ("vwap", "volume", "momentum", "supportResistance", "riskReward", "breakoutRetest")):
            results.append(Candidate(str(last.symbol), entry, stop, target, "ORB_15M", now, expiry, score, confirmations))
    recent = session.iloc[-4:-1]
    touched_vwap = bool((recent.low <= recent.vwap * 1.0015).any())
    continuation = float(last.close) > float(previous.high) and float(last.close) > vwap_val
    if touched_vwap and continuation:
        confirmations = {**base_confirmations, "breakoutRetest": True, "setup": "VWAP_RETEST_RECLAIM"}
        if all(bool(confirmations[key]) for key in ("vwap", "volume", "momentum", "supportResistance", "riskReward", "breakoutRetest")):
            results.append(Candidate(str(last.symbol), entry, stop, target, "VWAP_CONTINUATION", now, expiry, score, confirmations))
    return results
