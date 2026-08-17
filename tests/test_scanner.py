import json
import time

import pytest

from engine.config import Settings
from engine.scanner import run_scan


def test_empty_database_publishes_no_trade(tmp_path):
    universe = tmp_path / "universe.json"
    universe.write_text('[{"symbol":"TEST","sources":["NIFTY 500"]}]')
    config = Settings("", tmp_path / "market.duckdb", tmp_path / "signals.json", universe, max_symbols=1)
    result = run_scan(config)
    assert result["status"] == "NO_TRADE"
    assert result["signals"] == []
    assert json.loads(config.snapshot_path.read_text())["reason"] == "NO_TRADE"


def test_expired_deadline_fails_scan_and_records_runtime_reason(tmp_path):
    universe = tmp_path / "universe.json"
    universe.write_text('[{"symbol":"TEST","sources":["NIFTY 500"]}]')
    config = Settings("", tmp_path / "market.duckdb", tmp_path / "signals.json", universe, max_symbols=1)
    with pytest.raises(TimeoutError, match="maximum runtime"):
        run_scan(config, deadline_monotonic=time.monotonic() - 1)
    from engine.store import MarketStore
    with MarketStore(config.db_path).connect() as con:
        assert con.execute("SELECT reason FROM scanner_runs").fetchone()[0] == "MAX_RUNTIME_EXCEEDED"
