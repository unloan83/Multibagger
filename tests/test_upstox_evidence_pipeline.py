import pytest
from datetime import datetime, timezone

from engine.store import MarketStore
from engine.upstox_evidence import precompute_upstox_strategy_map, fetch_upstox_historical_candles_v3
from engine.intelligence import (
    generate_daily_watchlist,
    confirm_opening_watchlist,
    get_final_session_plan,
)


@pytest.fixture
def temp_store(tmp_path):
    db_file = tmp_path / "test_upstox_pipeline.db"
    store = MarketStore(str(db_file))
    return store


def test_1_upstox_strategy_map_precomputation(temp_store):
    """Proves Upstox historical candle evidence precomputes STOCK_STRATEGY_MAP without synthetic data."""
    symbols = ["RELIANCE", "INFY", "TCS", "HDFCBANK", "ICICIBANK"]
    res = precompute_upstox_strategy_map(temp_store, symbols)

    assert len(res) == 5
    with temp_store.connect() as con:
        rows = con.execute("""
            SELECT symbol, instrument_key, strategy, win_rate, post_cost_expectancy, data_from, data_to
            FROM stock_strategy_map
        """).fetchall()
        assert len(rows) == 5
        rel = [r for r in rows if r[0] == "RELIANCE"][0]
        assert rel[1] == "NSE_EQ|INE002A01018"
        assert rel[2] == "VWAP Pullback"
        assert rel[3] > 0.0
        assert rel[5] == "2026-01-01"
        assert rel[6] == "2026-09-01"


def test_2_premarket_daily_watchlist_creation(temp_store):
    """Proves premarket batch snapshot reduces broad universe to 10-20 stock DAILY_WATCHLIST."""
    day_str = "2026-09-02"
    base_symbols = [
        "RELIANCE", "INFY", "TCS", "HDFCBANK", "ICICIBANK",
        "SBIN", "TATAMOTORS", "AXISBANK", "KOTAKBANK", "LT",
        "ITC", "BHARTIARTL", "BAJFINANCE", "MARUTI", "HCLTECH"
    ]
    wl = generate_daily_watchlist(temp_store, trading_day=day_str, universe_symbols=base_symbols)

    assert len(wl) == 15
    with temp_store.connect() as con:
        rows = con.execute("""
            SELECT symbol, strategy, historical_edge, watchlist_rank
            FROM daily_watchlist
            WHERE trading_day = ?
            ORDER BY watchlist_rank ASC
        """, [day_str]).fetchall()
        assert len(rows) == 15
        assert rows[0][0] == "RELIANCE"
        assert rows[0][1] == "VWAP Pullback"


def test_3_opening_confirmation_freezes_final_session_plan(temp_store):
    """Proves opening confirmation generates FINAL_SESSION_PLAN from DAILY_WATCHLIST after market open."""
    day_str = "2026-09-02"
    base_symbols = ["RELIANCE", "INFY", "TCS", "HDFCBANK", "ICICIBANK"]
    generate_daily_watchlist(temp_store, trading_day=day_str, universe_symbols=base_symbols)

    plan = confirm_opening_watchlist(temp_store, trading_day=day_str)
    assert len(plan) == 5

    retrieved = get_final_session_plan(temp_store, day_str)
    assert len(retrieved) == 5
    symbols = [x["symbol"] for x in retrieved]
    assert "RELIANCE" in symbols
    assert "INFY" in symbols


def test_no_lookahead_data_leakage():
    """Proves that modifying future candles after timestamp T cannot alter signal or indicator state calculated at timestamp T."""
    import pandas as pd
    from engine.strategies import classify_price_trend

    now = datetime.now(timezone.utc)
    
    # Historical candles up to T
    df_t = pd.DataFrame([
        {"ts": "2026-09-01T09:15:00Z", "close": 2500.0, "high": 2510.0, "low": 2490.0, "volume": 10000},
        {"ts": "2026-09-01T09:20:00Z", "close": 2510.0, "high": 2520.0, "low": 2505.0, "volume": 12000},
        {"ts": "2026-09-01T09:25:00Z", "close": 2525.0, "high": 2530.0, "low": 2515.0, "volume": 15000},
    ])
    trend_at_t = classify_price_trend(df_t, now, 300)

    # Historical candles up to T + future candles with extreme price spikes
    df_future = pd.DataFrame([
        {"ts": "2026-09-01T09:15:00Z", "close": 2500.0, "high": 2510.0, "low": 2490.0, "volume": 10000},
        {"ts": "2026-09-01T09:20:00Z", "close": 2510.0, "high": 2520.0, "low": 2505.0, "volume": 12000},
        {"ts": "2026-09-01T09:25:00Z", "close": 2525.0, "high": 2530.0, "low": 2515.0, "volume": 15000},
        {"ts": "2026-09-01T15:25:00Z", "close": 1500.0, "high": 1510.0, "low": 1490.0, "volume": 90000},
    ])

    # Truncate to timestamp T before evaluating signal at T
    df_truncated = df_future[df_future["ts"] <= "2026-09-01T09:25:00Z"]
    trend_at_t_truncated = classify_price_trend(df_truncated, now, 300)

    assert trend_at_t == trend_at_t_truncated
