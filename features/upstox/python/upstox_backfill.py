from __future__ import annotations

from datetime import datetime, timedelta, timezone

from engine.backfill import backfill
from engine.config import Settings


def warmup_upstox(settings: Settings, days: int = 35) -> dict[str, int]:
    """Seed recent one-minute bars from Upstox before automatic paper execution starts."""
    if not 20 <= days <= 35:
        raise ValueError("Upstox warm-up days must be between 20 and 35")
    if settings.market_data_provider != "upstox":
        raise RuntimeError("Upstox warm-up requires MARKET_DATA_PROVIDER=upstox")
    end = datetime.now(timezone.utc).date()
    return backfill(settings, end - timedelta(days=days), end, resume=True)
