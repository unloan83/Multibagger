from datetime import datetime, timedelta, timezone

import pandas as pd

from engine.backtest import walk_forward
from engine.config import Settings
from engine.store import MarketStore


def test_replay_uses_only_rebuilt_aligned_orb_core(tmp_path):
    universe = tmp_path / "universe.json"
    universe.write_text('[{"symbol":"TEST","sources":["NIFTY 500"]}]')
    settings = Settings("", tmp_path / "market.duckdb", tmp_path / "signals.json", universe, max_symbols=1)
    store = MarketStore(settings.db_path)
    rows = []
    start = datetime(2026, 1, 1, 3, 45, tzinfo=timezone.utc)
    for day in range(20):
        base = start + timedelta(days=day)
        for minute in range(20):
            price = 100 + minute * 0.02
            rows.append({"instrument_key":"K", "symbol":"TEST", "ts":base + timedelta(minutes=minute),
                         "open":price-.05, "high":price+.1, "low":price-.1, "close":price,
                         "volume":1000, "bid":None, "ask":None, "received_at":base})
    store.upsert_bars(pd.DataFrame(rows))
    result = walk_forward(settings, "2026-01-01", "2026-01-21", windows=2, calc_bootstrap=False)
    assert set(result["strategies"]) == {"ORB_15M_RETEST_ALIGNED"}
    assert result["source"] == "RECORDED_UPSTOX_1MIN_EXECUTABLE_QUOTES"
