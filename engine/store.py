from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
import threading
from typing import Iterator

import duckdb
import pandas as pd


_DATABASE_LOCK = threading.RLock()


SCHEMA = """
CREATE TABLE IF NOT EXISTS instruments (
  instrument_key VARCHAR PRIMARY KEY, symbol VARCHAR NOT NULL, name VARCHAR,
  exchange VARCHAR NOT NULL, updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS minute_bars (
  instrument_key VARCHAR NOT NULL, symbol VARCHAR NOT NULL, ts TIMESTAMPTZ NOT NULL,
  open DOUBLE NOT NULL, high DOUBLE NOT NULL, low DOUBLE NOT NULL, close DOUBLE NOT NULL,
  volume BIGINT NOT NULL, bid DOUBLE, ask DOUBLE, received_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (instrument_key, ts)
);
CREATE TABLE IF NOT EXISTS scanner_runs (
  run_id VARCHAR PRIMARY KEY, started_at TIMESTAMPTZ NOT NULL, completed_at TIMESTAMPTZ,
  status VARCHAR NOT NULL, universe_size INTEGER NOT NULL, fresh_symbols INTEGER NOT NULL DEFAULT 0,
  signal_count INTEGER NOT NULL DEFAULT 0, reason VARCHAR
);
CREATE TABLE IF NOT EXISTS paper_signals (
  run_id VARCHAR NOT NULL, symbol VARCHAR NOT NULL, entry DOUBLE NOT NULL, stop DOUBLE NOT NULL,
  target DOUBLE NOT NULL, strategy VARCHAR NOT NULL, timestamp TIMESTAMPTZ NOT NULL,
  expiry TIMESTAMPTZ NOT NULL, rank_score DOUBLE NOT NULL, status VARCHAR NOT NULL DEFAULT 'OPEN',
  PRIMARY KEY (run_id, symbol, strategy)
);
CREATE TABLE IF NOT EXISTS paper_trades (
  trade_id VARCHAR PRIMARY KEY, trading_day DATE NOT NULL, run_id VARCHAR NOT NULL,
  symbol VARCHAR NOT NULL, strategy VARCHAR NOT NULL, strategy_version VARCHAR NOT NULL,
  data_source VARCHAR NOT NULL, status VARCHAR NOT NULL, quantity INTEGER NOT NULL,
  signal_entry DOUBLE NOT NULL, entry_quote DOUBLE NOT NULL, entry_fill DOUBLE NOT NULL,
  stop_price DOUBLE NOT NULL, target_price DOUBLE NOT NULL, opened_at TIMESTAMPTZ NOT NULL,
  current_quote DOUBLE NOT NULL, last_marked_at TIMESTAMPTZ NOT NULL,
  exit_quote DOUBLE, exit_fill DOUBLE, closed_at TIMESTAMPTZ, exit_reason VARCHAR,
  gross_pnl DOUBLE NOT NULL DEFAULT 0, net_pnl DOUBLE NOT NULL DEFAULT 0,
  brokerage DOUBLE NOT NULL DEFAULT 0, fees_taxes DOUBLE NOT NULL DEFAULT 0,
  slippage DOUBLE NOT NULL DEFAULT 0, capital_used DOUBLE NOT NULL,
  intended_order_json VARCHAR NOT NULL
);
CREATE TABLE IF NOT EXISTS paper_job_runs (
  job_id VARCHAR PRIMARY KEY, model VARCHAR NOT NULL, job_type VARCHAR NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL, started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ, status VARCHAR NOT NULL, max_runtime_seconds INTEGER NOT NULL,
  duration_ms BIGINT, reason VARCHAR
);
CREATE TABLE IF NOT EXISTS paper_trade_events (
  event_id VARCHAR PRIMARY KEY, trade_id VARCHAR NOT NULL, run_id VARCHAR NOT NULL,
  event_type VARCHAR NOT NULL, observed_at TIMESTAMPTZ NOT NULL, quote DOUBLE,
  gross_pnl DOUBLE, net_pnl DOUBLE, target_status VARCHAR, details_json VARCHAR NOT NULL
);
CREATE TABLE IF NOT EXISTS paper_entry_rejections (
  rejection_id VARCHAR PRIMARY KEY, run_id VARCHAR NOT NULL, symbol VARCHAR NOT NULL,
  strategy VARCHAR NOT NULL, observed_at TIMESTAMPTZ NOT NULL,
  reason VARCHAR NOT NULL, details_json VARCHAR NOT NULL
);
CREATE TABLE IF NOT EXISTS paper_target_history (
  snapshot_id VARCHAR PRIMARY KEY, run_id VARCHAR NOT NULL, observed_at TIMESTAMPTZ NOT NULL,
  trading_day DATE NOT NULL, realized_net_pnl DOUBLE NOT NULL, open_net_pnl DOUBLE NOT NULL,
  projected_net_pnl DOUBLE NOT NULL, daily_profit_target DOUBLE NOT NULL,
  daily_loss_limit DOUBLE NOT NULL, target_reached BOOLEAN NOT NULL,
  loss_limit_reached BOOLEAN NOT NULL, new_entries_enabled BOOLEAN NOT NULL
);
CREATE TABLE IF NOT EXISTS validation_results (
  run_id VARCHAR NOT NULL, strategy VARCHAR NOT NULL, train_start TIMESTAMPTZ,
  train_end TIMESTAMPTZ, test_start TIMESTAMPTZ, test_end TIMESTAMPTZ,
  trades INTEGER NOT NULL, return_pct DOUBLE, max_drawdown_pct DOUBLE, profit_factor DOUBLE,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS backfill_progress (
  instrument_key VARCHAR NOT NULL, from_date DATE NOT NULL, to_date DATE NOT NULL,
  status VARCHAR NOT NULL, bar_count INTEGER NOT NULL DEFAULT 0, error VARCHAR,
  updated_at TIMESTAMPTZ NOT NULL, PRIMARY KEY (instrument_key, from_date, to_date)
);
"""


