from __future__ import annotations

import json
import os
import urllib.request
import uuid
from dataclasses import asdict
from datetime import datetime, timezone

from .config import Settings
from .store import MarketStore
from .strategies import Candidate, scan_symbol


def run_scan(settings: Settings) -> dict:
    if os.getenv("ENABLE_LIVE_TRADING", "false").lower() != "false":
        raise RuntimeError("Live trading is prohibited")
    store = MarketStore(settings.db_path)
    run_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    symbols = settings.symbols()
    candidates: list[Candidate] = []
    fresh = 0
    with store.connect() as con:
        con.execute("INSERT INTO scanner_runs (run_id, started_at, status, universe_size) VALUES (?, ?, 'RUNNING', ?)", [run_id, now, len(symbols)])
    try:
        for symbol in symbols:
            frame = store.bars(symbol)
            found = scan_symbol(frame, settings, now)
            if len(frame) and found:
                fresh += 1
            candidates.extend(found)
        candidates.sort(key=lambda item: item.rank_score, reverse=True)
        with store.connect() as con:
            for item in candidates:
                con.execute("INSERT INTO paper_signals VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')", [
                    run_id, item.symbol, item.entry, item.stop, item.target, item.strategy,
                    item.timestamp, item.expiry, item.rank_score,
                ])
            reason = None if candidates else "NO_TRADE"
            con.execute("UPDATE scanner_runs SET completed_at=?, status=?, fresh_symbols=?, signal_count=?, reason=? WHERE run_id=?", [now, "SIGNALS" if candidates else "NO_TRADE", fresh, len(candidates), reason, run_id])
        payload = {
            "status": "SIGNALS" if candidates else "NO_TRADE", "asOf": now.isoformat(), "run_id": run_id,
            "source": f"{settings.market_data_provider.upper()}_1MIN_DUCKDB", "mode": "PAPER_ONLY", "evaluatedUniverseSize": len(symbols),
            "reason": None if candidates else "NO_TRADE", "signals": [{**asdict(item), "run_id": run_id, "timestamp": item.timestamp.isoformat(), "expiry": item.expiry.isoformat()} for item in candidates],
        }
        settings.snapshot_path.parent.mkdir(parents=True, exist_ok=True)
        settings.snapshot_path.write_text(json.dumps(payload, indent=2))
        publish_url = os.getenv("SIGNAL_INGEST_URL", "")
        publish_token = os.getenv("SIGNAL_INGEST_TOKEN", "")
        if publish_url:
            if not publish_token:
                raise RuntimeError("SIGNAL_INGEST_TOKEN is required when SIGNAL_INGEST_URL is set")
            request = urllib.request.Request(publish_url, data=json.dumps(payload).encode(), method="POST",
                headers={"Authorization": f"Bearer {publish_token}", "Content-Type": "application/json"})
            with urllib.request.urlopen(request, timeout=30) as response:
                if response.status >= 300:
                    raise RuntimeError(f"Signal publication failed with HTTP {response.status}")
        return payload
    except Exception:
        with store.connect() as con:
            con.execute("UPDATE scanner_runs SET completed_at=?, status='FAILED', reason='DATA_UNAVAILABLE' WHERE run_id=?", [datetime.now(timezone.utc), run_id])
        raise
