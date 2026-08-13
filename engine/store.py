from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import duckdb
import pandas as pd


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

    @contextmanager
    def connect(self) -> Iterator[duckdb.DuckDBPyConnection]:
        con = duckdb.connect(str(self.path))
        try:
            yield con
        finally:
            con.close()

    def upsert_bar(self, row: dict) -> None:
        with self.connect() as con:
            con.execute("DELETE FROM minute_bars WHERE instrument_key=? AND ts=?", [row["instrument_key"], row["ts"]])
            con.execute("""INSERT INTO minute_bars VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", [
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
