from __future__ import annotations

import sqlite3
import datetime
from pathlib import Path
from engine.config import Settings
from engine.rejection_logger import DecisionLogger

def _setup_test_db(tmp_path: Path) -> Settings:
    db_path = tmp_path / "trading_state.db"
    conn = sqlite3.connect(str(db_path))
    conn.execute("""
        CREATE TABLE trades (
            trade_id TEXT PRIMARY KEY,
            instrument_key TEXT,
            symbol TEXT,
            state TEXT,
            entry_price REAL,
            target_price REAL,
            stop_loss REAL,
            qty INT,
            filled_qty INT,
            gross_pnl REAL,
            net_pnl REAL,
            rejection_reason TEXT,
            created_at TEXT,
            updated_at TEXT
        );
    """)
    conn.execute("""
        CREATE TABLE system_config (
            key TEXT PRIMARY KEY,
            value TEXT
        );
    """)
    conn.commit()
    conn.close()
    return Settings(db_path=db_path, log_dir=tmp_path / "logs")

def test_eod_largest_loser_zero_when_no_losers(tmp_path):
    settings = _setup_test_db(tmp_path)
    conn = sqlite3.connect(str(settings.db_path))
    conn.execute(
        "INSERT INTO trades VALUES ('t1', 'NSE_EQ|TCS', 'TCS', 'CLOSED', 3500.0, 3620.0, 3460.0, 10, 10, 700.0, 640.43, NULL, '2026-08-31', '2026-08-31')"
    )
    conn.commit()
    conn.close()

    logger = DecisionLogger(settings)
    report = logger.generate_eod_report()

    assert report["winners"] == 1
    assert report["losers"] == 0
    assert report["largest_winner"] == 640.43
    assert report["largest_loser"] == 0.0


def test_eod_risk_breaker_status_explicit_states(tmp_path):
    settings = _setup_test_db(tmp_path)
    logger = DecisionLogger(settings)
    
    # 1. Default / Running state -> NOT_TRIGGERED
    report = logger.generate_eod_report()
    assert report["risk_breaker_status"] == "NOT_TRIGGERED"

    # 2. Triggered state -> TRIGGERED
    conn = sqlite3.connect(str(settings.db_path))
    conn.execute("INSERT OR REPLACE INTO system_config VALUES ('system_state', 'BREAKER_TRIPPED')")
    conn.commit()
    conn.close()

    report_triggered = logger.generate_eod_report()
    assert report_triggered["risk_breaker_status"] == "TRIGGERED"


def test_eod_data_integrity_warning_on_unscanned_trade(tmp_path):
    settings = _setup_test_db(tmp_path)
    conn = sqlite3.connect(str(settings.db_path))
    conn.execute(
        "INSERT INTO trades VALUES ('t1', 'NSE_EQ|TCS', 'TCS', 'CLOSED', 3500.0, 3620.0, 3460.0, 10, 10, 700.0, 640.43, NULL, '2026-08-31', '2026-08-31')"
    )
    conn.commit()
    conn.close()

    logger = DecisionLogger(settings)
    report = logger.generate_eod_report()

    assert report["trades_executed"] == 1
    assert report["universe_scanned"] == 0
    assert report["data_integrity_warning"] is not None
    assert "trades_executed > 0 but universe_scanned == 0" in report["data_integrity_warning"]

