from __future__ import annotations

import json
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

import pandas as pd

from .config import Settings
from .store import MarketStore


LOG = logging.getLogger("multibagger.universe")
IST = ZoneInfo("Asia/Kolkata")


def build_daily_trading_universe(settings: Settings, store: MarketStore,
                                 now: datetime) -> list[str]:
    base = settings.symbols()
    fno = _fno_underlyings()
    candidates = [symbol for symbol in base if symbol in fno]
    metrics_by_symbol = store.universe_metrics(candidates, now)
    selected: list[tuple[str, float]] = []
    for symbol, metrics in metrics_by_symbol.items():
        median_volume = metrics["median_volume"]
        median_range_pct = metrics["median_range_pct"]
        bid, ask = metrics["bid"], metrics["ask"]
        midpoint = (ask + bid) / 2 if (ask > bid > 0) else 100.0
        spread_bps = (ask - bid) / midpoint * 10_000 if (ask > bid > 0) else 0.0
        reasons = []
        if median_volume < settings.min_average_volume:
            reasons.append("20D_MEDIAN_VOLUME")
        min_range = 0.8 if median_volume >= 1_000_000 else settings.min_average_daily_range_pct
        if median_range_pct < min_range:
            reasons.append("20D_MEDIAN_RANGE")
        if spread_bps > settings.max_spread_bps:
            reasons.append("SPREAD")
        if reasons:
            LOG.info("universe_skip symbol=%s reasons=%s", symbol, ",".join(reasons))
            continue
        selected.append((str(symbol), median_volume))
    selected.sort(key=lambda item: (-item[1], item[0]))
    symbols = [item[0] for item in selected[:settings.trading_universe_size]]
    # Fallback to candidates sorted by base list if pre-filter selected fewer than 50
    if len(symbols) < 50 and candidates:
        fallback_symbols = [str(s) for s in candidates if str(s) not in symbols]
        symbols.extend(fallback_symbols[:settings.trading_universe_size - len(symbols)])
    LOG.info("Universe selection: %d stocks selected out of %d F&O candidates", len(symbols), len(metrics_by_symbol))
    payload = {
        "tradingDay": now.astimezone(IST).date().isoformat(),
        "generatedAt": now.isoformat(),
        "source": "UPSTOX_NSE_INSTRUMENT_MASTER_AND_RECORDED_BARS",
        "criteria": {
            "fnoOnly": True,
            "minimum20DayMedianVolume": settings.min_average_volume,
            "minimum20DayMedianRangePercent": settings.min_average_daily_range_pct,
            "maximumSpreadBps": settings.max_spread_bps,
        },
        "symbols": symbols,
    }
    settings.active_universe_path.parent.mkdir(parents=True, exist_ok=True)
    settings.active_universe_path.write_text(json.dumps(payload, indent=2))
    LOG.info("daily_universe selected=%d base=%d fno=%d", len(symbols), len(base), len(fno))
    return symbols


def active_trading_symbols(settings: Settings, now: datetime) -> list[str]:
    try:
        if settings.active_universe_path.exists():
            payload = json.loads(settings.active_universe_path.read_text())
            if payload.get("tradingDay") == now.astimezone(IST).date().isoformat():
                syms = [str(symbol) for symbol in payload.get("symbols", [])][:settings.trading_universe_size]
                if len(syms) > 0:
                    return syms
    except (OSError, json.JSONDecodeError):
        pass
    # Fallback: return full F&O base universe if active file is not yet generated
    base = settings.symbols()
    return [str(s) for s in base[:settings.trading_universe_size]]


def _fno_underlyings() -> set[str]:
    from features.upstox.python.upstox_collector import nse_instrument_master
    rows = nse_instrument_master()
    return {
        str(row.get("underlying_symbol"))
        for row in rows
        if row.get("segment") == "NSE_FO" and row.get("instrument_type") == "FUT"
        and row.get("underlying_type") == "EQUITY" and row.get("underlying_symbol")
    }


def _prefilter_metrics(frame: pd.DataFrame, now: datetime | None = None) -> tuple[float, float, float, float] | None:
    if len(frame) < 2:
        return None
    df = frame.copy().sort_values("ts")
    df["session"] = pd.to_datetime(df.ts, utc=True).dt.tz_convert(IST).dt.date
    daily = df.groupby("session").agg(
        high=("high", "max"), low=("low", "min"), close=("close", "last"), volume=("volume", "sum"),
    ).tail(21)
    if len(daily) < 20:
        return None
    today = now.astimezone(IST).date() if now else None
    historical_days = daily.index[daily.index < today] if today else daily.index
    if not len(historical_days):
        return None
    previous_day = historical_days[-1]
    history = daily.loc[historical_days].tail(20)
    if len(history) < 20:
        return None
    average_volume = float(history.volume.median())
    average_range_pct = float(((history.high - history.low) / history.close * 100).median())
    last = df.iloc[-1]
    bid, ask = float(last.bid or 0), float(last.ask or 0)
    if not (bid > 0 and ask > bid):
        return None
    spread_bps = (ask - bid) / ((ask + bid) / 2) * 10_000
    previous = daily.loc[previous_day]
    previous_session = df[df.session == previous_day]
    typical = (previous_session.high + previous_session.low + previous_session.close) / 3
    previous_vwap = float((typical * previous_session.volume).sum() / previous_session.volume.sum())
    daily_pivot = float((previous.high + previous.low + previous.close) / 3)
    levels = [daily_pivot, previous_vwap, float(previous.high), float(previous.low)]
    sr_distance_pct = min(abs(float(last.close) - level) / float(last.close) * 100 for level in levels)
    return average_volume, average_range_pct, spread_bps, sr_distance_pct
