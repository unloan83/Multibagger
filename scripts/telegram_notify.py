"""Small fail-open Telegram notifier shared by the OCI paper engines."""

from __future__ import annotations

import fcntl
import json
import logging
import os
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


LOG = logging.getLogger("multibagger.telegram")


def telegram_configured() -> bool:
    return bool(os.environ.get("TELEGRAM_TOKEN", "").strip() and os.environ.get("TELEGRAM_CHAT_ID", "").strip())


def send_telegram_message(text: str, *, event_key: str, cooldown_seconds: int = 0) -> bool:
    """Send without ever interrupting trading; suppress repeated operational alerts."""
    if os.environ.get("MULTIBAGGER_TEST_MODE") == "1":
        if not text.startswith("[TEST ONLY]"):
            text = f"[TEST ONLY] {text}"

    token = os.environ.get("TELEGRAM_TOKEN", "").strip()
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat_id:
        return False

    state_path = Path(os.environ.get(
        "TELEGRAM_NOTIFICATION_STATE",
        "/var/lib/multibagger/telegram_notification_state.json",
    ))
    try:
        state_path.parent.mkdir(parents=True, exist_ok=True)
        with state_path.open("a+", encoding="utf-8") as state_file:
            fcntl.flock(state_file.fileno(), fcntl.LOCK_EX)
            state_file.seek(0)
            try:
                state = json.load(state_file)
            except (json.JSONDecodeError, ValueError):
                state = {}
            now = time.time()
            if cooldown_seconds and now - float(state.get(event_key, 0)) < cooldown_seconds:
                return False
            if not _post(token, chat_id, text):
                return False
            state[event_key] = now
            state_file.seek(0)
            state_file.truncate()
            json.dump(state, state_file, separators=(",", ":"), sort_keys=True)
            state_file.flush()
            os.fsync(state_file.fileno())
            return True
    except OSError as error:
        LOG.warning("Telegram notification state could not be updated: %s", error)
        return False


def _post(token: str, chat_id: str, text: str) -> bool:
    request = Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=json.dumps({
            "chat_id": chat_id,
            "text": text[:4000],
            "disable_web_page_preview": True,
        }).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urlopen(request, timeout=15) as response:
            payload = json.load(response)
        if response.status >= 300 or payload.get("ok") is not True:
            LOG.warning("Telegram rejected a notification with HTTP %s", response.status)
            return False
        return True
    except HTTPError as error:
        LOG.warning("Telegram rejected a notification with HTTP %s", error.code)
    except (URLError, TimeoutError, json.JSONDecodeError, OSError):
        LOG.warning("Telegram notification delivery failed")
    return False
