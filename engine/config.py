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
    min_daily_value: float = 50_000_000.0
    min_relative_volume: float = 1.2
    max_spread_bps: float = 20.0
    atr_stop_multiple: float = 1.2
    reward_risk: float = 2.0
    signal_expiry_minutes: int = 20
    market_data_provider: str = "breeze"
    breeze_api_key: str = ""
    breeze_api_secret: str = ""
    breeze_session_token: str = ""

    @classmethod
    def from_env(cls) -> "Settings":
        if os.getenv("ENABLE_LIVE_TRADING", "false").lower() != "false":
            raise RuntimeError("ENABLE_LIVE_TRADING must remain false; this engine is paper-only")
        provider = os.getenv("MARKET_DATA_PROVIDER", "breeze").strip().lower()
        if provider not in {"breeze", "upstox"}:
            raise RuntimeError("MARKET_DATA_PROVIDER must be breeze or upstox")
        max_symbols = int(os.getenv("NSE_UNIVERSE_SIZE", "500"))
        if not 1 <= max_symbols <= 500:
            raise RuntimeError("NSE_UNIVERSE_SIZE must be between 1 and 500")
        min_price = float(os.getenv("MIN_PRICE_INR", "150"))
        max_price = float(os.getenv("MAX_PRICE_INR", "750"))
        if min_price <= 0 or max_price <= min_price:
            raise RuntimeError("MIN_PRICE_INR and MAX_PRICE_INR must define a positive increasing range")
        return cls(
            access_token=os.getenv("UPSTOX_ACCESS_TOKEN", ""),
            db_path=Path(os.getenv("MARKET_DATA_DB", ROOT / "data" / "market_data.duckdb")),
            snapshot_path=Path(os.getenv("SIGNAL_SNAPSHOT_PATH", ROOT / "data" / "paper_signals.json")),
            universe_path=Path(os.getenv("NSE_UNIVERSE_PATH", ROOT / "data" / "market-universe.json")),
            max_symbols=max_symbols,
            stale_seconds=int(os.getenv("MAX_DATA_AGE_SECONDS", "120")),
            min_price=min_price,
            max_price=max_price,
            min_daily_value=float(os.getenv("MIN_DAILY_VALUE_INR", "50000000")),
            min_relative_volume=float(os.getenv("MIN_RELATIVE_VOLUME", "1.2")),
            max_spread_bps=float(os.getenv("MAX_SPREAD_BPS", "20")),
            market_data_provider=provider,
            breeze_api_key=os.getenv("BREEZE_API_KEY", ""),
            breeze_api_secret=os.getenv("BREEZE_API_SECRET", ""),
            breeze_session_token=os.getenv("BREEZE_SESSION_TOKEN", ""),
        )

    def symbols(self) -> list[str]:
        rows = json.loads(self.universe_path.read_text())
        symbols = [str(row["symbol"]).strip().upper() for row in rows
                   if row.get("symbol") and "NIFTY 500" in row.get("sources", [])]
        return list(dict.fromkeys(symbols))[: self.max_symbols]
