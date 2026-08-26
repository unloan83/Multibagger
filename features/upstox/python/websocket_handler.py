"""
WebSocket Connection & Reconnection Handler Module

Implements exponential backoff retry logic, error handling,
and Telegram alerts for broker market-data WebSocket streams.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Callable

LOG = logging.getLogger("multibagger.websocket")


def reconnect_with_backoff(
    connect_fn: Callable[[], Any],
    max_attempts: int = 10,
    initial_delay: float = 1.0,
    max_delay: float = 30.0,
    logger: logging.Logger | None = None,
) -> Any:
    """
    Executes a connection / reconnection function with exponential backoff retry logic.

    Backoff sequence (for initial_delay=1.0, max_delay=30.0):
      Attempt 1: delay = 1s
      Attempt 2: delay = 2s
      Attempt 3: delay = 4s
      Attempt 4: delay = 8s
      Attempt 5: delay = 16s
      Attempt 6..10: delay = 30s (max_delay)

    If all max_attempts fail, logs the final failure, sends a Telegram alert,
    and raises RuntimeError.
    """
    log = logger or LOG
    last_error: Exception | None = None

    for attempt in range(1, max_attempts + 1):
        try:
            return connect_fn()
        except Exception as error:
            last_error = error
            log.warning("WebSocket reconnect attempt %d/%d failed: %s", attempt, max_attempts, error)
            
            if attempt < max_attempts:
                # Exponential backoff calculation: 1s, 2s, 4s, 8s, 16s, capped at max_delay (30s)
                delay = min(max_delay, initial_delay * (2 ** (attempt - 1)))
                time.sleep(delay)

    # All attempts exhausted
    alert_message = "🚨 WEBSOCKET DOWN: All reconnection attempts failed. Bot cannot receive market data."
    try:
        from scripts.telegram_notify import send_telegram_message
        send_telegram_message(
            alert_message,
            event_key="websocket-reconnect-exhausted",
            cooldown_seconds=300,
        )
    except Exception as telegram_err:
        log.error("Failed to send Telegram alert: %s", telegram_err)

    raise RuntimeError(f"WebSocket reconnection failed after {max_attempts} attempts: {last_error}") from last_error
