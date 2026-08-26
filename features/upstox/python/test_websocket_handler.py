import logging
import sys
from types import SimpleNamespace
import pytest

from features.upstox.python.websocket_handler import reconnect_with_backoff


def test_reconnect_with_backoff_success_on_first_try(monkeypatch):
    calls = []
    def connect_fn():
        calls.append("connected")
        return "OK"

    result = reconnect_with_backoff(connect_fn, max_attempts=10, initial_delay=0.01, max_delay=0.05)
    assert result == "OK"
    assert len(calls) == 1


def test_reconnect_with_backoff_retries_and_succeeds(monkeypatch):
    calls = []
    delays = []

    monkeypatch.setattr("time.sleep", lambda delay: delays.append(delay))

    def connect_fn():
        calls.append(len(calls) + 1)
        if len(calls) < 4:
            raise ConnectionError(f"Connection dropped attempt {len(calls)}")
        return "RECONNECTED"

    result = reconnect_with_backoff(connect_fn, max_attempts=10, initial_delay=1.0, max_delay=30.0)
    assert result == "RECONNECTED"
    assert len(calls) == 4
    # Expected backoffs for attempts 1, 2, 3 -> delays after failures: 1.0s, 2.0s, 4.0s
    assert delays == [1.0, 2.0, 4.0]


def test_reconnect_with_backoff_exponential_cap(monkeypatch):
    calls = []
    delays = []

    monkeypatch.setattr("time.sleep", lambda delay: delays.append(delay))

    def connect_fn():
        calls.append(len(calls) + 1)
        if len(calls) < 8:
            raise TimeoutError("Network timeout")
        return "SUCCESS"

    result = reconnect_with_backoff(connect_fn, max_attempts=10, initial_delay=1.0, max_delay=30.0)
    assert result == "SUCCESS"
    assert len(calls) == 8
    # 1s, 2s, 4s, 8s, 16s, 30s (capped), 30s (capped)
    assert delays == [1.0, 2.0, 4.0, 8.0, 16.0, 30.0, 30.0]


def test_reconnect_with_backoff_exhaustion_alerts_and_raises(monkeypatch, caplog):
    calls = []
    delays = []
    alerts = []

    monkeypatch.setattr("time.sleep", lambda delay: delays.append(delay))

    def fake_send_telegram(msg, event_key=None, cooldown_seconds=0):
        alerts.append((msg, event_key))

    monkeypatch.setitem(
        sys.modules,
        "scripts.telegram_notify",
        SimpleNamespace(send_telegram_message=fake_send_telegram),
    )

    def failing_connect():
        calls.append(len(calls) + 1)
        raise RuntimeError("Persistent network outage")

    with caplog.at_level(logging.WARNING):
        with pytest.raises(RuntimeError, match="WebSocket reconnection failed after 10 attempts"):
            reconnect_with_backoff(failing_connect, max_attempts=10, initial_delay=1.0, max_delay=30.0)

    assert len(calls) == 10
    assert len(delays) == 9  # 9 delays between 10 attempts
    assert delays == [1.0, 2.0, 4.0, 8.0, 16.0, 30.0, 30.0, 30.0, 30.0]

    # Verify warning log format
    assert "WebSocket reconnect attempt 1/10 failed: Persistent network outage" in caplog.text
    assert "WebSocket reconnect attempt 10/10 failed: Persistent network outage" in caplog.text

    # Verify Telegram alert
    assert len(alerts) == 1
    assert "🚨 WEBSOCKET DOWN: All reconnection attempts failed" in alerts[0][0]
    assert alerts[0][1] == "websocket-reconnect-exhausted"
