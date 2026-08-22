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
    fifteen_minute = _fifteen_minute_candles(index_frame)
    vix_session = _current_session(vix_frame)
    adx = atr_pct = gap = None
    current_day = now.astimezone(IST).date()
    index_fresh = _session_day(index_session) == current_day and _fresh(index_session, now, settings.stale_seconds)
    vix_fresh = _session_day(vix_session) == current_day and _fresh(vix_session, now, settings.stale_seconds)
    if len(fifteen_minute) >= 28 and index_fresh:
        adx = float(ADXIndicator(fifteen_minute.high, fifteen_minute.low, fifteen_minute.close, window=14).adx().iloc[-1])
        atr = float(AverageTrueRange(fifteen_minute.high, fifteen_minute.low, fifteen_minute.close, window=14).average_true_range().iloc[-1])
        atr_pct = atr / float(fifteen_minute.close.iloc[-1]) * 100
        prior = _prior_session(index_frame, index_session)
        if len(prior):
            gap = (float(index_session.open.iloc[0]) - float(prior.close.iloc[-1])) / float(prior.close.iloc[-1]) * 100
    vix = float(vix_session.close.iloc[-1]) if len(vix_session) and vix_fresh else None
    event_labels = tuple(_event_labels(settings, now))
    reasons: list[str] = []

    if vix is not None and vix > settings.vix_max_level:
        regime: Regime = "HIGH_VOL"
    elif adx is None or vix is None or atr_pct is None or advance_decline_ratio is None:
        regime: Regime = "TRANSITION"
        reasons.append("REGIME_INPUT_UNAVAILABLE")
    elif atr_pct >= settings.regime_high_vol_atr_pct:
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
