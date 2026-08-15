from __future__ import annotations

import logging
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any

import pandas as pd

from features.breeze.python.breeze_collector import resolve_breeze_instruments
from engine.config import Settings
from engine.store import MarketStore


LOG = logging.getLogger("multibagger.breeze_backfill")


def warmup_breeze(settings: Settings, days: int = 8) -> dict[str, int]:
    """Seed recent one-minute candles using read-only Breeze historical APIs."""
    if not 3 <= days <= 14:
        raise ValueError("Breeze warm-up days must be between 3 and 14")
    if not all((settings.breeze_api_key, settings.breeze_api_secret, settings.breeze_session_token)):
        raise RuntimeError("Breeze credentials are required for warm-up")

    from breeze_connect import BreezeConnect

    client = BreezeConnect(api_key=settings.breeze_api_key)
    client.generate_session(
        api_secret=settings.breeze_api_secret,
        session_token=settings.breeze_session_token,
    )
    store = MarketStore(settings.db_path)
    instruments = resolve_breeze_instruments(client, settings, store)
    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=days)
    with store.connect() as con:
        session_counts = dict(con.execute("""
          SELECT symbol, count(DISTINCT CAST(ts AT TIME ZONE 'Asia/Kolkata' AS DATE))
          FROM minute_bars GROUP BY symbol
        """).fetchall())
    totals = {"symbols": len(instruments), "skipped": 0, "requests": 0, "bars": 0, "failed": 0}

    for token, item in instruments.items():
        if int(session_counts.get(item["symbol"], 0)) >= 3:
            totals["skipped"] += 1
            continue
        for chunk_start, chunk_end in _two_day_chunks(start, end):
            try:
                result = _request_with_retry(client, item["stock_code"], chunk_start, chunk_end)
                rows = result.get("Success") if isinstance(result, dict) else None
                if result.get("Error") if isinstance(result, dict) else True:
                    raise RuntimeError(str(result.get("Error") if isinstance(result, dict) else result))
                frame = pd.DataFrame([
                    {
                        "instrument_key": token,
                        "symbol": item["symbol"],
                        "ts": _history_timestamp(row["datetime"]),
                        "open": float(row["open"]),
                        "high": float(row["high"]),
                        "low": float(row["low"]),
                        "close": float(row["close"]),
                        "volume": int(float(row.get("volume") or 0)),
                        "bid": None,
                        "ask": None,
                        "received_at": datetime.now(timezone.utc),
                    }
                    for row in (rows or [])
                ])
                totals["requests"] += 1
                totals["bars"] += store.upsert_bars(frame) if not frame.empty else 0
                time.sleep(0.12)
            except Exception as error:
                totals["failed"] += 1
                LOG.error("Warm-up failed for %s %s..%s: %s", item["symbol"], chunk_start, chunk_end, error)
    if totals["failed"]:
        raise RuntimeError(f"Breeze warm-up incomplete: {totals['failed']} requests failed")
    return totals


def _request_with_retry(client: Any, stock_code: str, start: date, end: date) -> dict[str, Any]:
    for attempt in range(5):
        result = client.get_historical_data_v2(
            interval="1minute",
            from_date=f"{start.isoformat()}T00:00:00.000Z",
            to_date=f"{end.isoformat()}T23:59:59.000Z",
            stock_code=stock_code,
            exchange_code="NSE",
            product_type="cash",
        )
        if isinstance(result, dict) and result.get("Status") == 200 and result.get("Error") is None:
            return result
        if attempt < 4:
            time.sleep(min(2 ** attempt, 8))
    raise RuntimeError(str(result))


def _two_day_chunks(start: date, end: date):
    cursor = start
    while cursor <= end:
        chunk_end = min(cursor + timedelta(days=1), end)
        yield cursor, chunk_end
        cursor = chunk_end + timedelta(days=1)


def _history_timestamp(value: str) -> datetime:
    parsed = pd.Timestamp(value)
    if parsed.tzinfo is None:
        parsed = parsed.tz_localize("Asia/Kolkata")
    return parsed.tz_convert("UTC").to_pydatetime()
