from __future__ import annotations

import gzip
import json
import urllib.request
import logging
import threading
import time
from datetime import datetime, timezone

import pandas as pd

from .config import Settings
from .store import MarketStore
from .scanner import run_scan


INSTRUMENTS_URL = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz"


def resolve_upstox_instruments(settings: Settings, store: MarketStore) -> dict[str, str]:
    with urllib.request.urlopen(INSTRUMENTS_URL, timeout=30) as response:
        rows = json.loads(gzip.decompress(response.read()))
    wanted = set(settings.symbols())
    selected = {row["instrument_key"]: row["trading_symbol"] for row in rows if row.get("segment") == "NSE_EQ" and row.get("instrument_type") == "EQ" and row.get("trading_symbol") in wanted}
    with store.connect() as con:
        for key, symbol in selected.items():
            con.execute("INSERT OR REPLACE INTO instruments VALUES (?, ?, ?, 'NSE', ?)", [key, symbol, symbol, datetime.now(timezone.utc)])
    return selected


def collect(settings: Settings) -> None:
    if settings.market_data_provider == "breeze":
        from .breeze_collector import collect_breeze

        collect_breeze(settings)
        return
    collect_upstox(settings)


def collect_upstox(settings: Settings) -> None:
    if not settings.access_token:
        raise RuntimeError("UPSTOX_ACCESS_TOKEN is required")
    import upstox_client

    store = MarketStore(settings.db_path)
    instruments = resolve_upstox_instruments(settings, store)
    if len(instruments) < int(settings.max_symbols * 0.8):
        raise RuntimeError(f"Only {len(instruments)}/{settings.max_symbols} configured symbols resolved; refusing partial scan")
    config = upstox_client.Configuration()
    config.access_token = settings.access_token
    streamer = upstox_client.MarketDataStreamerV3(upstox_client.ApiClient(config), list(instruments), "full")

    def on_message(message: dict) -> None:
        received = datetime.now(timezone.utc)
        for key, feed in (message.get("feeds") or {}).items():
            full = feed.get("fullFeed", {}).get("marketFF", {})
            quotes = full.get("marketLevel", {}).get("bidAskQuote", [])
            bid = float(quotes[0].get("bidP", 0)) if quotes else None
            ask = float(quotes[0].get("askP", 0)) if quotes else None
            candles = full.get("marketOHLC", {}).get("ohlc", [])
            minute = next((bar for bar in candles if bar.get("interval") == "I1"), None)
            if not minute:
                continue
            store.upsert_bar({"instrument_key": key, "symbol": instruments[key], "ts": pd.to_datetime(int(minute["ts"]), unit="ms", utc=True).to_pydatetime(),
                "open": float(minute["open"]), "high": float(minute["high"]), "low": float(minute["low"]), "close": float(minute["close"]),
                "volume": int(minute.get("vol", 0)), "bid": bid, "ask": ask, "received_at": received})

    streamer.on("message", on_message)
    streamer.auto_reconnect(True, 5, 20)
    streamer.connect()


def run_worker(settings: Settings, scan_interval: int = 60) -> None:
    """Persistent local process: collect continuously and publish paper scans periodically."""
    if scan_interval < 30:
        raise ValueError("scan interval must be at least 30 seconds")
    stop = threading.Event()

    def scanner_loop() -> None:
        while not stop.wait(scan_interval):
            try:
                run_scan(settings)
            except Exception:
                logging.exception("paper scan failed; no recommendation was published")

    thread = threading.Thread(target=scanner_loop, name="paper-scanner", daemon=True)
    thread.start()
    try:
        collect(settings)
    finally:
        stop.set()
        thread.join(timeout=5)
