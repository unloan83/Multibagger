from __future__ import annotations

import json
import logging
import math
import uuid
from dataclasses import asdict
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from .config import Settings
from .store import MarketStore
from .strategies import Candidate, entry_score_threshold


IST = ZoneInfo("Asia/Kolkata")
STRATEGY_VERSION = "intraday-dual-regime-managed-v4"
BASELINE = "SIGNAL_ONLY_NO_EXECUTION"
LOG = logging.getLogger("multibagger.paper")


def run_paper_cycle(
    store: MarketStore,
    settings: Settings,
    candidates: list[Candidate],
    quotes: dict[str, dict[str, Any]],
    now: datetime,
    run_id: str,
) -> dict[str, Any]:
    """Mark/exit open positions and automatically simulate eligible new entries."""
    now = now.astimezone(timezone.utc)
    trading_day = now.astimezone(IST).date()
    no_entry_reasons: list[str] = []
    entry_rejections: list[dict[str, Any]] = []

    with store.connect() as con:
        open_trades = _records(con, "SELECT * FROM paper_trades WHERE status='OPEN' ORDER BY opened_at")
        for trade in open_trades:
            quote = _fresh_quote(quotes.get(trade["symbol"]), now, settings.stale_seconds)
            if not quote:
                continue
            if quote.get("completed_candle") is False:
                continue
            candle_ts = quote.get("ts")
            last_candle = trade.get("last_exit_candle_ts")
            if last_candle is not None and candle_ts is not None and candle_ts <= last_candle:
                continue
            reason = _regular_exit_reason(trade, quote, now, settings)
            _mark_trade(con, trade, quote, now, settings, reason, run_id)
            if candle_ts is not None:
                con.execute("UPDATE paper_trades SET last_exit_candle_ts=? WHERE trade_id=?", [candle_ts, trade["trade_id"]])

        open_trades = _records(con, "SELECT * FROM paper_trades WHERE status='OPEN' ORDER BY opened_at")
        projected = _closed_net_today(con, trading_day) + sum(float(row["net_pnl"]) for row in open_trades)
        lock_reason = None
        if projected >= settings.paper_daily_profit_target:
            lock_reason = "DAILY_PROFIT_TARGET_LOCK"
        elif projected <= -settings.paper_daily_loss_limit:
            lock_reason = "DAILY_LOSS_LIMIT_LOCK"
        if lock_reason:
            for trade in open_trades:
                quote = _fresh_quote(quotes.get(trade["symbol"]), now, settings.stale_seconds)
                if quote:
                    _mark_trade(con, trade, quote, now, settings, lock_reason, run_id)

        realized = _closed_net_today(con, trading_day)
        day_count = int(con.execute("SELECT count(*) FROM paper_trades WHERE trading_day=?", [trading_day]).fetchone()[0])
        consecutive_losses = _consecutive_losses(con, trading_day)
        feedback = _recent_session_feedback(con, trading_day)
        open_rows = _records(con, "SELECT * FROM paper_trades WHERE status='OPEN' ORDER BY opened_at")
        projected_before_entries = realized + sum(float(row["net_pnl"]) for row in open_rows)
        progress_ratio = projected_before_entries / settings.paper_daily_profit_target
        if settings.execution_paused:
            no_entry_reasons.append("Global trading execution pause is active; paper and sandbox entries/exits are blocked.")
        if realized >= settings.paper_daily_profit_target:
            no_entry_reasons.append("Daily paper profit target reached; new entries are disabled.")
        if realized <= -settings.paper_daily_loss_limit or (realized + sum(float(row["net_pnl"]) for row in open_rows)) <= -settings.paper_daily_loss_limit:
            no_entry_reasons.append("Daily paper loss limit reached; new entries are disabled.")
        if any(_as_trading_date(row.get("trading_day")) < trading_day for row in open_rows):
            no_entry_reasons.append("A prior-day paper position is awaiting a fresh executable exit; new entries are halted.")
        if not _entry_window_open(now):
            no_entry_reasons.append("Current time-of-day window blocks new entries; position management remains active.")
        if consecutive_losses >= settings.paper_consecutive_loss_limit:
            no_entry_reasons.append("Two consecutive losses reached; new entries are disabled for the day.")

        entries_allowed = not no_entry_reasons
        entry_gate_open = entries_allowed
        effective_max_positions = 1
        risk_multiplier = 1.0
        for candidate in candidates:
            if not entries_allowed:
                break
            if len(open_rows) >= effective_max_positions:
                no_entry_reasons.append("Maximum simultaneous paper positions reached.")
                break
            if settings.paper_max_trades_per_day > 0 and day_count >= settings.paper_max_trades_per_day:
                no_entry_reasons.append("Maximum paper trades for the day reached.")
                break
            quote = _fresh_quote(quotes.get(candidate.symbol), now, settings.stale_seconds)
            if not quote:
                continue
            trade, rejection_reason = _open_trade(
                con, candidate, quote, now, trading_day, run_id, settings,
                consecutive_losses, risk_multiplier, feedback,
            )
            if trade:
                open_rows.append(trade)
                day_count += 1
            elif rejection_reason:
                _record_entry_rejection(con, candidate, now, run_id, rejection_reason)
                entry_rejections.append({
                    "run_id": run_id,
                    "symbol": candidate.symbol,
                    "strategy": candidate.strategy,
                    "observed_at": now.isoformat(),
                    "reason": rejection_reason,
                })
                no_entry_reasons.append(
                    f"{candidate.symbol} paper entry rejected: {rejection_reason}."
                )

        daily = _metrics(con, "WHERE trading_day=? AND status='CLOSED'", [trading_day], settings.paper_portfolio_capital)
        overall = _metrics(con, "WHERE status='CLOSED'", [], settings.paper_portfolio_capital)
        open_rows = _records(con, "SELECT * FROM paper_trades WHERE status='OPEN' ORDER BY opened_at")
        recent = _records(con, "SELECT * FROM paper_trades WHERE status='CLOSED' ORDER BY closed_at DESC LIMIT 20")
        recent_rejections = _records(con, """
          SELECT run_id,symbol,strategy,observed_at,reason
          FROM paper_entry_rejections
          WHERE CAST(observed_at AT TIME ZONE 'Asia/Kolkata' AS DATE)=?
          ORDER BY observed_at DESC LIMIT 20
        """, [trading_day])
        realized = daily["netPnl"]
        target_reached = realized >= settings.paper_daily_profit_target
        loss_limit_reached = realized <= -settings.paper_daily_loss_limit
        enabled = (
            entry_gate_open and not settings.execution_paused and not target_reached and not loss_limit_reached
            and len(open_rows) < effective_max_positions
            and (settings.paper_max_trades_per_day == 0 or day_count < settings.paper_max_trades_per_day)
            and consecutive_losses < settings.paper_consecutive_loss_limit and _entry_window_open(now)
        )
        open_net_pnl = sum(float(row["net_pnl"]) for row in open_rows)
        con.execute("""
          INSERT INTO paper_target_history VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [
            str(uuid.uuid4()), run_id, now, trading_day, realized, open_net_pnl,
            realized + open_net_pnl, settings.paper_daily_profit_target,
            settings.paper_daily_loss_limit, target_reached, loss_limit_reached, enabled,
        ])

    return {
        "mode": "AUTOMATIC_PAPER_ONLY",
        "strategyVersion": STRATEGY_VERSION,
        "baseline": BASELINE,
        "dailyProfitTarget": settings.paper_daily_profit_target,
        "dailyLossLimit": settings.paper_daily_loss_limit,
        "targetReached": target_reached,
        "lossLimitReached": loss_limit_reached,
        "newEntriesEnabled": enabled,
        "executionPaused": settings.execution_paused,
        "adaptiveRisk": {
            "consecutiveLosses": consecutive_losses,
            "riskMultiplier": risk_multiplier,
            "effectiveMaxOpenPositions": effective_max_positions,
            "profitProgressRatio": round(progress_ratio, 4),
            "recentSessionFeedback": feedback,
        },
        "noEntryReasons": list(dict.fromkeys(no_entry_reasons)),
        "openPositions": [_public_trade(row) for row in open_rows],
        "recentClosedTrades": [_public_trade(row) for row in recent],
        "entryRejections": entry_rejections,
        "recentEntryRejections": [_public_rejection(row) for row in recent_rejections],
        "dailyMetrics": daily,
        "overallMetrics": overall,
    }


def run_risk_monitor(settings: Settings, now: datetime | None = None) -> dict[str, Any]:
    """Mark and exit open positions without scanning the full symbol universe or opening entries."""
    observed_at = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    store = MarketStore(settings.db_path)
    with store.connect() as con:
        open_rows = con.execute(
            "SELECT trade_id,symbol FROM paper_trades WHERE status='OPEN'"
        ).fetchall()
    open_trade_ids = {str(row[0]) for row in open_rows}
    symbols = sorted({str(row[1]) for row in open_rows})
    quotes = store.latest_quotes(symbols, completed_before=observed_at)
    for quote in quotes.values():
        quote["completed_candle"] = True
    _attach_live_thesis_context(store, settings, symbols, quotes, observed_at)
    monitor_run_id = f"monitor-{uuid.uuid4()}"
    result = run_paper_cycle(store, settings, [], quotes, observed_at, monitor_run_id)
    result["closedByMonitor"] = [
        trade for trade in result["recentClosedTrades"]
        if str(trade.get("trade_id")) in open_trade_ids
    ]
    from .publication import refresh_snapshot_with_paper
    refresh_snapshot_with_paper(settings, result, observed_at, monitor_run_id)
    return result


def _attach_live_thesis_context(store: MarketStore, settings: Settings, symbols: list[str],
                                quotes: dict[str, dict[str, Any]], now: datetime) -> None:
    if not symbols:
        return
    from .strategies import classify_price_trend
    try:
        universe = json.loads(settings.universe_path.read_text())
    except (OSError, json.JSONDecodeError):
        universe = []
    themes = {str(row.get("symbol") or ""): str(row.get("theme") or "UNCLASSIFIED") for row in universe}
    market_trend = classify_price_trend(store.bars(settings.market_index_symbol), now, settings.stale_seconds)
    for symbol in symbols:
        theme = themes.get(symbol, "UNCLASSIFIED")
        peers = [item for item, peer_theme in themes.items() if peer_theme == theme]
        frames = store.bars_for_symbols(peers)
        votes = []
        if not frames.empty:
            for _, frame in frames.groupby("symbol"):
                votes.append(classify_price_trend(frame.reset_index(drop=True), now, settings.stale_seconds))
        bullish = votes.count("BULLISH") / len(votes) if votes else 0
        bearish = votes.count("BEARISH") / len(votes) if votes else 0
        sector_trend = "BULLISH" if len(votes) >= 3 and bullish >= 0.55 else (
            "BEARISH" if len(votes) >= 3 and bearish >= 0.55 else "RANGE"
        )
        symbol_frame = store.bars(symbol)
        if symbol in quotes:
            quotes[symbol]["market_trend"] = market_trend
            quotes[symbol]["sector_trend"] = sector_trend
            quotes[symbol]["symbol_trend"] = classify_price_trend(symbol_frame, now, settings.stale_seconds)


def _open_trade(con: Any, candidate: Candidate, quote: dict[str, Any], now: datetime, trading_day: Any,
                run_id: str, settings: Settings, consecutive_losses: int = 0,
                risk_multiplier: float = 1.0,
                feedback: dict[str, Any] | None = None) -> tuple[dict[str, Any] | None, str | None]:
    if settings.execution_paused:
        return None, "EXECUTION_PAUSED"
    side = candidate.side
    entry_quote = float(quote["ask"] if side == "LONG" else quote["bid"])
    drift_bps = abs(entry_quote - float(candidate.entry)) / float(candidate.entry) * 10_000
    if drift_bps > settings.paper_max_entry_slippage_bps:
        return None, "ENTRY_PRICE_MOVED"
    required = ("marketDirection", "sectorDirection", "vwap", "volume", "momentum", "strategyQualified", "supportResistance", "riskReward")
    if settings.require_setup_confirmation:
        missing = [name for name in required if candidate.confirmations.get(name) is not True]
        if missing:
            return None, f"CONFIRMATION_FAILED_{missing[0].upper()}"
        minimum_score = entry_score_threshold(now)
        if minimum_score is None:
            return None, "TIME_OF_DAY_ENTRY_BLOCK"
        if candidate.rank_score < minimum_score:
            return None, "SETUP_SCORE_TOO_LOW"
        if candidate.confirmations.get("setupSource") != "PRICE_VOLUME_ONLY":
            return None, "NON_TECHNICAL_TRIGGER_REJECTED"
    stop_distance = (entry_quote - float(candidate.stop)) if side == "LONG" else (float(candidate.stop) - entry_quote)
    if stop_distance <= 0:
        return None, "INVALID_STOP_DISTANCE"
    reward = (float(candidate.target) - entry_quote) if side == "LONG" else (entry_quote - float(candidate.target))
    if reward <= 0:
        return None, "INVALID_PROFIT_TARGET"
    risk_budget = min(
        settings.paper_portfolio_capital * settings.paper_risk_per_trade_pct / 100,
        settings.paper_max_risk_per_trade,
    ) * risk_multiplier
    capital_budget = settings.paper_portfolio_capital * settings.paper_max_capital_per_trade_pct / 100
    quantity = min(math.floor(risk_budget / stop_distance), math.floor(capital_budget / entry_quote))
    while quantity > 0:
        loss_cost = _round_trip_cost(entry_quote, float(candidate.stop), quantity, settings)["total"]
        if stop_distance * quantity + loss_cost <= risk_budget:
            break
        quantity -= 1
    if quantity < 1:
        return None, "POSITION_SIZE_BELOW_ONE"
    modeled_cost = _round_trip_cost(entry_quote, float(candidate.target), quantity, settings)
    modeled_round_trip_cost = modeled_cost["total"]
    if reward * quantity <= 2 * modeled_round_trip_cost:
        return None, "EXPECTED_PROFIT_NOT_TWICE_COST"
    raw_rr = reward / stop_distance
    if raw_rr < settings.reward_risk or raw_rr > settings.max_reward_risk + 1e-6:
        return None, "RISK_REWARD_OUTSIDE_POLICY"
    slippage_factor = settings.paper_slippage_bps_per_side / 10_000
    entry_fill = entry_quote * (1 + slippage_factor if side == "LONG" else 1 - slippage_factor)
    capital_used = entry_fill * quantity
    brokerage = settings.paper_brokerage_per_order
    entry_cost = _one_way_cost(entry_quote, quantity, settings, is_sell=side == "SHORT")
    fees = entry_cost["feesTaxes"]
    slippage = entry_cost["slippageImpact"]
    trade_id = str(uuid.uuid4())
    execution_mode = "INTERNAL_PAPER"
    entry_order_id = None
    if settings.paper_submit_upstox_sandbox_orders:
        instrument_key = str(quote.get("instrument_key") or "")
        if settings.market_data_provider != "upstox" or not instrument_key or not settings.upstox_sandbox_access_token:
            LOG.error("Upstox sandbox entry refused because provider, instrument key, or sandbox token is missing")
            return None, "SANDBOX_CONFIGURATION_MISSING"
        try:
            entry_order_id = _submit_upstox_sandbox_order(
                candidate.symbol, instrument_key, quantity, entry_quote,
                "BUY" if side == "LONG" else "SELL", trade_id, settings,
            )
        except Exception as error:
            from features.upstox.python.upstox_sandbox import sanitize_log_message
            LOG.error(
                "Upstox sandbox entry failed for %s: %s",
                candidate.symbol, sanitize_log_message(str(error)),
            )
            return None, "SANDBOX_ORDER_REJECTED"
        execution_mode = "UPSTOX_SANDBOX"
    intended = {
        "side": side, "transactionType": "BUY" if side == "LONG" else "SELL",
        "orderType": "PAPER_MARKET", "symbol": candidate.symbol,
        "quantity": quantity, "observedEntryQuote": entry_quote, "stop": candidate.stop,
        "target": candidate.target, "signal": asdict(candidate),
        "entryReasons": candidate.confirmations, "modeledRoundTripCost": modeled_cost,
        "adaptiveRisk": {"consecutiveLosses": consecutive_losses, "riskMultiplier": risk_multiplier, "recentSessionFeedback": feedback or {}},
    }
    values = [
        trade_id, trading_day, run_id, candidate.symbol, side, candidate.strategy, STRATEGY_VERSION,
        f"{settings.market_data_provider.upper()}_1MIN_EXECUTABLE_QUOTES", "OPEN", quantity, candidate.entry,
        entry_quote, entry_fill, candidate.stop, candidate.target, now, entry_quote, now,
        None, None, None, None, 0.0, -(brokerage + fees + slippage), brokerage, fees,
        slippage, capital_used, json.dumps(intended, default=str, sort_keys=True),
    ]
    con.execute("""
      INSERT INTO paper_trades (
        trade_id,trading_day,run_id,symbol,side,strategy,strategy_version,data_source,status,quantity,
        signal_entry,entry_quote,entry_fill,stop_price,target_price,opened_at,current_quote,
        last_marked_at,exit_quote,exit_fill,closed_at,exit_reason,gross_pnl,net_pnl,brokerage,
        fees_taxes,slippage,capital_used,intended_order_json,execution_mode,entry_order_id,exit_order_id
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, [*values, execution_mode, entry_order_id, None])
    con.execute("""
      UPDATE paper_signals SET status='EXECUTED'
      WHERE run_id=? AND symbol=? AND strategy=?
    """, [run_id, candidate.symbol, candidate.strategy])
    _record_trade_event(
        con, trade_id, run_id, "ENTRY", now, entry_quote, 0.0,
        -(brokerage + fees + slippage), "OPEN",
        {
            "executionMode": execution_mode, "orderId": entry_order_id,
            "target": candidate.target, "stop": candidate.stop,
            "entryReasons": candidate.confirmations,
            "adaptiveRisk": {"consecutiveLosses": consecutive_losses, "riskMultiplier": risk_multiplier},
        },
    )
    return _records(con, "SELECT * FROM paper_trades WHERE trade_id=?", [trade_id])[0], None


def _mark_trade(con: Any, trade: dict[str, Any], quote: dict[str, Any], now: datetime,
                settings: Settings, exit_reason: str | None, event_run_id: str) -> None:
    side = str(trade.get("side") or "LONG")
    exit_quote = float(quote["bid"] if side == "LONG" else quote["ask"])
    quantity = int(trade["quantity"])
    entry_quote = float(trade["entry_quote"])
    entry_fill = float(trade["entry_fill"])
    direction = 1 if side == "LONG" else -1
    gross = direction * (exit_quote - entry_quote) * quantity
    slip = settings.paper_slippage_bps_per_side / 10_000
    exit_fill = exit_quote * (1 - slip if side == "LONG" else 1 + slip)
    exit_value = exit_fill * quantity
    entry_brokerage = float(trade["brokerage"])
    entry_fees = float(trade["fees_taxes"])
    entry_slippage = float(trade["slippage"])
    total_brokerage = entry_brokerage + settings.paper_brokerage_per_order
    exit_cost = _one_way_cost(exit_quote, quantity, settings, is_sell=side == "LONG")
    total_fees = entry_fees + exit_cost["feesTaxes"]
    total_slippage = entry_slippage + exit_cost["slippageImpact"]
    net = gross - total_brokerage - total_fees - total_slippage

    prev_peak = float(trade.get("peak_quote") or entry_quote)
    prev_lowest = float(trade.get("lowest_quote") or entry_quote)
    peak_quote = max(prev_peak, exit_quote)
    lowest_quote = min(prev_lowest, exit_quote)
    mfe = max(0.0, ((peak_quote - entry_fill) if side == "LONG" else (entry_fill - lowest_quote)) * quantity)
    mae = min(0.0, ((lowest_quote - entry_fill) if side == "LONG" else (entry_fill - peak_quote)) * quantity)
    profit_giveback = max(0.0, mfe - gross)

    opened_at = trade["opened_at"]
    if isinstance(opened_at, str):
        opened_at = datetime.fromisoformat(opened_at)
    if opened_at.tzinfo is None:
        opened_at = opened_at.replace(tzinfo=timezone.utc)
    duration_min = round((now - opened_at).total_seconds() / 60.0, 2)

    if exit_reason:
        if settings.execution_paused:
            con.execute("""
              UPDATE paper_trades SET current_quote=?,last_marked_at=?,gross_pnl=?,net_pnl=?,
                peak_quote=?,lowest_quote=?,mfe=?,mae=?,profit_giveback=?,holding_duration_minutes=?
              WHERE trade_id=?
            """, [exit_quote, now, gross, net, peak_quote, lowest_quote, mfe, mae, profit_giveback, duration_min, trade["trade_id"]])
            _record_trade_event(
                con, str(trade["trade_id"]), event_run_id, "EXIT_BLOCKED", now,
                exit_quote, gross, net, str(exit_reason), {"reason": "TRADING_EXECUTION_PAUSED"},
            )
            return
        exit_order_id = trade.get("exit_order_id")
        if trade.get("execution_mode") == "UPSTOX_SANDBOX" and not exit_order_id:
            instrument_key = str(quote.get("instrument_key") or "")
            try:
                exit_order_id = _submit_upstox_sandbox_order(
                    str(trade["symbol"]), instrument_key, quantity, exit_quote,
                    "SELL" if side == "LONG" else "BUY",
                    str(trade["trade_id"]), settings,
                )
            except Exception as error:
                LOG.error("Upstox sandbox exit failed for %s; paper position remains open: %s", trade["symbol"], error)
                con.execute("""
                  UPDATE paper_trades SET current_quote=?,last_marked_at=?,gross_pnl=?,net_pnl=?,
                    peak_quote=?,lowest_quote=?,mfe=?,mae=?,profit_giveback=?,holding_duration_minutes=?
                  WHERE trade_id=?
                """, [exit_quote, now, gross, net, peak_quote, lowest_quote, mfe, mae, profit_giveback, duration_min, trade["trade_id"]])
                _record_trade_event(
                    con, str(trade["trade_id"]), event_run_id, "EXIT_REJECTED", now,
                    exit_quote, gross, net, str(exit_reason), {"error": str(error)[:500]},
                )
                return
        con.execute("""
          UPDATE paper_trades SET status='CLOSED', current_quote=?, last_marked_at=?, exit_quote=?,
            exit_fill=?, closed_at=?, exit_reason=?, gross_pnl=?, net_pnl=?, brokerage=?,
            fees_taxes=?, slippage=?, exit_order_id=?, peak_quote=?, lowest_quote=?, mfe=?, mae=?,
            profit_giveback=?, holding_duration_minutes=? WHERE trade_id=?
        """, [exit_quote, now, exit_quote, exit_fill, now, exit_reason, gross, net,
              total_brokerage, total_fees, total_slippage, exit_order_id,
              peak_quote, lowest_quote, mfe, mae, profit_giveback, duration_min, trade["trade_id"]])
        con.execute("""
          UPDATE paper_signals SET status=?
          WHERE run_id=? AND symbol=? AND strategy=?
        """, [f"CLOSED_{exit_reason}", trade["run_id"], trade["symbol"], trade["strategy"]])
        _record_trade_event(
            con, str(trade["trade_id"]), event_run_id, "EXIT", now,
            exit_quote, gross, net, str(exit_reason), {"orderId": exit_order_id, "exitFill": exit_fill, "mfe": mfe, "mae": mae},
        )
        LOG.info("trade_exit trade_id=%s symbol=%s trigger=%s quote=%.4f net_pnl=%.2f",
                 trade["trade_id"], trade["symbol"], exit_reason, exit_quote, net)
    else:
        con.execute("""
          UPDATE paper_trades SET current_quote=?, last_marked_at=?, gross_pnl=?, net_pnl=?,
            peak_quote=?, lowest_quote=?, mfe=?, mae=?, profit_giveback=?, holding_duration_minutes=?
          WHERE trade_id=?
        """, [exit_quote, now, gross, net, peak_quote, lowest_quote, mfe, mae, profit_giveback, duration_min, trade["trade_id"]])
        _record_trade_event(
            con, str(trade["trade_id"]), event_run_id, "MARK", now,
            exit_quote, gross, net, "OPEN", {},
        )


def _regular_exit_reason(trade: dict[str, Any], quote: dict[str, Any], now: datetime, settings: Settings) -> str | None:
    side = str(trade.get("side") or "LONG")
    mark = float(quote["bid"] if side == "LONG" else quote["ask"])
    entry_quote = float(trade["entry_quote"])
    stop_price = float(trade["stop_price"])
    target_price = float(trade["target_price"])
    risk_unit = (entry_quote - stop_price) if side == "LONG" else (stop_price - entry_quote)

    if _as_trading_date(trade.get("trading_day")) < now.astimezone(IST).date():
        return "OVERNIGHT_SAFETY_EXIT"
    if _flatten_time_reached(now, settings):
        return "END_OF_DAY"

    if (side == "LONG" and mark <= stop_price) or (side == "SHORT" and mark >= stop_price):
        return "STOP_LOSS"
    if (side == "LONG" and mark >= target_price) or (side == "SHORT" and mark <= target_price):
        return "PROFIT_TARGET"
    if quote.get("regime_adverse") is True:
        return "REGIME_CHANGED_ADVERSE"

    opened_at = trade["opened_at"]
    if isinstance(opened_at, str):
        opened_at = datetime.fromisoformat(opened_at)
    if opened_at.tzinfo is None:
        opened_at = opened_at.replace(tzinfo=timezone.utc)
    if (now - opened_at.astimezone(timezone.utc)).total_seconds() < settings.paper_minimum_hold_seconds:
        return None

    adverse_trend = "BEARISH" if side == "LONG" else "BULLISH"
    if quote.get("market_trend") == adverse_trend:
        return "MARKET_TREND_INVALIDATED"
    if quote.get("sector_trend") == adverse_trend:
        return "SECTOR_TREND_INVALIDATED"
    if quote.get("symbol_trend") == adverse_trend:
        return "STOCK_TREND_INVALIDATED"

    intended = _intended_order(trade)
    confirmations = ((intended.get("signal") or {}).get("confirmations") or intended.get("entryReasons") or {})
    breakout_level = _optional_float(confirmations.get("breakoutLevel"))
    vwap = _optional_float(quote.get("vwap"))
    closes = [float(value) for value in quote.get("recent_closes") or []]
    volumes = [float(value) for value in quote.get("recent_volumes") or []]
    if breakout_level is not None:
        tolerance = breakout_level * 0.0005
        if (side == "LONG" and mark < breakout_level - tolerance) or (side == "SHORT" and mark > breakout_level + tolerance):
            return "FAILED_BREAKOUT"
    if vwap is not None and len(closes) >= 2:
        if (side == "LONG" and mark < vwap and closes[-1] < vwap and closes[-2] < vwap) or (
            side == "SHORT" and mark > vwap and closes[-1] > vwap and closes[-2] > vwap
        ):
            return "VWAP_FAILURE"

    peak_quote = max(float(trade.get("peak_quote") or entry_quote), mark)
    lowest_quote = min(float(trade.get("lowest_quote") or entry_quote), mark)
    if risk_unit > 0:
        favorable_quote = peak_quote if side == "LONG" else lowest_quote
        peak_r = ((favorable_quote - entry_quote) if side == "LONG" else (entry_quote - favorable_quote)) / risk_unit
        atr = _optional_float(confirmations.get("atr")) or risk_unit
        trailing_distance = settings.paper_trailing_atr_multiple * atr
        trailing_hit = mark <= peak_quote - trailing_distance if side == "LONG" else mark >= lowest_quote + trailing_distance
        if peak_r >= settings.paper_trailing_trigger_r and trailing_hit:
            return "TRAILING_PROFIT_STOP"
        estimated_cost_per_share = (
            2 * settings.paper_brokerage_per_order / max(int(trade["quantity"]), 1)
            + _round_trip_cost(entry_quote, entry_quote, max(int(trade["quantity"]), 1), settings)["variable"]
            / max(int(trade["quantity"]), 1)
        )
        break_even = entry_quote + estimated_cost_per_share if side == "LONG" else entry_quote - estimated_cost_per_share
        if peak_r >= settings.paper_break_even_trigger_r and (
            (side == "LONG" and mark <= break_even) or (side == "SHORT" and mark >= break_even)
        ):
            return "BREAK_EVEN_STOP"
        reversal = len(closes) >= 3 and (
            (side == "LONG" and closes[-1] < closes[-2] < closes[-3])
            or (side == "SHORT" and closes[-1] > closes[-2] > closes[-3])
        )
        volume_deteriorated = len(volumes) >= 3 and volumes[-1] < sum(volumes[:-1]) / (len(volumes) - 1)
        if reversal and volume_deteriorated:
            return "MOMENTUM_VOLUME_DETERIORATION"
    return None


def _one_way_cost(price: float, quantity: int, settings: Settings, *, is_sell: bool) -> dict[str, float]:
    turnover = price * quantity
    exchange = turnover * settings.paper_exchange_bps_per_side / 10_000
    regulatory = turnover * settings.paper_fees_bps_per_side / 10_000
    stt = turnover * settings.paper_stt_bps_sell / 10_000 if is_sell else 0.0
    gst = (settings.paper_brokerage_per_order + exchange) * settings.paper_gst_percent / 100
    slippage = turnover * settings.paper_slippage_bps_per_side / 10_000
    impact = turnover * settings.paper_market_impact_bps_per_side / 10_000
    return {
        "brokerage": settings.paper_brokerage_per_order,
        "feesTaxes": regulatory + exchange + stt + gst,
        "slippageImpact": slippage + impact,
    }


def _round_trip_cost(entry: float, exit_price: float, quantity: int, settings: Settings) -> dict[str, float]:
    buy = _one_way_cost(entry, quantity, settings, is_sell=False)
    sell = _one_way_cost(exit_price, quantity, settings, is_sell=True)
    brokerage = buy["brokerage"] + sell["brokerage"]
    fees = buy["feesTaxes"] + sell["feesTaxes"]
    slippage = buy["slippageImpact"] + sell["slippageImpact"]
    return {"brokerage": brokerage, "feesTaxes": fees, "slippageImpact": slippage,
            "variable": fees + slippage, "total": brokerage + fees + slippage}


def _intended_order(trade: dict[str, Any]) -> dict[str, Any]:
    try:
        value = trade.get("intended_order_json") or "{}"
        return json.loads(value) if isinstance(value, str) else dict(value)
    except (TypeError, ValueError, json.JSONDecodeError):
        return {}


def _optional_float(value: Any) -> float | None:
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else None
    except (TypeError, ValueError):
        return None


def _consecutive_losses(con: Any, trading_day: Any | None = None) -> int:
    where = "WHERE status='CLOSED'"
    parameters: list[Any] = []
    if trading_day is not None:
        where += " AND trading_day=?"
        parameters.append(trading_day)
    rows = con.execute(
        f"SELECT net_pnl FROM paper_trades {where} ORDER BY closed_at DESC LIMIT 20",
        parameters,
    ).fetchall()
    count = 0
    for (net_pnl,) in rows:
        if float(net_pnl) > 0:
            break
        count += 1
    return count


def _recent_session_feedback(con: Any, trading_day: Any) -> dict[str, Any]:
    rows = con.execute("""
      SELECT trading_day, sum(net_pnl) net_pnl,
             sum(CASE WHEN net_pnl <= 0 THEN 1 ELSE 0 END) losses,
             count(*) trades
      FROM paper_trades
      WHERE status='CLOSED' AND trading_day < ?
      GROUP BY trading_day ORDER BY trading_day DESC LIMIT 3
    """, [trading_day]).fetchall()
    losing_sessions = sum(1 for _, net_pnl, _, _ in rows if float(net_pnl) < 0)
    return {
        "sessions": [
            {"tradingDay": str(day), "netPnl": round(float(net_pnl), 2), "losses": int(losses), "trades": int(trades)}
            for day, net_pnl, losses, trades in rows
        ],
        "losingSessions": losing_sessions,
        "criteriaTightened": losing_sessions > 0,
    }


def _as_trading_date(value: Any):
    if isinstance(value, datetime):
        return value.date()
    if hasattr(value, "year") and hasattr(value, "month") and hasattr(value, "day"):
        return value
    return datetime.fromisoformat(str(value)).date()


def _flatten_time_reached(now: datetime, settings: Settings) -> bool:
    local = now.astimezone(IST)
    return (local.hour, local.minute) >= (settings.paper_flatten_hour_ist, settings.paper_flatten_minute_ist)


def _entry_window_open(now: datetime) -> bool:
    local = now.astimezone(IST)
    return local.weekday() < 5 and entry_score_threshold(now) is not None


def _fresh_quote(quote: dict[str, Any] | None, now: datetime, stale_seconds: int) -> dict[str, Any] | None:
    if not quote:
        return None
    try:
        bid, ask = float(quote["bid"]), float(quote["ask"])
        market_timestamp = quote["ts"]
        received_timestamp = quote.get("received_at") or market_timestamp
        if market_timestamp.tzinfo is None:
            market_timestamp = market_timestamp.replace(tzinfo=timezone.utc)
        if received_timestamp.tzinfo is None:
            received_timestamp = received_timestamp.replace(tzinfo=timezone.utc)
        market_age = (now - market_timestamp.astimezone(timezone.utc)).total_seconds()
        receipt_age = (now - received_timestamp.astimezone(timezone.utc)).total_seconds()
    except (KeyError, TypeError, ValueError):
        return None
    # Upstox finalizes a one-minute bar after the minute closes, so its market
    # timestamp can be older than the executable bid/ask receipt. Require a
    # fresh receipt and independently cap market-time lag to reject backfills.
    maximum_market_age = stale_seconds * 3
    return quote if (
        bid > 0 and ask > bid
        and 0 <= receipt_age <= stale_seconds
        and 0 <= market_age <= maximum_market_age
    ) else None


def _closed_net_today(con: Any, trading_day: Any) -> float:
    value = con.execute("SELECT coalesce(sum(net_pnl),0) FROM paper_trades WHERE trading_day=? AND status='CLOSED'", [trading_day]).fetchone()[0]
    return float(value or 0)


def _metrics(con: Any, where: str, parameters: list[Any], capital: float) -> dict[str, Any]:
    rows = _records(con, f"SELECT * FROM paper_trades {where} ORDER BY closed_at", parameters)
    wins = [row for row in rows if float(row["net_pnl"]) > 0]
    losses = [row for row in rows if float(row["net_pnl"]) <= 0]
    gross_profit = sum(float(row["net_pnl"]) for row in wins)
    gross_loss = abs(sum(float(row["net_pnl"]) for row in losses))
    equity = peak = maximum_drawdown = 0.0
    for row in rows:
        equity += float(row["net_pnl"])
        peak = max(peak, equity)
        maximum_drawdown = max(maximum_drawdown, peak - equity)
    net_pnl = sum(float(row["net_pnl"]) for row in rows)
    max_capital = max((float(row["capital_used"]) for row in rows), default=0.0)
    return {
        "closedTrades": len(rows),
        "grossPnl": _round(sum(float(row["gross_pnl"]) for row in rows)),
        "netPnl": _round(net_pnl),
        "winRate": _round(len(wins) / len(rows) * 100) if rows else 0,
        "profitFactor": _round(gross_profit / gross_loss) if gross_loss else (None if gross_profit else 0),
        "expectancyPerTrade": _round(net_pnl / len(rows)) if rows else 0,
        "maximumDrawdown": _round(maximum_drawdown),
        "brokerage": _round(sum(float(row["brokerage"]) for row in rows)),
        "feesTaxes": _round(sum(float(row["fees_taxes"]) for row in rows)),
        "slippage": _round(sum(float(row["slippage"]) for row in rows)),
        "capitalUtilisation": _round(max_capital / capital * 100) if capital > 0 else 0,
    }


def _records(con: Any, query: str, parameters: list[Any] | None = None) -> list[dict[str, Any]]:
    cursor = con.execute(query, parameters or [])
    columns = [item[0] for item in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def _public_trade(row: dict[str, Any]) -> dict[str, Any]:
    keys = [
        "trade_id", "trading_day", "run_id", "symbol", "side", "strategy", "strategy_version",
        "data_source", "status", "quantity", "signal_entry", "entry_quote", "entry_fill",
        "stop_price", "target_price", "opened_at", "current_quote", "last_marked_at",
        "exit_quote", "exit_fill", "closed_at", "exit_reason", "gross_pnl", "net_pnl",
        "brokerage", "fees_taxes", "slippage", "capital_used",
        "execution_mode", "entry_order_id", "exit_order_id",
        "peak_quote", "lowest_quote", "mfe", "mae", "profit_giveback", "holding_duration_minutes",
        "last_exit_candle_ts",
    ]
    result = {key: row.get(key) for key in keys}
    for key, value in list(result.items()):
        if isinstance(value, (datetime,)):
            result[key] = value.isoformat()
        elif key == "trading_day" and value is not None:
            result[key] = str(value)
    return result


def _public_rejection(row: dict[str, Any]) -> dict[str, Any]:
    result = dict(row)
    if isinstance(result.get("observed_at"), datetime):
        result["observed_at"] = result["observed_at"].isoformat()
    return result


def _round(value: float) -> float:
    return round(float(value), 2)


def _record_trade_event(con: Any, trade_id: str, run_id: str, event_type: str,
                        observed_at: datetime, quote: float | None, gross_pnl: float | None,
                        net_pnl: float | None, target_status: str,
                        details: dict[str, Any]) -> None:
    con.execute("""
      INSERT INTO paper_trade_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, [
        str(uuid.uuid4()), trade_id, run_id, event_type, observed_at, quote,
        gross_pnl, net_pnl, target_status, json.dumps(details, default=str, sort_keys=True),
    ])


def _record_entry_rejection(con: Any, candidate: Candidate, observed_at: datetime,
                            run_id: str, reason: str) -> None:
    con.execute("""
      INSERT INTO paper_entry_rejections VALUES (?, ?, ?, ?, ?, ?, ?)
    """, [
        str(uuid.uuid4()), run_id, candidate.symbol, candidate.strategy, observed_at,
        reason, json.dumps({"rankScore": candidate.rank_score}, sort_keys=True),
    ])
    con.execute("""
      UPDATE paper_signals SET status=?
      WHERE run_id=? AND symbol=? AND strategy=?
    """, [f"REJECTED_{reason}", run_id, candidate.symbol, candidate.strategy])


def _submit_upstox_sandbox_order(symbol: str, instrument_key: str, quantity: int, price: float,
                                  side: str, trade_id: str, settings: Settings) -> str:
    from features.upstox.python.upstox_sandbox import place_sandbox_order

    result = place_sandbox_order(
        symbol=symbol,
        instrument_key=instrument_key,
        quantity=quantity,
        price=price,
        product="I",
        transaction_type=side,
        tag=f"paper_{side.lower()}_{trade_id}"[:40],
        access_token=settings.upstox_sandbox_access_token,
    )
    order_id = str(result.get("order_id") or "")
    if result.get("status") != "SUCCESS" or not order_id:
        raise RuntimeError("Upstox sandbox did not return an accepted order ID")
    return order_id
