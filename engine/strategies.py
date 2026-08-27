from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
from ta.trend import ADXIndicator
from ta.volatility import AverageTrueRange, BollingerBands

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
    df["ema9"] = df.close.ewm(span=9, adjust=False).mean()
    for window in (9, 14, 21):
        try:
            df[f"adx{window}"] = ADXIndicator(df.high, df.low, df.close, window=window, fillna=False).adx()
        except IndexError:
            df[f"adx{window}"] = np.nan
    bands = BollingerBands(df.close, window=20, window_dev=2.5, fillna=False)
    df["bb_mid"], df["bb_upper"], df["bb_lower"] = (
        bands.bollinger_mavg(), bands.bollinger_hband(), bands.bollinger_lband()
    )
    return df


def intraday_indicator_window(frame: pd.DataFrame, warmup_bars: int = 500) -> pd.DataFrame:
    """Retain all current-session bars plus enough prior bars to converge indicators."""
    if frame.empty:
        return frame
    df = frame.sort_values("ts").reset_index(drop=True)
    sessions = pd.to_datetime(df.ts, utc=True).dt.tz_convert("Asia/Kolkata").dt.date
    current_session = sessions.iloc[-1]
    session_start = int(np.flatnonzero(sessions.to_numpy() == current_session)[0])
    return df.iloc[max(0, session_start - warmup_bars):].reset_index(drop=True)


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
                frame_is_enriched: bool = False, regime: str = "TRANSITION",
                history_frame: pd.DataFrame | None = None) -> list[Candidate]:
    """Run only the isolated agent assigned to the current IST window."""
    now = now or datetime.now(timezone.utc)
    agent = active_agent(now)
    if agent is None or agent not in settings.enabled_agents or regime == "NO_TRADE" or len(frame) < 30:
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
    history = history_frame.copy().sort_values("ts") if history_frame is not None else df
    if "session" not in history.columns:
        history["session"] = pd.to_datetime(history.ts, utc=True).dt.tz_convert("Asia/Kolkata").dt.date
    prior = history[history.session != last.session]
    daily_volume = prior.volume.groupby(prior.session).sum().tail(20).median()
    daily_range_pct = (((prior.high.groupby(prior.session).max() - prior.low.groupby(prior.session).min())
                        / prior.close.groupby(prior.session).last()) * 100).tail(20).median()
    minute = len(session) - 1
    comparable = prior.groupby("session").nth(minute).volume if len(prior) else pd.Series(dtype=float)
    comparable_mean = float(comparable.tail(20).median()) if len(comparable) else 0.0
    relative_volume = float(last.volume) / comparable_mean if comparable_mean > 0 else 0.0
    if not (
        settings.min_price <= close <= settings.max_price
        and daily_volume >= settings.min_average_volume
        and daily_range_pct >= settings.min_average_daily_range_pct
        and spread_bps <= settings.max_spread_bps
        and atr_pct >= settings.min_intraday_atr_pct
    ):
        return []

    vwap = float(last.vwap)
    recent_volume_mean = float(session.volume.iloc[-6:-1].mean())
    volume_confirmed = float(last.volume) >= max(1.2 * recent_volume_mean, 1.0)
    vwap_slope = float(session.vwap.iloc[-1]) - float(session.vwap.iloc[-5])
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
        "vwapSlopeAlignedLong": vwap_slope > 0,
        "vwapSlopeAlignedShort": vwap_slope < 0,
        "volumeAboveLast5x1_5": float(last.volume) > 1.5 * recent_volume_mean,
        # No live intraday news feed is attached to this engine. Fail closed:
        # the 10 news points are awarded only when verified evidence is supplied.
        "noAdverseNewsLastHour": False,
        "vwapPrice": round(vwap, 4),
        "atr": round(atr, 4),
        "relativeVolume": round(relative_volume, 3),
        "spreadBps": round(spread_bps, 3),
        "regime": regime,
        "agent": agent,
        "adx": round(float(last[f"adx{14 if agent == 'ALPHA' else 9 if agent == 'BETA' else 21}"]), 3),
        "ohlcv": {name: round(float(last[name]), 4) for name in ("open", "high", "low", "close", "volume")},
        "ema9": round(float(last.ema9), 4),
        "bb": {"mid": round(float(last.bb_mid), 4), "upper": round(float(last.bb_upper), 4),
               "lower": round(float(last.bb_lower), 4)},
    }
    if agent == "ALPHA" and float(last.adx14) > 25:
        candidate = _vwap_pullback(session, str(last.symbol), bid, ask, atr, vwap, relative_volume,
                                   spread_bps, settings, now, expiry, common)
        return [candidate] if candidate else []
    if agent == "BETA" and relative_volume >= 1.8 and float(last.adx9) > 18:
        candidate = _fifteen_minute_breakout(session, str(last.symbol), bid, ask, atr, vwap,
                                             relative_volume, spread_bps, settings, now, expiry, common)
        return [candidate] if candidate else []
    if agent == "GAMMA" and float(last.adx21) < 22:
        candidate = _bollinger_fade(session, str(last.symbol), bid, ask, atr, vwap,
                                    relative_volume, spread_bps, settings, now, expiry, common)
        if not candidate:
            candidate = _range_mean_reversion(session, str(last.symbol), bid, ask, atr, vwap,
                                              relative_volume, spread_bps, settings, now, expiry, common)
        return [candidate] if candidate else []

    return []


