from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd

from .config import Settings
from .strategies import Candidate, OpportunityEvaluation


IST = ZoneInfo("Asia/Kolkata")


def learning_mode_active(settings: Settings, now: datetime) -> bool:
    """The challenger expires automatically outside its configured IST trading date."""
    return bool(
        settings.paper_learning_mode_date
        and settings.paper_learning_mode_date == now.astimezone(IST).date().isoformat()
    )


def prepare_learning_shortlist(
    evaluations: list[OpportunityEvaluation],
    nifty_frame: pd.DataFrame,
    settings: Settings,
    now: datetime,
) -> tuple[list[dict[str, Any]], list[Candidate]]:
    """Rank observed setups and translate qualified price/volume evidence for paper execution."""
    if not learning_mode_active(settings, now):
        executable = [item.candidate for item in evaluations if item.status == "TRADE" and item.candidate]
        return [], sorted(executable, key=lambda item: item.rank_score, reverse=True)

    nifty_return_bps = _session_return_bps(nifty_frame, now)
    ranked = sorted(evaluations, key=lambda item: item.score, reverse=True)
    shortlist: list[dict[str, Any]] = []
    executable: list[Candidate] = []

    for evaluation in ranked[: settings.paper_learning_shortlist_size]:
        original = evaluation.candidate
        factors = dict(original.confirmations) if original else {}
        relative_strength = float(factors.get("sessionReturnBps") or 0.0) - nifty_return_bps
        shortlist.append({
            **evaluation.to_dict(),
            "momentumBps": factors.get("momentumBps"),
            "relativeStrengthVsNiftyBps": round(relative_strength, 2),
            "relativeVolume": factors.get("relativeVolume"),
            "vwapAligned": _vwap_aligned(evaluation.side, evaluation.entry, factors.get("vwapPrice")),
            "spreadBps": factors.get("spreadBps"),
        })

    for evaluation in ranked:
        if evaluation.status != "TRADE" or not evaluation.candidate:
            continue
        candidate = evaluation.candidate
        confirmations = dict(candidate.confirmations)
        confirmations.update({
            # These are translations of evidence already required by the unified scorer,
            # not relaxed or secondary confirmations.
            "setupSource": "PRICE_VOLUME_ONLY",
            "vwap": _vwap_aligned(candidate.side, candidate.entry, confirmations.get("vwapPrice")),
            "strategyQualified": True,
            "riskReward": float(confirmations.get("expectedR") or 0.0) >= settings.learning_confirmation_threshold,
            "learningMode": True,
            "learningModeDate": settings.paper_learning_mode_date,
            "learningObjectiveInr": settings.paper_learning_profit_objective,
            "relativeStrengthVsNiftyBps": round(
                float(confirmations.get("sessionReturnBps") or 0.0) - nifty_return_bps, 2
            ),
            "entryReason": "UNIFIED_PRICE_VOLUME_RANKING",
        })
        executable.append(replace(candidate, confirmations=confirmations))

    return shortlist, executable


def _session_return_bps(frame: pd.DataFrame, now: datetime) -> float:
    if frame is None or frame.empty or not {"ts", "open", "close"}.issubset(frame.columns):
        return 0.0
    timestamps = pd.to_datetime(frame.ts, utc=True)
    local_day = now.astimezone(IST).date()
    session = frame[timestamps.dt.tz_convert(IST).dt.date == local_day]
    if session.empty:
        return 0.0
    opening = float(session.iloc[0].open)
    return (float(session.iloc[-1].close) - opening) / opening * 10_000 if opening > 0 else 0.0


def _vwap_aligned(side: str, entry: float, vwap: object) -> bool:
    try:
        price = float(vwap)
    except (TypeError, ValueError):
        return False
    return entry >= price if side == "LONG" else entry <= price
