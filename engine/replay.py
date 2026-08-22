from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from typing import Any

from .config import Settings
from .regime_detector import detect_regime
from .store import MarketStore
from .strategies import classify_price_trend, scan_symbol


def replay_recorded_entries(settings: Settings, start: date, end: date) -> dict[str, Any]:
    """Point-in-time replay of retained entries; never submits or simulates broker orders."""
    store = MarketStore(settings.db_path)
    with store.connect() as con:
        trades = _records(con, """
          SELECT * FROM paper_trades
          WHERE trading_day BETWEEN ? AND ? AND status='CLOSED'
          ORDER BY opened_at, symbol
        """, [start, end])
        index_bar_count = int(con.execute("""
          SELECT count(*) FROM minute_bars
          WHERE symbol=? AND ts>=? AND ts<?
        """, [settings.market_index_symbol, start, end + timedelta(days=1)]).fetchone()[0])
    attempts_at = Counter(str(trade["opened_at"]) for trade in trades)
    symbols_per_day = Counter((str(trade["trading_day"]), str(trade["symbol"])) for trade in trades)
    ranks_at: dict[str, list[float]] = defaultdict(list)
    for trade in trades:
        ranks_at[str(trade["opened_at"])].append(_signal_rank(trade))

    rows: list[dict[str, Any]] = []
    for trade in trades:
        opened_at = _datetime(trade["opened_at"])
        frame = _bars_through(store, str(trade["symbol"]), opened_at)
        side = str(trade.get("side") or "LONG")
        index_frame = _bars_through(store, settings.market_index_symbol, opened_at)
        vix_frame = _bars_through(store, settings.vix_symbol, opened_at)
        regime = detect_regime(index_frame, vix_frame, _breadth_through(store, opened_at), settings, opened_at)
        candidates = scan_symbol(frame, settings, opened_at, regime=regime.regime)
        technical_match = next((candidate for candidate in candidates if candidate.side == side), None)
        market_trend = classify_price_trend(index_frame, opened_at, settings.stale_seconds)
        required_trend = "BULLISH" if side == "LONG" else "BEARISH"
        violations: list[str] = []
        intended = _intended(trade)
        old_reasons = intended.get("entryReasons") or {}
        if not old_reasons.get("marketTrend"):
            violations.append("NIFTY_TREND_NOT_CLASSIFIED")
        if not old_reasons.get("sectorTrend"):
            violations.append("SECTOR_TREND_NOT_CLASSIFIED")
        if market_trend != required_trend:
            violations.append(f"NIFTY_NOT_ALIGNED_{market_trend}")
        if technical_match is None:
            violations.append("A_GRADE_REGIME_STRATEGY_NOT_CONFIRMED")
        violations.extend(regime.skip_reasons)
        attempt_key = str(trade["opened_at"])
        if attempts_at[attempt_key] > settings.paper_max_open_positions and _signal_rank(trade) < max(ranks_at[attempt_key]):
            violations.append("ONE_POSITION_A_GRADE_LIMIT")
        if symbols_per_day[(str(trade["trading_day"]), str(trade["symbol"]))] > 1:
            violations.append("REPEATED_SYMBOL_ENTRY")
        initial_risk = abs(float(trade["entry_quote"]) - float(trade["stop_price"])) * int(trade["quantity"])
        if initial_risk > 0 and float(trade.get("mfe") or 0) >= settings.paper_break_even_trigger_r * initial_risk:
            violations.append("PROFIT_PROTECTION_NOT_APPLIED_AT_NEW_THRESHOLD")
        accepted = technical_match is not None and market_trend == required_trend and not violations
        rows.append({
            "tradingDay": str(trade["trading_day"]),
            "tradeId": str(trade["trade_id"]),
            "symbol": str(trade["symbol"]),
            "side": side,
            "openedAt": opened_at.isoformat(),
            "actualNetPnl": round(float(trade["net_pnl"]), 2),
            "actualExitReason": str(trade.get("exit_reason") or ""),
            "marketTrendAtEntry": market_trend,
            "regime": regime.to_dict(),
            "newTechnicalSetupMatched": technical_match is not None,
            "newEntryAccepted": accepted,
            "replayNetPnl": round(float(trade["net_pnl"]), 2) if accepted else 0.0,
            "violations": list(dict.fromkeys(violations)),
        })

    sessions = []
    for trading_day in sorted({row["tradingDay"] for row in rows}):
        day_rows = [row for row in rows if row["tradingDay"] == trading_day]
        actual = round(sum(row["actualNetPnl"] for row in day_rows), 2)
        replay = round(sum(row["replayNetPnl"] for row in day_rows), 2)
        sessions.append({
            "tradingDay": trading_day,
            "actualTrades": len(day_rows),
            "replayTrades": sum(1 for row in day_rows if row["newEntryAccepted"]),
            "actualNetPnl": actual,
            "replayNetPnl": replay,
            "lossReduction": round(max(0.0, replay - actual), 2) if actual < 0 else 0.0,
        })
    return {
        "source": "RECORDED_UPSTOX_1MIN_EXECUTABLE_QUOTES",
        "strategyVersion": "intraday-dual-regime-managed-v4",
        "method": "POINT_IN_TIME_REPLAY_OF_RECORDED_ENTRY_ATTEMPTS",
        "marketIndexBars": index_bar_count,
        "limitations": [
            "A rejected historical entry contributes zero P&L; this proves avoided loss, not positive expectancy.",
            *(["No NIFTY 50 bars exist in the requested replay window; market direction therefore fails closed as RANGE."]
              if index_bar_count == 0 else []),
        ],
        "sessions": sessions,
        "trades": rows,
    }


def _bars_through(store: MarketStore, symbol: str, observed_at: datetime):
    with store.connect() as con:
        return con.execute("""
          SELECT * FROM minute_bars
          WHERE symbol=? AND ts<=? AND ts>=? - INTERVAL '10 days'
          ORDER BY ts
        """, [symbol, observed_at, observed_at]).df()


def _breadth_through(store: MarketStore, observed_at: datetime) -> float | None:
    with store.connect() as con:
        advances, declines = con.execute("""
          WITH session AS (
            SELECT symbol, arg_min(open, ts) first_open, arg_max(close, ts) last_close
            FROM minute_bars
            WHERE ts<=? AND CAST(ts AT TIME ZONE 'Asia/Kolkata' AS DATE)=CAST(? AT TIME ZONE 'Asia/Kolkata' AS DATE)
              AND symbol NOT IN ('NIFTY 50', 'INDIA VIX') GROUP BY symbol
          )
          SELECT count(*) FILTER (WHERE last_close>first_open),
                 count(*) FILTER (WHERE last_close<first_open) FROM session
        """, [observed_at, observed_at]).fetchone()
    return float(advances) / max(int(declines), 1) if advances or declines else None


def _records(con: Any, query: str, parameters: list[Any]) -> list[dict[str, Any]]:
    cursor = con.execute(query, parameters)
    columns = [item[0] for item in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def _intended(trade: dict[str, Any]) -> dict[str, Any]:
    try:
        return json.loads(str(trade.get("intended_order_json") or "{}"))
    except (TypeError, ValueError, json.JSONDecodeError):
        return {}


def _signal_rank(trade: dict[str, Any]) -> float:
    return float((_intended(trade).get("signal") or {}).get("rank_score") or 0)


def _datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value))
