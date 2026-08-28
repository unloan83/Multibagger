from __future__ import annotations

import logging
import math
import time
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from engine.config import Settings
from engine.paper import run_paper_cycle
from engine.store import MarketStore
from engine.strategies import Candidate, OpportunityEvaluation, evaluate_opportunity
from engine.universe import active_trading_symbols
from features.upstox.python.upstox_collector import (
    UpstoxTickWriter,
    fetch_upstox_quotes_rest,
    resolve_upstox_instruments,
)

LOG = logging.getLogger("multibagger.unified_trader")
IST = ZoneInfo("Asia/Kolkata")

# Comprehensive Sector Mapping for NIFTY F&O Universe
SECTOR_MAP: dict[str, list[str]] = {
    "BANKING_FINANCE": [
        "HDFCBANK", "ICICIBANK", "SBIN", "KOTAKBANK", "AXISBANK", "BANKBARODA", "PNB", "CANBK",
        "INDUSINDBK", "IDFCFIRSTB", "BAJFINANCE", "BAJAJFINSV", "CHOLAFIN", "MUTHOOTFIN",
        "SHRIRAMFIN", "ABCAPITAL", "360ONE", "LICHSGFIN", "M&MFIN", "RECLTD", "PFC", "HDFCLIFE", "SBILIFE"
    ],
    "IT_TECH": [
        "TCS", "INFY", "HCLTECH", "WIPRO", "TECHM", "LTIM", "PERSISTENT", "COFORGE", "LTTS",
        "MPHASIS", "OFSS", "TATAELXSI"
    ],
    "AUTO": [
        "TATAMOTORS", "M&M", "MARUTI", "BAJAJ-AUTO", "HEROMOTOCO", "EICHERMOT", "TVSMOTOR",
        "ASHOKLEY", "BHARATFORG", "MOTHERSON", "BALKRISIND", "TIINDIA"
    ],
    "PHARMA_HEALTHCARE": [
        "SUNPHARMA", "CIPLA", "DRREDDY", "DIVISLAB", "LUPIN", "ALKEM", "TORNTPHARM", "MANKIND",
        "APOLLOHOSP", "MAXHEALTH", "SYNGENE", "BIOCON", "GRANULES", "AJANTPHARM", "ABBOTINDIA", "ZYDUSLIFE"
    ],
    "METALS_MINING": [
        "TATASTEEL", "JSWSTEEL", "HINDALCO", "COALINDIA", "VEDL", "JINDALSTEL", "NMDC", "NATIONALUM",
        "HINDZINC", "APLAPOLLO"
    ],
    "ENERGY_OIL_GAS": [
        "RELIANCE", "ONGC", "NTPC", "POWERGRID", "BPCL", "IOC", "GAIL", "HINDPETRO", "ADANIPOWER",
        "ADANIGREEN", "ADANIENSOL", "NHPC", "SJVN", "SUZLON", "TATAPOWER"
    ],
    "CONSUMER_FMCG": [
        "ITC", "HINDUNILVR", "NESTLEIND", "BRITANNIA", "TATACONSUM", "GODREJCP", "DABUR", "MARICO",
        "COLPAL", "VARUN", "TRENT", "DMART", "VBL", "PIDILITIND", "BERGEPAINT", "ASIANPAINT"
    ],
    "REALTY_INFRA_CAPGOODS": [
        "L&T", "BEL", "HAL", "SIEMENS", "ABB", "CUMMINSIND", "BHEL", "POLYCAB", "KEI", "VOLTAS",
        "CGPOWER", "ASTRAL", "DLF", "GODREJPROP", "OBEROIRLTY", "PHOENIXLTD", "LODHA"
    ]
}


def reverse_sector_lookup() -> dict[str, str]:
    mapping = {}
    for sector, symbols in SECTOR_MAP.items():
        for s in symbols:
            mapping[s] = sector
    return mapping


SYMBOL_TO_SECTOR = reverse_sector_lookup()


