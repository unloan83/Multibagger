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
from .strategies import Candidate


IST = ZoneInfo("Asia/Kolkata")
STRATEGY_VERSION = "intraday-orb-vwap-paper-v1"
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
            reason = _regular_exit_reason(trade, quote, now, settings)
            _mark_trade(con, trade, quote, now, settings, reason, run_id)

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
        open_rows = _records(con, "SELECT * FROM paper_trades WHERE status='OPEN' ORDER BY opened_at")
        existing_keys = {
            (str(row["symbol"]), str(row["strategy"]))
            for row in _records(con, "SELECT symbol,strategy FROM paper_trades WHERE trading_day=?", [trading_day])
        }

        if realized >= settings.paper_daily_profit_target:
            no_entry_reasons.append("Daily paper profit target reached; new entries are disabled.")
        if realized <= -settings.paper_daily_loss_limit:
            no_entry_reasons.append("Daily paper loss limit reached; new entries are disabled.")
        if not _entry_window_open(now):
            no_entry_reasons.append("Outside the automatic paper-entry window (09:20–14:45 IST on NSE weekdays).")

        entries_allowed = not no_entry_reasons
        for candidate in candidates:
            if not entries_allowed:
                break
            if len(open_rows) >= settings.paper_max_open_positions:
                no_entry_reasons.append("Maximum simultaneous paper positions reached.")
                break
            if day_count >= settings.paper_max_trades_per_day:
                no_entry_reasons.append("Maximum paper trades for the day reached.")
                break
            key = (candidate.symbol, candidate.strategy)
            if key in existing_keys:
                continue
            quote = _fresh_quote(quotes.get(candidate.symbol), now, settings.stale_seconds)
            if not quote:
                continue
            trade, rejection_reason = _open_trade(
                con, candidate, quote, now, trading_day, run_id, settings,
            )
            if trade:
                open_rows.append(trade)
                existing_keys.add(key)
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
        enabled = not target_reached and not loss_limit_reached and _entry_window_open(now)
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
    quotes = store.latest_quotes(symbols)
    monitor_run_id = f"monitor-{uuid.uuid4()}"
    result = run_paper_cycle(store, settings, [], quotes, observed_at, monitor_run_id)
    result["closedByMonitor"] = [
        trade for trade in result["recentClosedTrades"]
        if str(trade.get("trade_id")) in open_trade_ids
    ]
    from .publication import refresh_snapshot_with_paper
    refresh_snapshot_with_paper(settings, result, observed_at, monitor_run_id)
    return result


