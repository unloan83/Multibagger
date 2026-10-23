"""Versioned parameters for the daily model. Changing a value means bumping MODEL_VERSION."""
from __future__ import annotations

import os
from pathlib import Path

MODEL_VERSION = "daily-intel-v1"
STRATEGY_STATE = "SHADOW"  # paper only; no broker order call exists in this package

ROOT = Path(__file__).resolve().parents[1]
HOME = Path(os.environ.get("MB_INTEL_HOME", ROOT / "var" / "intel"))
DB_PATH = HOME / "intel.db"

CATEGORIES = ("INTRADAY", "SHORT_TERM", "LONG_TERM", "OPTIONS", "ETF")

# Paper sizing: equities use a fixed notional per pick; options trade one lot.
PAPER_CAPITAL_INR = 1_000_000.0
NOTIONAL_PER_PICK_INR = 100_000.0

# Provisional cost model (per side, as a fraction of notional) incl. slippage; options are per order.
COST_PER_SIDE = {"INTRADAY": 0.0010, "SHORT_TERM": 0.0017, "LONG_TERM": 0.0017, "ETF": 0.0007}
OPTIONS_COST_PER_ORDER_INR = 60.0
OPTIONS_SLIPPAGE_PER_LEG_INR_PER_UNIT = 0.5
COST_MODEL_VERSION = "provisional-2026-10"

# Data rules.
MIN_HISTORY_BARS = 260
MIN_MEDIAN_TURNOVER_INR = 10_00_00_000.0  # ₹10 crore/day

# Category rules.
MAX_PICKS = {"INTRADAY": 2, "SHORT_TERM": 3, "LONG_TERM": 5, "OPTIONS": 1, "ETF": 1}
MAX_HOLD_DAYS = {"INTRADAY": 1, "SHORT_TERM": 10, "POSITIONAL": 63, "LONG_TERM": 126}
SHORT_TERM_ENTRY_SLACK = 0.01  # buy at open only if open <= prev close * 1.01
INTRADAY_MAX_GAP = 0.03
OPTIONS_WIDTH_POINTS = 200.0
OPTIONS_MAX_DEBIT_FRACTION = 0.5  # reward >= risk
OPTIONS_MAX_LEG_SPREAD = 0.05
OPTIONS_MIN_DAYS_TO_EXPIRY = 2
VIX_HIGH = 22.0

# Analyst track record: an analyst moves picks only after enough scored calls with positive edge.
ANALYST_MIN_CALLS = 10
ANALYST_MIN_SHRUNK_R = 0.10
ANALYST_SHRINK_K = 10

# Kill rule: a category with enough closed picks and no edge is marked FAILED (no new entries).
KILL_MIN_CLOSED = 30

ETF_RISK = "NIFTYBEES"
ETF_IDLE = "LIQUIDBEES"
