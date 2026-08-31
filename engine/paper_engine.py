from __future__ import annotations

import os
import random
import logging
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
        if db_path:
            self.state_machine = StateMachine(db_path=db_path)
        else:
            self.state_machine = StateMachine(db_path=self.settings.db_path)
        self.paper_broker = PaperBroker()

    @staticmethod
    def assert_paper_only():
        if os.getenv("ENABLE_LIVE_TRADING", "false").lower() != "false":
            raise RuntimeError("CRITICAL SAFETY VIOLATION: ENABLE_LIVE_TRADING is true. PaperExecutionEngine refused to execute.")

    def execute_paper_buy(
        self,
        trade_id: str,
        instrument_key: str,
        qty: int,
        buy_limit: float,
        ask: float,
    ) -> Dict[str, Any]:
        self.assert_paper_only()
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
