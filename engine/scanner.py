from __future__ import annotations

import json
import logging
import os
import time
import uuid
from dataclasses import asdict, replace
from datetime import datetime, timezone

from .config import Settings
from .paper import run_paper_cycle
from .publication import publish_snapshot
from .regime_detector import evaluate_regime_15m
from .store import MarketStore
from .strategies import (Candidate, Trend, classify_price_trend, enrich, entry_score_threshold,
                         scan_symbol, score_setup)
from .universe import active_trading_symbols


SCAN_BATCH_SIZE = 50
LOG = logging.getLogger("multibagger.scanner")


def run_scan(settings: Settings, deadline_monotonic: float | None = None) -> dict:
    if os.getenv("ENABLE_LIVE_TRADING", "false").lower() != "false":
        raise RuntimeError("Live trading is prohibited")
    store = MarketStore(settings.db_path)
    run_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    symbols = active_trading_symbols(settings, now)
    candidates: list[Candidate] = []
    symbol_trends: dict[str, Trend] = {}
    enriched_frames: dict[str, object] = {}
    universe_rows = json.loads(settings.universe_path.read_text())
    themes = {str(row.get("symbol") or ""): str(row.get("theme") or "UNCLASSIFIED") for row in universe_rows}
    quotes: dict[str, dict] = {}
    fresh = 0
    with store.connect() as con:
        con.execute("INSERT INTO scanner_runs (run_id, started_at, status, universe_size) VALUES (?, ?, 'RUNNING', ?)", [run_id, now, len(symbols)])
    try:
        if deadline_monotonic is not None and time.monotonic() >= deadline_monotonic:
            raise TimeoutError("Upstox full scan exceeded its maximum runtime")
        for offset in range(0, len(symbols), SCAN_BATCH_SIZE):
            if deadline_monotonic is not None and time.monotonic() >= deadline_monotonic:
                raise TimeoutError("Upstox full scan exceeded its maximum runtime")
            batch = symbols[offset:offset + SCAN_BATCH_SIZE]
            frames = store.bars_for_symbols(batch)
            grouped = {symbol: frame.reset_index(drop=True) for symbol, frame in frames.groupby("symbol")} if not frames.empty else {}
            empty = frames.iloc[0:0]
            for symbol in batch:
                frame = grouped.get(symbol, empty)
                fresh_frame = False
                if len(frame):
                    last = frame.iloc[-1]
                    bar_time = last.ts.to_pydatetime() if hasattr(last.ts, "to_pydatetime") else last.ts
                    if bar_time.tzinfo is None:
                        bar_time = bar_time.replace(tzinfo=timezone.utc)
                    age = (now - bar_time.astimezone(timezone.utc)).total_seconds()
                    if 0 <= age <= settings.stale_seconds:
                        fresh_frame = True
                        fresh += 1
                        bid, ask = float(last.bid or 0), float(last.ask or 0)
                        if bid > 0 and ask > bid:
                            quotes[symbol] = {
                                "bid": bid, "ask": ask, "ts": bar_time,
                                "received_at": last.received_at,
                                "instrument_key": str(last.instrument_key),
                            }
                if fresh_frame and len(frame) >= 16:
                    enriched = enrich(frame)
                    enriched_frames[symbol] = enriched
                    symbol_trends[symbol] = classify_price_trend(enriched, now, settings.stale_seconds)

        nifty_frame = store.bars(settings.market_index_symbol)
        vix_frame = store.bars(settings.vix_symbol)
        advances = symbol_trends.values().count("BULLISH") if hasattr(symbol_trends.values(), "count") else sum(1 for value in symbol_trends.values() if value == "BULLISH")
        declines = sum(1 for value in symbol_trends.values() if value == "BEARISH")
        breadth_ratio = advances / max(declines, 1) if advances or declines else None
        regime, regime_day_locked, regime_changed_adverse = evaluate_regime_15m(
            store, nifty_frame, vix_frame, breadth_ratio, settings, now,
        )
        skip_reasons = list(regime.skip_reasons)
        if regime_day_locked:
            skip_reasons.append("MIDSESSION_ADVERSE_REGIME_DAY_LOCK")
        for quote in quotes.values():
            quote["regime_adverse"] = regime_changed_adverse or regime_day_locked
        with store.connect() as con:
            losses = con.execute("""
              SELECT net_pnl FROM paper_trades
              WHERE trading_day=CAST(? AT TIME ZONE 'Asia/Kolkata' AS DATE) AND status='CLOSED'
              ORDER BY closed_at DESC LIMIT ?
            """, [now, settings.paper_consecutive_loss_limit]).fetchall()
        if len(losses) >= settings.paper_consecutive_loss_limit and all(float(row[0]) <= 0 for row in losses):
            skip_reasons.append("TWO_CONSECUTIVE_LOSSES")
        if not symbols:
            skip_reasons.append("DAILY_250_STOCK_UNIVERSE_UNAVAILABLE")
        if skip_reasons:
            for reason in dict.fromkeys(skip_reasons):
                LOG.info("no_trade_skip=%s", reason)
        else:
            for symbol, enriched in enriched_frames.items():
                candidates.extend(scan_symbol(enriched, settings, now, frame_is_enriched=True, regime=regime.regime))
        market_trend = classify_price_trend(nifty_frame, now, settings.stale_seconds)
        sector_trends: dict[str, Trend] = {}
        sector_strengths: dict[tuple[str, Trend], float] = {}
        for theme in set(themes.values()):
            votes = [symbol_trends[symbol] for symbol in symbol_trends if themes.get(symbol) == theme]
            sector_trends[theme] = _classify_breadth(votes)
            for direction in ("BULLISH", "BEARISH", "RANGE"):
                sector_strengths[(theme, direction)] = votes.count(direction) / len(votes) if votes else 0.0
        top_sectors = {
            direction: {theme for theme, _ in sorted(
                ((theme, sector_strengths[(theme, direction)]) for theme in set(themes.values())),
                key=lambda item: item[1], reverse=True,
            )[:3]}
            for direction in ("BULLISH", "BEARISH", "RANGE")
        }
        confirmed_candidates: list[Candidate] = []
        threshold = entry_score_threshold(now)
        for candidate in candidates:
            theme = themes.get(candidate.symbol, "UNCLASSIFIED")
            sector_trend = sector_trends.get(theme, "RANGE")
            required_trend = "BULLISH" if candidate.side == "LONG" else "BEARISH"
            range_setup = candidate.strategy == "RANGE_MEAN_REVERSION"
            confirmations = {
                **candidate.confirmations,
                "marketDirection": market_trend == required_trend if not range_setup else market_trend == "RANGE",
                "sectorDirection": sector_trend == required_trend if not range_setup else sector_trend == "RANGE",
                "marketTrend": market_trend,
                "sectorTrend": sector_trend,
                "sector": theme,
                "sectorTop3": theme in top_sectors["RANGE" if range_setup else required_trend],
                "niftyStronglyAligned": not range_setup and market_trend == required_trend and regime.regime == "TRENDING",
            }
            score = score_setup(candidate, confirmations)
            LOG.info("setup_score symbol=%s side=%s score=%d threshold=%s", candidate.symbol,
                     candidate.side, score, threshold if threshold is not None else "BLOCKED")
            if (threshold is not None and score >= threshold and confirmations["marketDirection"]
                    and confirmations["sectorDirection"]):
                confirmed_candidates.append(replace(candidate, rank_score=score, confirmations={**confirmations, "setupScore": score}))
        candidates = confirmed_candidates
        candidates.sort(key=lambda item: item.rank_score, reverse=True)
        candidates = candidates[:1]
        if threshold is None:
            skip_reasons.append("TIME_OF_DAY_ENTRY_BLOCK")
        with store.connect() as con:
            con.execute("UPDATE paper_signals SET status='EXPIRED_UNEXECUTED' WHERE status='OPEN' AND expiry < ?", [now])
            for item in candidates:
                con.execute("""INSERT INTO paper_signals
                  (run_id,symbol,side,entry,stop,target,strategy,timestamp,expiry,rank_score,status)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')""", [
                    run_id, item.symbol, item.side, item.entry, item.stop, item.target, item.strategy,
                    item.timestamp, item.expiry, item.rank_score,
                ])
        paper = run_paper_cycle(store, settings, candidates, quotes, now, run_id)
        with store.connect() as con:
            reason = None if candidates else (skip_reasons[0] if skip_reasons else "NO_VALID_SETUP")
            con.execute("UPDATE scanner_runs SET completed_at=?, status=?, fresh_symbols=?, signal_count=?, reason=? WHERE run_id=?", [now, "SIGNALS" if candidates else "NO_TRADE", fresh, len(candidates), reason, run_id])
        payload = {
            "status": "SIGNALS" if candidates else "NO_TRADE", "asOf": now.isoformat(), "run_id": run_id,
            "source": f"{settings.market_data_provider.upper()}_1MIN_DUCKDB", "mode": "PAPER_ONLY", "evaluatedUniverseSize": len(symbols),
            "reason": None if candidates else (skip_reasons[0] if skip_reasons else "NO_VALID_SETUP"),
            "regime": regime.to_dict(),
            "signals": [{**asdict(item), "run_id": run_id, "timestamp": item.timestamp.isoformat(), "expiry": item.expiry.isoformat()} for item in candidates],
            "paperTrading": paper,
        }
        publish_snapshot(settings, payload)
        return payload
    except Exception as error:
        reason = "MAX_RUNTIME_EXCEEDED" if isinstance(error, TimeoutError) else "DATA_UNAVAILABLE"
        with store.connect() as con:
            con.execute("UPDATE scanner_runs SET completed_at=?, status='FAILED', reason=? WHERE run_id=?", [datetime.now(timezone.utc), reason, run_id])
        raise


def _classify_breadth(votes: list[Trend]) -> Trend:
    if len(votes) < 3:
        return "RANGE"
    bullish = votes.count("BULLISH") / len(votes)
    bearish = votes.count("BEARISH") / len(votes)
    if bullish >= 0.55 and bullish - bearish >= 0.10:
        return "BULLISH"
    if bearish >= 0.55 and bearish - bullish >= 0.10:
        return "BEARISH"
    return "RANGE"
