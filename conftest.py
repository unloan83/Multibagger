"""Session-wide guard: tests must never reach the real Telegram chat or its production state file.

Many tests drive paper entries, exits, breakers and degraded-mode incidents, and the code under test
sends a Telegram message for each. With credentials in the shell or in the repo's .env (as on the
Breeze VM), those synthetic trades would be posted for real. This guard, active for every test run:

1. removes Telegram credentials from the environment;
2. points TELEGRAM_NOTIFICATION_STATE at a temporary file instead of
   /var/lib/multibagger/telegram_notification_state.json;
3. refuses any HTTP request to api.telegram.org made through requests or urllib, including from the
   engine.notifier background thread, which can send after the test that queued the message ends.

Tests that exercise Telegram code monkeypatch the sender or set fake credentials themselves; those
patches sit above the transport and keep working.
"""
from __future__ import annotations

import os
import shutil
import tempfile
import urllib.request
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urlsplit

TELEGRAM_HOST = "api.telegram.org"
_CREDENTIAL_KEYS = ("TELEGRAM_TOKEN", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "TELEGRAM_ALLOWED_CHAT_ID")
_restore: list = []


def _is_telegram(url: object) -> bool:
    url = getattr(url, "full_url", None) or getattr(url, "url", None) or url
    return urlsplit(str(url)).hostname == TELEGRAM_HOST


def pytest_configure(config):
    for key in _CREDENTIAL_KEYS:
        os.environ.pop(key, None)
    state_dir = Path(tempfile.mkdtemp(prefix="multibagger-telegram-state-"))
    os.environ["TELEGRAM_NOTIFICATION_STATE"] = str(state_dir / "telegram_notification_state.json")
    _restore.append(lambda: shutil.rmtree(state_dir, ignore_errors=True))

    real_open = urllib.request.OpenerDirector.open

    def guarded_open(self, fullurl, *args, **kwargs):
        if _is_telegram(fullurl):
            raise URLError("Telegram is blocked during tests (conftest.py)")
        return real_open(self, fullurl, *args, **kwargs)

    # Left in place until the process exits: the notifier thread may still drain its queue at shutdown.
    urllib.request.OpenerDirector.open = guarded_open

    try:
        import requests
    except ImportError:  # intel/ is standard-library only
        return
    real_send = requests.Session.send

    def guarded_send(self, request, *args, **kwargs):
        if _is_telegram(request.url):
            raise requests.ConnectionError("Telegram is blocked during tests (conftest.py)")
        return real_send(self, request, *args, **kwargs)

    requests.Session.send = guarded_send


def pytest_unconfigure(config):
    while _restore:
        _restore.pop()()
