from __future__ import annotations

import json
import os
import time
import uuid
from collections import defaultdict
from dataclasses import asdict, replace
from datetime import datetime, timezone

from .config import Settings
from .paper import run_paper_cycle
from .publication import publish_snapshot
from .store import MarketStore
from .strategies import Candidate, enrich, scan_symbol


SCAN_BATCH_SIZE = 50


def run_scan(settings: Settings, deadline_monotonic: float | None = None) -> dict:
    if os.getenv("ENABLE_LIVE_TRADING", "false").lower() != "false":
        raise RuntimeError("Live trading is prohibited")
    store = MarketStore(settings.db_path)
    run_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    symbols = settings.symbols()
    candidates: list[Candidate] = []
    breadth_votes: list[bool] = []
    sector_votes: dict[str, list[bool]] = defaultdict(list)
    universe_rows = json.loads(settings.universe_path.read_text())
    themes = {str(row.get("symbol") or ""): str(row.get("theme") or "UNCLASSIFIED") for row in universe_rows}
    quotes: dict[str, dict] = {}
    fresh = 0
    with store.connect() as con:
        con.execute("INSERT INTO scanner_runs (run_id, started_at, status, universe_size) VALUES (?, ?, 'RUNNING', ?)", [run_id, now, len(symbols)])
    try:
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
                            quotes[symbol] = {"bid": bid, "ask": ask, "ts": bar_time, "instrument_key": str(last.instrument_key)}
                if fresh_frame and len(frame) >= 16:
                    enriched = enrich(frame)
                    candidates.extend(scan_symbol(enriched, settings, now, frame_is_enriched=True))
                    latest = enriched.iloc[-1]
                    recent = enriched.tail(5)
                    bullish = bool(
                        latest.close > latest.vwap
                        and latest.close > recent.close.mean()
                        and latest.close > recent.iloc[0].close
                    )
                    breadth_votes.append(bullish)
                    sector_votes[themes.get(symbol, "UNCLASSIFIED")].append(bullish)
        market_breadth = sum(breadth_votes) / len(breadth_votes) if breadth_votes else 0.0
        confirmed_candidates: list[Candidate] = []
        for candidate in candidates:
            theme = themes.get(candidate.symbol, "UNCLASSIFIED")
            votes = sector_votes.get(theme) or []
            sector_breadth = sum(votes) / len(votes) if votes else market_breadth
            confirmations = {
                **candidate.confirmations,
                "marketDirection": market_breadth >= 0.55,
                "sectorDirection": sector_breadth >= 0.55,
                "marketBreadth": round(market_breadth, 4),
                "sectorBreadth": round(sector_breadth, 4),
                "sector": theme,
            }
            confirmed_candidates.append(replace(candidate, confirmations=confirmations))
        candidates = confirmed_candidates
        candidates.sort(key=lambda item: item.rank_score, reverse=True)
        with store.connect() as con:
            con.execute("UPDATE paper_signals SET status='EXPIRED_UNEXECUTED' WHERE status='OPEN' AND expiry < ?", [now])
            for item in candidates:
                con.execute("INSERT INTO paper_signals VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')", [
                    run_id, item.symbol, item.entry, item.stop, item.target, item.strategy,
                    item.timestamp, item.expiry, item.rank_score,
                ])
        paper = run_paper_cycle(store, settings, candidates, quotes, now, run_id)
        with store.connect() as con:
            reason = None if candidates else "NO_TRADE"
            con.execute("UPDATE scanner_runs SET completed_at=?, status=?, fresh_symbols=?, signal_count=?, reason=? WHERE run_id=?", [now, "SIGNALS" if candidates else "NO_TRADE", fresh, len(candidates), reason, run_id])
        payload = {
            "status": "SIGNALS" if candidates else "NO_TRADE", "asOf": now.isoformat(), "run_id": run_id,
            "source": f"{settings.market_data_provider.upper()}_1MIN_DUCKDB", "mode": "PAPER_ONLY", "evaluatedUniverseSize": len(symbols),
            "reason": None if candidates else "NO_TRADE", "signals": [{**asdict(item), "run_id": run_id, "timestamp": item.timestamp.isoformat(), "expiry": item.expiry.isoformat()} for item in candidates],
            "paperTrading": paper,
        }
        publish_snapshot(settings, payload)
        return payload
    except Exception as error:
        reason = "MAX_RUNTIME_EXCEEDED" if isinstance(error, TimeoutError) else "DATA_UNAVAILABLE"
        with store.connect() as con:
            con.execute("UPDATE scanner_runs SET completed_at=?, status='FAILED', reason=? WHERE run_id=?", [datetime.now(timezone.utc), reason, run_id])
        raise
