import json

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
