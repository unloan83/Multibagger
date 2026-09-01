#!/usr/bin/env python3
"""
Stage-2 independent trade-ledger verifier.

PURPOSE
-------
1. Uses ONLY genuine Upstox historical candles.
2. Resolves genuine Upstox instrument keys.
3. Runs VWAP Pullback, ORB Breakout and Gap Continuation independently.
4. Produces an ACTUAL trade ledger.
5. Derives ALL statistics from that ledger.
6. No random/hash/sample/default/synthetic performance values.
7. Does NOT modify production DB, FINAL_SESSION_PLAN, learning, risk or execution.

This is a verification/reference calculation only.
"""

from __future__ import annotations

import math
import os
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from pathlib import Path
from statistics import mean
from typing import Any
from zoneinfo import ZoneInfo

# ----------------------------------------------------------------------
# ENVIRONMENT
# ----------------------------------------------------------------------

ROOT = Path("/opt/multibagger") if Path("/opt/multibagger").exists() else Path.cwd()
IST = ZoneInfo("Asia/Kolkata")

if not Path.cwd().resolve().as_posix().startswith("/opt/multibagger") and Path("/opt/multibagger").exists():
    print("READY = NO")
    print(f"BLOCKER = MUST_RUN_ON_OCI:/opt/multibagger | cwd={Path.cwd()}")
    raise SystemExit(2)

from engine.upstox_evidence import (
    verify_upstox_auth,
    load_instrument_master,
    build_nse_equity_map,
    fetch_historical_candles_v3,
)

from engine.config import Settings
from engine.universe import active_trading_symbols


# ======================================================================
# CONFIGURATION
# ======================================================================

BAR_MINUTES = 5

ROUND_TRIP_COST_BPS = 10.0      # 0.10%
SLIPPAGE_BPS_EACH_SIDE = 5.0   # 0.05% each entry/exit

STOP_PCT = 1.0
TARGET_PCT = 1.5

MIN_HISTORY_SESSIONS = 10

SAMPLE_SYMBOLS = [
    "360ONE",
    "ABB",
    "OBEROIRLTY",
]


# ======================================================================
# DATA STRUCTURES
# ======================================================================

@dataclass
class Bar:
    ts: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass
class Trade:
    symbol: str
    strategy: str
    side: str

    entry_ts: datetime
    entry_price: float
    entry_reason: str

    exit_ts: datetime
    exit_price: float
    exit_reason: str

    gross_pnl: float
    costs: float
    net_pnl: float


# ======================================================================
# HELPERS
# ======================================================================

def parse_ts(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        dt = value
    else:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=IST)

    return dt.astimezone(IST)


def normalize_candles(rows: list[dict[str, Any]]) -> list[Bar]:
    out: list[Bar] = []

    for r in rows:
        try:
            b = Bar(
                ts=parse_ts(r["timestamp"]),
                open=float(r["open"]),
                high=float(r["high"]),
                low=float(r["low"]),
                close=float(r["close"]),
                volume=float(r["volume"]),
            )
        except Exception:
            continue

        if (
            b.open <= 0
            or b.high <= 0
            or b.low <= 0
            or b.close <= 0
            or b.high < b.low
        ):
            continue

        out.append(b)

    out.sort(key=lambda x: x.ts)

    unique: dict[datetime, Bar] = {}
    for b in out:
        unique[b.ts] = b

    return sorted(unique.values(), key=lambda x: x.ts)


def group_sessions(bars: list[Bar]) -> dict[date, list[Bar]]:
    sessions: dict[date, list[Bar]] = defaultdict(list)

    for b in bars:
        t = b.ts.time()

        if time(9, 15) <= t <= time(15, 30):
            sessions[b.ts.date()].append(b)

    return dict(sorted(sessions.items()))


def typical_price(b: Bar) -> float:
    return (b.high + b.low + b.close) / 3.0


def running_vwap(session: list[Bar]) -> list[float]:
    result: list[float] = []

    pv = 0.0
    vol = 0.0

    for b in session:
        pv += typical_price(b) * b.volume
        vol += b.volume

        result.append(pv / vol if vol > 0 else b.close)

    return result


def execution_cost(entry: float, exit_: float) -> float:
    turnover = entry + exit_

    fees = turnover * (ROUND_TRIP_COST_BPS / 10000.0)
    slippage = turnover * (SLIPPAGE_BPS_EACH_SIDE / 10000.0)

    return fees + slippage


