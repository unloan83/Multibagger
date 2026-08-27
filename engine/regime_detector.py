from __future__ import annotations

import json
import logging
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo

import pandas as pd
import math
from ta.trend import ADXIndicator
from ta.volatility import AverageTrueRange

from .config import Settings


LOG = logging.getLogger("multibagger.regime")
IST = ZoneInfo("Asia/Kolkata")
Regime = Literal["TRENDING", "RANGE", "HIGH_VOL", "TRANSITION"]
MarketGateState = Literal["NORMAL", "REDUCED", "NO_TRADE"]


@dataclass(frozen=True)
class RegimeDetection:
    regime: Regime
    adx: float | None
    vix: float | None
    atr_pct: float | None
    advance_decline_ratio: float | None
    opening_gap_pct: float | None
    event_labels: tuple[str, ...]
    skip_reasons: tuple[str, ...]
    as_of: str

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class MarketGate:
    regime: MarketGateState
    opening_range_pct: float | None
    vwap_slope_bps: float | None
    breadth_ratio: float | None
    realized_volatility_pct: float | None
    vix: float | None
    skip_reasons: tuple[str, ...]
    as_of: str

    def to_dict(self) -> dict:
        return asdict(self)


def detect_opening_market_gate(index_frame: pd.DataFrame, vix_frame: pd.DataFrame,
                                breadth_ratio: float | None, settings: Settings,
                                now: datetime) -> MarketGate:
    """Classify the 09:15-09:30 IST opening tape once its 15 bars are complete."""
    local = now.astimezone(IST)
    index_session = _current_session(index_frame)
    vix_session = _current_session(vix_frame)
    opening = index_session.iloc[:15]
    opening_vix = vix_session.iloc[:15]
    missing = (
        local.hour * 60 + local.minute < 9 * 60 + 30 or len(opening) < 15 or
        _session_day(index_session) != local.date()
    )
    if missing:
        return MarketGate("NO_TRADE", None, None, _round(breadth_ratio), None, None,
                          ("REGIME_INPUT_UNAVAILABLE",), now.isoformat())

    first_open = float(opening.open.iloc[0])
    opening_range = (float(opening.high.max()) - float(opening.low.min())) / first_open * 100
    typical = (opening.high + opening.low + opening.close) / 3
    cumulative_volume = opening.volume.cumsum().replace(0, float("nan"))
    vwap = (typical * opening.volume).cumsum() / cumulative_volume
    slope_bps = (float(vwap.iloc[-1]) - float(vwap.iloc[4])) / first_open * 10_000
    returns = opening.close.pct_change().dropna()
    realized_vol = float(returns.std(ddof=0) * math.sqrt(len(returns)) * 100) if len(returns) else 0.0
    vix = float(opening_vix.close.iloc[-1]) if len(opening_vix) > 0 else 15.0
    effective_breadth = breadth_ratio if (breadth_ratio is not None and math.isfinite(breadth_ratio)) else 1.0

    # Low VIX and a narrow opening range are caution inputs, never lone kill switches.
    caution = sum((
        opening_range < 0.4,
        abs(slope_bps) < 2.0,
        0.8 <= float(effective_breadth) <= 1.25,
        realized_vol < 0.12,
        vix < 11,
    ))
    extreme = sum((
        opening_range > 1.5,
        realized_vol > 1.0,
        vix > 25,
        float(effective_breadth) > 4 or float(effective_breadth) < 0.25,
    ))
    if extreme >= 2:
        regime: MarketGateState = "NO_TRADE"
        reasons = ("OPENING_MARKET_CONDITIONS_EXTREME",)
    elif extreme == 1 or caution >= 2:
        regime = "REDUCED"
        reasons = ()
    else:
        regime = "NORMAL"
        reasons = ()
    return MarketGate(regime, _round(opening_range), _round(slope_bps), _round(effective_breadth),
                      _round(realized_vol), _round(vix), reasons, now.isoformat())


Regime = Literal[
    "STRONGLY_POSITIVE", "POSITIVE", "MIXED",
    "NEGATIVE", "STRONGLY_NEGATIVE", "UNSAFE",
    "TRENDING", "RANGE", "HIGH_VOL", "TRANSITION"
]


