from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from scripts.telegram_control import TelegramController, get_inline_keyboard_markup


def test_get_inline_keyboard_markup_structure():
    markup = get_inline_keyboard_markup()
    assert "inline_keyboard" in markup
    rows = markup["inline_keyboard"]
    assert len(rows) == 5
    assert rows[0][0]["callback_data"] == "cb_refresh"
    assert rows[0][1]["callback_data"] == "cb_flatten"
    assert rows[1][0]["callback_data"] == "cb_pause"
    assert rows[1][1]["callback_data"] == "cb_resume"
    assert rows[2][0]["callback_data"] == "cb_logs"
    assert rows[2][1]["callback_data"] == "cb_restart"
    assert rows[3][0]["callback_data"] == "cb_reset_technical_freeze"
    assert rows[3][1]["callback_data"] == "cb_reset_regime"

    assert rows[4][0]["callback_data"] == "cb_health"
    assert rows[4][1]["callback_data"] == "cb_rescan"



def test_telegram_controller_authorization(monkeypatch, tmp_path):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "fake_token")
    monkeypatch.setenv("TELEGRAM_ALLOWED_CHAT_ID", "123456")

    store = MagicMock()
    settings = SimpleNamespace(
        execution_paused=False,
        paper_max_open_positions=3,
        paper_daily_loss_limit=1000.0,
        paper_daily_profit_target=3000.0,
        market_data_provider="upstox",
        db_path=tmp_path / "test.duckdb",
    )
    ctrl = TelegramController(settings, store=store)

    assert ctrl._is_authorized("123456")
    assert not ctrl._is_authorized("999999")


def test_telegram_controller_pause_and_resume(monkeypatch, tmp_path):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "fake_token")
    monkeypatch.setenv("TELEGRAM_ALLOWED_CHAT_ID", "123456")

    sent_messages = []
    def mock_post(url, json=None, timeout=None):
        sent_messages.append((url, json))
        res = MagicMock()
        res.status_code = 200
        return res

    monkeypatch.setattr("requests.post", mock_post)

    store = MagicMock()
    settings = SimpleNamespace(
        execution_paused=False,
        paper_max_open_positions=3,
        paper_daily_loss_limit=1000.0,
        paper_daily_profit_target=3000.0,
        market_data_provider="upstox",
        db_path=tmp_path / "test.duckdb",
    )
    ctrl = TelegramController(settings, store=store)

    # Pause
    ctrl._handle_command("123456", "/pause")
    assert settings.execution_paused is True
    assert "Trading paused" in sent_messages[-1][1]["text"]

    # Resume
    ctrl._handle_command("123456", "/resume")
    assert settings.execution_paused is False
    assert "Trading resumed" in sent_messages[-1][1]["text"]


def test_telegram_controller_unauthorized_command(monkeypatch, tmp_path):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "fake_token")
    monkeypatch.setenv("TELEGRAM_ALLOWED_CHAT_ID", "123456")

    sent_messages = []
    def mock_post(url, json=None, timeout=None):
        sent_messages.append((url, json))
        res = MagicMock()
        res.status_code = 200
        return res

    monkeypatch.setattr("requests.post", mock_post)

    store = MagicMock()
    settings = SimpleNamespace(
        execution_paused=False,
        paper_max_open_positions=3,
        paper_daily_loss_limit=1000.0,
        paper_daily_profit_target=3000.0,
        market_data_provider="upstox",
        db_path=tmp_path / "test.duckdb",
    )
    ctrl = TelegramController(settings, store=store)

    update = {
        "message": {
            "chat": {"id": 999999},
            "text": "/flatten",
        }
    }
    ctrl._process_update(update)
    assert len(sent_messages) == 0  # Ignored because chat ID is unauthorized
