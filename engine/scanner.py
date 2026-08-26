from __future__ import annotations

import json
import logging
import os
import time
import uuid
from dataclasses import asdict, replace
from datetime import datetime, timezone
import gc

from .config import Settings
from .paper import _five_minute_context, run_paper_cycle
from .publication import publish_snapshot
from .regime_detector import detect_opening_market_gate
from .store import MarketStore
from .strategies import Candidate, Trend, active_agent, classify_price_trend, enrich, intraday_indicator_window, scan_symbol
from .universe import active_trading_symbols


SCAN_BATCH_SIZE = 50
LOG = logging.getLogger("multibagger.scanner")


def run_scan(settings: Settings, deadline_monotonic: float | None = None) -> dict:
    if os.getenv("ENABLE_LIVE_TRADING", "false").lower() != "false":
        raise RuntimeError("Live trading is prohibited")
    store = MarketStore(settings.db_path)
    run_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    symbols = active_trading_symbols(settings, now)
    candidates: list[Candidate] = []
    symbol_trends: dict[str, Trend] = {}
    audit_details: dict[str, dict[str, float | int]] = {}
    opening_trends: list[Trend] = []
    symbol_strengths: dict[str, float] = {}
    universe_rows = json.loads(settings.universe_path.read_text())
    themes = {str(row.get("symbol") or ""): str(row.get("theme") or "UNCLASSIFIED") for row in universe_rows}
    quotes: dict[str, dict] = {}
    fresh = 0
    with store.connect() as con:
        con.execute("INSERT INTO scanner_runs (run_id, started_at, status, universe_size) VALUES (?, ?, 'RUNNING', ?)", [run_id, now, len(symbols)])
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
                    if 0 <= age <= settings.stale_seconds:
                        fresh_frame = True
                        fresh += 1
                        bid, ask = float(last.bid or 0), float(last.ask or 0)
                        if bid > 0 and ask > bid:
                            quotes[symbol] = {
                                "bid": bid, "ask": ask, "ts": bar_time,
                                "received_at": last.received_at,
                                "instrument_key": str(last.instrument_key),
                                "completed_candle": bar_time < now.replace(second=0, microsecond=0),
                            }
                if fresh_frame and len(frame) >= 16:
                    enriched = enrich(intraday_indicator_window(frame))
                    symbol_trends[symbol] = classify_price_trend(enriched, now, settings.stale_seconds)
                    session = enriched[enriched.session == enriched.iloc[-1].session]
                    if len(session) >= 15:
                        opening_return = (float(session.iloc[14].close) - float(session.iloc[0].open)) / float(session.iloc[0].open) * 100
                        opening_trends.append("BULLISH" if opening_return > 0.1 else "BEARISH" if opening_return < -0.1 else "RANGE")
                        symbol_strengths[symbol] = (float(session.iloc[-1].close) - float(session.iloc[0].open)) / float(session.iloc[0].open) * 100
                    if symbol in quotes:
                        quotes[symbol].update(_five_minute_context(enriched, now))
                    last = enriched.iloc[-1]
                    audit_details[symbol] = {
                        "open": float(last.open), "high": float(last.high), "low": float(last.low),
                        "close": float(last.close), "volume": int(last.volume), "vwap": float(last.vwap),
                        "atr": float(last.atr), "bbMid": float(last.bb_mid),
                        "bbUpper": float(last.bb_upper), "bbLower": float(last.bb_lower),
                    }
                    candidates.extend(scan_symbol(enriched, settings, now, frame_is_enriched=True,
                                                  regime="NORMAL", history_frame=frame))

        nifty_frame = store.bars(settings.market_index_symbol, through=now)
        vix_frame = store.bars(settings.vix_symbol, through=now)
        advances = opening_trends.count("BULLISH")
        declines = opening_trends.count("BEARISH")
        breadth_ratio = advances / max(declines, 1) if advances or declines else None
        regime = detect_opening_market_gate(nifty_frame, vix_frame, breadth_ratio, settings, now)
        skip_reasons = list(regime.skip_reasons)
        if regime.regime == "NO_TRADE" and not skip_reasons:
            skip_reasons.append("OPENING_MARKET_GATE_NO_TRADE")
        for quote in quotes.values():
            quote["regime_adverse"] = False
        with store.connect() as con:
            losses = con.execute("""
              SELECT net_pnl FROM paper_trades
              WHERE trading_day=CAST(? AT TIME ZONE 'Asia/Kolkata' AS DATE) AND status='CLOSED'
              ORDER BY closed_at DESC LIMIT ?
            """, [now, settings.paper_consecutive_loss_limit]).fetchall()
        if len(losses) >= settings.paper_consecutive_loss_limit and all(float(row[0]) <= 0 for row in losses):
            skip_reasons.append("TWO_CONSECUTIVE_LOSSES")
        if not symbols:
            skip_reasons.append("DAILY_250_STOCK_UNIVERSE_UNAVAILABLE")
        if skip_reasons:
            candidates = []
            for reason in dict.fromkeys(skip_reasons):
                LOG.info("no_trade_skip=%s", reason)
        market_trend = classify_price_trend(nifty_frame, now, settings.stale_seconds)
        sector_trends: dict[str, Trend] = {}
        sector_strengths: dict[tuple[str, Trend], float] = {}
        sector_returns: dict[str, float] = {}
        for theme in set(themes.values()):
            votes = [symbol_trends[symbol] for symbol in symbol_trends if themes.get(symbol) == theme]
            sector_trends[theme] = _classify_breadth(votes)
            for direction in ("BULLISH", "BEARISH", "RANGE"):
                sector_strengths[(theme, direction)] = votes.count(direction) / len(votes) if votes else 0.0
            returns = [symbol_strengths[symbol] for symbol in symbol_strengths if themes.get(symbol) == theme]
            sector_returns[theme] = sum(returns) / len(returns) if returns else 0.0
        strongest = [theme for theme, _ in sorted(sector_returns.items(), key=lambda item: item[1], reverse=True)]
        weakest = list(reversed(strongest))
        confirmed_candidates: list[Candidate] = []
        for candidate in candidates:
            theme = themes.get(candidate.symbol, "UNCLASSIFIED")
            sector_trend = sector_trends.get(theme, "RANGE")
            required_trend = "BULLISH" if candidate.side == "LONG" else "BEARISH"
            agent = str(candidate.confirmations.get("agent") or active_agent(now) or "")
            range_setup = agent == "GAMMA"
            ranking = strongest if required_trend == "BULLISH" else weakest
            sector_rank = ranking.index(theme) + 1 if theme in ranking else None
            sector_qualified = _sector_qualified(agent, sector_trend, sector_rank)
            confirmations = {
                **candidate.confirmations,
                "regime": regime.regime,
                "marketDirection": True,
                "sectorDirection": sector_qualified,
                "marketTrend": market_trend,
                "sectorTrend": sector_trend,
                "sector": theme,
                "sectorTop3": sector_rank is not None and sector_rank <= 3,
                "sectorRank": sector_rank,
                "gateRiskMultiplier": 0.5 if regime.regime == "REDUCED" else 1.0,
            }
            if sector_qualified:
                confirmed_candidates.append(replace(candidate, rank_score=float(100 - (sector_rank or 50)), confirmations=confirmations))
        candidates = confirmed_candidates
        candidates.sort(key=lambda item: item.rank_score, reverse=True)
        candidates = candidates[:1]
        if active_agent(now) is None:
            skip_reasons.append("TIME_OF_DAY_ENTRY_BLOCK")
        with store.connect() as con:
            system_pnl = float(con.execute("""
              SELECT coalesce(sum(net_pnl),0) FROM paper_trades
              WHERE trading_day=CAST(? AT TIME ZONE 'Asia/Kolkata' AS DATE) AND status='CLOSED'
            """, [now]).fetchone()[0] or 0)
            signal_symbols = {item.symbol for item in candidates}
            audit_rows = []
            for symbol, details in audit_details.items():
                candidate = next((item for item in candidates if item.symbol == symbol), None)
                confirmations = candidate.confirmations if candidate else {}
                audit_rows.append([
                    str(uuid.uuid4()), run_id, now, "SIGNAL" if symbol in signal_symbols else "SCAN",
                    str(confirmations.get("agent") or active_agent(now) or ""), symbol, system_pnl,
                    regime.regime, confirmations.get("sectorRank"), confirmations.get("adx"),
                    json.dumps(details, sort_keys=True), candidate.entry if candidate else None,
                    candidate.stop if candidate else None, None, None, None, None, None, None,
                    None if candidate else "NO_VALID_SETUP",
                ])
            if audit_rows:
                con.executemany("INSERT INTO intraday_audit_log VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", audit_rows)
            con.execute("UPDATE paper_signals SET status='EXPIRED_UNEXECUTED' WHERE status='OPEN' AND expiry < ?", [now])
            for item in candidates:
                con.execute("""INSERT INTO paper_signals
                  (run_id,symbol,side,entry,stop,target,strategy,timestamp,expiry,rank_score,status)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')""", [
                    run_id, item.symbol, item.side, item.entry, item.stop, item.target, item.strategy,
                    item.timestamp, item.expiry, item.rank_score,
                ])
        paper = run_paper_cycle(store, settings, candidates, quotes, now, run_id)
        with store.connect() as con:
            reason = None if candidates else (skip_reasons[0] if skip_reasons else "NO_VALID_SETUP")
            con.execute("UPDATE scanner_runs SET completed_at=?, status=?, fresh_symbols=?, signal_count=?, reason=? WHERE run_id=?", [now, "SIGNALS" if candidates else "NO_TRADE", fresh, len(candidates), reason, run_id])
        payload = {
            "status": "SIGNALS" if candidates else "NO_TRADE", "asOf": now.isoformat(), "run_id": run_id,
            "source": f"{settings.market_data_provider.upper()}_1MIN_DUCKDB", "mode": "PAPER_ONLY", "evaluatedUniverseSize": len(symbols),
            "reason": None if candidates else (skip_reasons[0] if skip_reasons else "NO_VALID_SETUP"),
            "regime": regime.to_dict(),
            "signals": [{**asdict(item), "run_id": run_id, "timestamp": item.timestamp.isoformat(), "expiry": item.expiry.isoformat()} for item in candidates],
            "paperTrading": paper,
        }
        publish_snapshot(settings, payload)
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
