from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Settings:
    access_token: str
    db_path: Path
    snapshot_path: Path
    universe_path: Path
    max_symbols: int = 500
    stale_seconds: int = 120
    min_price: float = 150.0
    max_price: float = 750.0
    min_daily_value: float = 100_000_000.0
    min_relative_volume: float = 2.0
    max_spread_bps: float = 10.0
    min_atr_stop_pct: float = 0.5
    min_confluence_score: float = 80.0
    atr_stop_multiple: float = 1.2
    reward_risk: float = 2.0
    signal_expiry_minutes: int = 20
    paper_portfolio_capital: float = 500_000.0
    paper_risk_per_trade_pct: float = 0.5
    paper_max_capital_per_trade_pct: float = 20.0
    paper_daily_profit_target: float = 3_000.0
    paper_daily_loss_limit: float = 3_000.0
    paper_max_open_positions: int = 3
    paper_max_trades_per_day: int = 3
    paper_consecutive_loss_limit: int = 2
    paper_profit_risk_reduction_ratio: float = 0.70
    paper_profit_entry_lock_ratio: float = 0.90
    paper_max_entry_slippage_bps: float = 8.0
    paper_break_even_trigger_r: float = 0.75
    paper_trailing_trigger_r: float = 1.25
    paper_trailing_distance_r: float = 0.50
    require_expert_confirmation: bool = True
    execution_paused: bool = False
    paper_brokerage_per_order: float = 20.0
    paper_fees_bps_per_side: float = 5.0
    paper_slippage_bps_per_side: float = 5.0
    paper_flatten_hour_ist: int = 15
    paper_flatten_minute_ist: int = 15
    candle_watchdog_seconds: int = 180
    paper_submit_upstox_sandbox_orders: bool = False
    upstox_sandbox_access_token: str = ""
    market_data_provider: str = "upstox"
    breeze_api_key: str = ""
    breeze_api_secret: str = ""
    breeze_session_token: str = ""

    @classmethod
    def from_env(cls) -> "Settings":
        if os.getenv("ENABLE_LIVE_TRADING", "false").lower() != "false":
            raise RuntimeError("ENABLE_LIVE_TRADING must remain false; this engine is paper-only")
        provider = os.getenv("MARKET_DATA_PROVIDER", "upstox").strip().lower()
        if provider != "upstox":
            raise RuntimeError("Scheduled paper execution is Upstox-only; Breeze must remain separate")
        max_symbols = int(os.getenv("NSE_UNIVERSE_SIZE", "500"))
        if not 1 <= max_symbols <= 500:
            raise RuntimeError("NSE_UNIVERSE_SIZE must be between 1 and 500")
        min_price = float(os.getenv("MIN_PRICE_INR", "150"))
        max_price = float(os.getenv("MAX_PRICE_INR", "750"))
        if min_price <= 0 or max_price <= min_price:
            raise RuntimeError("MIN_PRICE_INR and MAX_PRICE_INR must define a positive increasing range")
        paper_capital = float(os.getenv("PAPER_PORTFOLIO_CAPITAL_INR", "500000"))
        risk_pct = float(os.getenv("PAPER_RISK_PER_TRADE_PERCENT", "0.5"))
        daily_target = float(os.getenv("PAPER_DAILY_PROFIT_TARGET_INR", "3000"))
        daily_loss = float(os.getenv("PAPER_DAILY_LOSS_LIMIT_INR", "3000"))
        max_positions = int(os.getenv("PAPER_MAX_OPEN_POSITIONS", "3"))
        max_trades = int(os.getenv("PAPER_MAX_TRADES_PER_DAY", "6"))
        execution_paused = os.getenv("TRADING_EXECUTION_PAUSED", "true").strip().lower() != "false"
        risk_reduction_ratio = float(os.getenv("PAPER_PROFIT_RISK_REDUCTION_RATIO", "0.70"))
        entry_lock_ratio = float(os.getenv("PAPER_PROFIT_ENTRY_LOCK_RATIO", "0.90"))
        max_entry_slippage_bps = float(os.getenv("PAPER_MAX_ENTRY_SLIPPAGE_BPS", "8"))
        if paper_capital <= 0 or not 0 < risk_pct <= 5:
            raise RuntimeError("Paper capital must be positive and risk per trade must be between 0 and 5 percent")
        if daily_target <= 0 or daily_loss <= 0:
            raise RuntimeError("Paper daily profit target and loss limit must be positive")
        if not 1 <= max_positions <= 10 or not 1 <= max_trades <= 50:
            raise RuntimeError("Paper position and daily-trade limits are outside safe bounds")
        if not 0 < risk_reduction_ratio < entry_lock_ratio <= 1:
            raise RuntimeError("Profit risk-reduction and entry-lock ratios must be ordered within (0, 1]")
        if not 0 <= max_entry_slippage_bps <= 20:
            raise RuntimeError("Paper entry slippage tolerance must be between 0 and 20 bps")
        return cls(
            access_token=os.getenv("UPSTOX_ACCESS_TOKEN", ""),
            db_path=Path(os.getenv("MARKET_DATA_DB", ROOT / "data" / "market_data.duckdb")),
            snapshot_path=Path(os.getenv("SIGNAL_SNAPSHOT_PATH", ROOT / "data" / "paper_signals.json")),
            universe_path=Path(os.getenv("NSE_UNIVERSE_PATH", ROOT / "data" / "market-universe.json")),
            max_symbols=max_symbols,
            stale_seconds=int(os.getenv("MAX_DATA_AGE_SECONDS", "120")),
            min_price=min_price,
            max_price=max_price,
            min_daily_value=float(os.getenv("MIN_DAILY_VALUE_INR", "100000000")),
            min_relative_volume=float(os.getenv("MIN_RELATIVE_VOLUME", "2.0")),
            max_spread_bps=float(os.getenv("MAX_SPREAD_BPS", "10")),
            paper_portfolio_capital=paper_capital,
            paper_risk_per_trade_pct=risk_pct,
            paper_max_capital_per_trade_pct=float(os.getenv("PAPER_MAX_CAPITAL_PER_TRADE_PERCENT", "20")),
            paper_daily_profit_target=daily_target,
            paper_daily_loss_limit=daily_loss,
            paper_max_open_positions=max_positions,
            paper_max_trades_per_day=max_trades,
            paper_profit_risk_reduction_ratio=risk_reduction_ratio,
            paper_profit_entry_lock_ratio=entry_lock_ratio,
            paper_max_entry_slippage_bps=max_entry_slippage_bps,
            paper_break_even_trigger_r=float(os.getenv("PAPER_BREAK_EVEN_TRIGGER_R", "0.75")),
            paper_trailing_trigger_r=float(os.getenv("PAPER_TRAILING_TRIGGER_R", "1.25")),
            paper_trailing_distance_r=float(os.getenv("PAPER_TRAILING_DISTANCE_R", "0.50")),
            require_expert_confirmation=os.getenv("PAPER_REQUIRE_EXPERT_CONFIRMATION", "true").lower() == "true",
            execution_paused=execution_paused,
            paper_brokerage_per_order=float(os.getenv("PAPER_BROKERAGE_PER_ORDER_INR", "20")),
            paper_fees_bps_per_side=float(os.getenv("PAPER_FEES_BPS_PER_SIDE", "5")),
            paper_slippage_bps_per_side=float(os.getenv("PAPER_SLIPPAGE_BPS_PER_SIDE", "5")),
            candle_watchdog_seconds=int(os.getenv("UPSTOX_CANDLE_WATCHDOG_SECONDS", "180")),
            paper_submit_upstox_sandbox_orders=os.getenv("PAPER_SUBMIT_UPSTOX_SANDBOX_ORDERS", "false").lower() == "true",
            upstox_sandbox_access_token=os.getenv("UPSTOX_SANDBOX_ACCESS_TOKEN", ""),
            market_data_provider=provider,
        )

    def symbols(self) -> list[str]:
        rows = json.loads(self.universe_path.read_text())
        symbols = [str(row["symbol"]).strip().upper() for row in rows
                   if row.get("symbol") and "NIFTY 500" in row.get("sources", [])]
        return list(dict.fromkeys(symbols))[: self.max_symbols]
