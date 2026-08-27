import json
import time

import pytest

from engine.config import Settings
from engine.scanner import _classify_breadth, run_scan


def test_empty_database_publishes_no_trade(tmp_path):
    universe = tmp_path / "universe.json"
    universe.write_text('[{"symbol":"TEST","sources":["NIFTY 500"]}]')
    config = Settings("", tmp_path / "market.duckdb", tmp_path / "signals.json", universe, max_symbols=1)
    result = run_scan(config)
    assert result["status"] == "NO_TRADE"
    assert result["signals"] == []
    assert json.loads(config.snapshot_path.read_text())["reason"] in ("REGIME_INPUT_UNAVAILABLE", "NO_TRADE_UNFAVOURABLE_REGIME", "NO_TRADE_STALE_DATA")


def test_expired_deadline_fails_scan_and_records_runtime_reason(tmp_path):
    universe = tmp_path / "universe.json"
    universe.write_text('[{"symbol":"TEST","sources":["NIFTY 500"]}]')
    config = Settings("", tmp_path / "market.duckdb", tmp_path / "signals.json", universe, max_symbols=1)
    with pytest.raises(TimeoutError, match="maximum runtime"):
        run_scan(config, deadline_monotonic=time.monotonic() - 1)
    from engine.store import MarketStore
    with MarketStore(config.db_path).connect() as con:
        assert con.execute("SELECT reason FROM scanner_runs").fetchone()[0] == "MAX_RUNTIME_EXCEEDED"


def test_sector_breadth_classifies_bull_bear_and_range_explicitly():
    assert _classify_breadth(["BULLISH"] * 6 + ["BEARISH"] * 2 + ["RANGE"] * 2) == "BULLISH"
    assert _classify_breadth(["BEARISH"] * 6 + ["BULLISH"] * 2 + ["RANGE"] * 2) == "BEARISH"
    assert _classify_breadth(["BULLISH", "BEARISH", "RANGE", "RANGE"]) == "RANGE"
