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
  run_id VARCHAR NOT NULL, symbol VARCHAR NOT NULL, side VARCHAR NOT NULL DEFAULT 'LONG', entry DOUBLE NOT NULL, stop DOUBLE NOT NULL,
  target DOUBLE NOT NULL, strategy VARCHAR NOT NULL, timestamp TIMESTAMPTZ NOT NULL,
  expiry TIMESTAMPTZ NOT NULL, rank_score DOUBLE NOT NULL, status VARCHAR NOT NULL DEFAULT 'OPEN',
  PRIMARY KEY (run_id, symbol, strategy)
);
CREATE TABLE IF NOT EXISTS paper_trades (
  trade_id VARCHAR PRIMARY KEY, trading_day DATE NOT NULL, run_id VARCHAR NOT NULL,
  symbol VARCHAR NOT NULL, side VARCHAR NOT NULL DEFAULT 'LONG', strategy VARCHAR NOT NULL, strategy_version VARCHAR NOT NULL,
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
CREATE TABLE IF NOT EXISTS regime_evaluations (
  evaluation_id VARCHAR PRIMARY KEY, trading_day DATE NOT NULL,
  evaluated_at TIMESTAMPTZ NOT NULL, slot_at TIMESTAMPTZ NOT NULL,
  regime VARCHAR NOT NULL, details_json VARCHAR NOT NULL,
  adverse_day_lock BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS intraday_audit_log (
  audit_id VARCHAR PRIMARY KEY, run_id VARCHAR NOT NULL, observed_at TIMESTAMPTZ NOT NULL,
  event_type VARCHAR NOT NULL, agent VARCHAR, symbol VARCHAR, system_pnl DOUBLE NOT NULL,
  regime VARCHAR, sector_rank INTEGER, adx DOUBLE, ohlcv_vwap_atr_bb_json VARCHAR NOT NULL,
  entry DOUBLE, stop DOUBLE, risk DOUBLE, quantity INTEGER, partial_exit DOUBLE,
  final_exit DOUBLE, total_pnl DOUBLE, no_scale_out_pnl DOUBLE, rejection_reason VARCHAR
);
"""


class MarketStore:
    def __init__(self, path: Path, read_only: bool = False):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        if not read_only:
            try:
                with self.connect(read_only=False) as con:
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
                    con.execute("ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS last_exit_candle_ts TIMESTAMPTZ")
                    con.execute("ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS side VARCHAR DEFAULT 'LONG'")
                    con.execute("ALTER TABLE paper_signals ADD COLUMN IF NOT EXISTS side VARCHAR DEFAULT 'LONG'")
                    con.execute("ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS agent VARCHAR")
                    con.execute("ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS initial_quantity INTEGER")
                    con.execute("ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS original_stop_price DOUBLE")
                    con.execute("ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS allowed_risk DOUBLE")
                    con.execute("ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS partial_quantity INTEGER DEFAULT 0")
                    con.execute("ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS partial_exit_quote DOUBLE")
                    con.execute("ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS partial_exit_fill DOUBLE")
                    con.execute("ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS partial_exit_at TIMESTAMPTZ")
                    con.execute("ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS partial_gross_pnl DOUBLE DEFAULT 0")
                    con.execute("ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS no_scale_out_pnl DOUBLE DEFAULT 0")
                    con.execute("ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS runner_max_r DOUBLE DEFAULT 0")
                    con.execute("ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS break_even_stop BOOLEAN DEFAULT false")
            except duckdb.IOException:
                pass

    @contextmanager
    def connect(self, read_only: bool = False) -> Iterator[duckdb.DuckDBPyConnection]:
        with _DATABASE_LOCK:
            con = None
            last_err = None
            for attempt in range(1, 8):
                try:
                    con = duckdb.connect(str(self.path), read_only=read_only)
                    break
                except (duckdb.IOException, duckdb.Error, OSError) as err:
                    last_err = err
                    if attempt < 7:
                        import time
                        delay = min(5.0, 0.2 * (2 ** (attempt - 1)))
                        time.sleep(delay)
            if con is None:
                raise duckdb.IOException(f"DuckDB connection failed after retries: {last_err}") from last_err
            try:
                yield con
            finally:
                try:
                    con.close()
                except Exception:
                    pass



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

    def bars(self, symbol: str, days: int = 35, through=None) -> pd.DataFrame:
        through_clause = "AND ts <= ?" if through is not None else ""
        parameters = [symbol, days, through] if through is not None else [symbol, days]
        with self.connect() as con:
            return con.execute(f"""
              SELECT instrument_key, symbol, ts, open, high, low, close, volume, bid, ask, received_at
              FROM minute_bars WHERE symbol=? AND ts >= now() - (? * INTERVAL '1 day')
              {through_clause}
              ORDER BY ts
            """, parameters).df()

    def bars_for_symbols(self, symbols: list[str], days: int = 35, through=None) -> pd.DataFrame:
        if not symbols:
            return pd.DataFrame()
        through_clause = "AND ts <= ?" if through is not None else ""
        parameters = [symbols, days, through] if through is not None else [symbols, days]
        with self.connect() as con:
            return con.execute(f"""
              SELECT instrument_key, symbol, ts, open, high, low, close, volume, bid, ask, received_at
              FROM minute_bars
              WHERE symbol IN (SELECT unnest(?)) AND ts >= now() - (? * INTERVAL '1 day')
              {through_clause}
              ORDER BY symbol, ts
            """, parameters).df()

    def latest_quotes(self, symbols: list[str], completed_before=None) -> dict[str, dict]:
        if not symbols:
            return {}
        with self.connect() as con:
            completed_clause = "AND ts < date_trunc('minute', ?)" if completed_before is not None else ""
            parameters = [symbols, completed_before] if completed_before is not None else [symbols]
            rows = con.execute(f"""
              SELECT symbol, instrument_key, ts, bid, ask, received_at,
                     open, high, low, close, volume
              FROM minute_bars
              WHERE symbol IN (SELECT unnest(?))
                {completed_clause}
                AND CAST(ts AT TIME ZONE 'Asia/Kolkata' AS DATE) = CAST((
                  SELECT max(latest.ts) AT TIME ZONE 'Asia/Kolkata'
                  FROM minute_bars latest WHERE latest.symbol=minute_bars.symbol
                ) AS DATE)
              ORDER BY symbol, ts
            """, parameters).fetchall()
        result: dict[str, dict] = {}
        for symbol, key, ts, bid, ask, received_at, open_, high, low, close, volume in rows:
            item = result.setdefault(str(symbol), {
                "recent_closes": [], "recent_volumes": [], "session_highs": [],
                "session_lows": [], "session_typical_values": [], "session_volumes": [],
            })
            item.update({
                "instrument_key": str(key), "ts": ts, "bid": bid, "ask": ask,
                "received_at": received_at,
            })
            item["recent_closes"].append(float(close))
            item["recent_volumes"].append(int(volume))
            item["session_highs"].append(float(high))
            item["session_lows"].append(float(low))
            item["session_typical_values"].append(((float(high) + float(low) + float(close)) / 3) * int(volume))
            item["session_volumes"].append(int(volume))
        for item in result.values():
            item["recent_closes"] = item["recent_closes"][-5:]
            item["recent_volumes"] = item["recent_volumes"][-5:]
            total_volume = sum(item.pop("session_volumes"))
            typical_values = item.pop("session_typical_values")
            item["vwap"] = sum(typical_values) / total_volume if total_volume > 0 else None
            item["opening_high"] = max(item["session_highs"][:15]) if len(item["session_highs"]) >= 15 else None
            item["opening_low"] = min(item["session_lows"][:15]) if len(item["session_lows"]) >= 15 else None
            item.pop("session_highs")
            item.pop("session_lows")
        return result

    def universe_metrics(self, symbols: list[str], now) -> dict[str, dict[str, float]]:
        """Aggregate the 20-session universe screen in DuckDB without loading all bars into RAM."""
        if not symbols:
            return {}
        with self.connect() as con:
            rows = con.execute("""
              WITH daily AS (
                SELECT symbol, CAST(ts AT TIME ZONE 'Asia/Kolkata' AS DATE) AS trading_day,
                       max(high) AS high, min(low) AS low, arg_max(close, ts) AS close,
                       sum(volume) AS volume
                FROM minute_bars
                WHERE symbol IN (SELECT unnest(?))
                  AND CAST(ts AT TIME ZONE 'Asia/Kolkata' AS DATE) < CAST(? AT TIME ZONE 'Asia/Kolkata' AS DATE)
                GROUP BY symbol,trading_day
              ), ranked AS (
                SELECT *, row_number() OVER (PARTITION BY symbol ORDER BY trading_day DESC) AS rn
                FROM daily
              ), stats AS (
                SELECT symbol, median(volume) AS median_volume,
                       median((high-low)/nullif(close,0)*100) AS median_range_pct,
                       count(*) AS sessions
                FROM ranked WHERE rn <= 20 GROUP BY symbol HAVING count(*)=20
              ), quotes AS (
                SELECT symbol,bid,ask,close,ts,
                       row_number() OVER (PARTITION BY symbol ORDER BY ts DESC) AS rn
                FROM minute_bars
                WHERE symbol IN (SELECT unnest(?)) AND bid > 0 AND ask > bid
              )
              SELECT stats.symbol,median_volume,median_range_pct,bid,ask,quotes.close
              FROM stats JOIN quotes ON quotes.symbol=stats.symbol AND quotes.rn=1
            """, [symbols, now, symbols]).fetchall()
        return {
            str(symbol): {
                "median_volume": float(volume), "median_range_pct": float(range_pct),
                "bid": float(bid), "ask": float(ask), "close": float(close),
            }
            for symbol, volume, range_pct, bid, ask, close in rows
        }

    def has_open_trades(self) -> bool:
        with self.connect() as con:
            return bool(con.execute("SELECT 1 FROM paper_trades WHERE status='OPEN' LIMIT 1").fetchone())

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

    def prune(self, retention_days: int = 35) -> int:
        if retention_days < 30:
            raise ValueError("minute-bar retention must cover the 20-session universe lookback")
        with self.connect() as con:
            before = con.execute("SELECT count(*) FROM minute_bars").fetchone()[0]
            con.execute("DELETE FROM minute_bars WHERE ts < now() - (? * INTERVAL '1 day')", [retention_days])
            con.execute("DELETE FROM intraday_audit_log WHERE observed_at < now() - (? * INTERVAL '1 day')", [retention_days])
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
