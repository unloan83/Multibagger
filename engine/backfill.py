from __future__ import annotations

import logging
import time
from datetime import date, datetime, timedelta, timezone

import pandas as pd
import upstox_client
from upstox_client.rest import ApiException

from features.upstox.python.upstox_collector import resolve_upstox_instruments
from .config import Settings
from .store import MarketStore


LOG = logging.getLogger("multibagger.backfill")


def month_chunks(start: date, end: date):
    cursor = start
    while cursor <= end:
        next_month = (cursor.replace(day=28) + timedelta(days=4)).replace(day=1)
        chunk_end = min(end, next_month - timedelta(days=1))
        yield cursor, chunk_end
        cursor = chunk_end + timedelta(days=1)


def backfill(settings: Settings, start: date = date(2022, 1, 1), end: date | None = None,
             resume: bool = True) -> dict[str, int]:
    if not settings.access_token:
        raise RuntimeError("UPSTOX_ACCESS_TOKEN is required")
    end = end or datetime.now(timezone.utc).date()
    if start < date(2022, 1, 1) or end < start:
        raise ValueError("Upstox V3 one-minute history starts at 2022-01-01")
    store = MarketStore(settings.db_path)
    instruments = resolve_upstox_instruments(settings, store)
    _validate_backfill_instruments(settings, instruments)
    config = upstox_client.Configuration()
    config.access_token = settings.access_token
    api = upstox_client.HistoryV3Api(upstox_client.ApiClient(config))
    totals = {"instruments": len(instruments), "chunks": 0, "bars": 0, "skipped": 0, "failed": 0}
    for instrument_key, symbol in instruments.items():
        for chunk_start, chunk_end in month_chunks(start, end):
            with store.connect() as con:
                done = con.execute("SELECT status FROM backfill_progress WHERE instrument_key=? AND from_date=? AND to_date=?", [instrument_key, chunk_start, chunk_end]).fetchone()
            if resume and done and done[0] == "COMPLETE":
                totals["skipped"] += 1
                continue
            try:
                response = _request_chunk(api, instrument_key, chunk_start, chunk_end)
                candles = getattr(getattr(response, "data", None), "candles", None) or []
                rows = [{"instrument_key": instrument_key, "symbol": symbol,
                         "ts": pd.to_datetime(candle[0], utc=True).to_pydatetime(),
                         "open": float(candle[1]), "high": float(candle[2]), "low": float(candle[3]),
                         "close": float(candle[4]), "volume": int(candle[5]), "bid": None, "ask": None,
                         "received_at": datetime.now(timezone.utc)} for candle in candles]
                count = store.upsert_bars(pd.DataFrame(rows)) if rows else 0
                with store.connect() as con:
                    con.execute("INSERT OR REPLACE INTO backfill_progress VALUES (?, ?, ?, 'COMPLETE', ?, NULL, ?)", [instrument_key, chunk_start, chunk_end, count, datetime.now(timezone.utc)])
                totals["chunks"] += 1
                totals["bars"] += count
                LOG.info("%s %s..%s: %d bars", symbol, chunk_start, chunk_end, count)
                time.sleep(0.12)
            except Exception as error:
                totals["failed"] += 1
                with store.connect() as con:
                    con.execute("INSERT OR REPLACE INTO backfill_progress VALUES (?, ?, ?, 'FAILED', 0, ?, ?)", [instrument_key, chunk_start, chunk_end, str(error)[:500], datetime.now(timezone.utc)])
                LOG.error("%s %s..%s failed: %s", symbol, chunk_start, chunk_end, error)
    if totals["failed"]:
        raise RuntimeError(f"Backfill incomplete: {totals['failed']} chunks failed; rerun with --resume")
    return totals


def _validate_backfill_instruments(settings: Settings, instruments: dict[str, str]) -> None:
    if instruments.get(settings.market_index_instrument_key) != settings.market_index_symbol:
        raise RuntimeError("NIFTY 50 index is missing from warm-up; direction classification must fail closed")
    if instruments.get(settings.vix_instrument_key) != settings.vix_symbol:
        raise RuntimeError("India VIX is missing from warm-up; regime classification must fail closed")
    equity_count = len(instruments) - 2
    minimum = max(1, int(settings.max_symbols * 0.8))
    if equity_count < minimum:
        raise RuntimeError(
            f"Resolved {equity_count}/{settings.max_symbols} equities plus NIFTY 50; "
            "refusing incomplete backfill"
        )


def _request_chunk(api, instrument_key: str, start: date, end: date):
    for attempt in range(6):
        try:
            return api.get_historical_candle_data1(instrument_key, "minutes", "1", end.isoformat(), start.isoformat())
        except ApiException as error:
            if getattr(error, "status", None) not in (429, 500, 502, 503, 504) or attempt == 5:
                raise
            time.sleep(min(2 ** attempt, 30))
    raise RuntimeError("unreachable")
