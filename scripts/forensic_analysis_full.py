#!/usr/bin/env python3
"""
Deep Forensic Audit Script for Active Production Scanner on OCI
Calculates Steps 2-7 empirically using upstox_market_data.duckdb snapshot.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import json
import math
import logging
from datetime import datetime, timezone, timedelta
from typing import Any
import pandas as pd
import numpy as np
import duckdb

from engine.config import Settings
from engine.store import MarketStore
from engine.strategies import (
    enrich, intraday_indicator_window, active_agent,
    classify_price_trend
)
from engine.regime_detector import detect_regime
from engine.strategy_router import route_strategy

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
LOG = logging.getLogger("forensic_audit")

DB_PATH = Path("/tmp/snap_upstox.duckdb")
OUTPUT_PATH = Path("/tmp/audit_results.txt")

def run_forensic_audit():
    if not DB_PATH.exists():
        LOG.error("Database %s does not exist", DB_PATH)
        return

    con = duckdb.connect(str(DB_PATH), read_only=True)
    settings = Settings.from_env()

    recent_runs = con.execute("""
        SELECT run_id, started_at, reason, fresh_symbols
        FROM scanner_runs
        ORDER BY started_at DESC
        LIMIT 5
    """).fetchall()

    latest_run_ts = recent_runs[0][1] if recent_runs else datetime.now(timezone.utc)
    if isinstance(latest_run_ts, str):
        latest_run_ts = datetime.fromisoformat(latest_run_ts)
    if latest_run_ts.tzinfo is None:
        latest_run_ts = latest_run_ts.replace(tzinfo=timezone.utc)

    LOG.info("Auditing universe data at timestamp: %s", latest_run_ts.isoformat())

    symbols = con.execute("SELECT DISTINCT symbol FROM minute_bars").fetchdf()["symbol"].tolist()
    symbols = [s for s in symbols if s not in (settings.market_index_symbol, settings.vix_symbol)]
    LOG.info("Total distinct stock symbols in DB: %d", len(symbols))

    min_query_ts = latest_run_ts - timedelta(days=5)
    LOG.info("Querying minute_bars from %s...", min_query_ts.isoformat())

    all_bars_df = con.execute("""
        SELECT symbol, ts, open, high, low, close, volume, bid, ask
        FROM minute_bars
        WHERE ts >= ? AND ts <= ?
        ORDER BY ts ASC
    """, [min_query_ts, latest_run_ts]).fetchdf()

    LOG.info("Loaded %d minute bars across %d symbols", len(all_bars_df), len(all_bars_df['symbol'].unique()))

    grouped = dict(tuple(all_bars_df.groupby("symbol")))

    nifty_frame = grouped.get(settings.market_index_symbol, pd.DataFrame())
    vix_frame = grouped.get(settings.vix_symbol, pd.DataFrame())

    opening_trends = []
    symbol_features = []
    now = latest_run_ts

    count = 0
    total_syms = len(grouped)

    for symbol, frame in grouped.items():
        count += 1
        if count % 100 == 0:
            LOG.info("Processed %d / %d symbols...", count, total_syms)

        if symbol in (settings.market_index_symbol, settings.vix_symbol):
            continue
        if len(frame) < 15:
            continue
        
        try:
            df = enrich(intraday_indicator_window(frame))
            if df.empty:
                continue
            last = df.iloc[-1]
            
            session = df[df.session == last.session]
            if len(session) < 15:
                continue

            if len(session) >= 15:
                open_p = float(session.iloc[0].open)
                close_p = float(session.iloc[14].close) if len(session) > 14 else float(session.iloc[-1].close)
                if open_p > 0:
                    ret = (close_p - open_p) / open_p * 100
                    opening_trends.append("BULLISH" if ret > 0.1 else "BEARISH" if ret < -0.1 else "RANGE")

            bid, ask, close, atr = float(last.bid or 0), float(last.ask or 0), float(last.close), float(last.atr or 0)
            vwap = float(last.vwap or close)
            vol = float(last.volume)

            midpoint = (ask + bid) / 2 if (ask > bid > 0) else close
            spread_bps = (ask - bid) / midpoint * 10_000 if (ask > bid > 0) else 0.0
            atr_pct = (atr / close * 100) if (close > 0 and atr > 0) else 0.0

            history = frame.copy().sort_values("ts")
            history["session"] = pd.to_datetime(history.ts, utc=True).dt.tz_convert("Asia/Kolkata").dt.date
            prior = history[history.session != last.session]
            daily_volume = prior.volume.groupby(prior.session).sum().tail(20).median() if len(prior) else vol * 375
            daily_range_pct = (((prior.high.groupby(prior.session).max() - prior.low.groupby(prior.session).min())
                                / prior.close.groupby(prior.session).last()) * 100).tail(20).median() if len(prior) else 2.0
            minute_idx = len(session) - 1
            comparable = prior.groupby("session").nth(minute_idx).volume if len(prior) else pd.Series(dtype=float)
            comparable_mean = float(comparable.tail(20).median()) if len(comparable) else 0.0
            relative_volume = vol / comparable_mean if comparable_mean > 0 else 1.0

            adx14 = float(last.adx14) if "adx14" in last and np.isfinite(last.adx14) else 15.0
            adx9 = float(last.adx9) if "adx9" in last and np.isfinite(last.adx9) else 15.0
            adx21 = float(last.adx21) if "adx21" in last and np.isfinite(last.adx21) else 15.0
            
            rsi = 50.0
            if len(session) >= 15:
                delta = session.close.diff()
                gain = delta.clip(lower=0).rolling(14).mean().iloc[-1]
                loss = (-delta.clip(upper=0)).rolling(14).mean().iloc[-1]
                if pd.notna(loss) and loss > 0:
                    rs = gain / loss
                    rsi = float(100.0 - (100.0 / (1.0 + rs)))
                elif pd.notna(gain) and gain > 0:
                    rsi = 100.0

            vwap_atr_dist = abs(close - vwap) / atr if atr > 0 else 0.0
            vwap_dist_pct = abs(close - vwap) / vwap * 100 if vwap > 0 else 0.0

            bb_upper = float(last.bb_upper) if "bb_upper" in last and np.isfinite(last.bb_upper) else close * 1.02
            bb_lower = float(last.bb_lower) if "bb_lower" in last and np.isfinite(last.bb_lower) else close * 0.98
            bb_mid = float(last.bb_mid) if "bb_mid" in last and np.isfinite(last.bb_mid) else close
            
            bb_pos = "INSIDE"
            if close >= bb_upper:
                bb_pos = "ABOVE_UPPER"
            elif close <= bb_lower:
                bb_pos = "BELOW_LOWER"

            trend = classify_price_trend(session, now, settings.stale_seconds)

            f_price = settings.min_price <= close <= settings.max_price
            f_volume = daily_volume >= settings.min_average_volume
            f_drange = daily_range_pct >= settings.min_average_daily_range_pct
            f_spread = spread_bps <= settings.max_spread_bps
            f_atr = atr_pct >= settings.min_intraday_atr_pct

            passed_base = f_price and f_volume and f_drange and f_spread and f_atr

            failed_base = []
            if not f_price: failed_base.append(f"PRICE({close:.1f})")
            if not f_volume: failed_base.append(f"DAILY_VOL({daily_volume:.0f})")
            if not f_drange: failed_base.append(f"DAILY_RANGE({daily_range_pct:.2f}%)")
            if not f_spread: failed_base.append(f"SPREAD({spread_bps:.1f}bps)")
            if not f_atr: failed_base.append(f"ATR_PCT({atr_pct:.2f}%)")

            symbol_features.append({
                "symbol": symbol,
                "ltp": close,
                "adx14": adx14,
                "adx9": adx9,
                "adx21": adx21,
                "rsi": rsi,
                "atr": atr,
                "atr_pct": atr_pct,
                "vwap": vwap,
                "vwap_atr_dist": vwap_atr_dist,
                "vwap_dist_pct": vwap_dist_pct,
                "bb_pos": bb_pos,
                "bb_upper": bb_upper,
                "bb_lower": bb_lower,
                "relative_volume": relative_volume,
                "spread_bps": spread_bps,
                "daily_volume": daily_volume,
                "daily_range_pct": daily_range_pct,
                "trend": trend,
                "passed_base": passed_base,
                "failed_base": failed_base,
                "session_bars": len(session),
                "frame": session
            })
        except Exception:
            continue

    LOG.info("Finished evaluating %d total symbols", len(symbol_features))

    advances = opening_trends.count("BULLISH")
    declines = opening_trends.count("BEARISH")
    breadth_ratio = advances / max(declines, 1) if advances or declines else None
    regime = detect_regime(nifty_frame, vix_frame, breadth_ratio, settings, now)
    route = route_strategy(regime.regime, ())

    LOG.info("Detected Regime: %s (as_of %s), Routed Strategy: %s", regime.regime, regime.as_of, route.selected_strategy)

    feat_df = pd.DataFrame(symbol_features)

    # STEP 3: MEASURE FEATURE DISTRIBUTIONS
    metrics = ["adx14", "adx9", "adx21", "rsi", "relative_volume", "vwap_atr_dist", "vwap_dist_pct", "atr_pct", "spread_bps"]
    dist_report = {}
    for m in metrics:
        s = feat_df[m].dropna()
        dist_report[m] = {
            "MIN": float(s.min()),
            "P10": float(s.quantile(0.10)),
            "P25": float(s.quantile(0.25)),
            "MEDIAN": float(s.median()),
            "P75": float(s.quantile(0.75)),
            "P90": float(s.quantile(0.90)),
            "MAX": float(s.max())
        }

    # STEP 4: STRATEGY REACHABILITY
    reachability = {
        "ALPHA": {"evaluated": len(feat_df), "c1_base": 0, "c2_adx14_gt_25": 0, "c3_pullback_trend": 0, "c4_candle_confirm": 0, "pass_all": 0},
        "BETA": {"evaluated": len(feat_df), "c1_base": 0, "c2_rvol_ge_1_8": 0, "c3_adx9_gt_18": 0, "c4_15m_breakout": 0, "pass_all": 0},
        "GAMMA": {"evaluated": len(feat_df), "c1_base": 0, "c2_adx21_lt_22": 0, "c3_vwap_or_bb_extreme": 0, "c4_reversion_confirm": 0, "pass_all": 0},
        "DELTA": {"evaluated": len(feat_df), "c1_base": 0, "c2_rsi_extreme": 0, "c3_rvol_gt_2_5": 0, "c4_reversal_candle": 0, "pass_all": 0},
    }

    near_misses = []

    for sf in symbol_features:
        session = sf["frame"]
        sym = sf["symbol"]
        close = sf["ltp"]
        atr = sf["atr"]
        vwap = sf["vwap"]
        rvol = sf["relative_volume"]
        passed_base = sf["passed_base"]
        
        # 1. ALPHA evaluation
        c1_alpha = passed_base
        c2_alpha = sf["adx14"] > 25.0
        trend = sf["trend"]
        c3_alpha = trend in ("BULLISH", "BEARISH")
        
        recent = session.tail(4)
        c4_alpha = False
        alpha_side = None
        if trend == "BULLISH" and recent.low.min() <= vwap + 0.2 * atr and close > vwap:
            c4_alpha = True
            alpha_side = "LONG"
        elif trend == "BEARISH" and recent.high.max() >= vwap - 0.2 * atr and close < vwap:
            c4_alpha = True
            alpha_side = "SHORT"

        if c1_alpha: reachability["ALPHA"]["c1_base"] += 1
        if c2_alpha: reachability["ALPHA"]["c2_adx14_gt_25"] += 1
        if c3_alpha: reachability["ALPHA"]["c3_pullback_trend"] += 1
        if c4_alpha: reachability["ALPHA"]["c4_candle_confirm"] += 1
        if c1_alpha and c2_alpha and c3_alpha and c4_alpha: reachability["ALPHA"]["pass_all"] += 1

        alpha_passed_cnt = sum([c1_alpha, c2_alpha, c3_alpha, c4_alpha])
        alpha_failed = []
        if not c1_alpha: alpha_failed.append(f"BASE_FILTER({','.join(sf['failed_base'])})")
        if not c2_alpha: alpha_failed.append(f"ADX14({sf['adx14']:.1f}<=25)")
        if not c3_alpha: alpha_failed.append(f"TREND({trend}!=BULL/BEAR)")
        if not c4_alpha: alpha_failed.append("NO_VWAP_PULLBACK_CANDLE")

        near_misses.append({
            "symbol": sym, "strategy": "ALPHA", "side": alpha_side or "LONG",
            "passed_count": alpha_passed_cnt, "failed_conditions": alpha_failed,
            "ltp": close, "adx": sf["adx14"], "rsi": sf["rsi"], "rvol": rvol, "vwap_dist": sf["vwap_dist_pct"],
            "trend": trend, "frame": session
        })

        # 2. BETA evaluation
        c1_beta = passed_base
        c2_beta = rvol >= 1.8
        c3_beta = sf["adx9"] > 18.0
        
        c4_beta = False
        beta_side = None
        candles = session.copy()
        candles["ts"] = pd.to_datetime(candles.ts, utc=True)
        fifteen = candles.set_index("ts").resample("15min", origin="start_day", offset="15min").agg(
            open=("open", "first"), high=("high", "max"), low=("low", "min"), close=("close", "last")
        ).dropna()
        if len(fifteen) >= 2:
            completed = fifteen.iloc[:-1]
            if not completed.empty:
                b_high, b_low = float(completed.high.max()), float(completed.low.min())
                if close > b_high and close > vwap:
                    c4_beta = True
                    beta_side = "LONG"
                elif close < b_low and close < vwap:
                    c4_beta = True
                    beta_side = "SHORT"

        if c1_beta: reachability["BETA"]["c1_base"] += 1
        if c2_beta: reachability["BETA"]["c2_rvol_ge_1_8"] += 1
        if c3_beta: reachability["BETA"]["c3_adx9_gt_18"] += 1
        if c4_beta: reachability["BETA"]["c4_15m_breakout"] += 1
        if c1_beta and c2_beta and c3_beta and c4_beta: reachability["BETA"]["pass_all"] += 1

        beta_passed_cnt = sum([c1_beta, c2_beta, c3_beta, c4_beta])
        beta_failed = []
        if not c1_beta: beta_failed.append(f"BASE_FILTER({','.join(sf['failed_base'])})")
        if not c2_beta: beta_failed.append(f"RVOL({rvol:.2f}<1.8)")
        if not c3_beta: beta_failed.append(f"ADX9({sf['adx9']:.1f}<=18)")
        if not c4_beta: beta_failed.append("NO_15M_BREAKOUT")

        near_misses.append({
            "symbol": sym, "strategy": "BETA", "side": beta_side or ("LONG" if close > vwap else "SHORT"),
            "passed_count": beta_passed_cnt, "failed_conditions": beta_failed,
            "ltp": close, "adx": sf["adx9"], "rsi": sf["rsi"], "rvol": rvol, "vwap_dist": sf["vwap_dist_pct"],
            "trend": trend, "frame": session
        })

        # 3. GAMMA evaluation
        c1_gamma = passed_base
        c2_gamma = sf["adx21"] < 22.0
        c3_gamma = (sf["bb_pos"] in ("ABOVE_UPPER", "BELOW_LOWER")) or (sf["vwap_dist_pct"] >= 2.0)
        c4_gamma = (sf["rsi"] > 70 or sf["rsi"] < 30)

        if c1_gamma: reachability["GAMMA"]["c1_base"] += 1
        if c2_gamma: reachability["GAMMA"]["c2_adx21_lt_22"] += 1
        if c3_gamma: reachability["GAMMA"]["c3_vwap_or_bb_extreme"] += 1
        if c4_gamma: reachability["GAMMA"]["c4_reversion_confirm"] += 1
        if c1_gamma and c2_gamma and c3_gamma and c4_gamma: reachability["GAMMA"]["pass_all"] += 1

        gamma_passed_cnt = sum([c1_gamma, c2_gamma, c3_gamma, c4_gamma])
        gamma_failed = []
        if not c1_gamma: gamma_failed.append(f"BASE_FILTER({','.join(sf['failed_base'])})")
        if not c2_gamma: gamma_failed.append(f"ADX21({sf['adx21']:.1f}>=22)")
        if not c3_gamma: gamma_failed.append(f"NO_BB_OR_VWAP_EXTREME(dist={sf['vwap_dist_pct']:.2f}%)")
        if not c4_gamma: gamma_failed.append(f"RSI_NOT_EXTREME({sf['rsi']:.1f})")

        gamma_side = "SHORT" if sf["rsi"] > 50 or close > vwap else "LONG"

        near_misses.append({
            "symbol": sym, "strategy": "GAMMA", "side": gamma_side,
            "passed_count": gamma_passed_cnt, "failed_conditions": gamma_failed,
            "ltp": close, "adx": sf["adx21"], "rsi": sf["rsi"], "rvol": rvol, "vwap_dist": sf["vwap_dist_pct"],
            "trend": trend, "frame": session
        })

        # 4. DELTA evaluation
        c1_delta = passed_base
        c2_delta = (sf["rsi"] > 80 or sf["rsi"] < 20)
        c3_delta = rvol > 2.5
        c4_delta = (sf["bb_pos"] in ("ABOVE_UPPER", "BELOW_LOWER"))

        if c1_delta: reachability["DELTA"]["c1_base"] += 1
        if c2_delta: reachability["DELTA"]["c2_rsi_extreme"] += 1
        if c3_delta: reachability["DELTA"]["c3_rvol_gt_2_5"] += 1
        if c4_delta: reachability["DELTA"]["c4_reversal_candle"] += 1
        if c1_delta and c2_delta and c3_delta and c4_delta: reachability["DELTA"]["pass_all"] += 1

    near_misses_df = pd.DataFrame(near_misses)
    top_near_misses = near_misses_df.sort_values(by=["passed_count", "vwap_dist"], ascending=[False, False]).head(20)

    # STEP 7: POST-MARKET OUTCOME ANALYSIS ON TOP NEAR MISSES
    outcomes = []
    for idx, row in top_near_misses.iterrows():
        sym = row["symbol"]
        decision_ts = now
        side = row["side"]
        entry_price = row["ltp"]
        atr = row["frame"].iloc[-1]["atr"] if len(row["frame"]) and "atr" in row["frame"].columns else entry_price * 0.01

        future_bars = con.execute("""
            SELECT ts, open, high, low, close
            FROM minute_bars
            WHERE symbol = ? AND ts > ?
            ORDER BY ts ASC
            LIMIT 60
        """, [sym, decision_ts]).fetchdf()

        mfe, mae = 0.0, 0.0
        ret_5, ret_15, ret_30, ret_60 = 0.0, 0.0, 0.0, 0.0
        risk = max(atr * 0.5, entry_price * 0.005)

        if not future_bars.empty:
            closes = future_bars["close"].values
            highs = future_bars["high"].values
            lows = future_bars["low"].values

            if side == "LONG":
                mfe_val = (highs.max() - entry_price) / risk
                mae_val = (entry_price - lows.min()) / risk
                if len(closes) >= 5: ret_5 = (closes[4] - entry_price) / entry_price * 100
                if len(closes) >= 15: ret_15 = (closes[14] - entry_price) / entry_price * 100
                if len(closes) >= 30: ret_30 = (closes[29] - entry_price) / entry_price * 100
                if len(closes) >= 60: ret_60 = (closes[59] - entry_price) / entry_price * 100
            else:
                mfe_val = (entry_price - lows.min()) / risk
                mae_val = (highs.max() - entry_price) / risk
                if len(closes) >= 5: ret_5 = (entry_price - closes[4]) / entry_price * 100
                if len(closes) >= 15: ret_15 = (entry_price - closes[14]) / entry_price * 100
                if len(closes) >= 30: ret_30 = (entry_price - closes[29]) / entry_price * 100
                if len(closes) >= 60: ret_60 = (entry_price - closes[59]) / entry_price * 100

            mfe, mae = mfe_val, mae_val

        classification = "AMBIGUOUS"
        if mfe >= 1.5 and mae <= 1.0:
            classification = "BAD_REJECT"
        elif mae >= 1.5 and mfe <= 0.5:
            classification = "GOOD_REJECT"
        else:
            classification = "AMBIGUOUS"

        outcomes.append({
            "rank": len(outcomes) + 1,
            "stock": sym,
            "strategy": row["strategy"],
            "side": side,
            "passed": row["passed_count"],
            "failed": ", ".join(row["failed_conditions"]),
            "ltp": entry_price,
            "mfe_r": round(mfe, 2),
            "mae_r": round(mae, 2),
            "ret_15m": round(ret_15, 2),
            "ret_60m": round(ret_60, 2),
            "verdict": classification
        })

    lines = []
    lines.append("=" * 90)
    lines.append("                     FORENSIC AUDIT EMPIRICAL RESULTS                               ")
    lines.append("=" * 90)

    lines.append("\nA. MARKET FEATURE DISTRIBUTIONS (Percentiles)")
    lines.append(f"{'METRIC':<20} | {'MIN':<8} | {'P10':<8} | {'P25':<8} | {'MEDIAN':<8} | {'P75':<8} | {'P90':<8} | {'MAX':<8}")
    lines.append("-" * 90)
    for m, d in dist_report.items():
        lines.append(f"{m:<20} | {d['MIN']:<8.2f} | {d['P10']:<8.2f} | {d['P25']:<8.2f} | {d['MEDIAN']:<8.2f} | {d['P75']:<8.2f} | {d['P90']:<8.2f} | {d['MAX']:<8.2f}")

    lines.append("\nB. STRATEGY REACHABILITY AUDIT")
    for strat, data in reachability.items():
        lines.append(f"\n{strat} (Total Evaluated: {data['evaluated']}):")
        for k, v in data.items():
            if k != "evaluated":
                pct = (v / max(data['evaluated'], 1)) * 100
                lines.append(f"  - {k:<25}: {v:>5} ({pct:>5.1f}%)")

    lines.append("\nC. TOP NEAR-MISS SETUPS & OUTCOME ANALYSIS")
    lines.append(f"{'RANK':<4} | {'STOCK':<12} | {'STRAT':<7} | {'SIDE':<5} | {'PASS':<4} | {'MFE(R)':<6} | {'MAE(R)':<6} | {'15m%':<6} | {'VERDICT':<11} | {'FAILED CONDITIONS'}")
    lines.append("-" * 105)
    for o in outcomes:
        lines.append(f"{o['rank']:<4} | {o['stock']:<12} | {o['strategy']:<7} | {o['side']:<5} | {o['passed']:<4} | {o['mfe_r']:<6.2f} | {o['mae_r']:<6.2f} | {o['ret_15m']:<6.2f}% | {o['verdict']:<11} | {o['failed']}")

    output_text = "\n".join(lines)
    OUTPUT_PATH.write_text(output_text)
    print(output_text)

if __name__ == "__main__":
    run_forensic_audit()