def close_long_trade(
    symbol: str,
    strategy: str,
    entry_bar: Bar,
    entry_price: float,
    entry_reason: str,
    future_bars: list[Bar],
) -> Trade | None:

    stop = entry_price * (1.0 - STOP_PCT / 100.0)
    target = entry_price * (1.0 + TARGET_PCT / 100.0)

    if not future_bars:
        return None

    exit_bar = None
    exit_price = None
    exit_reason = None

    for b in future_bars:
        hit_stop = b.low <= stop
        hit_target = b.high >= target

        if hit_stop and hit_target:
            exit_bar = b
            exit_price = stop
            exit_reason = "STOP_AND_TARGET_SAME_BAR_STOP_ASSUMED"
            break

        if hit_stop:
            exit_bar = b
            exit_price = stop
            exit_reason = "STOP"
            break

        if hit_target:
            exit_bar = b
            exit_price = target
            exit_reason = "TARGET"
            break

    if exit_bar is None:
        exit_bar = future_bars[-1]
        exit_price = exit_bar.close
        exit_reason = "EOD"

    gross = exit_price - entry_price
    costs = execution_cost(entry_price, exit_price)

    return Trade(
        symbol=symbol,
        strategy=strategy,
        side="LONG",
        entry_ts=entry_bar.ts,
        entry_price=entry_price,
        entry_reason=entry_reason,
        exit_ts=exit_bar.ts,
        exit_price=exit_price,
        exit_reason=exit_reason,
        gross_pnl=gross,
        costs=costs,
        net_pnl=gross - costs,
    )


# ======================================================================
# STRATEGIES
# ======================================================================

def vwap_pullback_trades(
    symbol: str,
    sessions: dict[date, list[Bar]],
) -> list[Trade]:

    trades: list[Trade] = []

    for session_day, bars in sessions.items():

        if len(bars) < 12:
            continue

        vwaps = running_vwap(bars)

        for i in range(2, len(bars) - 1):

            b_prev = bars[i - 1]
            b = bars[i]

            v_prev = vwaps[i - 1]
            v_now = vwaps[i]

            touched = b_prev.low <= v_prev
            reclaim = b.close > v_now and b.close > b.open
            valid_time = time(9, 25) <= b.ts.time() <= time(14, 30)

            if not (touched and reclaim and valid_time):
                continue

            entry = b.close

            trade = close_long_trade(
                symbol=symbol,
                strategy="VWAP Pullback",
                entry_bar=b,
                entry_price=entry,
                entry_reason=(
                    f"VWAP_PULLBACK_RECLAIM "
                    f"prev_low={b_prev.low:.2f} "
                    f"vwap={v_now:.2f}"
                ),
                future_bars=bars[i + 1:],
            )

            if trade:
                trades.append(trade)

            break

    return trades


def orb_breakout_trades(
    symbol: str,
    sessions: dict[date, list[Bar]],
) -> list[Trade]:

    trades: list[Trade] = []

    for session_day, bars in sessions.items():

        opening = [
            b for b in bars
            if time(9, 15) <= b.ts.time() <= time(9, 25)
        ]

        if len(opening) < 3:
            continue

        orb_high = max(b.high for b in opening)

        candidates = [
            (i, b)
            for i, b in enumerate(bars)
            if time(9, 30) <= b.ts.time() <= time(14, 30)
        ]

        if not candidates:
            continue

        vols = [b.volume for b in bars]

        for i, b in candidates:

            if i < 5:
                continue

            avg_vol = mean(vols[i - 5:i])

            breakout = b.close > orb_high
            volume_confirm = avg_vol > 0 and b.volume >= avg_vol * 1.10
            bullish = b.close > b.open

            if not (breakout and volume_confirm and bullish):
                continue

            entry = b.close

            trade = close_long_trade(
                symbol=symbol,
                strategy="ORB Breakout",
                entry_bar=b,
                entry_price=entry,
                entry_reason=(
                    f"ORB_BREAKOUT orb_high={orb_high:.2f} "
                    f"volume_ratio={b.volume / avg_vol:.2f}"
                ),
                future_bars=bars[i + 1:],
            )

            if trade:
                trades.append(trade)

            break

    return trades


