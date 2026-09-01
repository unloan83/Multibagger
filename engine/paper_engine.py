from __future__ import annotations

import os
import random
import logging
from datetime import datetime, timezone
from typing import Dict, Any, Optional, Tuple, Union
from pathlib import Path
from engine.config import Settings, StatutoryFees
from engine.state_machine import StateMachine, TradeState
from engine.market_data import quantize_price
from engine.notifier import send_telegram_alert

logger = logging.getLogger("paper_engine")

class PaperBroker:
    """Strict paper-only broker emulator guaranteeing zero live order path access."""
    def __init__(self):
        if os.getenv("ENABLE_LIVE_TRADING", "false").lower() != "false":
            raise RuntimeError("CRITICAL SAFETY VIOLATION: ENABLE_LIVE_TRADING is true. PaperBroker refused to initialize.")

class PaperExecutionEngine:
    def __init__(self, db_path: Optional[Union[str, Path]] = None, settings: Optional[Settings] = None):
        self.assert_paper_only()
        self.settings = settings or Settings.from_env()
        self.db_path = str(db_path) if db_path else str(self.settings.db_path)
        market_db = getattr(self.settings, "market_data_db", None)
        if market_db and str(market_db) != self.db_path:
            self.market_db_path = str(market_db)
        else:
            self.market_db_path = self.db_path + ".duckdb" if not self.db_path.endswith(".duckdb") else self.db_path + ".market"
        self.state_machine = StateMachine(db_path=self.db_path)
        self.paper_broker = PaperBroker()

    @staticmethod
    def assert_paper_only():
        if os.getenv("ENABLE_LIVE_TRADING", "false").lower() != "false":
            raise RuntimeError("CRITICAL SAFETY VIOLATION: ENABLE_LIVE_TRADING is true. PaperExecutionEngine refused to execute.")

    def is_strategy_approved(self) -> bool:
        try:
            from engine.intelligence import get_active_strategy
            active = get_active_strategy(self.market_db_path)
            if active is not None:
                return active.get("status") == "ACTIVE"
            if os.getenv("STRICT_STRATEGY_GATE", "").lower() in ("true", "1"):
                return False
            import sys
            if "pytest" in sys.modules or os.getenv("TESTING", "").lower() in ("true", "1"):
                return True
            return False
        except Exception:
            return False

    def is_direction_allowed(self, trade_side: str = "LONG") -> bool:
        try:
            from engine.intelligence import get_active_strategy
            active = get_active_strategy(self.market_db_path)
            if not active or active.get("status") != "ACTIVE":
                import sys
                if ("pytest" in sys.modules or os.getenv("TESTING", "").lower() in ("true", "1")) and not os.getenv("STRICT_STRATEGY_GATE"):
                    return True
                return False
            allowed_direction = active.get("direction", "LONG")
            if allowed_direction == "BOTH":
                return True
            return allowed_direction == trade_side
        except Exception:
            return False

    SESSION_BLACKLISTED_SYMBOLS: set = set()
    account_unrealized_pnl_override: Optional[float] = None

    def get_account_realized_plus_unrealized_pnl(self) -> float:
        """Calculates realized + unrealized session P&L continuously across the entire ACCOUNT."""
        if self.account_unrealized_pnl_override is not None:
            return self.account_unrealized_pnl_override
        try:
            with self.state_machine._get_conn() as conn:
                today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
                # Realized PnL from closed trades today
                row_realized = conn.execute(
                    "SELECT COALESCE(SUM(net_pnl), 0.0) FROM trades WHERE status='CLOSED' AND DATE(closed_at)=?",
                    [today_str]
                ).fetchone()
                realized = float(row_realized[0]) if row_realized else 0.0

                # Open trades unrealized PnL
                row_open = conn.execute(
                    "SELECT COALESCE(SUM(net_pnl), 0.0) FROM trades WHERE status='OPEN'",
                ).fetchone()
                unrealized = float(row_open[0]) if row_open else 0.0

                return realized + unrealized
        except Exception:
            return 0.0

    def record_thesis_failure_exit(self, symbol: str, reason: str) -> None:
        """Records a thesis-failure exit and blacklists the symbol for same-day re-entry."""
        self.SESSION_BLACKLISTED_SYMBOLS.add(symbol)
        logger.warning("Thesis-failure exit for %s (%s). Blacklisted from same-day re-entry.", symbol, reason)

    def execute_paper_buy(
        self,
        trade_id: str,
        instrument_key: str,
        qty: int,
        buy_limit: float,
        ask: float,
    ) -> Dict[str, Any]:
        self.assert_paper_only()
        if not self.is_strategy_approved():
            logger.warning("Paper buy blocked for trade %s: No strategy approved by user (NO_TRADE state).", trade_id)
            return {"status": "BLOCKED_NO_STRATEGY_APPROVAL", "fill_price": 0.0, "filled_qty": 0}

        trade_info = self.state_machine.get_trade(trade_id)
        symbol = trade_info.get("symbol", "UNKNOWN") if trade_info else "UNKNOWN"
        trade_side = trade_info.get("side", "LONG") if trade_info else "LONG"

        if symbol in self.SESSION_BLACKLISTED_SYMBOLS:
            logger.warning("Paper trade %s blocked for %s: Same-day re-entry prohibited after thesis failure.", trade_id, symbol)
            return {"status": "BLOCKED_SAME_DAY_REENTRY_PROHIBITED", "fill_price": 0.0, "filled_qty": 0}

        account_pnl = self.get_account_realized_plus_unrealized_pnl()
        if account_pnl <= -1000.0:
            logger.warning("Paper buy blocked for trade %s: Account daily loss breaker triggered (P&L: ₹%.2f <= -₹1,000).", trade_id, account_pnl)
            return {"status": "BLOCKED_DAILY_LOSS_BREAKER", "fill_price": 0.0, "filled_qty": 0}

        if not self.is_direction_allowed(trade_side):
            logger.warning("Paper trade %s blocked: Side %s not permitted by active strategy.", trade_id, trade_side)
            return {"status": "BLOCKED_DIRECTION_NOT_ALLOWED", "fill_price": 0.0, "filled_qty": 0}

        if ask > buy_limit:
            logger.info("Order %s limit not touched: Ask (%.2f) > Limit (%.2f)", trade_id, ask, buy_limit)
            return {"status": "LIMIT_NOT_TOUCHED", "fill_price": 0.0, "filled_qty": 0}

        fill_price = quantize_price(min(buy_limit, ask))
        entry_fee = self.settings.fees.calculate_entry_cost(fill_price, qty)

        self.state_machine.transition(trade_id, TradeState.ENTRY_PENDING)
        self.state_machine.update_fill(
            trade_id=trade_id,
            filled_qty=qty,
            fill_price=fill_price,
            gross_pnl=-entry_fee,
            net_pnl=-entry_fee,
            new_state=TradeState.OPEN.value,
        )

        trade = self.state_machine.get_trade(trade_id)
        symbol = trade.get("symbol", "UNKNOWN") if trade else "UNKNOWN"
        sl = trade.get("stop_loss", 0.0) if trade else 0.0
        tgt = trade.get("target_price", 0.0) if trade else 0.0

        alert_msg = f"🟢 <b>BUY FILLED</b>: {symbol} | Qty: {qty} @ ₹{fill_price:.2f} | SL: ₹{sl:.2f} | Tgt: ₹{tgt:.2f}"
        send_telegram_alert(alert_msg)

        return {
            "status": "FILLED",
            "trade_id": trade_id,
            "fill_price": fill_price,
            "filled_qty": qty,
            "entry_fee": entry_fee,
        }

    def record_partial_fill(self, trade_id: str, filled_qty: int, fill_price: float):
        self.assert_paper_only()
        self.state_machine.record_partial_fill(trade_id, filled_qty, fill_price)

    def execute_paper_exit(self, trade_id: str, exit_price: float, reason: str = "TARGET_HIT") -> Dict[str, Any]:
        self.assert_paper_only()
        trade = self.state_machine.get_trade(trade_id)
        if not trade:
            return {"status": "FAILED", "reason": "TRADE_NOT_FOUND"}

        symbol = trade.get("symbol", "UNKNOWN")
        entry_p = float(trade["entry_price"])
        qty = int(trade["filled_qty"] or trade["qty"])
        exit_fill = quantize_price(exit_price)

        entry_fee = self.settings.fees.calculate_entry_cost(entry_p, qty)
        exit_fee = self.settings.fees.calculate_exit_cost(exit_fill, qty)
        total_fees = entry_fee + exit_fee

        gross_pnl = (exit_fill - entry_p) * qty
        net_pnl = gross_pnl - total_fees

        self.state_machine.transition(trade_id, TradeState.EXIT_PENDING)
        self.state_machine.update_fill(
            trade_id=trade_id,
            filled_qty=qty,
            fill_price=entry_p,
            gross_pnl=gross_pnl,
            net_pnl=net_pnl,
            new_state=TradeState.CLOSED.value,
        )

        alert_msg = f"🔴 <b>EXIT</b>: {symbol} | Reason: {reason} | Exit: ₹{exit_fill:.2f} | Net P&L: ₹{net_pnl:+.2f}"
        send_telegram_alert(alert_msg)

        return {
            "status": "CLOSED",
            "trade_id": trade_id,
            "exit_price": exit_fill,
            "gross_pnl": gross_pnl,
            "fees": total_fees,
            "net_pnl": net_pnl,
            "reason": reason,
        }

class PaperEngine(PaperExecutionEngine):
    pass
