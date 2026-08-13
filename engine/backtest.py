from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime, timezone

import numpy as np
from pybroker import ExecContext, Strategy, StrategyConfig
from pybroker.data import DataSource

from .config import Settings
from .store import MarketStore


class DuckDBMinuteSource(DataSource):
    """PyBroker data source backed exclusively by recorded Upstox candles."""

    def __init__(self, store: MarketStore):
        super().__init__()
        self.store = store

    def _fetch_data(self, symbols, start_date, end_date, timeframe, adjust):  # noqa: ANN001
        with self.store.connect() as con:
            return con.execute("""
              SELECT symbol, ts AT TIME ZONE 'Asia/Kolkata' AS date, open, high, low, close, volume
              FROM minute_bars WHERE symbol IN (SELECT unnest(?)) AND ts BETWEEN ? AND ?
              ORDER BY symbol, ts
            """, [list(symbols), start_date, end_date]).df()


def execution(strategy_name: str):
    state = defaultdict(lambda: {"day": None, "bars": [], "volumes": defaultdict(list)})

    def execute(ctx: ExecContext) -> None:
        dt = np.datetime64(ctx.dt).astype("datetime64[m]").astype(object)
        day = dt.date()
        minute_index = (dt.hour * 60 + dt.minute) - (9 * 60 + 15)
        item = state[ctx.symbol]
        if item["day"] != day:
            if item["day"] is not None:
                for index, bar in enumerate(item["bars"]):
                    item["volumes"][index].append(bar[4])
            item["day"], item["bars"] = day, []
        bar = (float(ctx.open[-1]), float(ctx.high[-1]), float(ctx.low[-1]), float(ctx.close[-1]), float(ctx.volume[-1]))
        item["bars"].append(bar)
        bars = item["bars"]
        if minute_index < 15 or len(bars) < 16 or ctx.long_pos():
            return
        historical = item["volumes"].get(minute_index, [])[-20:]
        rvol = bar[4] / (sum(historical) / len(historical)) if historical and sum(historical) else 0
        if rvol < 1.2:
            return
        highs = np.array([value[1] for value in bars], dtype=float)
        lows = np.array([value[2] for value in bars], dtype=float)
        closes = np.array([value[3] for value in bars], dtype=float)
        volumes = np.array([value[4] for value in bars], dtype=float)
        typical = (highs + lows + closes) / 3
        vwap = float(np.sum(typical * volumes) / np.sum(volumes)) if np.sum(volumes) else 0
        true_ranges = np.maximum(highs[1:] - lows[1:], np.maximum(abs(highs[1:] - closes[:-1]), abs(lows[1:] - closes[:-1])))
        atr = float(np.mean(true_ranges[-14:])) if len(true_ranges) >= 14 else 0
        if atr <= 0:
            return
        if strategy_name == "ORB_15M":
            qualifies = closes[-2] <= np.max(highs[:15]) < closes[-1] and closes[-1] > vwap
        else:
            prior_typical = (highs[:-1] + lows[:-1] + closes[:-1]) / 3
            prior_vwap = np.cumsum(prior_typical * volumes[:-1]) / np.maximum(np.cumsum(volumes[:-1]), 1)
            touched = bool(np.any(lows[-4:-1] <= prior_vwap[-3:] * 1.0015))
            qualifies = touched and closes[-1] > highs[-2] and closes[-1] > vwap
        if not qualifies:
            return
        ctx.buy_shares = max(int(100_000 / closes[-1]), 1)
        ctx.stop_loss = 1.2 * atr
        ctx.stop_profit = 2.4 * atr
        ctx.hold_bars = max(1, 375 - minute_index)

    return execute


def walk_forward(settings: Settings, start: str, end: str, windows: int = 6, calc_bootstrap: bool = True) -> dict:
    store = MarketStore(settings.db_path)
    symbols = settings.symbols()
    with store.connect() as con:
        available = con.execute("SELECT count(*), count(DISTINCT symbol) FROM minute_bars WHERE ts BETWEEN ? AND ?", [start, end]).fetchone()
    if not available or available[0] == 0:
        raise RuntimeError("No Upstox minute bars exist for the requested backtest range")
    summaries = {}
    for strategy_name in ("ORB_15M", "VWAP_CONTINUATION"):
        config = StrategyConfig(initial_cash=1_000_000, fee_mode="per_order", fee_amount=20,
                                max_long_positions=10, exit_on_last_bar=True, bars_per_year=93_750)
        strategy = Strategy(DuckDBMinuteSource(store), start, end, config=config)
        strategy.add_execution(execution(strategy_name), symbols)
        result = strategy.walkforward(windows=windows, train_size=0.6, calc_bootstrap=calc_bootstrap,
                                      disable_parallel=True, between_time=("09:15", "15:30"))
        metrics = result.metrics
        summary = {"trades": int(metrics.trade_count), "return_pct": float(metrics.total_return_pct),
                   "max_drawdown_pct": float(metrics.max_drawdown_pct), "profit_factor": float(metrics.profit_factor)}
        summaries[strategy_name] = summary
        with store.connect() as con:
            con.execute("INSERT INTO validation_results VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
                str(uuid.uuid4()), strategy_name, start, end, start, end, summary["trades"],
                summary["return_pct"], summary["max_drawdown_pct"], summary["profit_factor"], datetime.now(timezone.utc)])
    return {"source": "UPSTOX_1MIN_DUCKDB", "walkforward_windows": windows,
            "available_bars": int(available[0]), "available_symbols": int(available[1]), "strategies": summaries}