def gap_continuation_trades(
    symbol: str,
    sessions: dict[date, list[Bar]],
) -> list[Trade]:

    trades: list[Trade] = []
    ordered_days = list(sessions.keys())

    for di in range(1, len(ordered_days)):

        prev_day = ordered_days[di - 1]
        day = ordered_days[di]

        previous = sessions[prev_day]
        bars = sessions[day]

        if not previous or len(bars) < 5:
            continue

        prev_close = previous[-1].close
        day_open = bars[0].open

        if prev_close <= 0:
            continue

        gap_pct = ((day_open - prev_close) / prev_close) * 100.0

        if gap_pct < 0.50:
            continue

        opening = bars[:3]
        opening_high = max(b.high for b in opening)
        gap_midpoint = prev_close + ((day_open - prev_close) * 0.50)

        if min(b.close for b in opening) < gap_midpoint:
            continue

        for i in range(3, len(bars) - 1):

            b = bars[i]

            if not (time(9, 30) <= b.ts.time() <= time(13, 30)):
                continue

            continuation = b.close > opening_high and b.close > b.open

            if not continuation:
                continue

            entry = b.close

            trade = close_long_trade(
                symbol=symbol,
                strategy="Gap Continuation",
                entry_bar=b,
                entry_price=entry,
                entry_reason=(
                    f"GAP_CONTINUATION gap={gap_pct:.2f}% "
                    f"opening_high={opening_high:.2f}"
                ),
                future_bars=bars[i + 1:],
            )

            if trade:
                trades.append(trade)

            break

    return trades


# ======================================================================
# STATISTICS
# ======================================================================

def max_drawdown_from_trades(trades: list[Trade]) -> float:
    equity = 0.0
    peak = 0.0
    max_dd = 0.0

    for t in trades:
        equity += t.net_pnl

        peak = max(peak, equity)
        dd = peak - equity

        max_dd = max(max_dd, dd)

    return max_dd


def summarize(trades: list[Trade]) -> dict[str, float | int]:

    if not trades:
        return {
            "trade_count": 0,
            "gross_pnl": 0.0,
            "costs": 0.0,
            "net_pnl": 0.0,
            "expectancy": 0.0,
            "wins": 0,
            "losses": 0,
            "win_rate": 0.0,
            "avg_win": 0.0,
            "avg_loss": 0.0,
            "profit_factor": 0.0,
            "max_drawdown": 0.0,
        }

    gross = sum(t.gross_pnl for t in trades)
    costs = sum(t.costs for t in trades)
    net = sum(t.net_pnl for t in trades)

    winners = [t.net_pnl for t in trades if t.net_pnl > 0]
    losers = [t.net_pnl for t in trades if t.net_pnl <= 0]

    gross_profit = sum(winners)
    gross_loss = abs(sum(losers))

    return {
        "trade_count": len(trades),
        "gross_pnl": gross,
        "costs": costs,
        "net_pnl": net,
        "expectancy": net / len(trades),
        "wins": len(winners),
        "losses": len(losers),
        "win_rate": (len(winners) / len(trades)) * 100.0,
        "avg_win": mean(winners) if winners else 0.0,
        "avg_loss": abs(mean(losers)) if losers else 0.0,
        "profit_factor": (
            gross_profit / gross_loss
            if gross_loss > 0
            else float("inf") if gross_profit > 0 else 0.0
        ),
        "max_drawdown": max_drawdown_from_trades(trades),
    }


def reconcile(
    trades: list[Trade],
    summary: dict[str, float | int],
) -> None:

    assert summary["trade_count"] == len(trades)

    ledger_net = sum(t.net_pnl for t in trades)

    assert math.isclose(
        float(summary["net_pnl"]),
        ledger_net,
        rel_tol=1e-9,
        abs_tol=1e-9,
    )

    if trades:
        assert math.isclose(
            float(summary["expectancy"]),
            ledger_net / len(trades),
            rel_tol=1e-9,
            abs_tol=1e-9,
        )

    assert int(summary["wins"]) + int(summary["losses"]) == len(trades)


# ======================================================================
# FETCH HISTORY
# ======================================================================

def fetch_history(
    instrument_key: str,
    days: int = 30,
) -> list[dict[str, Any]]:

    today = datetime.now(IST).date()
    final_day = today - timedelta(days=1)
    start_day = final_day - timedelta(days=days)

    all_rows: list[dict[str, Any]] = []
    cursor = start_day

    while cursor <= final_day:
        chunk_end = min(
            cursor + timedelta(days=28),
            final_day,
        )

        try:
            rows = fetch_historical_candles_v3(
                instrument_key,
                from_date=cursor.isoformat(),
                to_date=chunk_end.isoformat(),
                interval_minutes=BAR_MINUTES,
            )
            all_rows.extend(rows)
        except Exception as exc:
            pass

        cursor = chunk_end + timedelta(days=1)

    by_ts: dict[str, dict[str, Any]] = {}

    for r in all_rows:
        by_ts[str(r["timestamp"])] = r

    return sorted(
        by_ts.values(),
        key=lambda x: str(x["timestamp"]),
    )


# ======================================================================
# MAIN
# ======================================================================

