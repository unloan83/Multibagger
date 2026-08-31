from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Any

ROOT = Path(__file__).resolve().parents[1]
EXECUTION_ENGINE_IDENTITY = "UNIFIED_OPPORTUNITY_ENGINE"
UPSTOX_ALGO_HEADER = {"X-Algo-Name": "MultibaggerCore"}
UPSTOX_BASE_URL = "https://api.upstox.com/v2"

DB_PATH = str(ROOT / "data" / "trading_state.db")
MAX_DAILY_LOSS = 1000.0

STATUTORY_RATES = {
    "brokerage_per_order": 20.0,
    "stt_rate_sell": 0.00025,
    "exchange_turnover_rate": 0.0000345,
    "gst_rate": 0.18,
    "stamp_duty_rate_buy": 0.00003,
}

def calculate_statutory_costs(buy_qty: int, buy_price: float, sell_price: float) -> Dict[str, float]:
    buy_turnover = buy_price * buy_qty
    sell_turnover = sell_price * buy_qty
    total_turnover = buy_turnover + sell_turnover

    buy_brokerage = min(20.0, buy_turnover * 0.0005)
    sell_brokerage = min(20.0, sell_turnover * 0.0005)
    brokerage = buy_brokerage + sell_brokerage

    stt = sell_turnover * STATUTORY_RATES["stt_rate_sell"]
    exchange_charges = total_turnover * STATUTORY_RATES["exchange_turnover_rate"]
    gst = (brokerage + exchange_charges) * STATUTORY_RATES["gst_rate"]
    stamp_duty = buy_turnover * STATUTORY_RATES["stamp_duty_rate_buy"]

    total_cost = brokerage + stt + exchange_charges + gst + stamp_duty

    return {
        "brokerage": round(brokerage, 2),
        "stt": round(stt, 2),
        "exchange_charges": round(exchange_charges, 2),
        "gst": round(gst, 2),
        "stamp_duty": round(stamp_duty, 2),
        "total_cost": round(total_cost, 2),
    }

@dataclass(frozen=True)
class StatutoryFees:
    brokerage_per_order: float = 20.0
    stt_rate_sell: float = 0.00025
    exchange_turnover_rate: float = 0.0000345
    gst_rate: float = 0.18
    stamp_duty_rate_buy: float = 0.00003

    def calculate_entry_cost(self, price: float, qty: int) -> float:
        turnover = price * qty
        brokerage = min(20.0, turnover * 0.0005)
        exchange_fee = turnover * self.exchange_turnover_rate
        gst = (brokerage + exchange_fee) * self.gst_rate
        stamp_duty = turnover * self.stamp_duty_rate_buy
        return round(brokerage + exchange_fee + gst + stamp_duty, 4)

    def calculate_exit_cost(self, price: float, qty: int) -> float:
        turnover = price * qty
        brokerage = min(20.0, turnover * 0.0005)
        stt = turnover * self.stt_rate_sell
        exchange_fee = turnover * self.exchange_turnover_rate
        gst = (brokerage + exchange_fee) * self.gst_rate
        return round(brokerage + stt + exchange_fee + gst, 4)

    def calculate_total_roundtrip_cost(self, entry_price: float, exit_price: float, qty: int) -> float:
        return round(self.calculate_entry_cost(entry_price, qty) + self.calculate_exit_cost(exit_price, qty), 4)

