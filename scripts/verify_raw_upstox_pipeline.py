#!/usr/bin/env python3
from __future__ import annotations

import os
import sys
from datetime import date, timedelta
from pathlib import Path

from engine.upstox_evidence import (
    UpstoxDataError,
    verify_upstox_auth,
    load_instrument_master,
    build_nse_equity_map,
    fetch_historical_candles_v3,
    fetch_full_market_quotes,
    compute_quote_features,
    assert_real_candle_variation,
    assert_real_quote_variation,
)

from engine.config import Settings
from engine.universe import active_trading_symbols


def fail(msg: str, code: int = 2) -> None:
    print(f"\nREADY = NO")
    print(f"BLOCKER = {msg}")
    raise SystemExit(code)


def main() -> None:
    # ---------------------------------------------------------
    # ENVIRONMENT GATE
    # ---------------------------------------------------------
    cwd = str(Path.cwd().resolve())

    if not cwd.startswith("/opt/multibagger"):
        fail(f"INVALID_RUN_LOCATION: {cwd}")

    print("RUN_LOCATION = OCI")
    print(f"WORKDIR = {cwd}")

    # ---------------------------------------------------------
    # TOKEN / AUTH GATE
    # ---------------------------------------------------------
    token = os.getenv("UPSTOX_ACCESS_TOKEN", "").strip()

    if not token:
        fail("UPSTOX_ACCESS_TOKEN missing from OCI runtime environment")

    try:
        profile = verify_upstox_auth()
    except Exception as exc:
        fail(f"UPSTOX_AUTH_FAILED: {exc}")

    print("UPSTOX_AUTH = PASS")

    # ---------------------------------------------------------
    # REAL UNIVERSE
    # ---------------------------------------------------------
    settings = Settings()
    universe = active_trading_symbols(settings)

    if not universe:
        fail("REAL_UNIVERSE_EMPTY")

    universe = [str(s).upper().strip() for s in universe]

    print(f"REAL_UNIVERSE_COUNT = {len(universe)}")
    print(f"FIRST_10 = {universe[:10]}")
    print(f"LAST_10 = {universe[-10:]}")

    # ---------------------------------------------------------
    # GENUINE INSTRUMENT MASTER
    # ---------------------------------------------------------
    possible_master_paths = [
        "/opt/multibagger/data/upstox_instruments.json",
        "/opt/multibagger/data/upstox_instrument_master.json",
        "/opt/multibagger/data/upstox-nse-instruments.json",
        "/opt/multibagger/data/instruments.json",
        "/opt/multibagger/data/active-intraday-universe.json",
    ]

    master_path = next(
        (p for p in possible_master_paths if Path(p).exists()),
        None,
    )

    if not master_path:
        fail(
            "GENUINE_UPSTOX_INSTRUMENT_MASTER_NOT_FOUND. "
            "Locate existing downloaded Upstox master; do not construct keys."
        )

    try:
        master = load_instrument_master(master_path)
        key_map = build_nse_equity_map(master)
    except Exception as exc:
        fail(f"INSTRUMENT_MASTER_INVALID: {exc}")

    resolved = {
        symbol: key_map[symbol]
        for symbol in universe
        if symbol in key_map
    }

    missing = [s for s in universe if s not in resolved]

    print(f"MASTER_PATH = {master_path}")
    print(f"INSTRUMENT_KEYS_RESOLVED = {len(resolved)}")
    print(f"INSTRUMENT_KEYS_MISSING = {len(missing)}")

    if len(resolved) < 10:
        fail("TOO_FEW_REAL_INSTRUMENT_KEYS_RESOLVED")

    print("\n=== GENUINE INSTRUMENT KEY SAMPLE ===")
    for symbol in list(resolved)[:10]:
        print(f"{symbol} | {resolved[symbol]}")

    # ---------------------------------------------------------
    # HISTORICAL API PROOF
    # ---------------------------------------------------------
    today = date.today()

    # Completed historical period only.
    to_date = today - timedelta(days=1)
    from_date = to_date - timedelta(days=30)

    sample_symbols = list(resolved.keys())[:5]
    successful_samples = {}

    print("\n=== REAL UPSTOX HISTORICAL DATA ===")

    for symbol in sample_symbols:
        key = resolved[symbol]

        try:
            candles = fetch_historical_candles_v3(
                key,
                from_date=from_date.isoformat(),
                to_date=to_date.isoformat(),
                interval_minutes=5,
            )
        except Exception as exc:
            print(
                f"{symbol} | {key} | "
                f"HISTORICAL_DATA_FAILED | {exc}"
            )
            continue

        successful_samples[symbol] = candles

        print(
            f"{symbol} | {key} | "
            f"first={candles[0]['timestamp']} | "
            f"last={candles[-1]['timestamp']} | "
            f"count={len(candles)} | "
            f"first_close={candles[0]['close']:.2f} | "
            f"last_close={candles[-1]['close']:.2f}"
        )

    if len(successful_samples) < 3:
        fail("REAL_HISTORICAL_API_RETURNED_FEWER_THAN_3_VALID_SYMBOLS")

    try:
        assert_real_candle_variation(successful_samples)
    except Exception as exc:
        fail(f"HISTORICAL_VARIATION_CHECK_FAILED: {exc}")

    print("REAL_HISTORICAL_CANDLES = YES")
    print("SYNTHETIC_HISTORICAL_FALLBACKS = 0")

    # ---------------------------------------------------------
    # FULL MARKET QUOTE PROOF
    # ---------------------------------------------------------
    keys = list(resolved.values())

    try:
        quotes, counters = fetch_full_market_quotes(keys)
    except Exception as exc:
        fail(f"FULL_MARKET_QUOTE_FAILED: {exc}")

    print("\n=== UPSTOX QUOTE COUNTERS ===")
    print(f"API_REQUEST_COUNT = {counters['api_requests']}")
    print(f"QUOTES_REQUESTED = {counters['requested']}")
    print(f"QUOTES_RECEIVED = {counters['received']}")
    print(f"QUOTES_FAILED = {counters['failed']}")

    if not quotes:
        fail("ZERO_REAL_QUOTES_RECEIVED")

    key_to_symbol = {key: symbol for symbol, key in resolved.items()}

    quote_features = {}

    for key, quote in quotes.items():
        symbol = key_to_symbol.get(key)
        if not symbol:
            continue

        try:
            quote_features[symbol] = compute_quote_features(quote)
        except Exception:
            continue

    if len(quote_features) < 3:
        fail("FEWER_THAN_3_VALID_REAL_QUOTES")

    try:
        assert_real_quote_variation(quote_features)
    except Exception as exc:
        fail(f"QUOTE_VARIATION_CHECK_FAILED: {exc}")

    print("\n=== REAL QUOTE SAMPLE ===")

    for symbol in list(quote_features.keys())[:10]:
        f = quote_features[symbol]

        print(
            f"{symbol} | "
            f"CMP={f['cmp']:.2f} | "
            f"PrevClose={f['prev_close']:.2f} | "
            f"Gap={f['gap_pct']:+.2f}% | "
            f"Volume={f['volume']:.0f} | "
            f"Liquidity={f['liquidity']:.2f} | "
            f"Volatility={f['volatility_pct']:.2f}%"
        )

    print("REAL_MARKET_QUOTES = YES")
    print("SYNTHETIC_QUOTE_FALLBACKS = 0")

    # ---------------------------------------------------------
    # IMPORTANT: STOP HERE
    # ---------------------------------------------------------
    # Do NOT generate strategy map/watchlist until raw Upstox
    # plumbing has independently passed.
    print("\nRAW_UPSTOX_DATA_PIPELINE = PASS")
    print("READY_FOR_STRATEGY_MAP_GENERATION = YES")
    print("READY_FOR_TOMORROW_OPENING_CONFIRMATION = NOT_YET_TESTED")


if __name__ == "__main__":
    try:
        main()
    except UpstoxDataError as exc:
        fail(f"UPSTOX_DATA_ERROR: {exc}")
    except KeyboardInterrupt:
        fail("INTERRUPTED")
