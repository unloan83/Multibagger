from __future__ import annotations

import asyncio
import datetime
import json
import logging
import math
from typing import Dict, Any, Optional, Tuple, Callable

logger = logging.getLogger("market_data")

def quantize_price(price: float, tick_size: float = 0.05) -> float:
    if price <= 0:
        return 0.0
    return round(math.floor(price / tick_size + 0.00001) * tick_size, 2)

class TickData:
    def __init__(
        self,
        symbol: str,
        instrument_key: str,
        ltp: float,
        bid: float,
        ask: float,
        timestamp: float,
        volume: int = 0,
    ):
        self.symbol = symbol
        self.instrument_key = instrument_key
        self.ltp = ltp
        self.bid = bid
        self.ask = ask
        self.timestamp = timestamp
        self.volume = volume

class UpstoxMarketDataFeed:
    def __init__(self, access_token: str):
        self.access_token = access_token
        self.is_connected = False
        self.quote_ticks = 0
        self.candle_ticks = 0
        self.last_tick_time = 0.0
        self.tick_callbacks: list[Callable[[TickData], None]] = []

    def register_callback(self, callback: Callable[[TickData], None]):
        self.tick_callbacks.append(callback)

    def is_market_data_ready(self, now_ts: Optional[float] = None) -> bool:
        if now_ts is None:
            now_ts = datetime.datetime.now(datetime.timezone.utc).timestamp()
            
        if self.quote_ticks <= 0:
            logger.warning("MARKET_DATA_NOT_READY: Zero quote ticks received (quote_ticks=0).")
            return False
            
        if self.last_tick_time <= 0 or (now_ts - self.last_tick_time) > 2.0:
            logger.warning("MARKET_DATA_NOT_READY: Feed latency stale or zero ticks.")
            return False

        return True

    def process_raw_tick(self, tick_dict: Dict[str, Any], now_ts: Optional[float] = None):
        if now_ts is None:
            now_ts = datetime.datetime.now(datetime.timezone.utc).timestamp()
            
        self.quote_ticks += 1
        self.last_tick_time = now_ts
        
        tick = TickData(
            symbol=tick_dict.get("symbol", "UNKNOWN"),
            instrument_key=tick_dict.get("instrument_key", ""),
            ltp=float(tick_dict.get("ltp", 0.0)),
            bid=float(tick_dict.get("bid", 0.0)),
            ask=float(tick_dict.get("ask", 0.0)),
            timestamp=now_ts,
            volume=int(tick_dict.get("volume", 0)),
        )

        for cb in self.tick_callbacks:
            try:
                cb(tick)
            except Exception as e:
                logger.error("Error in tick callback: %s", e)

    def handle_disconnect_or_http_error(self, status_code: int):
        logger.error("Market data feed disconnected or HTTP %d error. Resetting tick counts.", status_code)
        self.is_connected = False
        self.quote_ticks = 0
        self.candle_ticks = 0

    async def connect_and_listen(self):
        logger.info("Connecting to Upstox Market Data Feed...")
        self.is_connected = True
        while self.is_connected:
            await asyncio.sleep(1.0)
