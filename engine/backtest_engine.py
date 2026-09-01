from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, date, timezone
from typing import List, Dict, Any, Optional

import pandas as pd
import numpy as np

from .config import Settings, StatutoryFees
from .store import MarketStore


@dataclass
class SimulatedTrade:
    trade_id: str
    symbol: str
    side: str  # "LONG" or "SHORT"
    strategy: str
    entry_time: datetime
    exit_time: datetime
    entry_price: float
    exit_price: float
    filled_qty: int
    traded_value: float  # entry_price * filled_qty (auto-derived)
    raw_pnl: float
    net_pnl: float  # raw_pnl - cost_haircut
    cost_haircut: float
    exit_reason: str
    regime: str  # "TRENDING" or "RANGE-BOUND"
    trading_day: date


@dataclass
class RegimeMetrics:
    regime: str
    trade_count: int = 0
    win_rate: float = 0.0
    avg_win: float = 0.0
    avg_loss: float = 0.0
    net_pnl: float = 0.0


@dataclass
class SampleMetrics:
    trade_count: int = 0
    win_rate: float = 0.0
    avg_win: float = 0.0
    avg_loss: float = 0.0
    avg_win_loss_ratio: float = 0.0
    max_drawdown: float = 0.0
    total_raw_pnl: float = 0.0
    total_net_pnl: float = 0.0
    avg_traded_value: float = 0.0
    regime_breakdown: Dict[str, RegimeMetrics] = field(default_factory=dict)


@dataclass
class BacktestResult:
    candidate_id: str
    strategy_name: str
    in_sample: SampleMetrics
    out_of_sample: SampleMetrics
    blended: SampleMetrics
    all_trades: List[SimulatedTrade] = field(default_factory=list)


def calculate_turnover_cost(traded_value: float) -> float:
    """Computes turnover-based cost haircut: ₹40 fixed brokerage + 0.03% statutory charges."""
    return 40.0 + (traded_value * 0.0003)


def classify_daily_regime(daily_close_series: pd.Series) -> str:
    """Classifies market regime using 20-day EMA trend vs slope."""
    if len(daily_close_series) < 20:
        return "RANGE-BOUND"
    ema20 = daily_close_series.ewm(span=20, adjust=False).mean()
    last_close = float(daily_close_series.iloc[-1])
    last_ema = float(ema20.iloc[-1])
    prev_ema = float(ema20.iloc[-2]) if len(ema20) > 1 else last_ema
    ema_slope = (last_ema - prev_ema) / prev_ema if prev_ema > 0 else 0.0

    if (last_close > last_ema and ema_slope > 0.0005) or (last_close < last_ema and ema_slope < -0.0005):
        return "TRENDING"
    return "RANGE-BOUND"


def compute_sample_metrics(trades: List[SimulatedTrade]) -> SampleMetrics:
    """Computes trade performance metrics for a list of simulated trades."""
    if not trades:
        return SampleMetrics()

    trade_count = len(trades)
    win_pnls = [t.net_pnl for t in trades if t.net_pnl > 0]
    loss_pnls = [abs(t.net_pnl) for t in trades if t.net_pnl <= 0]
    
    wins = len(win_pnls)
    win_rate = (wins / trade_count * 100.0) if trade_count > 0 else 0.0
    avg_win = (sum(win_pnls) / wins) if wins > 0 else 0.0
    avg_loss = (sum(loss_pnls) / len(loss_pnls)) if loss_pnls else 1.0
    avg_ratio = (avg_win / avg_loss) if avg_loss > 0 else avg_win

    total_raw = sum(t.raw_pnl for t in trades)
    total_net = sum(t.net_pnl for t in trades)
    avg_tv = sum(t.traded_value for t in trades) / trade_count

    # Max Drawdown calculation
    cum_net = 0.0
    peak = 0.0
    max_dd = 0.0
    for t in trades:
        cum_net += t.net_pnl
        if cum_net > peak:
            peak = cum_net
        dd = peak - cum_net
        if dd > max_dd:
            max_dd = dd

    # Regime Breakdown
    regime_map: Dict[str, List[SimulatedTrade]] = {}
    for t in trades:
        regime_map.setdefault(t.regime, []).append(t)

    regime_breakdown: Dict[str, RegimeMetrics] = {}
    for r_name in ["TRENDING", "RANGE-BOUND"]:
        r_trades = regime_map.get(r_name, [])
        r_cnt = len(r_trades)
        if r_cnt == 0:
            regime_breakdown[r_name] = RegimeMetrics(regime=r_name)
            continue
        r_wins = [t.net_pnl for t in r_trades if t.net_pnl > 0]
        r_losses = [abs(t.net_pnl) for t in r_trades if t.net_pnl <= 0]
        r_wr = (len(r_wins) / r_cnt * 100.0)
        r_aw = (sum(r_wins) / len(r_wins)) if r_wins else 0.0
        r_al = (sum(r_losses) / len(r_losses)) if r_losses else 1.0
        regime_breakdown[r_name] = RegimeMetrics(
            regime=r_name,
            trade_count=r_cnt,
            win_rate=r_wr,
            avg_win=r_aw,
            avg_loss=r_al,
            net_pnl=sum(t.net_pnl for t in r_trades),
        )

    return SampleMetrics(
        trade_count=trade_count,
        win_rate=win_rate,
        avg_win=avg_win,
        avg_loss=avg_loss,
        avg_win_loss_ratio=avg_ratio,
        max_drawdown=max_dd,
        total_raw_pnl=total_raw,
        total_net_pnl=total_net,
        avg_traded_value=avg_tv,
        regime_breakdown=regime_breakdown,
    )


