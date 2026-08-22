from __future__ import annotations

import json
import logging
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


def detect_regime(index_frame: pd.DataFrame, vix_frame: pd.DataFrame,
                  advance_decline_ratio: float | None, settings: Settings,
                  now: datetime) -> RegimeDetection:
    index_session = _current_session(index_frame)
    vix_session = _current_session(vix_frame)
    adx = atr_pct = gap = None
    current_day = now.astimezone(IST).date()
    index_fresh = _session_day(index_session) == current_day and _fresh(index_session, now, settings.stale_seconds)
    vix_fresh = _session_day(vix_session) == current_day and _fresh(vix_session, now, settings.stale_seconds)
    if len(index_session) >= 28 and index_fresh:
        adx = float(ADXIndicator(index_session.high, index_session.low, index_session.close, window=14).adx().iloc[-1])
        atr = float(AverageTrueRange(index_session.high, index_session.low, index_session.close, window=14).average_true_range().iloc[-1])
        atr_pct = atr / float(index_session.close.iloc[-1]) * 100
        prior = _prior_session(index_frame, index_session)
        if len(prior):
            gap = (float(index_session.open.iloc[0]) - float(prior.close.iloc[-1])) / float(prior.close.iloc[-1]) * 100
    vix = float(vix_session.close.iloc[-1]) if len(vix_session) and vix_fresh else None
    event_labels = tuple(_event_labels(settings, now))
    reasons: list[str] = []

    if adx is None or vix is None or atr_pct is None or advance_decline_ratio is None:
        regime: Regime = "TRANSITION"
        reasons.append("REGIME_INPUT_UNAVAILABLE")
    elif vix > settings.vix_max_level or atr_pct >= settings.regime_high_vol_atr_pct:
        regime = "HIGH_VOL"
    elif adx >= settings.regime_adx_trending and (
        advance_decline_ratio >= 1.5 or advance_decline_ratio <= 1 / 1.5
    ):
        regime = "TRENDING"
    elif adx <= settings.regime_adx_range and 0.75 <= advance_decline_ratio <= 1.33:
        regime = "RANGE"
    else:
        regime = "TRANSITION"

    if regime in ("HIGH_VOL", "TRANSITION"):
        reasons.append(f"REGIME_{regime}")
    if vix is not None and vix > settings.vix_max_level:
        reasons.append("VIX_ABOVE_20")
    if gap is not None and abs(gap) > settings.max_opening_gap_pct:
        reasons.append("OPENING_GAP_ABOVE_1_5_PERCENT")
    if event_labels:
        reasons.append("SCHEDULED_EVENT_DAY")

    result = RegimeDetection(
        regime, _round(adx), _round(vix), _round(atr_pct),
        _round(advance_decline_ratio), _round(gap), event_labels,
        tuple(dict.fromkeys(reasons)), now.isoformat(),
    )
    LOG.info("regime_detection=%s", json.dumps(result.to_dict(), sort_keys=True))
    for reason in result.skip_reasons:
        LOG.info("no_trade_skip=%s regime=%s", reason, regime)
    return result


def _current_session(frame: pd.DataFrame) -> pd.DataFrame:
    if frame.empty:
        return frame
    result = frame.copy().sort_values("ts")
    sessions = pd.to_datetime(result.ts, utc=True).dt.tz_convert(IST).dt.date
    return result[sessions == sessions.iloc[-1]].reset_index(drop=True)


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
