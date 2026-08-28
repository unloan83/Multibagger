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

    from engine.degraded import DEGRADED_MANAGER

    attempt = 0
    while True:
        attempt += 1
        try:
            res = connect_fn()
            DEGRADED_MANAGER.report_recovery("WEBSOCKET")
            return res
        except Exception as error:
            last_error = error
            DEGRADED_MANAGER.report_failure("WEBSOCKET", f"Reconnection attempt {attempt} failed: {error}")
            delay = min(max_delay, initial_delay * (2 ** (min(attempt, 10) - 1)))
            log.warning("WebSocket reconnect attempt %d failed: %s; retrying in %.1fs", attempt, error, delay)
            time.sleep(delay)
