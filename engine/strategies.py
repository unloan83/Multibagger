from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
from ta.trend import ADXIndicator
from ta.volatility import AverageTrueRange, BollingerBands

from .config import EXECUTION_ENGINE_IDENTITY, Settings

TradeSide = Literal["LONG", "SHORT"]
Trend = Literal["BULLISH", "BEARISH", "RANGE"]
Thesis = Literal["CONTINUATION", "BREAKOUT", "REVERSAL"]


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


@dataclass(frozen=True)
class OpportunityEvaluation:
    symbol: str
    side: TradeSide
    thesis: Thesis
    score: float
    expected_r: float
    entry: float
    stop: float
    target: float
    status: Literal["TRADE", "WATCH", "AVOID"]
    why_not_executable: str
    candidate: Candidate | None = None

    def to_dict(self) -> dict:
        return {
            "symbol": self.symbol,
            "side": self.side,
            "thesis": self.thesis,
            "score": round(self.score, 1),
            "expected_r": round(self.expected_r, 2),
            "entry": round(self.entry, 2),
            "stop": round(self.stop, 2),
            "target": round(self.target, 2),
            "status": self.status,
            "why_not_executable": self.why_not_executable,
        }


def round_to_tick(price: float, tick_size: float = 0.05) -> float:
    if price <= 0 or tick_size <= 0:
        return price
    return round(round(price / tick_size) * tick_size, 2)


def enrich(frame: pd.DataFrame) -> pd.DataFrame:
    df = frame.copy().sort_values("ts")
    typical = (df.high + df.low + df.close) / 3
    sessions = pd.to_datetime(df.ts, utc=True).dt.tz_convert("Asia/Kolkata").dt.date
    df["session"] = sessions
    cumulative_value = (typical * df.volume).groupby(sessions).cumsum()
    cumulative_volume = df.volume.groupby(sessions).cumsum().replace(0, np.nan)
    fallback_vwap = typical.groupby(sessions).expanding().mean().reset_index(level=0, drop=True)
    df["vwap"] = (cumulative_value / cumulative_volume).fillna(fallback_vwap).fillna(typical).fillna(df.close)
    df["atr"] = AverageTrueRange(df.high, df.low, df.close, window=14, fillna=False).average_true_range()
    df["ema9"] = df.close.ewm(span=9, adjust=False).mean()
    for window in (9, 14, 21):
        try:
            df[f"adx{window}"] = ADXIndicator(df.high, df.low, df.close, window=window, fillna=False).adx()
        except IndexError:
            df[f"adx{window}"] = np.nan
    bands = BollingerBands(df.close, window=20, window_dev=2.0, fillna=False)
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
    if len(frame) < 10:
        return "RANGE"
    df = frame if "session" in frame.columns else enrich(frame)
    last = df.iloc[-1]
    session = df[df.session == last.session]
    if len(session) < 10:
        return "RANGE"
    recent = session.tail(5)
    close = float(last.close)
    vwap = float(last.vwap)
    session_open = float(session.iloc[0].open)
    return_from_open_bps = (close - session_open) / session_open * 10_000
    rising = close > float(recent.close.iloc[0]) and close > float(recent.close.mean())
    falling = close < float(recent.close.iloc[0]) and close < float(recent.close.mean())
    if return_from_open_bps >= 8 and close > vwap and rising:
        return "BULLISH"
    if return_from_open_bps <= -8 and close < vwap and falling:
        return "BEARISH"
    return "RANGE"


