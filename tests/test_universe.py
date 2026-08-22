from datetime import datetime, timedelta, timezone

import pandas as pd

from engine.universe import _prefilter_metrics


def test_support_resistance_distance_uses_pivot_vwap_and_previous_day_extremes():
    now = datetime(2026, 8, 24, 3, 0, tzinfo=timezone.utc)
    rows = []
    for days_ago, close in ((3, 100.0), (2, 101.0), (1, 105.0)):
        start = now - timedelta(days=days_ago)
        for minute in range(3):
            rows.append({
                "ts": start + timedelta(minutes=minute), "open": close, "high": close + 5,
                "low": close - 15, "close": close, "volume": 200000,
                "bid": close - 0.01, "ask": close + 0.01,
            })
    metrics = _prefilter_metrics(pd.DataFrame(rows), now)
    assert metrics is not None
    assert metrics[3] > 0.5
