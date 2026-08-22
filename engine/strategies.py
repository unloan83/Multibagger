from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Literal

import numpy as np
import pandas as pd
from ta.volatility import AverageTrueRange

from .config import Settings


TradeSide = Literal["LONG", "SHORT"]
Trend = Literal["BULLISH", "BEARISH", "RANGE"]


@dataclass(frozen=True)
class Candidate:
    symbol: str
    side: TradeSide
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
    fallback_vwap = typical.groupby(sessions).expanding().mean().reset_index(level=0, drop=True)
    df["vwap"] = (cumulative_value / cumulative_volume).fillna(fallback_vwap)
    df["atr"] = AverageTrueRange(df.high, df.low, df.close, window=14, fillna=False).average_true_range()
    return df


def classify_price_trend(frame: pd.DataFrame, now: datetime, stale_seconds: int) -> Trend:
    """Classify a live one-minute frame without converting RANGE into a trade."""
    if len(frame) < 16:
        return "RANGE"
    df = frame if "session" in frame.columns else enrich(frame)
    last = df.iloc[-1]
    bar_time = _utc_datetime(last.ts)
    if not 0 <= (now.astimezone(timezone.utc) - bar_time).total_seconds() <= stale_seconds * 3:
        return "RANGE"
    session = df[df.session == last.session]
    if len(session) < 16:
        return "RANGE"
    recent = session.tail(5)
    close = float(last.close)
    vwap = float(last.vwap)
    session_open = float(session.iloc[0].open)
    return_from_open_bps = (close - session_open) / session_open * 10_000
    rising = close > float(recent.close.iloc[0]) and close > float(recent.close.mean())
    falling = close < float(recent.close.iloc[0]) and close < float(recent.close.mean())
    if return_from_open_bps >= 10 and close > vwap and rising:
        return "BULLISH"
    if return_from_open_bps <= -10 and close < vwap and falling:
        return "BEARISH"
    return "RANGE"


def scan_symbol(frame: pd.DataFrame, settings: Settings, now: datetime | None = None,
                frame_is_enriched: bool = False, regime: str = "TRANSITION") -> list[Candidate]:
    """Return regime-specific price/volume setups; recommendations are never an input."""
    now = now or datetime.now(timezone.utc)
    if regime not in ("TRENDING", "RANGE") or len(frame) < 30:
        return []
    df = frame.copy().sort_values("ts") if frame_is_enriched else enrich(frame)
    last = df.iloc[-1]
    bar_time = _utc_datetime(last.ts)
    if (now.astimezone(timezone.utc) - bar_time).total_seconds() > settings.stale_seconds:
        return []
    session = df[df.session == last.session]
    if len(session) < 17 or not np.isfinite(last.atr) or float(last.atr) <= 0:
        return []

    bid, ask, close, atr = float(last.bid or 0), float(last.ask or 0), float(last.close), float(last.atr)
    if bid <= 0 or ask <= bid:
        return []
    midpoint = (ask + bid) / 2
    spread_bps = (ask - bid) / midpoint * 10_000
    atr_pct = atr / close * 100
    prior = df[df.session != last.session]
    daily_volume = prior.volume.groupby(prior.session).sum().tail(5).mean()
    daily_range_pct = (((prior.high.groupby(prior.session).max() - prior.low.groupby(prior.session).min())
                        / prior.close.groupby(prior.session).last()) * 100).tail(5).mean()
    minute = len(session) - 1
    comparable = prior.groupby("session").nth(minute).volume if len(prior) else pd.Series(dtype=float)
    comparable_mean = float(comparable.tail(5).mean()) if len(comparable) else 0.0
    relative_volume = float(last.volume) / comparable_mean if comparable_mean > 0 else 0.0
    if not (
        settings.min_price <= close <= settings.max_price
        and daily_volume >= settings.min_average_volume
        and daily_range_pct >= settings.min_average_daily_range_pct
        and relative_volume >= settings.min_relative_volume
        and spread_bps <= settings.max_spread_bps
        and atr_pct >= settings.min_intraday_atr_pct
    ):
        return []

    vwap = float(last.vwap)
    recent_volume_mean = float(session.volume.iloc[-6:-1].mean())
    volume_confirmed = float(last.volume) >= max(1.2 * recent_volume_mean, 1.0)
    expiry = now + timedelta(minutes=settings.signal_expiry_minutes)
    common = {
        "setupSource": "PRICE_VOLUME_ONLY",
        "marketDirection": False,
        "sectorDirection": False,
        "vwap": True,
        "volume": volume_confirmed,
        "momentum": True,
        "supportResistance": True,
        "strategyQualified": True,
        "vwapPrice": round(vwap, 4),
        "atr": round(atr, 4),
        "relativeVolume": round(relative_volume, 3),
        "spreadBps": round(spread_bps, 3),
        "regime": regime,
    }
    if regime == "TRENDING":
        candidate = _vwap_pullback(session, str(last.symbol), bid, ask, atr, vwap, relative_volume,
                                   spread_bps, settings, now, expiry, common)
        if candidate:
            return [candidate]
        orb = _high_volume_orb(session, str(last.symbol), bid, ask, atr, vwap, relative_volume,
                               spread_bps, settings, now, expiry, common)
        return [orb] if orb else []
    candidate = _range_mean_reversion(session, str(last.symbol), bid, ask, atr, vwap, relative_volume,
                                      spread_bps, settings, now, expiry, common)
    return [candidate] if candidate else []