def evaluate_opportunity(frame: pd.DataFrame, settings: Settings, now: datetime | None = None,
                         frame_is_enriched: bool = False, market_bias: str = "MIXED",
                         history_frame: pd.DataFrame | None = None) -> OpportunityEvaluation | None:
    """Evaluates a single symbol against the Weighted Opportunity Scoring Engine."""
    now = now or datetime.now(timezone.utc)
    if len(frame) < 15:
        return None

    df = frame.copy().sort_values("ts") if frame_is_enriched else enrich(frame)
    last = df.iloc[-1]
    bar_time = _utc_datetime(last.ts)
    if (now.astimezone(timezone.utc) - bar_time).total_seconds() > settings.stale_seconds * 3:
        return None

    session = df[df.session == last.session]
    if len(session) < 15 or not np.isfinite(last.atr) or float(last.atr) <= 0:
        return None

    close = float(last.close)
    atr = float(last.atr)
    raw_bid = float(last.bid) if "bid" in last and pd.notna(last.bid) else 0.0
    raw_ask = float(last.ask) if "ask" in last and pd.notna(last.ask) else 0.0

    tick = max(0.05, round(close * 0.0001, 2))
    if (
        raw_bid <= 0
        or raw_ask <= 0
        or raw_ask <= raw_bid
        or abs(raw_bid - close) / close > 0.003
        or abs(raw_ask - close) / close > 0.003
    ):
        bid = close - (tick / 2.0)
        ask = close + (tick / 2.0)
    else:
        bid = raw_bid
        ask = raw_ask

    midpoint = (ask + bid) / 2
    spread_bps = (ask - bid) / midpoint * 10_000
    atr_pct = atr / close * 100

    history = history_frame.copy().sort_values("ts") if history_frame is not None else df
    if "session" not in history.columns:
        history["session"] = pd.to_datetime(history.ts, utc=True).dt.tz_convert("Asia/Kolkata").dt.date
    prior = history[history.session != last.session]
    daily_volume = prior.volume.groupby(prior.session).sum().tail(20).median() if len(prior) else float(last.volume) * 375
    daily_range_pct = (((prior.high.groupby(prior.session).max() - prior.low.groupby(prior.session).min())
                        / prior.close.groupby(prior.session).last()) * 100).tail(20).median() if len(prior) else 1.5

    minute = len(session) - 1
    comparable = prior.groupby("session").nth(minute).volume if len(prior) else pd.Series(dtype=float)
    comparable_mean = float(comparable.tail(20).median()) if len(comparable) else float(session.volume.mean())
    relative_volume = float(last.volume) / comparable_mean if comparable_mean > 0 else 1.0

    # Baseline Hard Risk Check
    reasons = []
    if not (settings.min_price <= close <= settings.max_price):
        reasons.append(f"PRICE_OUT_OF_BOUNDS({close:.1f})")
    if spread_bps > settings.max_spread_bps:
        reasons.append(f"SPREAD_TOO_HIGH({spread_bps:.1f}bps)")
    if atr_pct < settings.min_intraday_atr_pct:
        reasons.append(f"ATR_TOO_LOW({atr_pct:.2f}%)")
    if market_bias == "UNSAFE":
        reasons.append("UNSAFE_MARKET_BIAS")

    # Upper / Lower Circuit Limit Protection
    upper_circuit = float(getattr(last, "upper_circuit_limit", getattr(last, "upper_circuit", 0.0)) or 0.0)
    lower_circuit = float(getattr(last, "lower_circuit_limit", getattr(last, "lower_circuit", 0.0)) or 0.0)
    if upper_circuit > 0 and (upper_circuit - close) / close <= 0.005:
        reasons.append("CIRCUIT_LIMIT_NEAR")
    if lower_circuit > 0 and (close - lower_circuit) / close <= 0.005:
        reasons.append("CIRCUIT_LIMIT_NEAR")

    vwap = float(last.vwap)
    side: TradeSide = "LONG" if close >= vwap else "SHORT"
    trend = classify_price_trend(session, now, settings.stale_seconds)

    # Determine Trade Thesis
    recent = session.tail(5)
    breakout_high = float(session.iloc[:-1].high.max()) if len(session) > 1 else float(last.high)
    breakout_low = float(session.iloc[:-1].low.min()) if len(session) > 1 else float(last.low)

    thesis: Thesis = "CONTINUATION"
    if side == "LONG" and close > breakout_high and relative_volume >= 1.35:
        thesis = "BREAKOUT"
    elif side == "SHORT" and close < breakout_low and relative_volume >= 1.35:
        thesis = "BREAKOUT"
    elif (side == "LONG" and float(last.low) <= float(last.bb_lower) and close > float(last.open)) or \
         (side == "SHORT" and float(last.high) >= float(last.bb_upper) and close < float(last.open)):
        thesis = "REVERSAL"
    else:
        thesis = "CONTINUATION"

    # Stop & Target Calculation
    min_stop_distance = max(0.5 * atr, close * 0.002)
    if side == "LONG":
        entry = round_to_tick(ask)
        calculated_stop = max(vwap - 0.25 * atr, entry - 1.5 * atr) if thesis == "CONTINUATION" else (entry - 1.2 * atr)
        stop = round_to_tick(min(calculated_stop, entry - min_stop_distance))
        risk = entry - stop
        target = round_to_tick(entry + risk * 2.0)
    else:
        entry = round_to_tick(bid)
        calculated_stop = min(vwap + 0.25 * atr, entry + 1.5 * atr) if thesis == "CONTINUATION" else (entry + 1.2 * atr)
        stop = round_to_tick(max(calculated_stop, entry + min_stop_distance))
        risk = stop - entry
        target = round_to_tick(entry - risk * 2.0)

    if risk <= 0:
        return None

    expected_r = (abs(target - entry) / risk) if risk > 0 else 0.0

    # 0-100 Weighted Opportunity Score
    score = 0.0
    # 1. Market Alignment (20 pts)
    if (side == "LONG" and market_bias in ("STRONGLY_POSITIVE", "POSITIVE")) or \
       (side == "SHORT" and market_bias in ("STRONGLY_NEGATIVE", "NEGATIVE")):
        score += 20.0
    elif market_bias == "MIXED":
        score += 12.0
    else:
        score += 5.0

    # 2. RVOL & Volume Acceleration (25 pts)
    if relative_volume >= 2.5: score += 25.0
    elif relative_volume >= 1.8: score += 20.0
    elif relative_volume >= 1.35: score += 15.0
    elif relative_volume >= 1.0: score += 10.0
    else: score += 5.0

    # 3. Setup Quality & Thesis Alignment (25 pts)
    if thesis == "BREAKOUT" and relative_volume >= 1.5: score += 25.0
    elif thesis == "CONTINUATION" and trend in ("BULLISH", "BEARISH"): score += 22.0
    elif thesis == "REVERSAL": score += 18.0
    else: score += 12.0

    # 4. VWAP Slope & Alignment (15 pts)
    vwap_slope = float(session.vwap.iloc[-1]) - float(session.vwap.iloc[-5]) if len(session) >= 5 else 0.0
    if (side == "LONG" and vwap_slope > 0) or (side == "SHORT" and vwap_slope < 0):
        score += 15.0
    else:
        score += 5.0

    # 5. Spread & Liquidity (15 pts)
    if spread_bps <= 4.0: score += 15.0
    elif spread_bps <= 8.0: score += 10.0
    else: score += 5.0

    # Status Determination
    status: Literal["TRADE", "WATCH", "AVOID"] = "AVOID"
    why_not = ""

    if reasons:
        status = "AVOID"
        why_not = ", ".join(reasons)
    elif score >= settings.min_opportunity_score and expected_r >= 1.5:
        status = "TRADE"
        why_not = "QUALIFIED_EXECUTABLE"
    elif score >= 40.0:
        status = "WATCH"
        why_not = f"SCORE_BELOW_THRESHOLD({score:.1f}<55.0)"
    else:
        status = "AVOID"
        why_not = f"LOW_SCORE({score:.1f})"

    expiry = now + timedelta(minutes=settings.signal_expiry_minutes)
    common = {
        "setupSource": "WEIGHTED_OPPORTUNITY_SCORE",
        "score": round(score, 1),
        "marketBias": market_bias,
        "thesis": thesis,
        "vwapPrice": round(vwap, 4),
        "atr": round(atr, 4),
        "relativeVolume": round(relative_volume, 3),
        "spreadBps": round(spread_bps, 3),
        "expectedR": round(expected_r, 2),
        "sessionReturnBps": round((close - float(session.iloc[0].open)) / float(session.iloc[0].open) * 10_000, 2),
        "momentumBps": round((close - float(recent.iloc[0].close)) / float(recent.iloc[0].close) * 10_000, 2),
    }

    candidate = Candidate(str(last.symbol), side, entry, stop, target, thesis, now, expiry, score, common) if status == "TRADE" else None

    return OpportunityEvaluation(
        symbol=str(last.symbol),
        side=side,
        thesis=thesis,
        score=score,
        expected_r=expected_r,
        entry=entry,
        stop=stop,
        target=target,
        status=status,
        why_not_executable=why_not,
        candidate=candidate,
    )


def scan_symbol(frame: pd.DataFrame, settings: Settings, now: datetime | None = None,
                frame_is_enriched: bool = False, regime: str = "MIXED",
                history_frame: pd.DataFrame | None = None) -> list[Candidate]:
    """Scans symbol and returns Candidate list if qualified."""
    eval_res = evaluate_opportunity(frame, settings, now, frame_is_enriched, regime, history_frame)
    if eval_res and eval_res.status == "TRADE" and eval_res.candidate:
        return [eval_res.candidate]
    return []


def active_agent(now: datetime) -> str | None:
    return EXECUTION_ENGINE_IDENTITY


def entry_score_threshold(now: datetime) -> int | None:
    return 55


def score_setup(candidate: Candidate, confirmations: dict[str, object]) -> int:
    return int(candidate.rank_score)


def _utc_datetime(value: object) -> datetime:
    parsed = pd.Timestamp(value).to_pydatetime()
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)
