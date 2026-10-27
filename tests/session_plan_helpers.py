"""Seed FINAL_SESSION_PLAN rows for tests that exercise paper entries.

Since the fail-closed plan guard in engine.paper._open_trade, a symbol can only
be entered when today's final_session_plan lists it with status TRADE. Tests
that exercise entry, exit, risk or sizing logic seed that row explicitly, the
same way the premarket job does in production. The guard itself is covered by
tests/test_final_session_plan.py and tests/test_runtime_audit.py.
"""

from __future__ import annotations

from datetime import datetime
from typing import Iterable
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")


def seed_trade_plan(store, now: datetime, symbols: Iterable[str], status: str = "TRADE") -> None:
    """Insert a plan row for each symbol on the IST trading day of `now` (idempotent)."""
    trading_day = now.astimezone(IST).date()
    with store.connect() as con:
        for symbol in dict.fromkeys(symbols):
            con.execute(
                """
                INSERT OR IGNORE INTO final_session_plan (
                    plan_id, trading_day, symbol, strategy_template, strategy_id,
                    direction, entry_rule, adx, vwap_orb_rule, sl_pct, target_pct,
                    validator_source, backtest_trades, win_rate, avg_win_loss,
                    max_drawdown, learning_adjustment, final_score, status, locked_at
                ) VALUES (?, ?, ?, 'TEST', 'test-plan', 'LONG', 'TEST', 0, 'ON', 1.0, 1.5,
                          'TEST_FIXTURE', 0, 0, 0, 0, 0, 0, ?, ?)
                """,
                [f"PLAN-{trading_day}-{symbol}", trading_day, symbol, status, now],
            )
