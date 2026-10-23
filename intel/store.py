"""SQLite ledger for runs, picks, NO TRADE reasons and analyst calls (single writer, WAL)."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
  run_date TEXT NOT NULL, kind TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
  status TEXT NOT NULL, model_version TEXT NOT NULL, code_sha TEXT, detail TEXT,
  PRIMARY KEY (run_date, kind));
CREATE TABLE IF NOT EXISTS picks (
  id INTEGER PRIMARY KEY, run_date TEXT NOT NULL, logged_at TEXT NOT NULL, category TEXT NOT NULL,
  symbol TEXT NOT NULL, side TEXT NOT NULL, ref REAL, entry REAL, stop REAL, target REAL,
  max_hold_days INTEGER, score REAL, reasons TEXT, detail TEXT, status TEXT NOT NULL,
  fill_date TEXT, fill_price REAL, qty REAL, exit_date TEXT, exit_price REAL, exit_reason TEXT,
  gross_pnl REAL, costs REAL, net_pnl REAL, notional REAL, model_version TEXT NOT NULL,
  UNIQUE (run_date, category, symbol));
CREATE TABLE IF NOT EXISTS no_trades (
  run_date TEXT NOT NULL, category TEXT NOT NULL, reason TEXT NOT NULL, PRIMARY KEY (run_date, category));
CREATE TABLE IF NOT EXISTS analyst_calls (
  id INTEGER PRIMARY KEY, analyst TEXT NOT NULL, source TEXT NOT NULL, symbol TEXT NOT NULL,
  side TEXT NOT NULL, target REAL NOT NULL, stop REAL NOT NULL, horizon TEXT NOT NULL, link TEXT,
  published TEXT NOT NULL, run_date TEXT NOT NULL, status TEXT NOT NULL, fill_date TEXT, fill_price REAL,
  exit_date TEXT, exit_price REAL, exit_reason TEXT, r_multiple REAL,
  UNIQUE (analyst, symbol, side, target, stop, published));
CREATE TABLE IF NOT EXISTS category_state (
  category TEXT PRIMARY KEY, state TEXT NOT NULL, updated TEXT NOT NULL, reason TEXT);
"""


def connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(SCHEMA)
    return conn


def rows(conn: sqlite3.Connection, sql: str, args: tuple = ()) -> list[dict[str, Any]]:
    return [dict(r) for r in conn.execute(sql, args)]


def insert_pick(conn: sqlite3.Connection, run_date: str, logged_at: str, pick: dict[str, Any],
                model_version: str, status: str) -> bool:
    """Write-once: a rerun on the same day never duplicates or rewrites a logged pick."""
    known = {"category", "symbol", "side", "ref", "entry", "stop", "target", "max_hold_days", "score", "reasons"}
    cur = conn.execute(
        "INSERT OR IGNORE INTO picks (run_date, logged_at, category, symbol, side, ref, entry, stop, target,"
        " max_hold_days, score, reasons, detail, status, model_version)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (run_date, logged_at, pick["category"], pick["symbol"], pick["side"], pick.get("ref"), pick["entry"],
         pick["stop"], pick["target"], pick.get("max_hold_days"), pick.get("score"),
         json.dumps(pick.get("reasons", [])), json.dumps({k: v for k, v in pick.items() if k not in known}),
         status, model_version))
    return cur.rowcount == 1


def insert_no_trade(conn: sqlite3.Connection, run_date: str, category: str, reason: str) -> None:
    conn.execute("INSERT OR IGNORE INTO no_trades VALUES (?,?,?)", (run_date, category, reason))


def insert_call(conn: sqlite3.Connection, run_date: str, call: Any) -> bool:
    # The same call is often republished by several outlets over a few days: count it once.
    if conn.execute("SELECT 1 FROM analyst_calls WHERE analyst=? AND symbol=? AND side=? AND target=?"
                    " AND run_date >= date(?, '-10 day')",
                    (call.analyst, call.symbol, call.side, call.target, run_date)).fetchone():
        return False
    cur = conn.execute(
        "INSERT OR IGNORE INTO analyst_calls (analyst, source, symbol, side, target, stop, horizon, link,"
        " published, run_date, status) VALUES (?,?,?,?,?,?,?,?,?,?,'PENDING')",
        (call.analyst, call.source, call.symbol, call.side, call.target, call.stop, call.horizon, call.link,
         call.published, run_date))
    return cur.rowcount == 1


def update(conn: sqlite3.Connection, table: str, row_id: int, fields: dict[str, Any]) -> None:
    assert table in ("picks", "analyst_calls")
    cols = ", ".join(f"{k}=?" for k in fields)
    conn.execute(f"UPDATE {table} SET {cols} WHERE id=?", (*fields.values(), row_id))


def category_states(conn: sqlite3.Connection) -> dict[str, str]:
    return {r["category"]: r["state"] for r in rows(conn, "SELECT * FROM category_state")}


def set_category_state(conn: sqlite3.Connection, category: str, state: str, when: str, reason: str) -> None:
    conn.execute("INSERT INTO category_state VALUES (?,?,?,?) ON CONFLICT(category) DO UPDATE SET"
                 " state=excluded.state, updated=excluded.updated, reason=excluded.reason",
                 (category, state, when, reason))
