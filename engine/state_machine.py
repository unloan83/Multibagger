from __future__ import annotations

import datetime
import enum
import logging
import sqlite3
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Union, Any

logger = logging.getLogger("state_machine")

class TradeState(str, enum.Enum):
    QUALIFIED = "QUALIFIED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    ENTRY_PENDING = "ENTRY_PENDING"
    OPEN = "OPEN"
    PARTIALLY_FILLED = "PARTIALLY_FILLED"
    CANCELLED = "CANCELLED"
    FAILED = "FAILED"
    EXIT_PENDING = "EXIT_PENDING"
    CLOSED = "CLOSED"
    RECONCILING = "RECONCILING"
    HALTED = "HALTED"

VALID_STATES = {s.value for s in TradeState}

ALLOWED_TRANSITIONS = {
    TradeState.QUALIFIED: {TradeState.APPROVED, TradeState.REJECTED, TradeState.HALTED},
    TradeState.APPROVED: {TradeState.ENTRY_PENDING, TradeState.CANCELLED, TradeState.HALTED},
    TradeState.ENTRY_PENDING: {TradeState.OPEN, TradeState.PARTIALLY_FILLED, TradeState.CANCELLED, TradeState.FAILED, TradeState.HALTED},
    TradeState.PARTIALLY_FILLED: {TradeState.OPEN, TradeState.EXIT_PENDING, TradeState.CANCELLED, TradeState.CLOSED, TradeState.HALTED},
    TradeState.OPEN: {TradeState.EXIT_PENDING, TradeState.CLOSED, TradeState.HALTED},
    TradeState.EXIT_PENDING: {TradeState.CLOSED, TradeState.HALTED},
    TradeState.CANCELLED: set(),
    TradeState.FAILED: set(),
    TradeState.REJECTED: set(),
    TradeState.CLOSED: set(),
    TradeState.RECONCILING: {TradeState.QUALIFIED, TradeState.APPROVED, TradeState.OPEN, TradeState.HALTED},
    TradeState.HALTED: {TradeState.CLOSED, TradeState.RECONCILING},
}

