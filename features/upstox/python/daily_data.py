"""Upstox read-only daily data for the daily market-intelligence model.

Standard library only, so it runs on the Breeze VM without a virtualenv. No order endpoints.
Daily candles use the public historical-candle API; the option chain needs a read-only token
(``UPSTOX_ACCESS_TOKEN`` or ``UPSTOX_ANALYTICS_TOKEN``), which is never logged.
"""
from __future__ import annotations

import json
import os
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

BASE = "https://api.upstox.com/v2"
NIFTY_KEY = "NSE_INDEX|Nifty 50"
VIX_KEY = "NSE_INDEX|India VIX"
_MIN_INTERVAL_S = 0.12  # stays under Upstox's ~10 requests/second standard limit
_last_call = [0.0]


def _token() -> str | None:
    return os.environ.get("UPSTOX_ACCESS_TOKEN") or os.environ.get("UPSTOX_ANALYTICS_TOKEN") or None


def _get(url: str, auth: bool, timeout: float = 15.0) -> dict[str, Any]:
    headers = {"Accept": "application/json", "User-Agent": "multibagger-daily-intel/1"}
    token = _token()
    if auth:
        if not token:
            raise RuntimeError("UPSTOX_TOKEN_MISSING")
        headers["Authorization"] = f"Bearer {token}"
    for attempt in range(3):
        wait = _MIN_INTERVAL_S - (time.monotonic() - _last_call[0])
        if wait > 0:
            time.sleep(wait)
        _last_call[0] = time.monotonic()
        try:
            with urlopen(Request(url, headers=headers), timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except HTTPError as err:
            if err.code in (429, 500, 502, 503) and attempt < 2:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise RuntimeError(f"UPSTOX_HTTP_{err.code}") from None
        except URLError as err:
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise RuntimeError(f"UPSTOX_NETWORK:{err.reason}") from None
    raise RuntimeError("UPSTOX_RETRIES_EXHAUSTED")


def daily_candles(instrument_key: str, from_date: str, to_date: str) -> list[dict[str, Any]]:
    """Return daily bars oldest-first as {date, open, high, low, close, volume}."""
    url = f"{BASE}/historical-candle/{quote(instrument_key, safe='')}/day/{to_date}/{from_date}"
    payload = _get(url, auth=False)
    rows = (payload.get("data") or {}).get("candles") or []
    bars = [
        {"date": str(r[0])[:10], "open": float(r[1]), "high": float(r[2]), "low": float(r[3]),
         "close": float(r[4]), "volume": float(r[5] or 0)}
        for r in rows if len(r) >= 6
    ]
    bars.sort(key=lambda b: b["date"])
    return bars


def option_expiries(underlying_key: str = NIFTY_KEY) -> list[dict[str, Any]]:
    """Return [{expiry, lot_size}] for the underlying's listed option contracts, soonest first."""
    payload = _get(f"{BASE}/option/contract?instrument_key={quote(underlying_key, safe='')}", auth=True)
    seen: dict[str, int] = {}
    for row in payload.get("data") or []:
        expiry = row.get("expiry")
        if expiry and expiry not in seen:
            seen[expiry] = int(row.get("lot_size") or 0)
    return [{"expiry": e, "lot_size": seen[e]} for e in sorted(seen)]


def option_chain(expiry: str, underlying_key: str = NIFTY_KEY) -> list[dict[str, Any]]:
    """Return per-strike rows {strike, spot, ce:{bid,ask,ltp,oi,key}, pe:{...}}."""
    url = f"{BASE}/option/chain?instrument_key={quote(underlying_key, safe='')}&expiry_date={expiry}"
    payload = _get(url, auth=True)
    out = []
    for row in payload.get("data") or []:
        def leg(side: dict[str, Any] | None) -> dict[str, Any] | None:
            if not side:
                return None
            md = side.get("market_data") or {}
            return {"key": side.get("instrument_key"), "bid": float(md.get("bid_price") or 0),
                    "ask": float(md.get("ask_price") or 0), "ltp": float(md.get("ltp") or 0),
                    "oi": float(md.get("oi") or 0)}
        out.append({"strike": float(row.get("strike_price") or 0),
                    "spot": float(row.get("underlying_spot_price") or 0),
                    "ce": leg(row.get("call_options")), "pe": leg(row.get("put_options"))})
    return out
