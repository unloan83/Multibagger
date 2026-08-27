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

        # 1. Fetch Market Context & Pre-calc Breadth
        nifty_frame = store.bars(settings_obj.market_index_symbol, through=now)
        vix_frame = store.bars(settings_obj.vix_symbol, through=now)

        # Batch load bars for universe symbols
        for offset in range(0, len(symbols), SCAN_BATCH_SIZE):
            if deadline_monotonic is not None and time.monotonic() >= deadline_monotonic:
                raise TimeoutError("Upstox full scan exceeded its maximum runtime")
            batch = symbols[offset:offset + SCAN_BATCH_SIZE]
            frames = store.bars_for_symbols(batch, through=now)
            grouped = {symbol: frame.reset_index(drop=True) for symbol, frame in frames.groupby("symbol")} if not frames.empty else {}
            empty = frames.iloc[0:0]

            for symbol in batch:
                frame = grouped.get(symbol, empty)
                if len(frame):
                    last = frame.iloc[-1]
                    bar_time = last.ts.to_pydatetime() if hasattr(last.ts, "to_pydatetime") else last.ts
                    if bar_time.tzinfo is None:
                        bar_time = bar_time.replace(tzinfo=timezone.utc)
                    age = (now - bar_time.astimezone(timezone.utc)).total_seconds()
                    if 0 <= age <= settings_obj.stale_seconds * 3:
                        fresh += 1
                        bid, ask = float(last.bid or 0), float(last.ask or 0)
                        ltp_val = float(last.close if last.close else (bid + ask) / 2 if (bid and ask) else 100.0)
                        open_val = float(last.open if last.open else ltp_val)
                        if ltp_val > 0:
                            quote_dict[symbol] = {
                                "bid": bid, "ask": ask, "ts": bar_time, "ltp": ltp_val, "open": open_val,
                                "volume": int(last.volume if hasattr(last, "volume") else 0),
                                "received_at": last.received_at, "instrument_key": str(last.instrument_key),
                                "completed_candle": bar_time < now.replace(second=0, microsecond=0),
                            }
                
                # Evaluate Opportunity
                if len(frame) >= 15:
                    op_eval = evaluate_opportunity(frame, settings_obj, now, market_bias="MIXED", history_frame=frame)
                    if op_eval:
                        evaluations.append(op_eval)
                        if op_eval.status == "TRADE" and op_eval.candidate:
                            candidates.append(op_eval.candidate)

        # 2. Multi-Factor Market Bias Evaluation
        stocks_above_vwap = sum(1 for e in evaluations if e.entry >= e.stop)
        stocks_vwap_pct = (stocks_above_vwap / max(len(evaluations), 1)) * 100
        regime = detect_regime(nifty_frame, vix_frame, 1.0, settings_obj, now, stocks_vwap_pct)
        route = route_strategy(regime.regime, ())

        # Rank Top Leaders & Top Laggards
        evaluations.sort(key=lambda e: e.score, reverse=True)
        top_leaders = [e.to_dict() for e in evaluations[:10]]
        top_laggards = [e.to_dict() for e in evaluations[-10:] if e not in evaluations[:10]]

        best_score = evaluations[0].score if evaluations else 0.0
        why_not_executable = evaluations[0].why_not_executable if evaluations else "NO_SYMBOL_EVALUATED"

        # Determine Scan Execution Status
        if not candidates:
            if best_score < settings_obj.min_opportunity_score:
                exact_reason = f"SCORE_BELOW_THRESHOLD(Best: {best_score:.1f} < {settings_obj.min_opportunity_score:.1f})"
            else:
                exact_reason = why_not_executable
        else:
            exact_reason = "QUALIFIED_SIGNALS_PRESENT"

        LOG.info("SCANNER OUTPUT | MARKET BIAS: %s | EVALUATED: %d | BEST SCORE: %.1f | STATUS: %s",
                 regime.regime, len(evaluations), best_score, exact_reason)

        # Sort & Rank Executable Candidates
        candidates.sort(key=lambda c: c.rank_score, reverse=True)
        candidates = candidates[:1]  # Select top scoring candidate for paper execution

        with store.connect() as con:
            con.execute("UPDATE paper_signals SET status='EXPIRED_UNEXECUTED' WHERE status='OPEN' AND expiry < ?", [now])
            for item in candidates:
                con.execute("""INSERT INTO paper_signals
                  (run_id,symbol,side,entry,stop,target,strategy,timestamp,expiry,rank_score,status)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')""", [
                    run_id, item.symbol, item.side, item.entry, item.stop, item.target, item.strategy,
                    item.timestamp, item.expiry, item.rank_score,
                ])

        paper = run_paper_cycle(store, settings_obj, candidates, quote_dict, now, run_id)

        with store.connect() as con:
            con.execute(
                "UPDATE scanner_runs SET completed_at=?, status=?, fresh_symbols=?, signal_count=?, reason=? WHERE run_id=?",
                [now, "SIGNALS" if candidates else "NO_TRADE", fresh, len(candidates), exact_reason, run_id]
            )

        payload = {
            "status": "SIGNALS" if candidates else "NO_TRADE",
            "asOf": now.isoformat(),
            "run_id": run_id,
            "source": f"{settings_obj.market_data_provider.upper()}_1MIN_DUCKDB",
            "mode": "PAPER_ONLY",
            "evaluatedUniverseSize": len(symbols),
            "market_bias": regime.regime,
            "best_score": round(best_score, 1),
            "why_not_executable": exact_reason,
            "top_opportunities": top_leaders + top_laggards,
            "signals": [{**asdict(item), "run_id": run_id, "timestamp": item.timestamp.isoformat(), "expiry": item.expiry.isoformat()} for item in candidates],
            "paperTrading": paper,
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
