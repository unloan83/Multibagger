from __future__ import annotations

from dataclasses import dataclass
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


def scan_symbol(frame: pd.DataFrame, settings: Settings, now: datetime | None = None) -> list[Candidate]:
    now = now or datetime.now(timezone.utc)
    if len(frame) < 30:
        return []
    df = enrich(frame)
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
    if float(last.close) < settings.min_price or daily_value < settings.min_daily_value or rvol < settings.min_relative_volume or spread_bps > settings.max_spread_bps:
        return []
    entry, atr = float(ask), float(last.atr)
    stop = entry - settings.atr_stop_multiple * atr
    target = entry + settings.reward_risk * (entry - stop)
    expiry = now + timedelta(minutes=settings.signal_expiry_minutes)
    volume_component = min(rvol / 3, 1) * 40
    spread_component = max(0, 1 - spread_bps / settings.max_spread_bps) * 25
    trend_component = min(max((entry - float(last.vwap)) / atr, 0), 1) * 35
    score = round(volume_component + spread_component + trend_component, 4)
    opening = session.iloc[:15]
    orb_high = float(opening.high.max())
    previous = session.iloc[-2]
    results: list[Candidate] = []
    if float(previous.close) <= orb_high < float(last.close) and float(last.close) > float(last.vwap):
        results.append(Candidate(str(last.symbol), entry, stop, target, "ORB_15M", now, expiry, score))
    recent = session.iloc[-4:-1]
    touched_vwap = bool((recent.low <= recent.vwap * 1.0015).any())
    continuation = float(last.close) > float(previous.high) and float(last.close) > float(last.vwap)
    if touched_vwap and continuation:
        results.append(Candidate(str(last.symbol), entry, stop, target, "VWAP_CONTINUATION", now, expiry, score))
    return results
