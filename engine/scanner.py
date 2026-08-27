from __future__ import annotations

import json
import logging
import os
import time
import uuid
from dataclasses import asdict, replace
from datetime import datetime, timezone, timedelta
from typing import Any
import gc

import numpy as np
import pandas as pd

from .config import Settings
from .paper import _five_minute_context, run_paper_cycle
from .publication import publish_snapshot
from .regime_detector import detect_opening_market_gate, detect_regime
from .store import MarketStore
from .strategies import Candidate, Trend, active_agent, classify_price_trend, enrich, intraday_indicator_window, scan_symbol
from .strategy_router import route_strategy
from .universe import active_trading_symbols

SCAN_BATCH_SIZE = 50
LOG = logging.getLogger("multibagger.scanner")


def calculate_vwap(bars: pd.DataFrame, fallback: float = 100.0) -> float:
    if bars is None or bars.empty or "high" not in bars or "low" not in bars or "close" not in bars:
        return fallback
    vol = bars["volume"] if "volume" in bars else pd.Series(1, index=bars.index)
    vol_sum = vol.sum()
    if vol_sum <= 0:
        return float(bars["close"].iloc[-1])
    typical = (bars["high"] + bars["low"] + bars["close"]) / 3
    return float((typical * vol).sum() / vol_sum)


def calculate_rsi(close_series: pd.Series | list, period: int = 14) -> float:
    if close_series is None:
        return 50.0
    if not isinstance(close_series, pd.Series):
        close_series = pd.Series(close_series)
    if len(close_series) < period + 1:
        return 50.0
    delta = close_series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.rolling(window=period).mean().iloc[-1]
    avg_loss = loss.rolling(window=period).mean().iloc[-1]
    if pd.isna(avg_loss) or avg_loss == 0:
        return 100.0 if (not pd.isna(avg_gain) and avg_gain > 0) else 50.0
    rs = avg_gain / avg_loss
    rsi = 100.0 - (100.0 / (1.0 + rs))
    return float(rsi) if np.isfinite(rsi) else 50.0


def average_volume(bars: pd.DataFrame) -> float:
    if bars is None or bars.empty or "volume" not in bars:
        return 1.0
    avg = float(bars["volume"].mean())
    return avg if avg > 0 else 1.0


def get_bars(con, symbol: str, days: int = 20) -> pd.DataFrame:
    try:
        if hasattr(con, "execute"):
            return con.execute(
                "SELECT ts, open, high, low, close, volume FROM minute_bars WHERE symbol=? ORDER BY ts DESC LIMIT 1000",
                [symbol]
            ).fetchdf()
    except Exception:
        pass
    return pd.DataFrame()


def calculate_shared_indicators(quotes: dict, con) -> dict:
    """Calculate once, use across all 4 strategies (OCI 1GB RAM optimization)."""
    shared = {}
    for symbol, quote in quotes.items():
        if not quote or "ltp" not in quote:
            continue
        bars = get_bars(con, symbol, days=20)
        ltp = float(quote["ltp"])
        open_price = float(quote.get("open", ltp))
        prev_close = float(quote.get("prev_close", open_price))
        vol = float(quote.get("volume", 0))
        avg_vol = average_volume(bars)
        
        close_s = bars["close"] if (bars is not None and not bars.empty and "close" in bars) else pd.Series([ltp])
        
        shared[symbol] = {
            "vwap": calculate_vwap(bars, fallback=ltp),
            "rsi": calculate_rsi(close_s, period=14),
            "volume_ratio": (vol / avg_vol) if avg_vol > 0 else 1.0,
            "gap_pct": ((ltp - prev_close) / prev_close * 100) if prev_close > 0 else 0.0,
            "ltp": ltp,
            "open": open_price,
            "prev_close": prev_close,
            "volume": vol,
        }
    return shared


def run_alpha_strategy(shared_data: dict, settings: Settings) -> list[dict]:
    """ALPHA: VWAP pullback logic."""
    candidates = []
    for symbol, data in shared_data.items():
        if data["ltp"] <= data["vwap"] * 1.01 and data["volume_ratio"] > 1.5:
            candidates.append({"symbol": symbol, "score": 65, "strategy": "ALPHA", "ltp": data["ltp"]})
    candidates.sort(key=lambda x: x["score"], reverse=True)
    return candidates[:3]


