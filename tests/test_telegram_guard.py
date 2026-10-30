"""The repo-root conftest.py must keep every test run away from the real Telegram chat."""
import os
import time
import urllib.request
from pathlib import Path
from urllib.error import URLError

import pytest
import requests

from engine import notifier
from scripts import telegram_notify


def test_telegram_credentials_are_removed():
    for key in ("TELEGRAM_TOKEN", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "TELEGRAM_ALLOWED_CHAT_ID"):
        assert key not in os.environ


def test_notification_state_is_temporary():
    state = Path(os.environ["TELEGRAM_NOTIFICATION_STATE"])
    assert not str(state).startswith("/var/lib/")


def test_requests_to_telegram_are_refused():
    with pytest.raises(requests.ConnectionError, match="blocked during tests"):
        requests.post("https://api.telegram.org/botX/sendMessage", json={"text": "x"}, timeout=1)


def test_urllib_to_telegram_is_refused():
    with pytest.raises(URLError, match="blocked during tests"):
        urllib.request.urlopen("https://api.telegram.org/botX/sendMessage", timeout=1)


def test_script_sender_cannot_post_even_with_credentials(monkeypatch):
    monkeypatch.setenv("TELEGRAM_TOKEN", "123:fake")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "1")
    assert telegram_notify.send_telegram_message("guard check", event_key="guard-check") is False


def test_background_notifier_cannot_deliver(monkeypatch):
    monkeypatch.setattr(notifier, "_load_env_tokens", lambda: ("123:fake", "1"))
    worker = notifier.TelegramNotifierWorker()
    worker.start()
    try:
        worker.enqueue_alert("guard check")
        deadline = time.monotonic() + 5
        while worker.failed_count == 0 and time.monotonic() < deadline:
            time.sleep(0.05)
    finally:
        worker.stop()
    assert worker.sent_count == 0 and worker.failed_count == 1
