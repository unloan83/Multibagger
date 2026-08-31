from __future__ import annotations

import asyncio
import datetime
import logging
from typing import Dict, Any, List, Optional, Tuple, Union
from pathlib import Path
from engine.config import Settings
from engine.state_machine import StateMachine, TradeState
from engine.paper_engine import PaperExecutionEngine
from engine.notifier import send_telegram_alert

logger = logging.getLogger("position_manager")

class PositionManager:
    def __init__(self, db_path: Optional[Union[str, Path]] = None, settings: Optional[Settings] = None):
        self.settings = settings or Settings.from_env()
        if db_path:
            self.state_machine = StateMachine(db_path=db_path)
        else:
            self.state_machine = StateMachine(db_path=self.settings.db_path)
        self.paper_engine = PaperExecutionEngine(db_path=self.state_machine.db_path, settings=self.settings)
        self.high_water_marks: Dict[str, float] = {}
        self.is_running = False

    def get_active_positions(self) -> List[dict]:
        return self.state_machine.get_open_positions()

    def evaluate_trailing_sl(
        self,
        trade_id: str,
        current_ltp: float,
        high_since_entry: float,
        atr_5m: float,
    ) -> float:
        trade = self.state_machine.get_trade(trade_id)
        if not trade:
            return 0.0

        current_sl = float(trade["stop_loss"])
        new_sl = high_since_entry - (3.0 * atr_5m)

        if new_sl > current_sl:
            with self.state_machine._get_conn() as conn:
                conn.execute("UPDATE trades SET stop_loss = ? WHERE trade_id = ?", (new_sl, trade_id))
                conn.commit()
            return new_sl

        return current_sl

    def check_portfolio_risk_breaker(
        self,
        current_realized_pnl: float,
        current_unrealized_pnl: float,
    ) -> Tuple[bool, int]:
        total_mtm = current_realized_pnl + current_unrealized_pnl
        if total_mtm <= -self.settings.hard_daily_loss_limit:
            logger.critical("PORTFOLIO LOSS BREAKER TRIGGERED! MTM Loss: ₹%.2f <= -₹%.2f", total_mtm, self.settings.hard_daily_loss_limit)
            self.state_machine.is_halted = True
            
            send_telegram_alert("🚨 <b>EMERGENCY HALT</b>: Daily Loss Limit Hit (-₹1,000) | All Positions Liquidated")

            open_positions = self.get_active_positions()
            exits_triggered = 0

            for pos in open_positions:
                t_id = pos["trade_id"]
                entry_p = float(pos["entry_price"])
                self.paper_engine.execute_paper_exit(t_id, exit_price=entry_p * 0.99, reason="MAX_DAILY_LOSS_EXCEEDED")
                exits_triggered += 1

            return True, exits_triggered

        return False, 0

class PositionSupervisor(PositionManager):
    """Backward compatibility alias."""
    pass