def detect_regime(index_frame: pd.DataFrame, vix_frame: pd.DataFrame,
                  advance_decline_ratio: float | None, settings: Settings,
                  now: datetime, stocks_above_vwap_pct: float | None = None) -> RegimeDetection:
    """Multi-factor Market Context Evaluator. Index direction alone does not dictate market bias."""
    index_session = _current_session(index_frame)
    vix_session = _current_session(vix_frame)
    adx = atr_pct = gap = None
    current_day = now.astimezone(IST).date()
    index_fresh = not index_frame.empty and _session_day(index_session) == current_day and _fresh(index_session, now, settings.stale_seconds * 3)
    vix_fresh = not vix_frame.empty and _session_day(vix_session) == current_day and _fresh(vix_session, now, settings.stale_seconds * 3)
    
    reasons: list[str] = []
    
    if not index_session.empty and len(index_session) >= 14:
        typical = (index_session.high + index_session.low + index_session.close) / 3
        cum_vol = index_session.volume.cumsum().replace(0, float("nan"))
        cum_val = (typical * index_session.volume).cumsum()
        vwap_series = (cum_val / cum_vol).fillna(index_session.close)
        first_open = float(index_session.open.iloc[0])
        last_close = float(index_session.close.iloc[-1])
        index_ret_pct = (last_close - first_open) / first_open * 100 if first_open > 0 else 0.0
        index_above_vwap = last_close >= float(vwap_series.iloc[-1])
    else:
        index_ret_pct = 0.0
        index_above_vwap = True

    vix = float(vix_session.close.iloc[-1]) if (not vix_session.empty and vix_fresh) else 15.0
    event_labels = tuple(_event_labels(settings, now))

    effective_ad = advance_decline_ratio if (advance_decline_ratio is not None and math.isfinite(advance_decline_ratio)) else 1.0
    effective_vwap_pct = stocks_above_vwap_pct if (stocks_above_vwap_pct is not None and math.isfinite(stocks_above_vwap_pct)) else 50.0

    # Multi-Factor Score Calculation (-10 to +10)
    score = 0.0
    # 1. NIFTY Return (-3 to +3)
    if index_ret_pct >= 0.5: score += 3.0
    elif index_ret_pct >= 0.2: score += 2.0
    elif index_ret_pct >= 0.05: score += 1.0
    elif index_ret_pct <= -0.5: score -= 3.0
    elif index_ret_pct <= -0.2: score -= 2.0
    elif index_ret_pct <= -0.05: score -= 1.0

    # 2. Advance-Decline Breadth (-3 to +3)
    if effective_ad >= 2.5: score += 3.0
    elif effective_ad >= 1.5: score += 2.0
    elif effective_ad >= 1.1: score += 1.0
    elif effective_ad <= 0.4: score -= 3.0
    elif effective_ad <= 0.67: score -= 2.0
    elif effective_ad <= 0.9: score -= 1.0

    # 3. Stocks Above VWAP Participation (-2 to +2)
    if effective_vwap_pct >= 70.0: score += 2.0
    elif effective_vwap_pct >= 55.0: score += 1.0
    elif effective_vwap_pct <= 30.0: score -= 2.0
    elif effective_vwap_pct <= 45.0: score -= 1.0

    # 4. NIFTY Above VWAP (+1 / -1)
    if index_above_vwap: score += 1.0
    else: score -= 1.0

    # Market Bias Classification
    if vix > 30.0:
        regime: Regime = "UNSAFE"
        reasons.append("VIX_EXTREME_UNSAFE")
    elif score >= 5.0:
        regime = "STRONGLY_POSITIVE"
    elif score >= 2.0:
        regime = "POSITIVE"
    elif score <= -5.0:
        regime = "STRONGLY_NEGATIVE"
    elif score <= -2.0:
        regime = "NEGATIVE"
    else:
        regime = "MIXED"

    result = RegimeDetection(
        regime, _round(20.0), _round(vix), _round(1.0),
        _round(effective_ad), _round(gap), event_labels,
        tuple(dict.fromkeys(reasons)), now.isoformat(),
    )

    LOG.info("Regime inputs: VIX=%s, A/D=%s, Classification=%s",
             _round(vix), _round(effective_ad), regime)
    return result




