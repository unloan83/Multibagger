#!/usr/bin/env python3
"""
Ultra-fast Forensic Audit Script for Active Production Scanner on OCI
Calculates exact distributions, reachability, bottleneck rules, and top 20 near-misses.
"""
from __future__ import annotations

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import json
import logging
from datetime import datetime, timezone, timedelta
import pandas as pd
import numpy as np
import duckdb

from engine.config import Settings
from engine.regime_detector import detect_regime
from engine.strategy_router import route_strategy

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(message)s]")
LOG = logging.getLogger("fast_forensic")

DB_PATH = Path("/tmp/snap_upstox.duckdb")
OUTPUT_PATH = Path("/tmp/audit_results_fast.txt")

def fast_rsi(series: pd.Series, period: int = 14) -> float:
    if len(series) < period + 1:
        return 50.0
    delta = series.diff()
    gain = delta.clip(lower=0).tail(period).mean()
    loss = (-delta.clip(upper=0)).tail(period).mean()
    if loss == 0 or pd.isna(loss):
        return 100.0 if gain > 0 else 50.0
    rs = gain / loss
    return float(100.0 - (100.0 / (1.0 + rs)))

def fast_adx(df: pd.DataFrame, period: int = 14) -> float:
    if len(df) < period + 1:
        return 15.0
    df = df.tail(period + 10)
    high = df["high"]
    low = df["low"]
    close = df["close"]
    
    tr = pd.concat([
        high - low,
        (high - close.shift(1)).abs(),
        (low - close.shift(1)).abs()
    ], axis=1).max(axis=1)
    
    up_move = high - high.shift(1)
    down_move = low.shift(1) - low
    
    plus_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
    minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)
    
    tr_sum = tr.rolling(period).sum().iloc[-1]
    if pd.isna(tr_sum) or tr_sum == 0:
        return 15.0
        
    plus_di = 100 * (pd.Series(plus_dm, index=df.index).rolling(period).sum().iloc[-1] / tr_sum)
    minus_di = 100 * (pd.Series(minus_dm, index=df.index).rolling(period).sum().iloc[-1] / tr_sum)
    
    di_sum = plus_di + minus_di
    if di_sum == 0 or pd.isna(di_sum):
        return 15.0
    dx = 100 * abs(plus_di - minus_di) / di_sum
    return float(dx)

