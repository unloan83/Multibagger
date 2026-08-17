from datetime import datetime
from zoneinfo import ZoneInfo

from engine.collector import _nonblocking_lock, scheduled_upstox_job
from scripts.options_quant_scheduler import scheduled_options_job
from scripts.options_quant_scheduler import notify_completed
from scripts.telegram_notify import send_telegram_message


IST = ZoneInfo("Asia/Kolkata")


def test_upstox_scan_is_15_minutes_and_options_stagger_slot_is_not_used():
    assert scheduled_upstox_job(datetime(2026, 8, 17, 9, 20, tzinfo=IST)) == "FULL_SCAN"
    assert scheduled_upstox_job(datetime(2026, 8, 17, 9, 35, tzinfo=IST)) == "FULL_SCAN"
    assert scheduled_upstox_job(datetime(2026, 8, 17, 9, 25, tzinfo=IST)) is None
    assert scheduled_upstox_job(datetime(2026, 8, 17, 9, 22, tzinfo=IST)) == "RISK_MONITOR"


def test_shared_job_lock_is_nonblocking(tmp_path):
    path = tmp_path / "paper.lock"
    with _nonblocking_lock(path) as first:
        assert first is True
        with _nonblocking_lock(path) as overlapping:
            assert overlapping is False


def test_options_full_scan_is_staggered_five_minutes_after_upstox():
    assert scheduled_options_job(datetime(2026, 8, 17, 9, 25, tzinfo=IST)) == "FULL_SCAN"
    assert scheduled_options_job(datetime(2026, 8, 17, 9, 40, tzinfo=IST)) == "FULL_SCAN"
    assert scheduled_options_job(datetime(2026, 8, 17, 9, 20, tzinfo=IST)) == "RISK_MONITOR"


def test_telegram_notification_is_cooled_down(tmp_path, monkeypatch):
    monkeypatch.setenv("TELEGRAM_TOKEN", "123456789:abcdefghijklmnopqrstuvwxyz")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "123456789")
    monkeypatch.setenv("TELEGRAM_NOTIFICATION_STATE", str(tmp_path / "telegram-state.json"))
    sent = []
    monkeypatch.setattr("scripts.telegram_notify._post", lambda token, chat, message: sent.append(message) or True)
    assert send_telegram_message("first", event_key="failure", cooldown_seconds=900) is True
    assert send_telegram_message("duplicate", event_key="failure", cooldown_seconds=900) is False
    assert sent == ["first"]


def test_options_full_scan_notifies_but_routine_monitor_does_not(monkeypatch):
    sent = []
    monkeypatch.setattr(
        "scripts.options_quant_scheduler.send_telegram_message",
        lambda message, **kwargs: sent.append(message) or True,
    )
    summary = {
        "direction": None, "openPositions": 0, "dailyNetPnl": 0,
        "dailyProfitTarget": 3000, "targetReached": False,
    }
    now = datetime(2026, 8, 17, 9, 25, tzinfo=IST)
    notify_completed("FULL_SCAN", now, 1250, summary, None)
    notify_completed("RISK_MONITOR", now, 200, summary, summary)
    assert len(sent) == 1
    assert "Options Quant full scan completed" in sent[0]
