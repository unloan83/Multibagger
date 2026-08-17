from __future__ import annotations

import json
import os
import urllib.request
from datetime import datetime, timezone
from typing import Any
from urllib.error import HTTPError

from .config import Settings


def publish_snapshot(settings: Settings, payload: dict[str, Any]) -> None:
    settings.snapshot_path.parent.mkdir(parents=True, exist_ok=True)
    settings.snapshot_path.write_text(json.dumps(payload, indent=2))
    publish_url = os.getenv("SIGNAL_INGEST_URL", "")
    publish_token = os.getenv("SIGNAL_INGEST_TOKEN", "")
    if not publish_url:
        return
    if not publish_token:
        raise RuntimeError("SIGNAL_INGEST_TOKEN is required when SIGNAL_INGEST_URL is set")
    request = urllib.request.Request(
        publish_url,
        data=json.dumps(payload).encode(),
        method="POST",
        headers={"Authorization": f"Bearer {publish_token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            if response.status >= 300:
                raise RuntimeError(f"Signal publication failed with HTTP {response.status}")
    except HTTPError as error:
        detail = error.read(1000).decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Signal publication failed with HTTP {error.code}: {detail}"
        ) from error


def refresh_snapshot_with_paper(
    settings: Settings,
    paper: dict[str, Any],
    observed_at: datetime,
    monitor_run_id: str,
) -> dict[str, Any]:
    """Refresh public execution state without extending expired scanner signals."""
    previous: dict[str, Any] = {}
    if settings.snapshot_path.exists():
        try:
            loaded = json.loads(settings.snapshot_path.read_text())
            if isinstance(loaded, dict):
                previous = loaded
        except (OSError, json.JSONDecodeError):
            previous = {}

    observed_at = observed_at.astimezone(timezone.utc)
    active_signals = [
        signal for signal in previous.get("signals", [])
        if isinstance(signal, dict) and _is_active(signal.get("expiry"), observed_at)
    ]
    has_signals = bool(active_signals)
    payload = {
        "status": "SIGNALS" if has_signals else "NO_TRADE",
        "asOf": observed_at.isoformat(),
        "run_id": previous.get("run_id") if has_signals else monitor_run_id,
        "source": previous.get("source") or f"{settings.market_data_provider.upper()}_1MIN_DUCKDB",
        "mode": "PAPER_ONLY",
        "evaluatedUniverseSize": previous.get("evaluatedUniverseSize", 0),
        "reason": None if has_signals else "NO_TRADE",
        "signals": active_signals,
        "paperTrading": paper,
    }
    publish_snapshot(settings, payload)
    return payload


def _is_active(expiry: Any, observed_at: datetime) -> bool:
    if not isinstance(expiry, str):
        return False
    try:
        parsed = datetime.fromisoformat(expiry.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc) > observed_at
    except ValueError:
        return False
