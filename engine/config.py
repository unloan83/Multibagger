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
    trading_universe_size: int = 250
    stale_seconds: int = 120
    min_price: float = 150.0
    max_price: float = 750.0
    min_daily_value: float = 500_000_000.0
    min_relative_volume: float = 1.5
    max_spread_bps: float = 8.0
    min_intraday_atr_pct: float = 0.35
    max_breakout_extension_atr: float = 0.60
    min_atr_stop_pct: float = 0.5
    min_confluence_score: float = 80.0
    atr_stop_multiple: float = 3.0
    reward_risk: float = 1.5
    max_reward_risk: float = 2.0
    min_average_volume: int = 500_000
    min_average_daily_range_pct: float = 1.5
    support_resistance_proximity_pct: float = 0.5
    regime_adx_trending: float = 25.0
    regime_adx_range: float = 20.0
    regime_high_vol_atr_pct: float = 1.5
    vix_max_level: float = 20.0
    vix_symbol: str = "INDIA VIX"
    vix_instrument_key: str = "NSE_INDEX|India VIX"
    max_opening_gap_pct: float = 1.5
    no_trade_events_path: Path = ROOT / "data" / "no-trade-events.json"
    active_universe_path: Path = ROOT / "data" / "active-intraday-universe.json"
    signal_expiry_minutes: int = 20
    paper_portfolio_capital: float = 500_000.0
    paper_risk_per_trade_pct: float = 0.25
    paper_min_risk_per_trade: float = 250.0
    paper_max_risk_per_trade: float = 500.0
    paper_max_aggregate_open_risk: float = 750.0
    paper_max_capital_per_trade_pct: float = 20.0
    paper_daily_profit_target: float = 4_000.0
    paper_daily_loss_limit: float = 1_000.0
    paper_max_open_positions: int = 3
    paper_max_trades_per_day: int = 4
    paper_consecutive_loss_limit: int = 2
    paper_profit_risk_reduction_ratio: float = 0.70
    paper_profit_entry_lock_ratio: float = 0.90
    paper_max_entry_slippage_bps: float = 8.0
    paper_break_even_trigger_r: float = 1.0
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
    paper_flatten_minute_ist: int = 15
    candle_watchdog_seconds: int = 180
    paper_submit_upstox_sandbox_orders: bool = False
    upstox_sandbox_access_token: str = ""
    market_data_provider: str = "upstox"
    market_index_symbol: str = "NIFTY 50"
    market_index_instrument_key: str = "NSE_INDEX|Nifty 50"
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
        risk_pct = float(os.getenv("PAPER_RISK_PER_TRADE_PERCENT", "0.25"))
        daily_target = float(os.getenv("PAPER_DAILY_PROFIT_TARGET_INR", "4000"))
        daily_loss = float(os.getenv("PAPER_DAILY_LOSS_LIMIT_INR", "1000"))
        max_positions = int(os.getenv("PAPER_MAX_OPEN_POSITIONS", "3"))
        max_trades = int(os.getenv("PAPER_MAX_TRADES_PER_DAY", "4"))
        execution_paused = os.getenv("TRADING_EXECUTION_PAUSED", "true").strip().lower() != "false"
        risk_reduction_ratio = float(os.getenv("PAPER_PROFIT_RISK_REDUCTION_RATIO", "0.70"))
        entry_lock_ratio = float(os.getenv("PAPER_PROFIT_ENTRY_LOCK_RATIO", "0.90"))
        max_entry_slippage_bps = float(os.getenv("PAPER_MAX_ENTRY_SLIPPAGE_BPS", "8"))
        max_trade_risk = float(os.getenv("PAPER_MAX_RISK_PER_TRADE_INR", "500"))
        max_open_risk = float(os.getenv("PAPER_MAX_AGGREGATE_OPEN_RISK_INR", "750"))
        if paper_capital <= 0 or not 0 < risk_pct <= 5:
            raise RuntimeError("Paper capital must be positive and risk per trade must be between 0 and 5 percent")
        if daily_target <= 0 or daily_loss <= 0:
            raise RuntimeError("Paper daily profit target and loss limit must be positive")
        if not 1 <= max_positions <= 10 or not 0 <= max_trades <= 50:
            raise RuntimeError("Paper position and daily-trade limits are outside safe bounds")
        if not 0 < risk_reduction_ratio < entry_lock_ratio <= 1:
            raise RuntimeError("Profit risk-reduction and entry-lock ratios must be ordered within (0, 1]")
        if not 0 <= max_entry_slippage_bps <= 20:
            raise RuntimeError("Paper entry slippage tolerance must be between 0 and 20 bps")
        if max_trade_risk != 500 or max_open_risk != 750:
            raise RuntimeError("Paper risk caps must remain INR 500 per trade and INR 750 aggregate")
        trading_universe_size = int(os.getenv("INTRADAY_TRADING_UNIVERSE_SIZE", "250"))
        if trading_universe_size != 250:
            raise RuntimeError("INTRADAY_TRADING_UNIVERSE_SIZE must remain 250")
        if abs(daily_target - 4_000) > 0.01 or abs(daily_loss - 1_000) > 0.01:
            raise RuntimeError("Paper profit/loss breakers must remain INR 4,000/1,000")
        return cls(
            access_token=os.getenv("UPSTOX_ACCESS_TOKEN", ""),
            db_path=Path(os.getenv("MARKET_DATA_DB", ROOT / "data" / "market_data.duckdb")),
            snapshot_path=Path(os.getenv("SIGNAL_SNAPSHOT_PATH", ROOT / "data" / "paper_signals.json")),
            universe_path=Path(os.getenv("NSE_UNIVERSE_PATH", ROOT / "data" / "market-universe.json")),
            max_symbols=max_symbols,
            trading_universe_size=trading_universe_size,
            stale_seconds=int(os.getenv("MAX_DATA_AGE_SECONDS", "120")),
            min_price=min_price,
            max_price=max_price,
            min_daily_value=float(os.getenv("MIN_DAILY_VALUE_INR", "500000000")),
            min_relative_volume=float(os.getenv("MIN_RELATIVE_VOLUME", "1.5")),
            max_spread_bps=float(os.getenv("MAX_SPREAD_BPS", "8")),
            min_intraday_atr_pct=float(os.getenv("MIN_INTRADAY_ATR_PERCENT", "0.35")),
            max_breakout_extension_atr=float(os.getenv("MAX_BREAKOUT_EXTENSION_ATR", "0.60")),
            reward_risk=float(os.getenv("MIN_REWARD_RISK", "1.5")),
            max_reward_risk=float(os.getenv("MAX_REWARD_RISK", "2.0")),
            min_average_volume=int(os.getenv("MIN_AVERAGE_DAILY_VOLUME", "500000")),
            min_average_daily_range_pct=float(os.getenv("MIN_AVERAGE_DAILY_RANGE_PERCENT", "1.5")),
            support_resistance_proximity_pct=float(os.getenv("SUPPORT_RESISTANCE_PROXIMITY_PERCENT", "0.5")),
            regime_adx_trending=float(os.getenv("REGIME_ADX_TRENDING", "25")),
            regime_adx_range=float(os.getenv("REGIME_ADX_RANGE", "20")),
            regime_high_vol_atr_pct=float(os.getenv("REGIME_HIGH_VOL_ATR_PERCENT", "1.5")),
            vix_max_level=float(os.getenv("VIX_MAX_LEVEL", "20")),
            vix_symbol=os.getenv("VIX_SYMBOL", "INDIA VIX"),
            vix_instrument_key=os.getenv("VIX_INSTRUMENT_KEY", "NSE_INDEX|India VIX"),
            max_opening_gap_pct=float(os.getenv("MAX_OPENING_GAP_PERCENT", "1.5")),
            no_trade_events_path=Path(os.getenv("NO_TRADE_EVENTS_PATH", ROOT / "data" / "no-trade-events.json")),
            active_universe_path=Path(os.getenv("ACTIVE_INTRADAY_UNIVERSE_PATH", ROOT / "data" / "active-intraday-universe.json")),
            paper_portfolio_capital=paper_capital,
            paper_risk_per_trade_pct=risk_pct,
            paper_min_risk_per_trade=250.0,
            paper_max_risk_per_trade=max_trade_risk,
            paper_max_aggregate_open_risk=max_open_risk,
            paper_max_capital_per_trade_pct=float(os.getenv("PAPER_MAX_CAPITAL_PER_TRADE_PERCENT", "20")),
            paper_daily_profit_target=daily_target,
            paper_daily_loss_limit=daily_loss,
            paper_max_open_positions=max_positions,
            paper_max_trades_per_day=max_trades,
            paper_profit_risk_reduction_ratio=risk_reduction_ratio,
            paper_profit_entry_lock_ratio=entry_lock_ratio,
            paper_max_entry_slippage_bps=max_entry_slippage_bps,
            paper_break_even_trigger_r=float(os.getenv("PAPER_BREAK_EVEN_TRIGGER_R", "1.0")),
            paper_trailing_trigger_r=float(os.getenv("PAPER_TRAILING_TRIGGER_R", "1.0")),
            paper_trailing_atr_multiple=float(os.getenv("PAPER_TRAILING_ATR_MULTIPLE", "1.5")),
            paper_minimum_hold_seconds=int(os.getenv("PAPER_MINIMUM_HOLD_SECONDS", "60")),
            paper_monitor_interval_seconds=int(os.getenv("PAPER_MONITOR_INTERVAL_SECONDS", "30")),
            paper_signal_interval_seconds=int(os.getenv("PAPER_SIGNAL_INTERVAL_SECONDS", "900")),
            require_setup_confirmation=os.getenv("PAPER_REQUIRE_SETUP_CONFIRMATION", "true").lower() == "true",
            execution_paused=execution_paused,
            paper_brokerage_per_order=float(os.getenv("PAPER_BROKERAGE_PER_ORDER_INR", "20")),
            paper_fees_bps_per_side=float(os.getenv("PAPER_FEES_BPS_PER_SIDE", "5")),
            paper_slippage_bps_per_side=float(os.getenv("PAPER_SLIPPAGE_BPS_PER_SIDE", "5")),
            paper_stt_bps_sell=float(os.getenv("PAPER_STT_BPS_SELL", "2.5")),
            paper_exchange_bps_per_side=float(os.getenv("PAPER_EXCHANGE_BPS_PER_SIDE", "0.31")),
            paper_gst_percent=float(os.getenv("PAPER_GST_PERCENT", "18")),
            paper_market_impact_bps_per_side=float(os.getenv("PAPER_MARKET_IMPACT_BPS_PER_SIDE", "2")),
            candle_watchdog_seconds=int(os.getenv("UPSTOX_CANDLE_WATCHDOG_SECONDS", "180")),
            paper_submit_upstox_sandbox_orders=os.getenv("PAPER_SUBMIT_UPSTOX_SANDBOX_ORDERS", "false").lower() == "true",
            upstox_sandbox_access_token=os.getenv("UPSTOX_SANDBOX_ACCESS_TOKEN", ""),
            market_data_provider=provider,
            market_index_symbol=os.getenv("MARKET_INDEX_SYMBOL", "NIFTY 50"),
            market_index_instrument_key=os.getenv("MARKET_INDEX_INSTRUMENT_KEY", "NSE_INDEX|Nifty 50"),
        )

    def symbols(self) -> list[str]:
        rows = json.loads(self.universe_path.read_text())
        symbols = [str(row["symbol"]).strip().upper() for row in rows
                   if row.get("symbol") and "NIFTY 500" in row.get("sources", [])]
        return list(dict.fromkeys(symbols))[: self.max_symbols]