@dataclass(frozen=True)
class Settings:
    access_token: str = ""
    db_path: Path = field(default_factory=lambda: ROOT / "data" / "trading_state.db")
    snapshot_path: Path = field(default_factory=lambda: ROOT / "data" / "paper_signals.json")
    universe_path: Path = field(default_factory=lambda: ROOT / "data" / "market-universe.json")
    max_symbols: int = 500
    trading_universe_size: int = 250
    stale_seconds: int = 120
    min_price: float = 50.0
    max_price: float = 15000.0
    min_daily_value: float = 500_000_000.0
    min_relative_volume: float = 1.30
    max_spread_bps: float = 10.0
    min_intraday_atr_pct: float = 0.04
    max_breakout_extension_atr: float = 0.60
    min_atr_stop_pct: float = 0.5
    min_confluence_score: float = 50.0
    min_score_morning: float = 50.0
    min_score_midday: float = 50.0
    min_score_afternoon: float = 50.0
    atr_stop_multiple: float = 3.0
    reward_risk: float = 2.0
    max_reward_risk: float = 2.0
    min_average_volume: int = 150_000
    min_average_daily_range_pct: float = 0.85
    min_opportunity_score: float = 55.0
    support_resistance_proximity_pct: float = 0.5
    regime_adx_trending: float = 20.0
    regime_adx_range: float = 20.0
    regime_high_vol_atr_pct: float = 1.5
    vix_max_level: float = 20.0
    vix_symbol: str = "INDIA VIX"
    vix_instrument_key: str = "NSE_INDEX|India VIX"
    max_opening_gap_pct: float = 1.5
    no_trade_events_path: Path = field(default_factory=lambda: ROOT / "data" / "no-trade-events.json")
    active_universe_path: Path = field(default_factory=lambda: ROOT / "data" / "active-intraday-universe.json")
    signal_expiry_minutes: int = 20
    paper_portfolio_capital: float = 500_000.0
    paper_risk_per_trade_pct: float = 0.25
    paper_min_risk_per_trade: float = 250.0
    paper_max_risk_per_trade: float = 500.0
    paper_max_aggregate_open_risk: float = 750.0
    paper_max_capital_per_trade_pct: float = 20.0
    paper_daily_profit_target: float = 4_000.0
    paper_daily_loss_limit: float = 1_000.0
    paper_learning_mode_date: str = ""
    paper_learning_profit_objective: float = 1_000.0
    paper_learning_shortlist_size: int = 5
    paper_max_open_positions: int = 3
    paper_max_trades_per_day: int = 4
    paper_consecutive_loss_limit: int = 2
    paper_profit_risk_reduction_ratio: float = 0.70
    paper_profit_entry_lock_ratio: float = 0.90
    paper_max_entry_slippage_bps: float = 8.0
    paper_break_even_trigger_r: float = 1.25
    paper_trailing_trigger_r: float = 1.0
    paper_trailing_atr_multiple: float = 1.5
    paper_minimum_hold_seconds: int = 60
    paper_monitor_interval_seconds: int = 30
    paper_signal_interval_seconds: int = 900
    require_setup_confirmation: bool = True
    execution_paused: bool = True
    paper_brokerage_per_order: float = 20.0
    paper_fees_bps_per_side: float = 5.0
    paper_slippage_bps_per_side: float = 5.0
    paper_stt_bps_sell: float = 2.5
    paper_exchange_bps_per_side: float = 0.31
    paper_gst_percent: float = 18.0
    paper_market_impact_bps_per_side: float = 2.0
    paper_flatten_hour_ist: int = 15
    paper_flatten_minute_ist: int = 10
    candle_watchdog_seconds: int = 180
    paper_submit_upstox_sandbox_orders: bool = False
    upstox_sandbox_access_token: str = ""
    market_data_provider: str = "upstox"
    market_index_symbol: str = "NIFTY 50"
    market_index_instrument_key: str = "NSE_INDEX|Nifty 50"
    breeze_session_token: str = ""
    enabled_agents: tuple[str, ...] = ("UNIFIED_OPPORTUNITY_ENGINE", "ALPHA", "BETA", "GAMMA")
    backoff_initial_seconds: float = 1.0
    backoff_max_seconds: float = 60.0
    backoff_max_attempts: int = 10

    hard_daily_loss_limit: float = 1000.0
    tick_size: float = 0.05
    log_dir: Path = field(default_factory=lambda: ROOT / "logs")
    algo_name: str = "MultibaggerCore"
    headers: dict[str, str] = field(default_factory=lambda: {"X-Algo-Name": "MultibaggerCore"})

    session_preflight_start: str = "08:30"
    session_preflight_end: str = "09:00"
    session_blackout_start: str = "09:15"
    session_blackout_end: str = "09:20"
    session_trading_start: str = "09:20"
    session_trading_end: str = "15:10"
    session_squareoff_time: str = "15:10"

    min_rvol: float = 1.30
    min_net_reward: float = 150.0
    min_rr_ratio: float = 1.8
    max_spread_pct: float = 0.003
    max_tick_latency_ms: int = 2000

    fees: StatutoryFees = field(default_factory=StatutoryFees)

    def symbols(self) -> list[str]:
        if not self.universe_path.exists():
            return []
        rows = json.loads(self.universe_path.read_text())
        symbols = [
            str(row["symbol"]).strip().upper()
            for row in rows
            if row.get("symbol") and "NIFTY 500" in row.get("sources", [])
        ]
        return list(dict.fromkeys(symbols))[: self.max_symbols]

    @classmethod
    def from_env(cls) -> Settings:
        if os.getenv("ENABLE_LIVE_TRADING", "false").lower() != "false":
            raise RuntimeError("ENABLE_LIVE_TRADING must remain false; this engine is paper-only")

        max_risk_trade = float(os.getenv("PAPER_MAX_RISK_PER_TRADE_INR", "500.0"))
        if max_risk_trade > 500.0:
            raise RuntimeError("PAPER_MAX_RISK_PER_TRADE_INR must not exceed 500.0")

        max_symbols = int(os.getenv("NSE_UNIVERSE_SIZE", "500"))
        if not 1 <= max_symbols <= 500:
            raise RuntimeError("NSE_UNIVERSE_SIZE must be between 1 and 500")

        min_price = float(os.getenv("MIN_PRICE_INR", "50.0"))
        max_price = float(os.getenv("MAX_PRICE_INR", "15000.0"))
        if min_price <= 0 or max_price <= min_price:
            raise RuntimeError("MIN_PRICE_INR and MAX_PRICE_INR must form a positive increasing range")

        paper_capital = float(os.getenv("PAPER_PORTFOLIO_CAPITAL_INR", "500000.0"))
        risk_pct = float(os.getenv("PAPER_RISK_PER_TRADE_PERCENT", "0.25"))
        daily_target = float(os.getenv("PAPER_DAILY_PROFIT_TARGET_INR", "4000.0"))
        daily_loss = float(os.getenv("PAPER_DAILY_LOSS_LIMIT_INR", "1000.0"))

        if paper_capital <= 0 or not 0 < risk_pct <= 5:
            raise RuntimeError("Paper capital must be positive and risk per trade must be between 0 and 5 percent")
        if daily_target <= 0 or daily_loss <= 0:
            raise RuntimeError("Paper daily profit target and loss limit must be positive")
        if abs(daily_target - 4_000) > 0.01 or abs(daily_loss - 1_000) > 0.01:
            raise RuntimeError("Paper trading rules must remain INR 4,000 profit / 1,000 loss")

        agents_raw = os.getenv("ENABLED_AGENTS", "UNIFIED_OPPORTUNITY_ENGINE")
        tokens = tuple(t.strip().upper() for t in agents_raw.split(",") if t.strip())
        if not tokens or set(tokens) != {EXECUTION_ENGINE_IDENTITY}:
            raise RuntimeError(f"ENABLED_AGENTS must be {EXECUTION_ENGINE_IDENTITY} so scheduled scans can execute")

        token = os.getenv("UPSTOX_ACCESS_TOKEN", "").strip()
        db_p = Path(os.getenv("TRADING_DB_PATH", str(ROOT / "data" / "trading_state.db")))
        db_p.parent.mkdir(parents=True, exist_ok=True)
        (ROOT / "logs").mkdir(parents=True, exist_ok=True)

        return cls(
            access_token=token,
            db_path=db_p,
            max_symbols=max_symbols,
            min_price=min_price,
            max_price=max_price,
            paper_portfolio_capital=paper_capital,
            paper_risk_per_trade_pct=risk_pct,
            paper_daily_profit_target=daily_target,
            paper_daily_loss_limit=daily_loss,
            enabled_agents=tokens,
        )