def _candidate(symbol: str, side: TradeSide, entry: float, stop: float, rr: float, strategy: str,
               now: datetime, expiry: datetime, relative_volume: float, spread_bps: float,
               settings: Settings, confirmations: dict[str, object]) -> Candidate | None:
    risk = entry - stop if side == "LONG" else stop - entry
    if risk <= 0 or risk / entry * 100 < settings.min_atr_stop_pct:
        return None
    target = entry + (risk * rr if side == "LONG" else -risk * rr)
    score = round(min(relative_volume / 3, 1) * 40 + max(0, 1 - spread_bps / settings.max_spread_bps) * 25 + 35, 4)
    if score < settings.min_confluence_score:
        return None
    details = {**confirmations, "riskReward": rr >= settings.reward_risk, "targetR": rr,
               "tradeDirection": "BULLISH" if side == "LONG" else "BEARISH"}
    return Candidate(symbol, side, entry, stop, target, strategy, now, expiry, score, details)


def _vwap_pullback(session, symbol, bid, ask, atr, vwap, relative_volume, spread_bps,
                   settings, now, expiry, common):
    recent, last, previous = session.tail(4), session.iloc[-1], session.iloc[-2]
    trend = classify_price_trend(session, now, settings.stale_seconds)
    if trend == "BULLISH" and recent.low.min() <= vwap + 0.2 * atr and last.close > vwap and last.close > previous.high:
        stop = min(float(recent.low.min()), vwap) - 0.25 * atr
        return _candidate(symbol, "LONG", ask, stop, settings.max_reward_risk, "VWAP_PULLBACK_CONTINUATION",
                          now, expiry, relative_volume, spread_bps, settings, {**common, "setup": "VWAP_PULLBACK"})
    if trend == "BEARISH" and recent.high.max() >= vwap - 0.2 * atr and last.close < vwap and last.close < previous.low:
        stop = max(float(recent.high.max()), vwap) + 0.25 * atr
        return _candidate(symbol, "SHORT", bid, stop, settings.max_reward_risk, "VWAP_PULLBACK_CONTINUATION",
                          now, expiry, relative_volume, spread_bps, settings, {**common, "setup": "VWAP_PULLBACK"})
    return None


def _range_mean_reversion(session, symbol, bid, ask, atr, vwap, relative_volume, spread_bps,
                          settings, now, expiry, common):
    recent, last = session.tail(20), session.iloc[-1]
    low, high = float(recent.low.min()), float(recent.high.max())
    if float(last.low) <= low + 0.2 * atr and last.close > last.open:
        stop = low - 0.25 * atr
        risk = ask - stop
        if vwap - ask >= settings.reward_risk * risk:
            return _candidate(symbol, "LONG", ask, stop, settings.reward_risk, "RANGE_MEAN_REVERSION",
                              now, expiry, relative_volume, spread_bps, settings, {**common, "setup": "RANGE_EXTREME"})
    if float(last.high) >= high - 0.2 * atr and last.close < last.open:
        stop = high + 0.25 * atr
        risk = stop - bid
        if bid - vwap >= settings.reward_risk * risk:
            return _candidate(symbol, "SHORT", bid, stop, settings.reward_risk, "RANGE_MEAN_REVERSION",
                              now, expiry, relative_volume, spread_bps, settings, {**common, "setup": "RANGE_EXTREME"})
    return None


def _high_volume_orb(session, symbol, bid, ask, atr, vwap, relative_volume, spread_bps,
                     settings, now, expiry, common):
    if len(session) < 17:
        return None
    opening, last = session.iloc[:15], session.iloc[-1]
    if float(last.volume) <= 2 * float(session.iloc[:5].volume.mean()):
        return None
    high, low = float(opening.high.max()), float(opening.low.min())
    if last.close > high and last.close > vwap:
        return _candidate(symbol, "LONG", ask, high - 0.25 * atr, settings.max_reward_risk, "HIGH_VOLUME_ORB",
                          now, expiry, relative_volume, spread_bps, settings,
                          {**common, "setup": "HIGH_VOLUME_ORB", "breakoutLevel": high, "breakoutRetest": True})
    if last.close < low and last.close < vwap:
        return _candidate(symbol, "SHORT", bid, low + 0.25 * atr, settings.max_reward_risk, "HIGH_VOLUME_ORB",
                          now, expiry, relative_volume, spread_bps, settings,
                          {**common, "setup": "HIGH_VOLUME_ORB", "breakoutLevel": low, "breakoutRetest": True})
    return None


def _utc_datetime(value: object) -> datetime:
    parsed = pd.Timestamp(value).to_pydatetime()
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)
