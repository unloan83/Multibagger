from datetime import date

from types import SimpleNamespace

import pytest

from engine.backfill import _validate_backfill_instruments, month_chunks


def test_month_chunks_cover_range_without_overlap():
    chunks = list(month_chunks(date(2022, 1, 1), date(2022, 3, 4)))
    assert chunks == [(date(2022, 1, 1), date(2022, 1, 31)),
                      (date(2022, 2, 1), date(2022, 2, 28)),
                      (date(2022, 3, 1), date(2022, 3, 4))]


def test_backfill_accepts_equities_plus_required_market_index():
    settings = SimpleNamespace(
        max_symbols=2,
        market_index_instrument_key="NSE_INDEX|Nifty 50",
        market_index_symbol="NIFTY 50",
        vix_instrument_key="NSE_INDEX|India VIX", vix_symbol="INDIA VIX",
    )
    _validate_backfill_instruments(settings, {
        "NSE_EQ|ONE": "ONE",
        "NSE_EQ|TWO": "TWO",
        "NSE_INDEX|Nifty 50": "NIFTY 50",
        "NSE_INDEX|India VIX": "INDIA VIX",
    })


def test_backfill_rejects_warmup_without_required_market_index():
    settings = SimpleNamespace(
        max_symbols=2,
        market_index_instrument_key="NSE_INDEX|Nifty 50",
        market_index_symbol="NIFTY 50",
        vix_instrument_key="NSE_INDEX|India VIX", vix_symbol="INDIA VIX",
    )
    with pytest.raises(RuntimeError, match="index is missing"):
        _validate_backfill_instruments(settings, {
            "NSE_EQ|ONE": "ONE",
            "NSE_EQ|TWO": "TWO",
        })