def evaluate_regime_15m(store, index_frame: pd.DataFrame, vix_frame: pd.DataFrame,
                        advance_decline_ratio: float | None, settings: Settings,
                        now: datetime) -> tuple[RegimeDetection, bool, bool]:
    """Evaluate once per IST quarter-hour and persist any adverse intraday lock."""
    local = now.astimezone(IST)
    slot = local.replace(minute=(local.minute // 15) * 15, second=0, microsecond=0)
    trading_day = local.date()
    with store.connect() as con:
        row = con.execute("""
          SELECT regime,details_json,adverse_day_lock,slot_at FROM regime_evaluations
          WHERE trading_day=? ORDER BY evaluated_at DESC LIMIT 1
        """, [trading_day]).fetchone()
    if row and row[3] >= slot:
        payload = json.loads(row[1])
        payload["event_labels"] = tuple(payload.get("event_labels") or ())
        payload["skip_reasons"] = tuple(payload.get("skip_reasons") or ())
        return RegimeDetection(**payload), bool(row[2]), False

    result = detect_regime(index_frame, vix_frame, advance_decline_ratio, settings, now)
    previous = str(row[0]) if row else None
    changed_adverse = previous in ("TRENDING", "RANGE") and result.regime in ("HIGH_VOL", "TRANSITION")
    day_locked = bool(row[2]) if row else False
    day_locked = day_locked or changed_adverse
    with store.connect() as con:
        con.execute("INSERT INTO regime_evaluations VALUES (?, ?, ?, ?, ?, ?, ?)", [
            str(uuid.uuid4()), trading_day, now, slot, result.regime,
            json.dumps(result.to_dict(), sort_keys=True), day_locked,
        ])
    LOG.info("regime_reevaluation slot=%s previous=%s current=%s adverse_day_lock=%s",
             slot.isoformat(), previous, result.regime, day_locked)
    if previous is not None and previous != result.regime:
        LOG.warning("regime_state_change previous=%s current=%s slot=%s", previous, result.regime, slot.isoformat())
    return result, day_locked, changed_adverse


def _current_session(frame: pd.DataFrame) -> pd.DataFrame:
    if frame.empty:
        return frame
    result = frame.copy().sort_values("ts")
    sessions = pd.to_datetime(result.ts, utc=True).dt.tz_convert(IST).dt.date
    return result[sessions == sessions.iloc[-1]].reset_index(drop=True)


def _fifteen_minute_candles(frame: pd.DataFrame) -> pd.DataFrame:
    if frame.empty:
        return frame
    df = frame.copy().sort_values("ts")
    df["ts"] = pd.to_datetime(df.ts, utc=True)
    df["session"] = df.ts.dt.tz_convert(IST).dt.date
    pieces = []
    for _, session in df.groupby("session"):
        candles = session.set_index("ts").resample("15min", origin="start_day", offset="15min").agg(
            open=("open", "first"), high=("high", "max"), low=("low", "min"), close=("close", "last"),
        ).dropna()
        pieces.append(candles.reset_index())
    return pd.concat(pieces, ignore_index=True).sort_values("ts") if pieces else df.iloc[0:0]


def _prior_session(frame: pd.DataFrame, current: pd.DataFrame) -> pd.DataFrame:
    if frame.empty or current.empty:
        return frame.iloc[0:0]
    current_day = pd.to_datetime(current.ts, utc=True).dt.tz_convert(IST).dt.date.iloc[-1]
    sessions = pd.to_datetime(frame.ts, utc=True).dt.tz_convert(IST).dt.date
    prior_days = sorted(set(sessions[sessions < current_day]))
    return frame[sessions == prior_days[-1]] if prior_days else frame.iloc[0:0]


def _session_day(frame: pd.DataFrame):
    return pd.to_datetime(frame.ts.iloc[-1], utc=True).tz_convert(IST).date() if len(frame) else None


def _fresh(frame: pd.DataFrame, now: datetime, stale_seconds: int) -> bool:
    if frame.empty:
        return False
    timestamp = pd.to_datetime(frame.ts.iloc[-1], utc=True).to_pydatetime()
    return 0 <= (now - timestamp).total_seconds() <= stale_seconds * 3


def _event_labels(settings: Settings, now: datetime) -> list[str]:
    try:
        payload = json.loads(settings.no_trade_events_path.read_text())
    except (OSError, json.JSONDecodeError):
        LOG.error("no_trade_event_calendar_unavailable path=%s", settings.no_trade_events_path)
        return ["EVENT_CALENDAR_UNAVAILABLE"]
    today = now.astimezone(IST).date().isoformat()
    labels = [str(item.get("type") or "EVENT") for item in payload.get("events", []) if item.get("date") == today]
    expiry_weekday = payload.get("weeklyExpiryWeekday")
    if isinstance(expiry_weekday, int) and now.astimezone(IST).weekday() == expiry_weekday:
        labels.append("NIFTY_EXPIRY")
    return list(dict.fromkeys(labels))


def _round(value: float | None) -> float | None:
    return round(value, 4) if value is not None and math.isfinite(value) else None
