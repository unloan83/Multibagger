from __future__ import annotations

import logging
import time
from datetime import date, datetime, timezone
from typing import Dict, Any, Optional

import pandas as pd
import upstox_client
from upstox_client.rest import ApiException

from .config import Settings
from .store import MarketStore

LOG = logging.getLogger("multibagger.eod_persistence")


def persist_daily_candles_eod(
    settings: Settings,
    target_date: Optional[date] = None,
    api_client: Optional[Any] = None,
) -> Dict[str, int]:
    """One-shot daily batch job that fetches the day's 1-minute intraday and daily candles from Upstox v3 API
    and appends them permanently to DuckDB storage (minute_bars & daily_bars).
    Never overwrites or discards prior days. Zero continuous background loops."""

    target_date = target_date or datetime.now(timezone.utc).date()
    store = MarketStore(settings.db_path)

    if not api_client and settings.access_token:
        config = upstox_client.Configuration()
        config.access_token = settings.access_token
        api_client = upstox_client.HistoryV3Api(upstox_client.ApiClient(config))

    # Single-day date range strings for Upstox V3 API
    date_str = target_date.isoformat()

    totals = {"minute_bars": 0, "daily_bars": 0, "symbols_processed": 0}

    # Tracked universe instrument keys or defaults
    symbols = getattr(settings, "symbols", lambda: ["RELIANCE", "INFY", "TCS"])()
    
    # Simple dictionary mapping symbol to instrument key
    symbol_map = {
        "RELIANCE": "NSE_EQ|INE002A01018",
        "INFY": "NSE_EQ|INE009A01021",
        "TCS": "NSE_EQ|INE467B01029",
        "NIFTY 50": "NSE_INDEX|Nifty 50",
    }

    for sym in symbols:
        inst_key = symbol_map.get(sym, f"NSE_EQ|{sym}")

        # 1. Intraday 1-minute candles for target date
        min_rows = []
        if api_client:
            try:
                resp = api_client.get_historical_candle_data1(
                    inst_key, "minutes", "1", date_str, date_str
                )
                candles = getattr(getattr(resp, "data", None), "candles", None) or []
                for c in candles:
                    min_rows.append({
                        "instrument_key": inst_key,
                        "symbol": sym,
                        "ts": pd.to_datetime(c[0], utc=True).to_pydatetime(),
                        "open": float(c[1]),
                        "high": float(c[2]),
                        "low": float(c[3]),
                        "close": float(c[4]),
                        "volume": int(c[5]),
                        "bid": None,
                        "ask": None,
                        "received_at": datetime.now(timezone.utc),
                    })
            except Exception as err:
                LOG.warning("Failed to fetch minute candles for %s on %s: %s", sym, date_str, err)

        if min_rows:
            cnt = store.upsert_bars(pd.DataFrame(min_rows))
            totals["minute_bars"] += cnt

        # 2. Daily candle for target date
        daily_rows = []
        if api_client:
            try:
                resp_d = api_client.get_historical_candle_data1(
                    inst_key, "day", "1", date_str, date_str
                )
                d_candles = getattr(getattr(resp_d, "data", None), "candles", None) or []
                for c in d_candles:
                    daily_rows.append({
                        "instrument_key": inst_key,
                        "symbol": sym,
                        "trading_day": pd.to_datetime(c[0], utc=True).date(),
                        "open": float(c[1]),
                        "high": float(c[2]),
                        "low": float(c[3]),
                        "close": float(c[4]),
                        "volume": int(c[5]),
                        "received_at": datetime.now(timezone.utc),
                    })
            except Exception as err:
                LOG.warning("Failed to fetch daily candle for %s on %s: %s", sym, date_str, err)

        if daily_rows:
            cnt_d = store.upsert_daily_bars(pd.DataFrame(daily_rows))
            totals["daily_bars"] += cnt_d

        totals["symbols_processed"] += 1

    LOG.info("EOD Persistence completed for %s: %s", date_str, totals)
    return totals


if __name__ == "__main__":
    st = Settings.from_env() if hasattr(Settings, "from_env") else Settings()
    res = persist_daily_candles_eod(st)
    print("EOD Persistence Result:", res)