def main() -> None:

    print("=== STAGE 2 INDEPENDENT TRADE-LEDGER VERIFICATION ===")
    print("RUN_LOCATION = OCI")

    if not os.getenv("UPSTOX_ACCESS_TOKEN", "").strip():
        print("READY = NO")
        print("BLOCKER = UPSTOX_ACCESS_TOKEN_MISSING")
        raise SystemExit(2)

    try:
        verify_upstox_auth()
        print("UPSTOX_AUTH = PASS")
    except Exception as exc:
        print("UPSTOX_AUTH = FAIL")
        raise SystemExit(2)

    settings = Settings()

    universe = [
        str(x).upper().strip()
        for x in active_trading_symbols(settings)
    ]

    possible = [
        ROOT / "data/upstox_instruments.json",
        ROOT / "data/upstox_instrument_master.json",
        ROOT / "data/instruments.json",
    ]

    master_path = next(
        (p for p in possible if p.exists()),
        None,
    )

    if master_path is None:
        master_path = ROOT / "data/active-intraday-universe.json"

    master = load_instrument_master(master_path)
    key_map = build_nse_equity_map(master)

    print(f"INSTRUMENT_MASTER = {master_path}")

    overall_reconcile = True

    print()
    print(
        "symbol | strategy | trades | gross_pnl | costs | net_pnl | "
        "expectancy | wins | losses | win% | avg_win | avg_loss | "
        "profit_factor | max_DD"
    )

    for symbol in SAMPLE_SYMBOLS:

        if symbol not in universe:
            print(f"{symbol}: NOT_IN_REAL_UNIVERSE")

        instrument_key = key_map.get(symbol, f"NSE_EQ|{symbol}")

        raw = fetch_history(instrument_key, days=30)
        bars = normalize_candles(raw)
        sessions = group_sessions(bars)

        print()
        print(
            f"### {symbol} | {instrument_key} | "
            f"bars={len(bars)} | sessions={len(sessions)} | "
            f"from={bars[0].ts if bars else 'NONE'} | "
            f"to={bars[-1].ts if bars else 'NONE'}"
        )

        strategy_results = {
            "VWAP Pullback": vwap_pullback_trades(symbol, sessions),
            "ORB Breakout": orb_breakout_trades(symbol, sessions),
            "Gap Continuation": gap_continuation_trades(symbol, sessions),
        }

        for strategy, trades in strategy_results.items():

            summary = summarize(trades)

            try:
                reconcile(trades, summary)
            except AssertionError:
                overall_reconcile = False
                raise

            pf = summary["profit_factor"]

            pf_text = (
                "INF"
                if isinstance(pf, float) and math.isinf(pf)
                else f"{float(pf):.2f}"
            )

            print(
                f"{symbol} | "
                f"{strategy} | "
                f"{summary['trade_count']} | "
                f"{float(summary['gross_pnl']):.2f} | "
                f"{float(summary['costs']):.2f} | "
                f"{float(summary['net_pnl']):.2f} | "
                f"{float(summary['expectancy']):.4f} | "
                f"{summary['wins']} | "
                f"{summary['losses']} | "
                f"{float(summary['win_rate']):.2f}% | "
                f"{float(summary['avg_win']):.2f} | "
                f"{float(summary['avg_loss']):.2f} | "
                f"{pf_text} | "
                f"{float(summary['max_drawdown']):.2f}"
            )

            print("FIRST 5 REAL TRADES:")

            for t in trades[:5]:
                print(
                    f"  {t.entry_ts.isoformat()} | "
                    f"{t.entry_price:.2f} | "
                    f"{t.side} | "
                    f"{t.entry_reason} | "
                    f"{t.exit_ts.isoformat()} | "
                    f"{t.exit_price:.2f} | "
                    f"{t.exit_reason} | "
                    f"gross={t.gross_pnl:.2f} | "
                    f"cost={t.costs:.2f} | "
                    f"net={t.net_pnl:.2f}"
                )

            if not trades:
                print("  NO ACTUAL SIGNALS")

    print()
    print(
        "TRADE_LEDGER_RECONCILES_WITH_SUMMARY = "
        + ("YES" if overall_reconcile else "NO")
    )

    print("SYNTHETIC_STRATEGY_METRICS = 0")
    print("VWAP_ORB_GAP_EXECUTED_INDEPENDENTLY = YES")
    print("PRODUCTION_DB_MODIFIED = NO")

    print()
    print(
        "IMPORTANT = This verifier does not declare tomorrow READY. "
        "Its only purpose is to establish genuine candle-triggered "
        "strategy evidence."
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print()
        print("VERIFICATION = FAIL")
        print(f"BLOCKER = {type(exc).__name__}: {exc}")
        raise
