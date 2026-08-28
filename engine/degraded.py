"""
SAFE_DEGRADED Mode State & Dependency Health Manager for Multibagger Trading Bot
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any

LOG = logging.getLogger("multibagger.degraded")


class DegradedModeManager:
    def __init__(self):
        self._lock = threading.Lock()
        self._degraded = False
        self._active_failures: dict[str, str] = {}
        self._attempts: dict[str, int] = {}
        self._last_attempt: dict[str, float] = {}

    @property
    def is_degraded(self) -> bool:
        with self._lock:
            return self._degraded or len(self._active_failures) > 0

    def active_failures(self) -> dict[str, str]:
        with self._lock:
            return dict(self._active_failures)

    def report_failure(self, dependency: str, reason: str) -> bool:
        """
        Reports a dependency failure. Transitions bot to SAFE_DEGRADED mode.
        Sends single incident FAILURE alert to Telegram via notify_incident_event.
        Returns True if this is a new failure transition.
        """
        from scripts.telegram_notify import notify_incident_event
        is_new = False
        with self._lock:
            self._degraded = True
            dep_key = dependency.upper()
            if dep_key not in self._active_failures:
                self._active_failures[dep_key] = reason
                is_new = True
            else:
                self._active_failures[dep_key] = reason

        if is_new:
            LOG.warning("ENTERED SAFE_DEGRADED MODE due to %s failure: %s", dependency, reason)
            notify_incident_event(
                incident_key=dependency.lower(),
                is_failure=True,
                message=(
                    f"⚠️ SAFE_DEGRADED Mode Active — [{dependency.upper()} Failure]\n"
                    f"Reason: {reason[:300]}\n"
                    "Status: New entries BLOCKED, position & risk state PRESERVED, protecting open positions.\n"
                    "Auto-recovery: Retrying with bounded exponential backoff."
                ),
            )
        return is_new

    def report_recovery(self, dependency: str) -> bool:
        """
        Reports dependency recovery. If all dependencies recover, exits SAFE_DEGRADED mode.
        Sends single incident RECOVERED alert to Telegram via notify_incident_event.
        Returns True if fully recovered to normal mode.
        """
        from scripts.telegram_notify import notify_incident_event
        was_active = False
        fully_recovered = False
        dep_key = dependency.upper()
        with self._lock:
            if dep_key in self._active_failures:
                del self._active_failures[dep_key]
                was_active = True
            self._attempts[dep_key] = 0
            if len(self._active_failures) == 0:
                self._degraded = False
                fully_recovered = True

        if was_active:
            LOG.info("RECOVERED dependency %s", dep_key)
            notify_incident_event(
                incident_key=dependency.lower(),
                is_failure=False,
                message=(
                    f"✅ SAFE_DEGRADED Incident Resolved — [{dep_key} Recovered]\n"
                    "Bot status: ALL SYSTEMS HEALTHY. Normal trading operations resumed."
                ),
            )
        return fully_recovered

    def compute_backoff(self, dependency: str, initial_delay: float = 1.0, max_delay: float = 60.0) -> float:
        dep_key = dependency.upper()
        with self._lock:
            attempts = self._attempts.get(dep_key, 0) + 1
            self._attempts[dep_key] = attempts
            delay = min(max_delay, initial_delay * (2 ** (attempts - 1)))
            return delay

    def reset_backoff(self, dependency: str) -> None:
        dep_key = dependency.upper()
        with self._lock:
            self._attempts[dep_key] = 0

    def reset(self) -> None:
        with self._lock:
            self._degraded = False
            self._active_failures.clear()
            self._attempts.clear()


# Global singleton instance
DEGRADED_MANAGER = DegradedModeManager()