def run_beta_strategy(shared_data: dict, settings: Settings) -> list[dict]:
    """BETA: Momentum breakout logic."""
    candidates = []
    for symbol, data in shared_data.items():
        if data["gap_pct"] >= 3.0 and data["volume_ratio"] >= 3.0:
            candidates.append({"symbol": symbol, "score": 60, "strategy": "BETA", "ltp": data["ltp"]})
    candidates.sort(key=lambda x: x["score"], reverse=True)
    return candidates[:3]


def run_gamma_strategy(shared_data: dict, settings: Settings) -> list[dict]:
    """GAMMA: Mean reversion logic."""
    candidates = []
    for symbol, data in shared_data.items():
        vwap = data["vwap"]
        if vwap > 0:
            distance_from_vwap = abs(data["ltp"] - vwap) / vwap * 100
            if distance_from_vwap >= 2.0 and (data["rsi"] > 70 or data["rsi"] < 30):
                candidates.append({"symbol": symbol, "score": 55, "strategy": "GAMMA", "ltp": data["ltp"]})
    candidates.sort(key=lambda x: x["score"], reverse=True)
    return candidates[:3]


def run_delta_strategy(shared_data: dict, settings: Settings) -> list[dict]:
    """DELTA: Contrarian logic."""
    candidates = []
    for symbol, data in shared_data.items():
        if (data["rsi"] > 80 or data["rsi"] < 20) and data["volume_ratio"] > 2.5:
            candidates.append({"symbol": symbol, "score": 50, "strategy": "DELTA", "ltp": data["ltp"]})
    candidates.sort(key=lambda x: x["score"], reverse=True)
    return candidates[:3]