class MarketStore:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as con:
            con.execute(SCHEMA)
            con.execute("ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS execution_mode VARCHAR DEFAULT 'INTERNAL_PAPER'")
            con.execute("ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS entry_order_id VARCHAR")
            con.execute("ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS exit_order_id VARCHAR")
            con.execute("ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS peak_quote DOUBLE")
            con.execute("ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS lowest_quote DOUBLE")
            con.execute("ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS mfe DOUBLE")
            con.execute("ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS mae DOUBLE")
            con.execute("ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS profit_giveback DOUBLE")
            con.execute("ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS holding_duration_minutes DOUBLE")

    @contextmanager
    def connect(self) -> Iterator[duckdb.DuckDBPyConnection]:
        with _DATABASE_LOCK:
            con = duckdb.connect(str(self.path))
            try:
                yield con
            finally:
                con.close()

    def upsert_bar(self, row: dict) -> None:
        with self.connect() as con:
            con.execute("DELETE FROM minute_bars WHERE instrument_key=? AND ts=?", [row["instrument_key"], row["ts"]])
            con.execute("""INSERT INTO minute_bars VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", [
                row[k] for k in ("instrument_key", "symbol", "ts", "open", "high", "low", "close", "volume", "bid", "ask", "received_at")
            ])

    def upsert_bars(self, frame: pd.DataFrame) -> int:
        if frame.empty:
            return 0
        with self.connect() as con:
            con.register("incoming_bars", frame)
            con.execute("""
              INSERT OR REPLACE INTO minute_bars
              SELECT instrument_key, symbol, ts, open, high, low, close, volume,
                     bid, ask, received_at FROM incoming_bars
            """)
        return len(frame)

    def bars(self, symbol: str, days: int = 10) -> pd.DataFrame:
        with self.connect() as con:
            return con.execute("""
              SELECT * FROM minute_bars WHERE symbol=? AND ts >= now() - (? * INTERVAL '1 day')
              ORDER BY ts
            """, [symbol, days]).df()

    def bars_for_symbols(self, symbols: list[str], days: int = 10) -> pd.DataFrame:
        if not symbols:
            return pd.DataFrame()
        with self.connect() as con:
            return con.execute("""
              SELECT * FROM minute_bars
              WHERE symbol IN (SELECT unnest(?)) AND ts >= now() - (? * INTERVAL '1 day')
              ORDER BY symbol, ts
            """, [symbols, days]).df()

    def latest_quotes(self, symbols: list[str]) -> dict[str, dict]:
        if not symbols:
            return {}
        with self.connect() as con:
            rows = con.execute("""
              SELECT symbol, instrument_key, ts, bid, ask, received_at
              FROM minute_bars
              WHERE symbol IN (SELECT unnest(?))
              QUALIFY row_number() OVER (PARTITION BY symbol ORDER BY ts DESC)=1
            """, [symbols]).fetchall()
        return {
            str(symbol): {
                "instrument_key": str(key), "ts": ts, "bid": bid, "ask": ask,
                "received_at": received_at,
            }
            for symbol, key, ts, bid, ask, received_at in rows
        }

    def start_job(self, job_id: str, model: str, job_type: str, scheduled_at,
                  max_runtime_seconds: int) -> None:
        with self.connect() as con:
            con.execute("""
              INSERT INTO paper_job_runs VALUES (?, ?, ?, ?, now(), NULL, 'RUNNING', ?, NULL, NULL)
            """, [job_id, model, job_type, scheduled_at, max_runtime_seconds])

    def finish_job(self, job_id: str, status: str, duration_ms: int, reason: str | None = None) -> None:
        with self.connect() as con:
            con.execute("""
              UPDATE paper_job_runs SET completed_at=now(), status=?, duration_ms=?, reason=?
              WHERE job_id=?
            """, [status, duration_ms, reason, job_id])

    def record_skipped_job(self, job_id: str, model: str, job_type: str, scheduled_at,
                           max_runtime_seconds: int, reason: str) -> None:
        with self.connect() as con:
            con.execute("""
              INSERT INTO paper_job_runs VALUES (?, ?, ?, ?, now(), now(), 'SKIPPED', ?, 0, ?)
            """, [job_id, model, job_type, scheduled_at, max_runtime_seconds, reason])

    def prune(self, retention_days: int = 14) -> int:
        if retention_days < 10:
            raise ValueError("minute-bar retention must be at least 10 days")
        with self.connect() as con:
            before = con.execute("SELECT count(*) FROM minute_bars").fetchone()[0]
            con.execute("DELETE FROM minute_bars WHERE ts < now() - (? * INTERVAL '1 day')", [retention_days])
            after = con.execute("SELECT count(*) FROM minute_bars").fetchone()[0]
        return before - after

    def recover_incomplete_runs(self) -> int:
        """Mark scanner invocations interrupted by a process restart as failed."""
        with self.connect() as con:
            rows = con.execute("""
              UPDATE scanner_runs SET completed_at=now(), status='FAILED', reason='PROCESS_INTERRUPTED'
              WHERE completed_at IS NULL RETURNING run_id
            """).fetchall()
        return len(rows)
