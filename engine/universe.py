from __future__ import annotations

import gzip
import json
import logging
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

import pandas as pd

from .config import Settings
from .store import MarketStore


LOG = logging.getLogger("multibagger.universe")
IST = ZoneInfo("Asia/Kolkata")
INSTRUMENTS_URL = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz"


def build_daily_trading_universe(settings: Settings, store: MarketStore,
                                 now: datetime) -> list[str]:
    base = settings.symbols()
    fno = _fno_underlyings()
    frames = store.bars_for_symbols(base)
    selected: list[tuple[str, float, float]] = []
    if not frames.empty:
        for symbol, frame in frames.groupby("symbol"):
            if symbol not in fno:
                continue
            metrics = _prefilter_metrics(frame.reset_index(drop=True))
            if not metrics:
                continue
            average_volume, average_range_pct, spread_bps, sr_distance_pct = metrics
            reasons = []
            if average_volume < settings.min_average_volume:
                reasons.append("AVERAGE_VOLUME")
            if average_range_pct < settings.min_average_daily_range_pct:
                reasons.append("AVERAGE_DAILY_RANGE")
            if spread_bps > settings.max_spread_bps:
                reasons.append("SPREAD")
            if sr_distance_pct > settings.support_resistance_proximity_pct:
                reasons.append("NOT_NEAR_SUPPORT_RESISTANCE")
            if reasons:
                LOG.info("universe_skip symbol=%s reasons=%s", symbol, ",".join(reasons))
                continue
            selected.append((str(symbol), average_volume, sr_distance_pct))
    selected.sort(key=lambda item: (-item[1], item[2], item[0]))
    symbols = [item[0] for item in selected[:settings.trading_universe_size]]
    payload = {
        "tradingDay": now.astimezone(IST).date().isoformat(),
        "generatedAt": now.isoformat(),
        "source": "UPSTOX_NSE_INSTRUMENT_MASTER_AND_RECORDED_BARS",
        "criteria": {
            "fnoOnly": True,
            "minimumAverageVolume": settings.min_average_volume,
            "minimumAverageDailyRangePercent": settings.min_average_daily_range_pct,
            "maximumSpreadBps": settings.max_spread_bps,
            "supportResistanceProximityPercent": settings.support_resistance_proximity_pct,
        },
        "symbols": symbols,
    }
    settings.active_universe_path.parent.mkdir(parents=True, exist_ok=True)
    settings.active_universe_path.write_text(json.dumps(payload, indent=2))
    LOG.info("daily_universe selected=%d base=%d fno=%d", len(symbols), len(base), len(fno))
    return symbols


def active_trading_symbols(settings: Settings, now: datetime) -> list[str]:
    try:
        payload = json.loads(settings.active_universe_path.read_text())
        if payload.get("tradingDay") == now.astimezone(IST).date().isoformat():
            return [str(symbol) for symbol in payload.get("symbols", [])][:settings.trading_universe_size]
    except (OSError, json.JSONDecodeError):
        pass
    return []


def _fno_underlyings() -> set[str]:
    with urllib.request.urlopen(INSTRUMENTS_URL, timeout=30) as response:
        rows = json.loads(gzip.decompress(response.read()))
    return {
        str(row.get("underlying_symbol"))
        for row in rows
        if row.get("segment") == "NSE_FO" and row.get("instrument_type") == "FUT"
        and row.get("underlying_type") == "EQUITY" and row.get("underlying_symbol")
    }


def _prefilter_metrics(frame: pd.DataFrame) -> tuple[float, float, float, float] | None:
    if len(frame) < 2:
        return None
    df = frame.copy().sort_values("ts")
    df["session"] = pd.to_datetime(df.ts, utc=True).dt.tz_convert(IST).dt.date
    daily = df.groupby("session").agg(
        high=("high", "max"), low=("low", "min"), close=("close", "last"), volume=("volume", "sum"),
    ).tail(6)
    if len(daily) < 3:
        return None
    history = daily.iloc[:-1] if len(daily) > 3 else daily
    average_volume = float(history.volume.mean())
    average_range_pct = float(((history.high - history.low) / history.close * 100).mean())
    last = df.iloc[-1]
    bid, ask = float(last.bid or 0), float(last.ask or 0)
    if not (bid > 0 and ask > bid):
        return None
    spread_bps = (ask - bid) / ((ask + bid) / 2) * 10_000
    reference = history.tail(5)
    levels = [float(reference.high.max()), float(reference.low.min()), float(reference.close.iloc[-1])]
    sr_distance_pct = min(abs(float(last.close) - level) / float(last.close) * 100 for level in levels)
    return average_volume, average_range_pct, spread_bps, sr_distance_pct