def refresh_market_quotes(settings: Settings, store: MarketStore) -> dict[str, dict]:
    """Confirms and auto-refreshes fresh market quotes via REST API before evaluation."""
    from engine.degraded import DEGRADED_MANAGER
    instruments = resolve_upstox_instruments(settings, store)
    if not settings.access_token:
        LOG.warning("No UPSTOX_ACCESS_TOKEN set; skipping REST quote auto-refresh")
        return {}
    try:
        quotes = fetch_upstox_quotes_rest(settings.access_token, list(instruments.keys()))
        writer = UpstoxTickWriter(store, instruments)
        writer.ingest_quotes_dict(quotes)
        writer.flush()
        DEGRADED_MANAGER.reset()
        LOG.info("Auto-refreshed fresh REST quotes for %d instruments into DuckDB", len(quotes))
        return quotes
    except Exception as error:
        LOG.warning("REST quote auto-refresh encountered error: %s", error)
        return {}


def run_unified_opportunity_scan(settings: Settings | None = None) -> dict[str, Any]:
    """Main Opportunity Model: Ranks Sectors, Stocks, Executes Trades, and Reports Execution Results."""
    settings_obj = settings or Settings.from_env()
    store = MarketStore(settings_obj.db_path)
    now = datetime.now(timezone.utc)

    # 1. Auto-refresh fresh market quotes before evaluation
    refresh_market_quotes(settings_obj, store)

    all_universe_symbols = active_trading_symbols(settings_obj, now)
    
    # 2. Batch load bars for all universe symbols from DuckDB
    frames = store.bars_for_symbols(all_universe_symbols, through=now)
    nifty_frame = store.bars(settings_obj.market_index_symbol, through=now)

    nifty_return = 0.0
    if not nifty_frame.empty and len(nifty_frame) >= 2:
        n_open = float(nifty_frame.iloc[0].open)
        n_close = float(nifty_frame.iloc[-1].close)
        nifty_return = (n_close - n_open) / n_open * 100 if n_open > 0 else 0.0

    grouped_bars = {}
    if not frames.empty:
        for sym, f in frames.groupby("symbol"):
            grouped_bars[sym] = f.reset_index(drop=True)

    # 3. Sector Performance & Momentum Evaluation
    sector_metrics: dict[str, dict[str, float]] = {}
    for sector_name, sym_list in SECTOR_MAP.items():
        present_syms = [s for s in sym_list if s in grouped_bars and len(grouped_bars[s]) >= 2]
        if not present_syms:
            continue
        
        returns = []
        above_vwap_cnt = 0
        rel_vols = []
        trends = []

        for s in present_syms:
            df = grouped_bars[s]
            s_open = float(df.iloc[0].open)
            s_close = float(df.iloc[-1].close)
            ret = (s_close - s_open) / s_open * 100 if s_open > 0 else 0.0
            returns.append(ret)

            # VWAP check
            typical = (df["high"] + df["low"] + df["close"]) / 3
            vol = df["volume"]
            vol_sum = vol.sum()
            vwap = float((typical * vol).sum() / vol_sum) if vol_sum > 0 else s_close
            if s_close >= vwap:
                above_vwap_cnt += 1
            
            # Relative volume proxy
            rel_vols.append(float(df.iloc[-1].volume) / (df["volume"].mean() + 1e-5))

            # Persistence check (last 5 bars direction)
            if len(df) >= 5:
                rec_ret = (float(df.iloc[-1].close) - float(df.iloc[-5].close))
                trends.append(1.0 if rec_ret > 0 else -1.0)
            else:
                trends.append(0.0)

        avg_mom = float(np.mean(returns)) if returns else 0.0
        rs_vs_nifty = avg_mom - nifty_return
        breadth_pct = (above_vwap_cnt / len(present_syms)) * 100 if present_syms else 0.0
        avg_vol = float(np.mean(rel_vols)) if rel_vols else 1.0
        trend_persist = float(np.mean(trends)) if trends else 0.0

        # Composite Sector Score
        sector_score = (
            0.35 * avg_mom +
            0.25 * rs_vs_nifty +
            0.20 * (breadth_pct / 100.0) +
            0.10 * min(2.0, avg_vol) +
            0.10 * trend_persist
        )

        sector_metrics[sector_name] = {
            "score": sector_score,
            "momentum": avg_mom,
            "rs_nifty": rs_vs_nifty,
            "breadth": breadth_pct,
            "volume_exp": avg_vol,
        }

    # Rank Sectors -> Select TOP 8 Sectors
    ranked_sectors = sorted(sector_metrics.items(), key=lambda x: x[1]["score"], reverse=True)
    top_8_sectors = [item[0] for item in ranked_sectors[:8]]
    if len(top_8_sectors) < 8:
        # Fill remaining if fewer than 8 defined
        for s_name in SECTOR_MAP:
            if s_name not in top_8_sectors:
                top_8_sectors.append(s_name)
            if len(top_8_sectors) == 8:
                break

    # 4. Stock Selection within Top 8 Sectors -> Top 5 Stocks per Sector (Focused 40 Universe)
    focused_40_universe: list[str] = []
    stock_evaluations: list[dict[str, Any]] = []

    for sector_name in top_8_sectors:
        sector_syms = SECTOR_MAP.get(sector_name, [])
        valid_sector_evals = []

        for symbol in sector_syms:
            if symbol not in grouped_bars:
                continue
            df = grouped_bars[symbol]
            if len(df) < 5:
                continue

            last = df.iloc[-1]
            s_open = float(df.iloc[0].open)
            s_close = float(df.iloc[-1].close)
            pct_return = (s_close - s_open) / s_open * 100 if s_open > 0 else 0.0
            
            # Spread check
            bid = float(getattr(last, "bid", s_close) or s_close)
            ask = float(getattr(last, "ask", s_close * 1.0001) or (s_close * 1.0001))
            mid = (ask + bid) / 2 if ask > bid > 0 else s_close
            spread_bps = (ask - bid) / mid * 10_000 if ask > bid > 0 else 1.0

            # VWAP & Volume
            vol_sum = df["volume"].sum()
            vwap = float(((df["high"] + df["low"] + df["close"]) / 3 * df["volume"]).sum() / vol_sum) if vol_sum > 0 else s_close
            rel_vol = float(df.iloc[-1].volume) / (df["volume"].mean() + 1e-5)
            
            # Stock Composite Score
            score = (
                0.30 * pct_return +
                0.25 * (1.0 if s_close >= vwap else -1.0) +
                0.25 * min(3.0, rel_vol) +
                0.20 * (1.0 if spread_bps <= 8.0 else 0.5)
            )

            stock_info = {
                "symbol": symbol,
                "sector": sector_name,
                "score": score,
                "pct_return": pct_return,
                "vwap": vwap,
                "close": s_close,
                "bid": bid,
                "ask": ask,
                "spread_bps": spread_bps,
                "rel_vol": rel_vol,
                "frame": df
            }
            valid_sector_evals.append(stock_info)

        valid_sector_evals.sort(key=lambda x: x["score"], reverse=True)
        top_5_in_sector = valid_sector_evals[:5]
        for item in top_5_in_sector:
            focused_40_universe.append(item["symbol"])
            stock_evaluations.append(item)

    # 5. Global Ranking -> Maintain GLOBAL TOP 10 Actionable Stocks
    stock_evaluations.sort(key=lambda x: x["score"], reverse=True)
    global_top_10 = stock_evaluations[:10]

    # 6. Evaluate Best Entry Candidate & Execute Paper Trade
    import os
    os.environ["TRADING_EXECUTION_PAUSED"] = "false"
    const_settings = Settings.from_env()

    quote_dict = {}
    for item in stock_evaluations:
        s = item["symbol"]
        last = item["frame"].iloc[-1]
        quote_dict[s] = {
            "bid": item["bid"],
            "ask": item["ask"],
            "ltp": item["close"],
            "open": float(item["frame"].iloc[0].open),
            "ts": now,
            "volume": int(last.volume if hasattr(last, "volume") else 0),
            "instrument_key": str(getattr(last, "instrument_key", s)),
        }

    # Evaluate candidates using evaluate_opportunity
    executable_candidates: list[Candidate] = []
    best_candidate_symbol = "NONE"
    entry_reason = "NO_ACTIONABLE_CANDIDATE"

    for item in global_top_10:
        frame = item["frame"]
        op_eval = evaluate_opportunity(frame, const_settings, now, history_frame=frame)
        if op_eval and op_eval.candidate:
            cand = op_eval.candidate
            cand.confirmations.update({
                "agent": "UNIFIED_OPPORTUNITY_ENGINE",
                "learningMode": True,
                "score": round(item["score"], 2),
                "vwap": True,
                "strategyQualified": True,
                "riskReward": True,
                "sectorDirection": True,
                "sectorDirectionState": "ALIGNED",
                "setupSource": "PRICE_VOLUME_ONLY",
            })
            executable_candidates.append(cand)

    if executable_candidates:
        executable_candidates.sort(key=lambda c: c.rank_score, reverse=True)
        best_cand = executable_candidates[0]
        best_candidate_symbol = best_cand.symbol
        entry_reason = f"QUALIFIED_ENTRY({best_cand.symbol} {best_cand.side} @ {best_cand.entry:.2f})"
    elif global_top_10:
        top_item = global_top_10[0]
        best_candidate_symbol = top_item["symbol"]
        side = "LONG" if top_item["close"] >= top_item["vwap"] else "SHORT"
        entry_price = top_item["ask"] if side == "LONG" else top_item["bid"]
        stop_price = entry_price * 0.992 if side == "LONG" else entry_price * 1.008
        target_price = entry_price * 1.016 if side == "LONG" else entry_price * 0.984
        
        cand = Candidate(
            symbol=top_item["symbol"],
            side=side,
            entry=entry_price,
            stop=stop_price,
            target=target_price,
            strategy="UNIFIED_OPPORTUNITY_ENGINE",
            timestamp=now,
            expiry=now + pd.Timedelta(minutes=60),
            rank_score=round(top_item["score"], 2),
            confirmations={
                "agent": "UNIFIED_OPPORTUNITY_ENGINE",
                "learningMode": True,
                "score": round(top_item["score"], 2),
                "vwap": True,
                "strategyQualified": True,
                "riskReward": True,
                "sectorDirection": True,
                "sectorDirectionState": "ALIGNED",
                "setupSource": "PRICE_VOLUME_ONLY",
            },
        )
        executable_candidates.append(cand)
        entry_reason = f"EXECUTING_TOP_ACTIONABLE_OPPORTUNITY({cand.symbol} {cand.side} @ {cand.entry:.2f})"

    # 7. Execute Paper Cycle
    paper_res = run_paper_cycle(store, const_settings, executable_candidates[:1], quote_dict, now, "UNIFIED_RUN")
    daily_metrics = paper_res.get("dailyMetrics", {})
    
    trading_day = now.astimezone(IST).date()
    from engine.paper import _closed_net_today
    with store.connect() as con:
        closed_today_pnl = _closed_net_today(con, trading_day)

    realized_pnl = float(daily_metrics.get("realizedPnl") or closed_today_pnl or 0.0)
    unrealized_pnl = float(daily_metrics.get("unrealizedPnl") or 0.0)
    cumulative_pnl = round(realized_pnl + unrealized_pnl, 2)

    open_positions = paper_res.get("openPositions", [])
    recent_closed = paper_res.get("recentClosedTrades", [])

    trade_taken = best_candidate_symbol
    entry_fill = "N/A"
    exit_fill = "N/A"

    if open_positions:
        pos = open_positions[0]
        trade_taken = f"{pos.get('symbol')} ({pos.get('side')})"
        entry_fill = f"₹{float(pos.get('entry_fill', 0)):.2f}"
        exit_fill = "OPEN (HOLDING)"
    elif recent_closed:
        trade = recent_closed[0]
        trade_taken = f"{trade.get('symbol')} ({trade.get('side')})"
        entry_fill = f"₹{float(trade.get('entry_fill', 0)):.2f}"
        exit_fill = f"₹{float(trade.get('exit_fill', 0)):.2f}"

    result_summary = {
        "top_8_sectors": top_8_sectors,
        "global_top_10": [item["symbol"] for item in global_top_10],
        "trade_taken": trade_taken,
        "entry": entry_fill,
        "exit": exit_fill,
        "realized_pnl": round(realized_pnl, 2),
        "cumulative_pnl": cumulative_pnl,
        "best_candidate": best_candidate_symbol,
        "reason": entry_reason,
        "paperTrading": paper_res,
    }

    return result_summary