def run():
    if not DB_PATH.exists():
        LOG.error("DB missing")
        return
    con = duckdb.connect(str(DB_PATH), read_only=True)
    settings = Settings.from_env()

    # Get latest completed run
    run_row = con.execute("SELECT run_id, started_at FROM scanner_runs ORDER BY started_at DESC LIMIT 1").fetchone()
    now = run_row[1] if run_row else datetime.now(timezone.utc)
    if isinstance(now, str):
        now = datetime.fromisoformat(now)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    LOG.info("Audit at timestamp: %s", now.isoformat())

    # Get bars for last 3 days
    min_ts = now - timedelta(days=3)
    bars_df = con.execute("""
        SELECT symbol, ts, open, high, low, close, volume, bid, ask
        FROM minute_bars
        WHERE ts >= ? AND ts <= ?
        ORDER BY ts ASC
    """, [min_ts, now]).fetchdf()

    LOG.info("Fetched %d bars for %d symbols", len(bars_df), len(bars_df['symbol'].unique()))

    grouped = dict(tuple(bars_df.groupby("symbol")))

    nifty_frame = grouped.get(settings.market_index_symbol, pd.DataFrame())
    vix_frame = grouped.get(settings.vix_symbol, pd.DataFrame())

    symbol_features = []
    opening_trends = []

    for sym, frame in grouped.items():
        if sym in (settings.market_index_symbol, settings.vix_symbol):
            continue
        if len(frame) < 15:
            continue

        df = frame.copy().sort_values("ts")
        sessions = pd.to_datetime(df.ts, utc=True).dt.tz_convert("Asia/Kolkata").dt.date
        df["session"] = sessions
        last_session = sessions.iloc[-1]
        session = df[df.session == last_session]
        if len(session) < 15:
            continue

        last = session.iloc[-1]
        close = float(last.close)
        bid = float(last.bid or 0)
        ask = float(last.ask or 0)
        vol = float(last.volume)

        # Opening trend
        open_p = float(session.iloc[0].open)
        close_15 = float(session.iloc[14].close)
        ret_15 = (close_15 - open_p) / open_p * 100 if open_p > 0 else 0.0
        opening_trends.append("BULLISH" if ret_15 > 0.1 else "BEARISH" if ret_15 < -0.1 else "RANGE")

        # Indicators
        typical = (session.high + session.low + session.close) / 3
        cum_val = (typical * session.volume).cumsum()
        cum_vol = session.volume.cumsum().replace(0, np.nan)
        vwap = float((cum_val / cum_vol).iloc[-1]) if float(cum_vol.iloc[-1] or 0) > 0 else close

        # ATR 14
        tr = pd.concat([session.high - session.low, (session.high - session.close.shift(1)).abs(), (session.low - session.close.shift(1)).abs()], axis=1).max(axis=1)
        atr = float(tr.tail(14).mean()) if len(tr) >= 14 else float(session.high.max() - session.low.min())
        atr_pct = (atr / close * 100) if close > 0 else 0.0

        # Bollinger Bands (20, 2.5)
        sma20 = float(session.close.tail(20).mean()) if len(session) >= 20 else close
        std20 = float(session.close.tail(20).std()) if len(session) >= 20 else 0.0
        bb_upper = sma20 + 2.5 * std20
        bb_lower = sma20 - 2.5 * std20
        bb_pos = "ABOVE_UPPER" if close >= bb_upper else "BELOW_LOWER" if close <= bb_lower else "INSIDE"

        # Spreads & Rvol
        midpoint = (ask + bid) / 2 if (ask > bid > 0) else close
        spread_bps = (ask - bid) / midpoint * 10_000 if (ask > bid > 0) else 0.0

        prior = df[df.session != last_session]
        daily_volume = float(prior.volume.groupby(prior.session).sum().median()) if len(prior) else vol * 375
        daily_range_pct = float((((prior.high.groupby(prior.session).max() - prior.low.groupby(prior.session).min()) / prior.close.groupby(prior.session).last()) * 100).median()) if len(prior) else 2.0

        comp_vol = float(prior.groupby("session").nth(len(session)-1).volume.median()) if len(prior) else 0.0
        relative_volume = vol / comp_vol if comp_vol > 0 else 1.0

        adx14 = fast_adx(session, 14)
        adx9 = fast_adx(session, 9)
        adx21 = fast_adx(session, 21)
        rsi = fast_rsi(session.close, 14)

        vwap_atr_dist = abs(close - vwap) / atr if atr > 0 else 0.0
        vwap_dist_pct = abs(close - vwap) / vwap * 100 if vwap > 0 else 0.0

        # Trend classification
        recent = session.tail(5)
        ret_bps = (close - open_p) / open_p * 10_000 if open_p > 0 else 0.0
        rising = close > float(recent.close.iloc[0]) and close > float(recent.close.mean())
        falling = close < float(recent.close.iloc[0]) and close < float(recent.close.mean())
        trend = "BULLISH" if (ret_bps >= 10 and close > vwap and rising) else "BEARISH" if (ret_bps <= -10 and close < vwap and falling) else "RANGE"

        # Base Filters
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
            "symbol": sym, "ltp": close, "adx14": adx14, "adx9": adx9, "adx21": adx21,
            "rsi": rsi, "atr": atr, "atr_pct": atr_pct, "vwap": vwap, "vwap_atr_dist": vwap_atr_dist,
            "vwap_dist_pct": vwap_dist_pct, "bb_pos": bb_pos, "bb_upper": bb_upper, "bb_lower": bb_lower,
            "relative_volume": relative_volume, "spread_bps": spread_bps, "daily_volume": daily_volume,
            "daily_range_pct": daily_range_pct, "trend": trend, "passed_base": passed_base,
            "failed_base": failed_base, "frame": session
        })

    LOG.info("Evaluated %d symbols in universe", len(symbol_features))

    adv = opening_trends.count("BULLISH")
    dec = opening_trends.count("BEARISH")
    breadth = adv / max(dec, 1) if adv or dec else None
    regime = detect_regime(nifty_frame, vix_frame, breadth, settings, now)
    route = route_strategy(regime.regime, ())

    feat_df = pd.DataFrame(symbol_features)

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

    # Reachability
    reachability = {
        "ALPHA": {"evaluated": len(feat_df), "pass_base": 0, "pass_adx14_gt_25": 0, "pass_pullback_trend": 0, "pass_all": 0},
        "BETA": {"evaluated": len(feat_df), "pass_base": 0, "pass_rvol_ge_1_8": 0, "pass_adx9_gt_18": 0, "pass_all": 0},
        "GAMMA": {"evaluated": len(feat_df), "pass_base": 0, "pass_adx21_lt_22": 0, "pass_vwap_dist_ge_2": 0, "pass_rsi_extreme": 0, "pass_all": 0},
        "DELTA": {"evaluated": len(feat_df), "pass_base": 0, "pass_rsi_extreme": 0, "pass_rvol_gt_2_5": 0, "pass_all": 0},
    }

    near_misses = []

    for sf in symbol_features:
        sym = sf["symbol"]
        close = sf["ltp"]
        atr = sf["atr"]
        vwap = sf["vwap"]
        rvol = sf["relative_volume"]
        passed_base = sf["passed_base"]
        trend = sf["trend"]
        session = sf["frame"]

        # ALPHA
        c1 = passed_base
        c2 = sf["adx14"] > 25.0
        c3 = trend in ("BULLISH", "BEARISH")
        recent = session.tail(4)
        c4 = (trend == "BULLISH" and recent.low.min() <= vwap + 0.2 * atr and close > vwap) or \
             (trend == "BEARISH" and recent.high.max() >= vwap - 0.2 * atr and close < vwap)

        if c1: reachability["ALPHA"]["pass_base"] += 1
        if c2: reachability["ALPHA"]["pass_adx14_gt_25"] += 1
        if c3: reachability["ALPHA"]["pass_pullback_trend"] += 1
        if c1 and c2 and c3 and c4: reachability["ALPHA"]["pass_all"] += 1

        failed_alpha = []
        if not c1: failed_alpha.append("BASE_FILTER")
        if not c2: failed_alpha.append(f"ADX14({sf['adx14']:.1f}<=25)")
        if not c3: failed_alpha.append(f"TREND({trend}!=BULL/BEAR)")
        if not c4: failed_alpha.append("NO_PULLBACK_CANDLE")

        near_misses.append({
            "symbol": sym, "strategy": "ALPHA", "side": "LONG" if close > vwap else "SHORT",
            "passed": sum([c1, c2, c3, c4]), "failed": failed_alpha, "ltp": close,
            "vwap_dist": sf["vwap_dist_pct"], "frame": session
        })

        # BETA
        c1_b = passed_base
        c2_b = rvol >= 1.8
        c3_b = sf["adx9"] > 18.0

        if c1_b: reachability["BETA"]["pass_base"] += 1
        if c2_b: reachability["BETA"]["pass_rvol_ge_1_8"] += 1
        if c3_b: reachability["BETA"]["pass_adx9_gt_18"] += 1
        if c1_b and c2_b and c3_b: reachability["BETA"]["pass_all"] += 1

        failed_beta = []
        if not c1_b: failed_beta.append("BASE_FILTER")
        if not c2_b: failed_beta.append(f"RVOL({rvol:.2f}<1.8)")
        if not c3_b: failed_beta.append(f"ADX9({sf['adx9']:.1f}<=18)")

        near_misses.append({
            "symbol": sym, "strategy": "BETA", "side": "LONG" if close > vwap else "SHORT",
            "passed": sum([c1_b, c2_b, c3_b]), "failed": failed_beta, "ltp": close,
            "vwap_dist": sf["vwap_dist_pct"], "frame": session
        })

        # GAMMA
        c1_g = passed_base
        c2_g = sf["adx21"] < 22.0
        c3_g = sf["vwap_dist_pct"] >= 2.0 or sf["bb_pos"] != "INSIDE"
        c4_g = sf["rsi"] > 70 or sf["rsi"] < 30

        if c1_g: reachability["GAMMA"]["pass_base"] += 1
        if c2_g: reachability["GAMMA"]["pass_adx21_lt_22"] += 1
        if c3_g: reachability["GAMMA"]["pass_vwap_dist_ge_2"] += 1
        if c4_g: reachability["GAMMA"]["pass_rsi_extreme"] += 1
        if c1_g and c2_g and c3_g and c4_g: reachability["GAMMA"]["pass_all"] += 1

        failed_gamma = []
        if not c1_g: failed_gamma.append("BASE_FILTER")
        if not c2_g: failed_gamma.append(f"ADX21({sf['adx21']:.1f}>=22)")
        if not c3_g: failed_gamma.append(f"NO_EXTREME_DIST({sf['vwap_dist_pct']:.2f}%<2%)")
        if not c4_g: failed_gamma.append(f"RSI({sf['rsi']:.1f})")

        near_misses.append({
            "symbol": sym, "strategy": "GAMMA", "side": "SHORT" if sf["rsi"] > 50 else "LONG",
            "passed": sum([c1_g, c2_g, c3_g, c4_g]), "failed": failed_gamma, "ltp": close,
            "vwap_dist": sf["vwap_dist_pct"], "frame": session
        })

        # DELTA
        c1_d = passed_base
        c2_d = sf["rsi"] > 80 or sf["rsi"] < 20
        c3_d = rvol > 2.5

        if c1_d: reachability["DELTA"]["pass_base"] += 1
        if c2_d: reachability["DELTA"]["pass_rsi_extreme"] += 1
        if c3_d: reachability["DELTA"]["pass_rvol_gt_2_5"] += 1
        if c1_d and c2_d and c3_d: reachability["DELTA"]["pass_all"] += 1

    # Top near misses
    nm_df = pd.DataFrame(near_misses)
    top_nm = nm_df.sort_values(by=["passed", "vwap_dist"], ascending=[False, False]).head(20)

    outcomes = []
    for idx, row in top_nm.iterrows():
        sym = row["symbol"]
        side = row["side"]
        entry = row["ltp"]
        atr = row["frame"].iloc[-1]["atr"] if "atr" in row["frame"].columns else entry * 0.01

        fut = con.execute("SELECT high, low, close FROM minute_bars WHERE symbol=? AND ts > ? ORDER BY ts ASC LIMIT 60", [sym, now]).fetchdf()
        mfe, mae, ret_15 = 0.0, 0.0, 0.0
        risk = max(atr * 0.5, entry * 0.005)
        if not fut.empty:
            if side == "LONG":
                mfe = (fut["high"].max() - entry) / risk
                mae = (entry - fut["low"].min()) / risk
                if len(fut) >= 15: ret_15 = (fut["close"].iloc[14] - entry) / entry * 100
            else:
                mfe = (entry - fut["low"].min()) / risk
                mae = (fut["high"].max() - entry) / risk
                if len(fut) >= 15: ret_15 = (entry - fut["close"].iloc[14]) / entry * 100

        verdict = "BAD_REJECT" if (mfe >= 1.5 and mae <= 1.0) else "GOOD_REJECT" if (mae >= 1.5 and mfe <= 0.5) else "AMBIGUOUS"

        outcomes.append({
            "rank": len(outcomes) + 1, "stock": sym, "strategy": row["strategy"], "side": side,
            "passed": row["passed"], "failed": ", ".join(row["failed"]), "ltp": entry,
            "mfe_r": round(mfe, 2), "mae_r": round(mae, 2), "ret_15m": round(ret_15, 2), "verdict": verdict
        })

    res = {
        "regime": regime.regime,
        "routed_strategy": route.selected_strategy,
        "distributions": dist_report,
        "reachability": reachability,
        "near_misses": outcomes
    }

    OUTPUT_PATH.write_text(json.dumps(res, indent=2))
    LOG.info("Audit completed and saved to %s", OUTPUT_PATH)

if __name__ == "__main__":
    run()