class StateMachine:
    def __init__(self, db_path: Union[str, Path] = "data/trading_state.db"):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.init_db()

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=10.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        return conn

    def init_db(self):
        with self._get_conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS trades (
                    trade_id TEXT PRIMARY KEY,
                    instrument_key TEXT NOT NULL,
                    symbol TEXT NOT NULL,
                    state TEXT NOT NULL,
                    entry_price REAL NOT NULL,
                    target_price REAL NOT NULL,
                    stop_loss REAL NOT NULL,
                    qty INTEGER NOT NULL,
                    filled_qty INTEGER DEFAULT 0,
                    gross_pnl REAL DEFAULT 0.0,
                    net_pnl REAL DEFAULT 0.0,
                    rejection_reason TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS system_config (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS rvol_baselines (
                    instrument_key TEXT NOT NULL,
                    bucket_index INTEGER NOT NULL,
                    avg_volume REAL NOT NULL,
                    PRIMARY KEY (instrument_key, bucket_index)
                );
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS delivery_baselines (
                    instrument_key TEXT PRIMARY KEY,
                    delivery_20d_sma REAL NOT NULL,
                    prior_day_delivery_pct REAL NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            conn.commit()

    @property
    def is_halted(self) -> bool:
        return self.get_system_state() == "HALTED"

    @is_halted.setter
    def is_halted(self, value: bool):
        val_str = "HALTED" if value else "RUNNING"
        with self._get_conn() as conn:
            conn.execute("INSERT OR REPLACE INTO system_config (key, value) VALUES ('system_state', ?)", (val_str,))
            conn.commit()

    def get_system_state(self) -> str:
        with self._get_conn() as conn:
            row = conn.execute("SELECT value FROM system_config WHERE key = 'system_state'").fetchone()
            if row:
                return row["value"]
            return "RUNNING"

    def create_trade_intent(self, candidate: dict) -> str:
        trade_id = str(candidate.get("trade_id") or f"trade-{uuid.uuid4().hex[:12]}")
        ikey = str(candidate.get("instrument_key", ""))
        symbol = str(candidate.get("symbol", ""))
        entry_p = float(candidate.get("entry_price", candidate.get("ltp", 0.0)))
        target_p = float(candidate.get("target_price", 0.0))
        sl_p = float(candidate.get("stop_loss", 0.0))
        qty = int(candidate.get("qty", 1))

        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        with self._get_conn() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO trades (trade_id, instrument_key, symbol, state, entry_price, target_price, stop_loss, qty, filled_qty, gross_pnl, net_pnl, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0.0, 0.0, ?, ?)
                """,
                (trade_id, ikey, symbol, TradeState.QUALIFIED.value, entry_p, target_p, sl_p, qty, now_iso, now_iso),
            )
            conn.commit()
        return trade_id

    def inject_raw_trade(self, trade_dict: dict):
        t_id = trade_dict["trade_id"]
        ikey = trade_dict.get("instrument_key", "")
        symbol = trade_dict.get("symbol", "")
        state = trade_dict.get("state", TradeState.OPEN.value)
        entry_p = float(trade_dict.get("entry_price", 0.0))
        target_p = float(trade_dict.get("target_price", 0.0))
        sl_p = float(trade_dict.get("stop_loss", 0.0))
        qty = int(trade_dict.get("qty", 1))
        filled_qty = int(trade_dict.get("filled_qty", qty))
        gross_pnl = float(trade_dict.get("gross_pnl", 0.0))
        net_pnl = float(trade_dict.get("net_pnl", 0.0))

        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        with self._get_conn() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO trades (trade_id, instrument_key, symbol, state, entry_price, target_price, stop_loss, qty, filled_qty, gross_pnl, net_pnl, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (t_id, ikey, symbol, state, entry_p, target_p, sl_p, qty, filled_qty, gross_pnl, net_pnl, now_iso, now_iso),
            )
            conn.commit()

    def transition(self, trade_id: str, to_state: Union[TradeState, str], rejection_reason: Optional[str] = None) -> bool:
        to_state_val = to_state.value if isinstance(to_state, TradeState) else to_state
        if to_state_val not in VALID_STATES:
            raise ValueError(f"Invalid state {to_state_val}")

        with self._get_conn() as conn:
            row = conn.execute("SELECT state FROM trades WHERE trade_id = ?", (trade_id,)).fetchone()
            if not row:
                logger.error("Trade %s not found for transition", trade_id)
                return False

            now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
            
            if rejection_reason:
                conn.execute(
                    "UPDATE trades SET state = ?, rejection_reason = ?, updated_at = ? WHERE trade_id = ?",
                    (to_state_val, rejection_reason, now_iso, trade_id),
                )
            else:
                conn.execute(
                    "UPDATE trades SET state = ?, updated_at = ? WHERE trade_id = ?",
                    (to_state_val, now_iso, trade_id),
                )
            conn.commit()

        if to_state_val == TradeState.HALTED.value:
            self.is_halted = True
        return True

    def transition_state(self, trade_id: str, to_state: str, rejection_reason: Optional[str] = None) -> bool:
        return self.transition(trade_id, to_state, rejection_reason)

    def record_partial_fill(self, trade_id: str, filled_qty: int, fill_price: float):
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        with self._get_conn() as conn:
            conn.execute(
                """
                UPDATE trades
                SET filled_qty = ?, entry_price = ?, state = ?, updated_at = ?
                WHERE trade_id = ?
                """,
                (filled_qty, fill_price, TradeState.PARTIALLY_FILLED.value, now_iso, trade_id),
            )
            conn.commit()

    def resolve_pending_timeout(self, trade_id: str, elapsed_seconds: float = 16.0):
        if elapsed_seconds < 15.0:
            return

        with self._get_conn() as conn:
            row = conn.execute("SELECT * FROM trades WHERE trade_id = ?", (trade_id,)).fetchone()
            if not row:
                return

            filled_qty = int(row["filled_qty"])
            now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

            if filled_qty > 0:
                conn.execute(
                    """
                    UPDATE trades
                    SET state = ?, qty = ?, rejection_reason = ?, updated_at = ?
                    WHERE trade_id = ?
                    """,
                    (TradeState.OPEN.value, filled_qty, "PARTIAL_FILL_RESOLVED", now_iso, trade_id),
                )
                logger.info("Trade %s partial fill resolved: %d filled, state transitioned to OPEN", trade_id, filled_qty)
            else:
                conn.execute(
                    """
                    UPDATE trades
                    SET state = ?, rejection_reason = ?, updated_at = ?
                    WHERE trade_id = ?
                    """,
                    (TradeState.CANCELLED.value, "ENTRY_TIMEOUT_15S", now_iso, trade_id),
                )
                logger.info("Trade %s entry timed out with 0 fills: transitioned to CANCELLED", trade_id)

            conn.commit()

    def reconcile_on_startup(self) -> Dict[str, str]:
        reconciled = {}
        with self._get_conn() as conn:
            rows = conn.execute("SELECT trade_id, state FROM trades WHERE state IN ('ENTRY_PENDING')").fetchall()
            for r in rows:
                t_id = r["trade_id"]
                self.transition(t_id, TradeState.CANCELLED, rejection_reason="STARTUP_RECONCILE_CANCEL")
                reconciled[t_id] = "CANCELLED"
        return reconciled

    def get_state(self, trade_id: str) -> Optional[TradeState]:
        with self._get_conn() as conn:
            row = conn.execute("SELECT state FROM trades WHERE trade_id = ?", (trade_id,)).fetchone()
            if row:
                return TradeState(row["state"])
            return None

    def get_trade(self, trade_id: str) -> Optional[Dict[str, Any]]:
        with self._get_conn() as conn:
            row = conn.execute("SELECT * FROM trades WHERE trade_id = ?", (trade_id,)).fetchone()
            if row:
                return dict(row)
            return None

    def get_open_positions(self) -> List[dict]:
        with self._get_conn() as conn:
            rows = conn.execute("SELECT * FROM trades WHERE state IN ('OPEN', 'PARTIALLY_FILLED')").fetchall()
            return [dict(r) for r in rows]

    def get_total_realized_pnl(self) -> float:
        with self._get_conn() as conn:
            res = conn.execute("SELECT SUM(net_pnl) as total FROM trades WHERE state = 'CLOSED'").fetchone()
            return float(res["total"] or 0.0)

    def update_fill(self, trade_id: str, filled_qty: int, fill_price: float, gross_pnl: float, net_pnl: float, new_state: str):
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        with self._get_conn() as conn:
            conn.execute(
                """
                UPDATE trades
                SET filled_qty = ?, entry_price = ?, gross_pnl = ?, net_pnl = ?, state = ?, updated_at = ?
                WHERE trade_id = ?
                """,
                (filled_qty, fill_price, gross_pnl, net_pnl, new_state, now_iso, trade_id),
            )
            conn.commit()

    def process_auto_timeouts(self, max_pending_seconds: float = 15.0) -> List[str]:
        timed_out_ids = []
        now = datetime.datetime.now(datetime.timezone.utc)
        with self._get_conn() as conn:
            rows = conn.execute(
                "SELECT trade_id, filled_qty, qty, created_at, updated_at FROM trades WHERE state IN ('ENTRY_PENDING', 'PARTIALLY_FILLED')"
            ).fetchall()
            for r in rows:
                updated_at_str = r["updated_at"] or r["created_at"]
                try:
                    dt = datetime.datetime.fromisoformat(updated_at_str)
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=datetime.timezone.utc)
                    elapsed = (now - dt).total_seconds()
                except Exception:
                    elapsed = 999.0

                if elapsed > max_pending_seconds:
                    t_id = r["trade_id"]
                    self.resolve_pending_timeout(t_id, elapsed)
                    timed_out_ids.append(t_id)
        return timed_out_ids