def _candidate(symbol: str, side: TradeSide, entry: float, stop: float, rr: float, strategy: str,
               now: datetime, expiry: datetime, relative_volume: float, spread_bps: float,
               settings: Settings, confirmations: dict[str, object]) -> Candidate | None:
    risk = entry - stop if side == "LONG" else stop - entry
    if risk <= 0 or risk / entry * 100 < settings.min_atr_stop_pct:
        return None
    target = entry + (risk * 4 if side == "LONG" else -risk * 4)
    score = 0.0
    details = {**confirmations, "riskReward": rr >= settings.reward_risk, "targetR": rr,
               "tradeDirection": "BULLISH" if side == "LONG" else "BEARISH"}
    return Candidate(symbol, side, entry, stop, target, strategy, now, expiry, score, details)


def active_agent(now: datetime) -> str | None:
    local = now.astimezone(ZoneInfo("Asia/Kolkata"))
    minute = local.hour * 60 + local.minute
    if local.weekday() >= 5:
        return None
    if 9 * 60 + 30 <= minute < 11 * 60:
        return "ALPHA"
    if 11 * 60 <= minute < 13 * 60 + 30:
        return "BETA"
    if 13 * 60 + 30 <= minute < 15 * 60:
        return "GAMMA"
    return None


def entry_score_threshold(now: datetime) -> int | None:
    return 0 if active_agent(now) else None


def score_setup(candidate: Candidate, confirmations: dict[str, object]) -> int:
    side_key = "vwapSlopeAlignedLong" if candidate.side == "LONG" else "vwapSlopeAlignedShort"
    return sum((
        20 if confirmations.get(side_key) is True else 0,
        15 if confirmations.get("volumeAboveLast5x1_5") is True else 0,
        15 if confirmations.get("momentum") is True else 0,
        10 if confirmations.get("sectorTop3") is True else 0,
        10 if confirmations.get("niftyStronglyAligned") is True else 0,
        10 if confirmations.get("supportResistance") is True else 0,
        10 if float(confirmations.get("spreadBps") or 10_000) < 5 else 0,
        10 if confirmations.get("noAdverseNewsLastHour") is True else 0,
    ))


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


def _bollinger_fade(session, symbol, bid, ask, atr, vwap, relative_volume, spread_bps,
                    settings, now, expiry, common):
    last = session.iloc[-1]
    if not all(np.isfinite(float(last[name])) for name in ("bb_mid", "bb_upper", "bb_lower")):
        return None
    if float(last.low) <= float(last.bb_lower) and float(last.close) > float(last.open):
        return _candidate(symbol, "LONG", ask, float(last.low) - 0.25 * atr, settings.reward_risk,
                          "GAMMA_BB_FADE", now, expiry, relative_volume, spread_bps, settings,
                          {**common, "setup": "BB_20_2_5_FADE", "mean": float(last.bb_mid)})
    if float(last.high) >= float(last.bb_upper) and float(last.close) < float(last.open):
        return _candidate(symbol, "SHORT", bid, float(last.high) + 0.25 * atr, settings.reward_risk,
                          "GAMMA_BB_FADE", now, expiry, relative_volume, spread_bps, settings,
                          {**common, "setup": "BB_20_2_5_FADE", "mean": float(last.bb_mid)})
    return None


def _fifteen_minute_breakout(session, symbol, bid, ask, atr, vwap, relative_volume, spread_bps,
                             settings, now, expiry, common):
    candles = session.copy()
    candles["ts"] = pd.to_datetime(candles.ts, utc=True)
    fifteen = candles.set_index("ts").resample("15min", origin="start_day", offset="15min").agg(
        open=("open", "first"), high=("high", "max"), low=("low", "min"), close=("close", "last")
    ).dropna()
    if len(fifteen) < 2:
        return None
    completed = fifteen.iloc[:-1] if len(session) % 15 else fifteen.iloc[:-1]
    if completed.empty:
        return None
    last = session.iloc[-1]
    breakout_high, breakout_low = float(completed.high.max()), float(completed.low.min())
    if float(last.close) > breakout_high and float(last.close) > vwap:
        return _candidate(symbol, "LONG", ask, breakout_high - 0.25 * atr, settings.reward_risk,
                          "BETA_15M_BREAKOUT", now, expiry, relative_volume, spread_bps, settings,
                          {**common, "setup": "15M_BREAKOUT", "breakoutLevel": breakout_high})
    if float(last.close) < breakout_low and float(last.close) < vwap:
        return _candidate(symbol, "SHORT", bid, breakout_low + 0.25 * atr, settings.reward_risk,
                          "BETA_15M_BREAKOUT", now, expiry, relative_volume, spread_bps, settings,
                          {**common, "setup": "15M_BREAKOUT", "breakoutLevel": breakout_low})
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