def _open_trade(con: Any, candidate: Candidate, quote: dict[str, Any], now: datetime, trading_day: Any,
                run_id: str, settings: Settings) -> tuple[dict[str, Any] | None, str | None]:
    entry_quote = float(quote["ask"])
    stop_distance = entry_quote - float(candidate.stop)
    if stop_distance <= 0:
        return None, "INVALID_STOP_DISTANCE"
    risk_budget = settings.paper_portfolio_capital * settings.paper_risk_per_trade_pct / 100
    capital_budget = settings.paper_portfolio_capital * settings.paper_max_capital_per_trade_pct / 100
    quantity = min(math.floor(risk_budget / stop_distance), math.floor(capital_budget / entry_quote))
    if quantity < 1:
        return None, "POSITION_SIZE_BELOW_ONE"
    entry_fill = entry_quote * (1 + settings.paper_slippage_bps_per_side / 10_000)
    capital_used = entry_fill * quantity
    brokerage = settings.paper_brokerage_per_order
    fees = capital_used * settings.paper_fees_bps_per_side / 10_000
    slippage = (entry_fill - entry_quote) * quantity
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
                candidate.symbol, instrument_key, quantity, entry_quote, "BUY", trade_id, settings,
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
        "side": "BUY", "orderType": "PAPER_MARKET", "symbol": candidate.symbol,
        "quantity": quantity, "observedAsk": entry_quote, "stop": candidate.stop,
        "target": candidate.target, "signal": asdict(candidate),
    }
    values = [
        trade_id, trading_day, run_id, candidate.symbol, candidate.strategy, STRATEGY_VERSION,
        f"{settings.market_data_provider.upper()}_1MIN_EXECUTABLE_QUOTES", "OPEN", quantity, candidate.entry,
        entry_quote, entry_fill, candidate.stop, candidate.target, now, entry_quote, now,
        None, None, None, None, 0.0, -(brokerage + fees + slippage), brokerage, fees,
        slippage, capital_used, json.dumps(intended, default=str, sort_keys=True),
    ]
    con.execute("""
      INSERT INTO paper_trades (
        trade_id,trading_day,run_id,symbol,strategy,strategy_version,data_source,status,quantity,
        signal_entry,entry_quote,entry_fill,stop_price,target_price,opened_at,current_quote,
        last_marked_at,exit_quote,exit_fill,closed_at,exit_reason,gross_pnl,net_pnl,brokerage,
        fees_taxes,slippage,capital_used,intended_order_json,execution_mode,entry_order_id,exit_order_id
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, [*values, execution_mode, entry_order_id, None])
    con.execute("""
      UPDATE paper_signals SET status='EXECUTED'
      WHERE run_id=? AND symbol=? AND strategy=?
    """, [run_id, candidate.symbol, candidate.strategy])
    _record_trade_event(
        con, trade_id, run_id, "ENTRY", now, entry_quote, 0.0,
        -(brokerage + fees + slippage), "OPEN",
        {"executionMode": execution_mode, "orderId": entry_order_id, "target": candidate.target, "stop": candidate.stop},
    )
    return _records(con, "SELECT * FROM paper_trades WHERE trade_id=?", [trade_id])[0], None


def _mark_trade(con: Any, trade: dict[str, Any], quote: dict[str, Any], now: datetime,
                settings: Settings, exit_reason: str | None, event_run_id: str) -> None:
    exit_quote = float(quote["bid"])
    quantity = int(trade["quantity"])
    entry_quote = float(trade["entry_quote"])
    gross = (exit_quote - entry_quote) * quantity
    exit_fill = exit_quote * (1 - settings.paper_slippage_bps_per_side / 10_000)
    exit_value = exit_fill * quantity
    entry_brokerage = float(trade["brokerage"])
    entry_fees = float(trade["fees_taxes"])
    entry_slippage = float(trade["slippage"])
    total_brokerage = entry_brokerage + settings.paper_brokerage_per_order
    total_fees = entry_fees + exit_value * settings.paper_fees_bps_per_side / 10_000
    total_slippage = entry_slippage + (exit_quote - exit_fill) * quantity
    net = gross - total_brokerage - total_fees - total_slippage
    if exit_reason:
        exit_order_id = trade.get("exit_order_id")
        if trade.get("execution_mode") == "UPSTOX_SANDBOX" and not exit_order_id:
            instrument_key = str(quote.get("instrument_key") or "")
            try:
                exit_order_id = _submit_upstox_sandbox_order(
                    str(trade["symbol"]), instrument_key, quantity, exit_quote, "SELL",
                    str(trade["trade_id"]), settings,
                )
            except Exception as error:
                LOG.error("Upstox sandbox exit failed for %s; paper position remains open: %s", trade["symbol"], error)
                con.execute("UPDATE paper_trades SET current_quote=?,last_marked_at=?,gross_pnl=?,net_pnl=? WHERE trade_id=?",
                            [exit_quote, now, gross, net, trade["trade_id"]])
                _record_trade_event(
                    con, str(trade["trade_id"]), event_run_id, "EXIT_REJECTED", now,
                    exit_quote, gross, net, str(exit_reason), {"error": str(error)[:500]},
                )
                return
        con.execute("""
          UPDATE paper_trades SET status='CLOSED', current_quote=?, last_marked_at=?, exit_quote=?,
            exit_fill=?, closed_at=?, exit_reason=?, gross_pnl=?, net_pnl=?, brokerage=?,
            fees_taxes=?, slippage=?, exit_order_id=? WHERE trade_id=?
        """, [exit_quote, now, exit_quote, exit_fill, now, exit_reason, gross, net,
              total_brokerage, total_fees, total_slippage, exit_order_id, trade["trade_id"]])
        con.execute("""
          UPDATE paper_signals SET status=?
          WHERE run_id=? AND symbol=? AND strategy=?
        """, [f"CLOSED_{exit_reason}", trade["run_id"], trade["symbol"], trade["strategy"]])
        _record_trade_event(
            con, str(trade["trade_id"]), event_run_id, "EXIT", now,
            exit_quote, gross, net, str(exit_reason), {"orderId": exit_order_id, "exitFill": exit_fill},
        )
    else:
        con.execute("""
          UPDATE paper_trades SET current_quote=?, last_marked_at=?, gross_pnl=?, net_pnl=?
          WHERE trade_id=?
        """, [exit_quote, now, gross, net, trade["trade_id"]])
        _record_trade_event(
            con, str(trade["trade_id"]), event_run_id, "MARK", now,
            exit_quote, gross, net, "OPEN", {},
        )


def _regular_exit_reason(trade: dict[str, Any], quote: dict[str, Any], now: datetime, settings: Settings) -> str | None:
    bid = float(quote["bid"])
    if bid <= float(trade["stop_price"]):
        return "STOP_LOSS"
    if bid >= float(trade["target_price"]):
        return "PROFIT_TARGET"
    if _flatten_time_reached(now, settings):
        return "END_OF_DAY"
    return None


def _flatten_time_reached(now: datetime, settings: Settings) -> bool:
    local = now.astimezone(IST)
    return (local.hour, local.minute) >= (settings.paper_flatten_hour_ist, settings.paper_flatten_minute_ist)


def _entry_window_open(now: datetime) -> bool:
    local = now.astimezone(IST)
    minute = local.hour * 60 + local.minute
    return local.weekday() < 5 and 9 * 60 + 20 <= minute <= 14 * 60 + 45


def _fresh_quote(quote: dict[str, Any] | None, now: datetime, stale_seconds: int) -> dict[str, Any] | None:
    if not quote:
        return None
    try:
        bid, ask = float(quote["bid"]), float(quote["ask"])
        timestamp = quote["ts"]
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=timezone.utc)
        age = (now - timestamp.astimezone(timezone.utc)).total_seconds()
    except (KeyError, TypeError, ValueError):
        return None
    return quote if bid > 0 and ask > bid and 0 <= age <= stale_seconds else None


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
        "trade_id", "trading_day", "run_id", "symbol", "strategy", "strategy_version",
        "data_source", "status", "quantity", "signal_entry", "entry_quote", "entry_fill",
        "stop_price", "target_price", "opened_at", "current_quote", "last_marked_at",
        "exit_quote", "exit_fill", "closed_at", "exit_reason", "gross_pnl", "net_pnl",
        "brokerage", "fees_taxes", "slippage", "capital_used",
        "execution_mode", "entry_order_id", "exit_order_id",
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