class InHouseBacktestEngine:
    """In-House Backtest Engine that replaces Algoverse as primary strategy validator.
    Simulates real trade records against local DuckDB 1-minute historical candles."""

    def __init__(self, db_path: str, capital_per_trade: float = 50000.0):
        self.db_path = db_path
        self.capital_per_trade = capital_per_trade
        self.fees = StatutoryFees()

    def run_backtest(
        self,
        candidate_id: str,
        strategy_name: str,
        direction: str,
        adx_threshold: float,
        vwap_mode: str,
        stop_loss_pct: float,
        target_pct: float,
        entry_time_str: str = "09:20",
        bars_df: Optional[pd.DataFrame] = None,
        daily_df: Optional[pd.DataFrame] = None,
    ) -> BacktestResult:
        """Executes bar-by-bar historical trade simulation without lookahead bias."""
        if bars_df is None or bars_df.empty:
            store = MarketStore(self.db_path)
            try:
                with store.connect() as con:
                    bars_df = con.execute("""
                        SELECT symbol, ts, open, high, low, close, volume, bid, ask
                        FROM minute_bars ORDER BY ts ASC
                    """).df()
            except Exception:
                bars_df = pd.DataFrame()

        if bars_df.empty:
            empty_sm = SampleMetrics()
            return BacktestResult(
                candidate_id=candidate_id,
                strategy_name=strategy_name,
                in_sample=empty_sm,
                out_of_sample=empty_sm,
                blended=empty_sm,
                all_trades=[],
            )

        # Parse timestamps and group by session/trading_day
        bars_df["ts_dt"] = pd.to_datetime(bars_df["ts"], utc=True)
        bars_df = bars_df.sort_values("ts_dt").reset_index(drop=True)
        bars_df["trading_day"] = bars_df["ts_dt"].dt.date

        unique_days = sorted(bars_df["trading_day"].unique())

        # Regime tagging map by trading_day
        regime_map: Dict[date, str] = {}
        if daily_df is not None and not daily_df.empty:
            daily_df["date"] = pd.to_datetime(daily_df["trading_day"]).dt.date
            daily_df = daily_df.sort_values("date")
            for idx in range(len(daily_df)):
                sub_series = daily_df["close"].iloc[: idx + 1]
                t_day = daily_df["date"].iloc[idx]
                regime_map[t_day] = classify_daily_regime(sub_series)
        else:
            # Derive daily close from minute_bars
            daily_closes = bars_df.groupby("trading_day")["close"].last()
            for idx in range(len(daily_closes)):
                sub_series = daily_closes.iloc[: idx + 1]
                t_day = daily_closes.index[idx]
                regime_map[t_day] = classify_daily_regime(sub_series)

        trades: List[SimulatedTrade] = []

        # Group bars by symbol and session
        grouped = bars_df.groupby(["symbol", "trading_day"])

        trade_counter = 1
        for (sym, t_day), session_bars in grouped:
            if len(session_bars) < 15:
                continue

            session_bars = session_bars.sort_values("ts_dt").reset_index(drop=True)
            t_regime = regime_map.get(t_day, "RANGE-BOUND")

            # Evaluate entry at entry_time bar (e.g. 09:20 or minute 0)
            # Ensure STRICT no-lookahead bias: only access session_bars up to entry index T
            for idx in range(0, max(1, len(session_bars) - 1)):
                current_bar = session_bars.iloc[idx]
                bar_time = current_bar["ts_dt"]
                
                # Filter entry time if specified
                if entry_time_str:
                    target_hour, target_min = map(int, entry_time_str.split(":"))
                    ist_time = bar_time + pd.Timedelta(hours=5, minutes=30)
                    if ist_time.hour != target_hour or ist_time.minute != target_min:
                        continue

                # Calculate indicators strictly up to bar T (index idx)
                historical_slice = session_bars.iloc[: idx + 1]
                close = float(current_bar["close"])

                # Session VWAP up to T
                cum_vol = historical_slice["volume"].sum()
                vwap = (historical_slice["close"] * historical_slice["volume"]).sum() / cum_vol if cum_vol > 0 else close

                # Determine direction
                trade_side = None
                if direction in ("LONG", "BOTH") and close >= vwap:
                    trade_side = "LONG"
                elif direction in ("SHORT", "BOTH") and close <= vwap:
                    trade_side = "SHORT"

                if not trade_side:
                    continue

                # Quantize position size & auto-derive traded_value
                entry_price = close
                filled_qty = max(1, int(self.capital_per_trade / entry_price))
                traded_value = round(entry_price * filled_qty, 2)

                # Define stop loss and target prices
                if trade_side == "LONG":
                    stop_price = round(entry_price * (1.0 - stop_loss_pct / 100.0), 2)
                    target_price = round(entry_price * (1.0 + target_pct / 100.0), 2)
                else:
                    stop_price = round(entry_price * (1.0 + stop_loss_pct / 100.0), 2)
                    target_price = round(entry_price * (1.0 - target_pct / 100.0), 2)

                # Simulate future bar progression from idx+1 onwards (No Lookahead)
                exit_price = entry_price
                exit_time = bar_time
                exit_reason = "EOD_EXIT"

                for future_idx in range(idx + 1, len(session_bars)):
                    f_bar = session_bars.iloc[future_idx]
                    f_high = float(f_bar["high"])
                    f_low = float(f_bar["low"])
                    f_close = float(f_bar["close"])
                    f_time = f_bar["ts_dt"]

                    if trade_side == "LONG":
                        if f_low <= stop_price:
                            exit_price = stop_price
                            exit_time = f_time
                            exit_reason = "STOP_LOSS"
                            break
                        elif f_high >= target_price:
                            exit_price = target_price
                            exit_time = f_time
                            exit_reason = "TARGET_REACHED"
                            break
                    else:  # SHORT
                        if f_high >= stop_price:
                            exit_price = stop_price
                            exit_time = f_time
                            exit_reason = "STOP_LOSS"
                            break
                        elif f_low <= target_price:
                            exit_price = target_price
                            exit_time = f_time
                            exit_reason = "TARGET_REACHED"
                            break
                    
                    exit_price = f_close
                    exit_time = f_time

                # Compute Raw PnL & Turnover Cost Haircut
                if trade_side == "LONG":
                    raw_pnl = (exit_price - entry_price) * filled_qty
                else:
                    raw_pnl = (entry_price - exit_price) * filled_qty

                cost_haircut = calculate_turnover_cost(traded_value)
                net_pnl = round(raw_pnl - cost_haircut, 2)

                sim_trade = SimulatedTrade(
                    trade_id=f"trade-{candidate_id}-{trade_counter:04d}",
                    symbol=sym,
                    side=trade_side,
                    strategy=strategy_name,
                    entry_time=bar_time,
                    exit_time=exit_time,
                    entry_price=entry_price,
                    exit_price=exit_price,
                    filled_qty=filled_qty,
                    traded_value=traded_value,
                    raw_pnl=round(raw_pnl, 2),
                    net_pnl=net_pnl,
                    cost_haircut=round(cost_haircut, 2),
                    exit_reason=exit_reason,
                    regime=t_regime,
                    trading_day=t_day,
                )
                trades.append(sim_trade)
                trade_counter += 1
                break  # Max 1 trade per symbol per day

        # Chronological Walk-Forward 70/30 Split
        trades.sort(key=lambda t: t.entry_time)
        split_idx = int(len(trades) * 0.70)
        in_sample_trades = trades[:split_idx]
        out_of_sample_trades = trades[split_idx:]

        in_sample_metrics = compute_sample_metrics(in_sample_trades)
        out_sample_metrics = compute_sample_metrics(out_of_sample_trades)
        blended_metrics = compute_sample_metrics(trades)

        return BacktestResult(
            candidate_id=candidate_id,
            strategy_name=strategy_name,
            in_sample=in_sample_metrics,
            out_of_sample=out_sample_metrics,
            blended=blended_metrics,
            all_trades=trades,
        )
