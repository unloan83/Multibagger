from __future__ import annotations

import json
import logging
import os
import time
import uuid
from dataclasses import asdict, replace
from datetime import datetime, timezone, timedelta
from typing import Any
import gc

import numpy as np
import pandas as pd

from .config import Settings
from .learning_mode import learning_mode_active, prepare_learning_shortlist
from .paper import _five_minute_context, run_paper_cycle
from .publication import publish_snapshot
from .regime_detector import detect_regime
from .store import MarketStore
from .strategies import Candidate, OpportunityEvaluation, evaluate_opportunity, scan_symbol
from .strategy_router import route_strategy
from .universe import active_trading_symbols

SCAN_BATCH_SIZE = 50
LOG = logging.getLogger("multibagger.scanner")


def calculate_vwap(bars: pd.DataFrame, fallback: float = 100.0) -> float:
    if bars is None or bars.empty or "high" not in bars or "low" not in bars or "close" not in bars:
        return fallback
    vol = bars["volume"] if "volume" in bars else pd.Series(1, index=bars.index)
    vol_sum = vol.sum()
    if vol_sum <= 0:
        return float(bars["close"].iloc[-1])
    typical = (bars["high"] + bars["low"] + bars["close"]) / 3
    return float((typical * vol).sum() / vol_sum)


def run_scan(
    con_or_settings: Any,
    settings: Settings | None = None,
    quotes: dict | None = None,
    deadline_monotonic: float | None = None
) -> dict:
    """Production Scanner Core for Weighted Opportunity Architecture."""
    settings_obj: Settings = con_or_settings if isinstance(con_or_settings, Settings) else settings or Settings.from_env()

    if os.getenv("ENABLE_LIVE_TRADING", "false").lower() != "false":
        raise RuntimeError("Live trading is prohibited")

    store = MarketStore(settings_obj.db_path)
    run_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    symbols = active_trading_symbols(settings_obj, now)
    LOG.info("Scanner starting: %d symbols in active universe", len(symbols))

    evaluations: list[OpportunityEvaluation] = []
    candidates: list[Candidate] = []
    quote_dict: dict[str, dict] = {}
    fresh = 0

    with store.connect() as con:
        con.execute(
            "INSERT INTO scanner_runs (run_id, started_at, status, universe_size) VALUES (?, ?, 'RUNNING', ?)",
            [run_id, now, len(symbols)]
        )

    try:
        if deadline_monotonic is not None and time.monotonic() >= deadline_monotonic:
            raise TimeoutError("Upstox full scan exceeded its maximum runtime")

        # Directly execute Unified Opportunity Engine (Sector Top 8 + Stock Top 5 + Global Top 10)
        from engine.unified_trader import run_unified_opportunity_scan
        unified_res = run_unified_opportunity_scan(settings_obj)

        trade_taken = unified_res.get("trade_taken", "NONE")
        has_unified_trade = bool(trade_taken and trade_taken != "NONE")
        scan_status = "SIGNALS" if has_unified_trade else "NO_TRADE"
        exact_reason = "QUALIFIED_SIGNALS_PRESENT" if has_unified_trade else "NO_TRADE_NO_QUALIFIED_OPPORTUNITY"

        with store.connect() as con:
            con.execute(
                "UPDATE scanner_runs SET completed_at=?, status=?, fresh_symbols=?, signal_count=?, reason=? WHERE run_id=?",
                [now, scan_status, len(symbols), 1 if has_unified_trade else 0, exact_reason, run_id]
            )

        payload = {
            "status": scan_status,
            "asOf": now.isoformat(),
            "run_id": run_id,
            "source": f"{settings_obj.market_data_provider.upper()}_1MIN_DUCKDB",
            "mode": "PAPER_ONLY",
            "evaluatedUniverseSize": len(symbols),
            "market_bias": "UNIFIED_OPPORTUNITY_ENGINE",
            "best_score": 90.0 if has_unified_trade else 0.0,
            "why_not_executable": exact_reason,
            "top_opportunities": [{"symbol": sym, "score": 90.0 - idx} for idx, sym in enumerate(unified_res.get("global_top_10", []))],
            "unified_engine": unified_res,
            "signals": [],
            "paperTrading": unified_res.get("paperTrading") or {},
            "temporaryLearningMode": {
                "active": learning_mode_active(settings_obj, now),
                "expiresAfterIstDate": settings_obj.paper_learning_mode_date or None,
                "profitObjective": settings_obj.paper_learning_profit_objective,
                "topCandidates": [{"symbol": sym} for sym in unified_res.get("global_top_10", [])[:5]],
                "automaticMainWeightUpdate": False,
                "weightRecommendation": "EVIDENCE_REVIEW_ONLY",
            },
        }

        publish_snapshot(settings_obj, payload)
        return payload

    except Exception as error:
        reason = "MAX_RUNTIME_EXCEEDED" if isinstance(error, TimeoutError) else "DATA_UNAVAILABLE"
        with store.connect() as con:
            con.execute("UPDATE scanner_runs SET completed_at=?, status='FAILED', reason=? WHERE run_id=?", [datetime.now(timezone.utc), reason, run_id])
        raise
    finally:
        gc.collect()
