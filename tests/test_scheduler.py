from datetime import datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from engine.collector import (
    _nonblocking_lock,
    _notify_scan_blocker,
    _run_locked_job,
    _upstox_scan_message,
    scheduled_upstox_job,
)
from scripts.options_quant_scheduler import scheduled_options_job
from scripts.options_quant_scheduler import notify_completed
from scripts.telegram_notify import send_telegram_message


IST = ZoneInfo("Asia/Kolkata")


def test_upstox_scan_is_15_minutes_and_options_stagger_slot_is_not_used():
    assert scheduled_upstox_job(datetime(2026, 8, 17, 9, 20, tzinfo=IST)) == "RISK_MONITOR"
    assert scheduled_upstox_job(datetime(2026, 8, 17, 9, 35, tzinfo=IST)) == "FULL_SCAN"
    assert scheduled_upstox_job(datetime(2026, 8, 17, 9, 28, tzinfo=IST)) is None
    assert scheduled_upstox_job(datetime(2026, 8, 17, 9, 43, tzinfo=IST)) is None
    assert scheduled_upstox_job(datetime(2026, 8, 17, 9, 22, tzinfo=IST)) == "RISK_MONITOR"


def test_scheduled_full_scan_invokes_unified_execution_engine(tmp_path, monkeypatch):
    scheduled_at = datetime(2026, 8, 17, 9, 35, tzinfo=IST)
    job_type = scheduled_upstox_job(scheduled_at)
    invoked = []

    class Store:
        def start_job(self, *_args):
            pass

        def finish_job(self, *_args):
            pass

    def run_scan(settings, **_kwargs):
        invoked.append(settings.enabled_agents)
        return {"status": "NO_TRADE", "signals": [], "paperTrading": {}}

    monkeypatch.setattr("engine.collector.run_scan", run_scan)
    monkeypatch.setattr("engine.collector.send_telegram_message", lambda *_args, **_kwargs: True)
    settings = SimpleNamespace(enabled_agents=("UNIFIED_OPPORTUNITY_ENGINE",))

    _run_locked_job(Store(), settings, job_type, scheduled_at, 240, tmp_path / "paper.lock")

    assert invoked == [("UNIFIED_OPPORTUNITY_ENGINE",)]


def test_shared_job_lock_is_nonblocking(tmp_path):
    path = tmp_path / "paper.lock"
    with _nonblocking_lock(path) as first:
        assert first is True
        with _nonblocking_lock(path) as overlapping:
            assert overlapping is False


def test_options_full_scan_is_staggered_eight_minutes_after_upstox():
    assert scheduled_options_job(datetime(2026, 8, 17, 9, 28, tzinfo=IST)) == "RISK_MONITOR"
    assert scheduled_options_job(datetime(2026, 8, 17, 9, 43, tzinfo=IST)) == "FULL_SCAN"
    assert scheduled_options_job(datetime(2026, 8, 17, 9, 20, tzinfo=IST)) is None
    assert scheduled_options_job(datetime(2026, 8, 17, 9, 35, tzinfo=IST)) is None
    assert scheduled_options_job(datetime(2026, 8, 17, 9, 26, tzinfo=IST)) == "RISK_MONITOR"


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


def test_upstox_scan_summary_and_operational_blocker_are_explicit(monkeypatch):
    result = {
        "status": "NO_TRADE", "reason": "REGIME_INPUT_UNAVAILABLE", "signals": [],
        "paperTrading": {"openPositions": [], "entryRejections": [], "dailyMetrics": {"netPnl": 0},
                         "dailyProfitTarget": 4000, "targetReached": False},
    }
    now = datetime(2026, 8, 17, 9, 35, tzinfo=IST)
    assert "Reason: REGIME_INPUT_UNAVAILABLE" in _upstox_scan_message(result, now, 1250)
    sent = []
    monkeypatch.setattr("engine.collector.send_telegram_message",
                        lambda message, **kwargs: sent.append((message, kwargs)) or True)
    assert _notify_scan_blocker(result, now) is True
    assert "entries blocked — action required" in sent[0][0]
    assert sent[0][1]["cooldown_seconds"] == 1800
    assert _notify_scan_blocker({"reason": "NO_VALID_SETUP"}, now) is False