def run_scan(
    con_or_settings: Any,
    settings: Settings | None = None,
    quotes: dict | None = None,
    deadline_monotonic: float | None = None
) -> dict | tuple[list, str]:
    # Signature overload 1: run_scan(con, settings, quotes)
    if hasattr(con_or_settings, "execute") and settings is not None and isinstance(quotes, dict):
        con = con_or_settings
        shared_data = calculate_shared_indicators(quotes, con)
        
        alpha_cand = run_alpha_strategy(shared_data, settings)
        if alpha_cand:
            return alpha_cand, "ALPHA"
        beta_cand = run_beta_strategy(shared_data, settings)
        if beta_cand:
            return beta_cand, "BETA"
        gamma_cand = run_gamma_strategy(shared_data, settings)
        if gamma_cand:
            return gamma_cand, "GAMMA"
        delta_cand = run_delta_strategy(shared_data, settings)
        if delta_cand:
            return delta_cand, "DELTA"
        return [], "NONE"

    # Signature overload 2: run_scan(settings: Settings, deadline_monotonic: float | None = None)
    settings_obj: Settings = con_or_settings


    if os.getenv("ENABLE_LIVE_TRADING", "false").lower() != "false":
        raise RuntimeError("Live trading is prohibited")
        
    store = MarketStore(settings_obj.db_path)
    run_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    symbols = active_trading_symbols(settings_obj, now)
    LOG.info("Scanner reading from DuckDB: %d symbols in active universe", len(symbols))
    
    candidates: list[Candidate] = []
    symbol_trends: dict[str, Trend] = {}
    audit_details: dict[str, dict[str, float | int]] = {}
    opening_trends: list[Trend] = []
    symbol_strengths: dict[str, float] = {}
    universe_rows = json.loads(settings_obj.universe_path.read_text())
    themes = {str(row.get("symbol") or ""): str(row.get("theme") or "UNCLASSIFIED") for row in universe_rows}
    quote_dict: dict[str, dict] = {}
    fresh = 0
    
    with store.connect() as con:
        con.execute(
            "INSERT INTO scanner_runs (run_id, started_at, status, universe_size) VALUES (?, ?, 'RUNNING', ?)",
            [run_id, now, len(symbols)]
        )

    try:
        if deadline_monotonic is not None and time.monotonic() >= deadline_monotonic:
            raise TimeoutError("Upstox full scan exceeded its maximum runtime")
            
        for offset in range(0, len(symbols), SCAN_BATCH_SIZE):
            if deadline_monotonic is not None and time.monotonic() >= deadline_monotonic:
                raise TimeoutError("Upstox full scan exceeded its maximum runtime")
            batch = symbols[offset:offset + SCAN_BATCH_SIZE]
            frames = store.bars_for_symbols(batch, through=now)
            grouped = {symbol: frame.reset_index(drop=True) for symbol, frame in frames.groupby("symbol")} if not frames.empty else {}
            empty = frames.iloc[0:0]
            for symbol in batch:
                frame = grouped.get(symbol, empty)
                fresh_frame = False
                if len(frame):
                    last = frame.iloc[-1]
                    bar_time = last.ts.to_pydatetime() if hasattr(last.ts, "to_pydatetime") else last.ts
                    if bar_time.tzinfo is None:
                        bar_time = bar_time.replace(tzinfo=timezone.utc)
                    age = (now - bar_time.astimezone(timezone.utc)).total_seconds()
                    if 0 <= age <= settings_obj.stale_seconds:
                        fresh_frame = True
                        fresh += 1
                        bid, ask = float(last.bid or 0), float(last.ask or 0)
                        ltp_val = float(last.close if last.close else (bid + ask) / 2 if (bid and ask) else 100.0)
                        open_val = float(last.open if last.open else ltp_val)
                        if ltp_val > 0:
                            quote_dict[symbol] = {
                                "bid": bid, "ask": ask, "ts": bar_time, "ltp": ltp_val, "open": open_val,
                                "volume": int(last.volume if hasattr(last, "volume") else 0),
                                "received_at": last.received_at, "instrument_key": str(last.instrument_key),
                                "completed_candle": bar_time < now.replace(second=0, microsecond=0),
                            }
                if fresh_frame and len(frame) >= 16:
                    enriched = enrich(intraday_indicator_window(frame))
                    symbol_trends[symbol] = classify_price_trend(enriched, now, settings_obj.stale_seconds)
                    session = enriched[enriched.session == enriched.iloc[-1].session]
                    if len(session) >= 15:
                        opening_return = (float(session.iloc[14].close) - float(session.iloc[0].open)) / float(session.iloc[0].open) * 100
                        opening_trends.append("BULLISH" if opening_return > 0.1 else "BEARISH" if opening_return < -0.1 else "RANGE")
                        symbol_strengths[symbol] = (float(session.iloc[-1].close) - float(session.iloc[0].open)) / float(session.iloc[0].open) * 100
                    if symbol in quote_dict:
                        quote_dict[symbol].update(_five_minute_context(enriched, now))
                    last = enriched.iloc[-1]
                    audit_details[symbol] = {
                        "open": float(last.open), "high": float(last.high), "low": float(last.low),
                        "close": float(last.close), "volume": int(last.volume), "vwap": float(last.vwap),
                        "atr": float(last.atr), "bbMid": float(last.bb_mid),
                        "bbUpper": float(last.bb_upper), "bbLower": float(last.bb_lower),
                    }
                    candidates.extend(scan_symbol(enriched, settings_obj, now, frame_is_enriched=True, regime="NORMAL", history_frame=frame))

        # Regime & Sequential Strategy Evaluation
        nifty_frame = store.bars(settings_obj.market_index_symbol, through=now)
        vix_frame = store.bars(settings_obj.vix_symbol, through=now)
        advances = opening_trends.count("BULLISH")
        declines = opening_trends.count("BEARISH")
        breadth_ratio = advances / max(declines, 1) if advances or declines else None
        
        regime = detect_regime(nifty_frame, vix_frame, breadth_ratio, settings_obj, now)
        skip_reasons = list(regime.skip_reasons)

        if len(nifty_frame):
            last_nifty = nifty_frame.iloc[-1]
            last_market_bar_ts = last_nifty.ts.to_pydatetime() if hasattr(last_nifty.ts, "to_pydatetime") else last_nifty.ts
            if last_market_bar_ts.tzinfo is None:
                last_market_bar_ts = last_market_bar_ts.replace(tzinfo=timezone.utc)
        else:
            last_market_bar_ts = now

        bar_age = max(0.0, (now - last_market_bar_ts.astimezone(timezone.utc)).total_seconds())
        regime_dt = datetime.fromisoformat(regime.as_of)
        if regime_dt.tzinfo is None:
            regime_dt = regime_dt.replace(tzinfo=timezone.utc)
        regime_age = max(0.0, (now - regime_dt.astimezone(timezone.utc)).total_seconds())

        # Route strategy dynamically
        route = route_strategy(regime.regime, ())

        # Strict NO_TRADE Reason Categorization
        if bar_age > settings_obj.stale_seconds:
            exact_no_trade_reason = "NO_TRADE_STALE_DATA"
        elif regime_age > settings_obj.stale_seconds:
            exact_no_trade_reason = "NO_TRADE_STALE_REGIME"
        elif regime.regime in ("HIGH_VOLATILITY", "HIGH_VOL", "TRANSITION", "NO_TRADE") or route.selected_strategy == "NO_TRADE":
            exact_no_trade_reason = "NO_TRADE_UNFAVOURABLE_REGIME"
        elif not candidates:
            exact_no_trade_reason = "NO_TRADE_NO_VALID_SETUP"
        else:
            exact_no_trade_reason = "NO_TRADE_RISK_VETO"

        LOG.info(
            "NOW | LAST_MARKET_BAR_TS | BAR_AGE_SEC | REGIME_TS | REGIME_AGE_SEC | REGIME | STRATEGY | NO_TRADE_REASON: "
            "%s | %s | %ds | %s | %ds | %s | %s | %s",
            now.isoformat(), last_market_bar_ts.isoformat(), int(bar_age), regime.as_of, int(regime_age),
            regime.regime, route.selected_strategy, exact_no_trade_reason
        )

        if exact_no_trade_reason != "NO_TRADE_NO_VALID_SETUP" and route.selected_strategy == "NO_TRADE":
            skip_reasons.append(exact_no_trade_reason)

        if skip_reasons:
            candidates = []
            for reason in dict.fromkeys(skip_reasons):
                LOG.info("no_trade_skip=%s", reason)

        # Confirm & rank candidates
        confirmed_candidates: list[Candidate] = []
        for candidate in candidates:
            confirmations = {
                **candidate.confirmations,
                "regime": regime.regime,
                "selected_strategy": route.selected_strategy,
                "gateRiskMultiplier": 0.5 if regime.regime == "REDUCED" else 1.0,
            }
            confirmed_candidates.append(replace(candidate, confirmations=confirmations))
            
        candidates = confirmed_candidates
        candidates.sort(key=lambda item: item.rank_score, reverse=True)
        candidates = candidates[:1]

        with store.connect() as con:
            con.execute("UPDATE paper_signals SET status='EXPIRED_UNEXECUTED' WHERE status='OPEN' AND expiry < ?", [now])
            for item in candidates:
                con.execute("""INSERT INTO paper_signals
                  (run_id,symbol,side,entry,stop,target,strategy,timestamp,expiry,rank_score,status)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')""", [
                    run_id, item.symbol, item.side, item.entry, item.stop, item.target, item.strategy,
                    item.timestamp, item.expiry, item.rank_score,
                ])

        paper = run_paper_cycle(store, settings_obj, candidates, quote_dict, now, run_id)
        
        with store.connect() as con:
            reason = None if candidates else exact_no_trade_reason
            con.execute(
                "UPDATE scanner_runs SET completed_at=?, status=?, fresh_symbols=?, signal_count=?, reason=? WHERE run_id=?",
                [now, "SIGNALS" if candidates else "NO_TRADE", fresh, len(candidates), reason, run_id]
            )

        payload = {
            "status": "SIGNALS" if candidates else "NO_TRADE",
            "asOf": now.isoformat(),
            "run_id": run_id,
            "source": f"{settings_obj.market_data_provider.upper()}_1MIN_DUCKDB",
            "mode": "PAPER_ONLY",
            "evaluatedUniverseSize": len(symbols),
            "reason": None if candidates else exact_no_trade_reason,
            "regime": regime.to_dict(),
            "route": route._asdict(),
            "bar_age_sec": int(bar_age),
            "regime_age_sec": int(regime_age),
            "signals": [{**asdict(item), "run_id": run_id, "timestamp": item.timestamp.isoformat(), "expiry": item.expiry.isoformat()} for item in candidates],
            "paperTrading": paper,
        }

        publish_snapshot(settings_obj, payload)
        return payload
        
    except Exception as error:
        reason = "MAX_RUNTIME_EXCEEDED" if isinstance(error, TimeoutError) else "DATA_UNAVAILABLE"
        with store.connect() as con:
            con.execute("UPDATE scanner_runs SET completed_at=?, status='FAILED', reason=? WHERE run_id=?", [datetime.now(timezone.utc), reason, run_id])
        raise
    finally:
        gc.collect()


def _classify_breadth(votes: list[Trend]) -> Trend:
    if len(votes) < 3:
        return "RANGE"
    bullish = votes.count("BULLISH") / len(votes)
    bearish = votes.count("BEARISH") / len(votes)
    if bullish >= 0.55 and bullish - bearish >= 0.10:
        return "BULLISH"
    if bearish >= 0.55 and bearish - bullish >= 0.10:
        return "BEARISH"
    return "RANGE"


def _sector_qualified(agent: str, sector_trend: Trend, sector_rank: int | None) -> bool:
    if agent == "GAMMA":
        return sector_trend == "RANGE"
    return agent in ("ALPHA", "BETA") and sector_rank is not None and sector_rank <= 3
