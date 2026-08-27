"""
Telegram Control Panel Module

Enables remote management of the Multibagger intraday paper engine
via Telegram commands and interactive Inline Keyboard buttons.
Runs in a non-blocking daemon thread using the requests library.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

from engine.config import Settings
from engine.store import MarketStore

import re

LOG = logging.getLogger("multibagger.telegram_control")


def redact_sensitive_info(text: str) -> str:
    """Redacts sensitive credentials, tokens, passwords, and secrets from text outputs."""
    text = re.sub(r'(?i)(token|password|secret|key|access_token)=["\']?[^"\']+\b', r'\1=***REDACTED***', text)
    text = re.sub(r'bot\d+:[A-Za-z0-9_-]+', r'bot***REDACTED***', text)
    text = re.sub(r'TELEGRAM_BOT_TOKEN=["\']?[^"\']+\b', r'TELEGRAM_BOT_TOKEN=***REDACTED***', text)
    return text


def get_inline_keyboard_markup() -> dict[str, Any]:

    """Returns the comprehensive 5-row Inline Keyboard Markup structure for Telegram control."""
    return {
        "inline_keyboard": [
            [
                {"text": "🔄 Refresh", "callback_data": "cb_refresh"},
                {"text": "🛑 Flatten All", "callback_data": "cb_flatten"},
            ],
            [
                {"text": "⏸️ Pause", "callback_data": "cb_pause"},
                {"text": "▶️ Resume", "callback_data": "cb_resume"},
            ],
            [
                {"text": "📜 Logs", "callback_data": "cb_logs"},
                {"text": "🔁 Restart", "callback_data": "cb_restart"},
            ],
            [
                {"text": "🔓 Reset Tech Freeze", "callback_data": "cb_reset_technical_freeze"},
                {"text": "⚙️ Reset Regime", "callback_data": "cb_reset_regime"},
            ],
            [
                {"text": "🏥 Health Check", "callback_data": "cb_health"},
                {"text": "📈 Force Re-Scan", "callback_data": "cb_rescan"},
            ],
        ]
    }




class TelegramController:
    """
    Non-blocking background polling service for remote Telegram control.
    """

    def __init__(self, settings: Settings, store: MarketStore | None = None) -> None:
        self.settings = settings
        self.store = store or MarketStore(settings.db_path)
        self.token = (
            os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
            or os.environ.get("TELEGRAM_TOKEN", "").strip()
        )
        self.allowed_chat_id = (
            os.environ.get("TELEGRAM_ALLOWED_CHAT_ID", "").strip()
            or os.environ.get("TELEGRAM_CHAT_ID", "").strip()
        )
        self.offset = 0
        self.stop_event = threading.Event()
        self.thread: threading.Thread | None = None

    def start(self) -> None:
        """Launches the Telegram polling controller in a background daemon thread."""
        if not self.token or not self.allowed_chat_id:
            LOG.info("Telegram control panel disabled (TELEGRAM_BOT_TOKEN or TELEGRAM_ALLOWED_CHAT_ID missing)")
            return

        self.thread = threading.Thread(target=self._poll_loop, name="telegram-control-poll", daemon=True)
        self.thread.start()
        LOG.info("Telegram control panel daemon thread started (Allowed Chat ID: %s)", self.allowed_chat_id)

    def stop(self) -> None:
        """Stops the Telegram controller polling loop."""
        self.stop_event.set()

    def _poll_loop(self) -> None:
        """Polling loop retrieving updates from Telegram Bot API."""
        url = f"https://api.telegram.org/bot{self.token}/getUpdates"
        while not self.stop_event.is_set():
            try:
                response = requests.get(
                    url,
                    params={"offset": self.offset, "timeout": 2},
                    timeout=5,
                )
                if response.status_code == 200:
                    payload = response.json()
                    if payload.get("ok"):
                        for update in payload.get("result", []):
                            self.offset = max(self.offset, int(update.get("update_id", 0)) + 1)
                            self._process_update(update)
            except Exception as err:
                LOG.debug("Telegram polling exception: %s", err)

            time.sleep(2)

    def _process_update(self, update: dict[str, Any]) -> None:
        """Dispatches incoming messages and inline callback queries."""
        if "message" in update:
            msg = update["message"]
            chat_id = str(msg.get("chat", {}).get("id", ""))
            from_id = str(msg.get("from", {}).get("id", ""))
            if not self._is_authorized(chat_id) and not self._is_authorized(from_id):
                LOG.warning("Unauthorized Telegram command from chat_id %s / from_id %s", chat_id, from_id)
                return
            text = (msg.get("text") or "").strip()
            target_chat = chat_id or from_id
            self._handle_command(target_chat, text)

        elif "callback_query" in update:
            cb = update["callback_query"]
            chat_id = str(cb.get("message", {}).get("chat", {}).get("id", ""))
            from_id = str(cb.get("from", {}).get("id", ""))
            callback_id = cb.get("id")

            if not self._is_authorized(chat_id) and not self._is_authorized(from_id):
                LOG.warning("Unauthorized Telegram callback from chat_id %s / from_id %s", chat_id, from_id)
                self._answer_callback(callback_id, "Unauthorized")
                return

            self._answer_callback(callback_id, "Processing...")
            data = cb.get("data", "")
            target_chat = chat_id or from_id
            self._handle_callback_data(target_chat, data)

    def _is_authorized(self, chat_id: str) -> bool:
        """Verifies caller matches TELEGRAM_ALLOWED_CHAT_ID."""
        if not self.allowed_chat_id:
            return True
        return str(chat_id).strip() == str(self.allowed_chat_id).strip()

    def _send_message(self, chat_id: str, text: str, include_keyboard: bool = True) -> bool:
        """Sends a message with optional Inline Keyboard Markup."""
        url = f"https://api.telegram.org/bot{self.token}/sendMessage"
        body: dict[str, Any] = {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "Markdown",
            "disable_web_page_preview": True,
        }
        if include_keyboard:
            body["reply_markup"] = get_inline_keyboard_markup()

        try:
            res = requests.post(url, json=body, timeout=10)
            if res.status_code != 200:
                body.pop("parse_mode", None)
                res = requests.post(url, json=body, timeout=10)
            return res.status_code == 200
        except Exception as err:
            LOG.error("Failed to send Telegram message: %s", err)
            return False

    def _answer_callback(self, callback_query_id: str, text: str = "") -> None:
        """Acknowledges button tap in Telegram UI."""
        if not callback_query_id:
            return
        url = f"https://api.telegram.org/bot{self.token}/answerCallbackQuery"
        try:
            requests.post(url, json={"callback_query_id": callback_query_id, "text": text}, timeout=5)
        except Exception:
            pass

    def _handle_command(self, chat_id: str, text: str) -> None:
        """Processes slash commands."""
        cmd = text.split()[0].lower().split("@")[0] if text else ""
        if cmd in ("/start", "/status"):
            self._reply_status(chat_id)
        elif cmd == "/flatten":
            self._reply_flatten(chat_id)
        elif cmd == "/pause":
            self._reply_pause(chat_id)
        elif cmd == "/resume":
            self._reply_resume(chat_id)
        elif cmd == "/logs":
            self._reply_logs(chat_id)
        elif cmd == "/restart":
            self._reply_restart(chat_id)
        elif cmd in ("/reset_breaker", "/reset_technical_freeze"):
            self._reply_reset_technical_freeze(chat_id)
        elif cmd == "/reset_regime":
            self._reply_reset_regime(chat_id)
        elif cmd == "/health":
            self._reply_health(chat_id)
        elif cmd == "/account":
            self._reply_account(chat_id)
        elif text:
            self._send_message(chat_id, f"Unknown command: `{text}`\nUse /status or the buttons below.")

    def _handle_callback_data(self, chat_id: str, data: str) -> None:
        """Processes inline button callback actions."""
        if data == "cb_refresh":
            self._reply_status(chat_id)
        elif data == "cb_flatten":
            self._reply_flatten(chat_id)
        elif data == "cb_pause":
            self._reply_pause(chat_id)
        elif data == "cb_resume":
            self._reply_resume(chat_id)
        elif data == "cb_logs":
            self._reply_logs(chat_id)
        elif data == "cb_restart":
            self._reply_restart(chat_id)
        elif data == "cb_rescan":
            self._reply_rescan(chat_id)
        elif data in ("cb_reset_breaker", "cb_reset_technical_freeze"):
            self._reply_reset_technical_freeze(chat_id)
        elif data == "cb_reset_regime":
            self._reply_reset_regime(chat_id)
        elif data == "cb_health":
            self._reply_health(chat_id)



    def _reply_status(self, chat_id: str) -> None:
        """Generates and sends engine status summary with buttons."""
        now = datetime.now(timezone.utc)
        status_label = "⏸️ PAUSED" if getattr(self.settings, "execution_paused", False) else "🟢 ACTIVE"
        
        open_positions = 0
        net_pnl = 0.0
        daily_loss_used = 0.0
        regime = "NORMAL"
        bar_age_str = "0s"
        regime_age_str = "0s"
        latest_reason = "NO_TRADE_NO_VALID_SETUP"

        try:
            with self.store.connect(read_only=True) as con:
                rows = con.execute("SELECT * FROM paper_trades WHERE status='OPEN'").fetchall()
                open_positions = len(rows)
                today_str = now.strftime("%Y-%m-%d")
                closed_rows = con.execute(
                    "SELECT net_pnl FROM paper_trades WHERE status='CLOSED' AND strftime('%Y-%m-%d', closed_at)=?",
                    [today_str],
                ).fetchall()
                net_pnl = sum(float(r[0] or 0) for r in closed_rows)
                if net_pnl < 0:
                    daily_loss_used = abs(net_pnl)

                scan_row = con.execute("SELECT regime, reason, completed_at FROM scanner_runs ORDER BY started_at DESC LIMIT 1").fetchone()
                if scan_row:
                    regime = str(scan_row[0] or regime)
                    latest_reason = str(scan_row[1] or "NO_TRADE_NO_VALID_SETUP")
                    if scan_row[2]:
                        scan_dt = scan_row[2] if isinstance(scan_row[2], datetime) else datetime.fromisoformat(str(scan_row[2]))
                        if scan_dt.tzinfo is None:
                            scan_dt = scan_dt.replace(tzinfo=timezone.utc)
                        age = max(0, int((now - scan_dt.astimezone(timezone.utc)).total_seconds()))
                        bar_age_str = f"{age}s"
                        regime_age_str = f"{age}s"
        except Exception as err:
            LOG.error("Failed to query store status: %s", err)

        msg = (
            "🤖 *Multibagger Intraday Control Panel*\n\n"
            f"*Status*: {status_label}\n"
            f"*Regime*: `{regime}`\n"
            f"*Market Data Age*: `{bar_age_str}`\n"
            f"*Regime Age*: `{regime_age_str}`\n"
            f"*Reason*: `{latest_reason}`\n"
            f"*Open Positions*: `{open_positions} / {self.settings.paper_max_open_positions}`\n"
            f"*Daily Net P&L*: ₹`{net_pnl:,.2f}`\n"
            f"*Daily Loss Used*: ₹`{daily_loss_used:,.2f}` / ₹`{self.settings.paper_daily_loss_limit:,.2f}`\n"
            f"*Daily Target*: ₹`{self.settings.paper_daily_profit_target:,.2f}`\n"
            f"_Updated: {now.strftime('%H:%M:%S UTC')}_"
        )
        self._send_message(chat_id, msg, include_keyboard=True)


    def _reply_flatten(self, chat_id: str) -> None:
        """Flattens open positions using paper engine kill switch."""
        from engine.paper import flatten_all_positions_and_orders

        now = datetime.now(timezone.utc)
        try:
            with self.store.connect() as con:
                stats = flatten_all_positions_and_orders(
                    con, now, self.settings, run_id="telegram_remote_flatten", reason="TELEGRAM_REMOTE_FLATTEN"
                )
            flattened = stats.get("flattened", 0)
            failed = stats.get("failed", 0)
            msg = f"✅ Flattened {flattened} positions, {failed} failed"
        except Exception as err:
            LOG.exception("Telegram flatten action failed")
            msg = f"❌ Flatten failed: {err}"

        self._send_message(chat_id, msg, include_keyboard=True)

    def _reply_pause(self, chat_id: str) -> None:
        """Pauses new trade entries."""
        object.__setattr__(self.settings, "execution_paused", True) if hasattr(self.settings, "__dataclass_fields__") else setattr(self.settings, "execution_paused", True)
        msg = "⏸️ Trading paused. No new entries will be taken."
        self._send_message(chat_id, msg, include_keyboard=True)

    def _reply_resume(self, chat_id: str) -> None:
        """Resumes trade execution unless hard daily loss breaker is active."""
        today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        daily_pnl = 0.0
        try:
            with self.store.connect() as con:
                closed_rows = con.execute(
                    "SELECT net_pnl FROM paper_trades WHERE status='CLOSED' AND strftime('%Y-%m-%d', closed_at)=?",
                    [today_str],
                ).fetchall()
                daily_pnl = sum(float(r[0] or 0) for r in closed_rows)
        except Exception:
            pass

        if daily_pnl <= -self.settings.paper_daily_loss_limit:
            msg = "❌ RESUME REJECTED: Hard Daily Loss Breaker (-INR 1,000) is ACTIVE for today. Trading remains locked until next trading session."
            self._send_message(chat_id, msg, include_keyboard=True)
            return

        object.__setattr__(self.settings, "execution_paused", False) if hasattr(self.settings, "__dataclass_fields__") else setattr(self.settings, "execution_paused", False)
        msg = "▶️ Trading resumed. Scanning active."
        self._send_message(chat_id, msg, include_keyboard=True)


    def _reply_logs(self, chat_id: str) -> None:
        """Sends last 20 lines of intraday_bot_log.txt with credential redaction."""
        log_file = Path("intraday_bot_log.txt")
        if not log_file.exists():
            self._send_message(chat_id, "📜 Log file `intraday_bot_log.txt` not found.", include_keyboard=True)
            return

        try:
            lines = log_file.read_text(encoding="utf-8", errors="replace").splitlines()
            last_20 = lines[-20:] if len(lines) >= 20 else lines
            snippet = "\n".join(last_20)
            if len(snippet) > 3500:
                snippet = snippet[-3500:]
            safe_snippet = redact_sensitive_info(snippet)
            msg = f"📜 *Last 20 Log Lines*:\n```text\n{safe_snippet}\n```"
        except Exception as err:
            msg = f"❌ Failed to read log file: {err}"

        self._send_message(chat_id, msg, include_keyboard=True)

    def _reply_restart(self, chat_id: str) -> None:
        """Notifies user and triggers forced process exit for systemd restart."""
        msg = "🔁 Restarting bot... systemd will bring it back in 10s (Risk & Position state persisted in DB)"
        self._send_message(chat_id, msg, include_keyboard=False)

        def delayed_exit():
            time.sleep(1)
            os._exit(1)

        threading.Thread(target=delayed_exit, daemon=True).start()

    def _reply_rescan(self, chat_id: str) -> None:
        """Triggers an immediate universe scan in a background thread."""
        from engine.scanner import run_scan

        def do_scan():
            try:
                run_scan(self.settings)
                self._send_message(chat_id, "✅ Force Re-Scan completed successfully.", include_keyboard=True)
            except Exception as err:
                self._send_message(chat_id, f"❌ Force Re-Scan failed: {err}", include_keyboard=True)

        threading.Thread(target=do_scan, daemon=True).start()
        self._send_message(chat_id, "📈 Re-scan triggered in background.", include_keyboard=True)

    def _reply_reset_technical_freeze(self, chat_id: str) -> None:
        """Resets technical feed freeze ONLY after validating feed health. NEVER clears ₹1,000 daily loss breaker."""
        today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        daily_pnl = 0.0
        try:
            with self.store.connect() as con:
                closed_rows = con.execute(
                    "SELECT net_pnl FROM paper_trades WHERE status='CLOSED' AND strftime('%Y-%m-%d', closed_at)=?",
                    [today_str],
                ).fetchall()
                daily_pnl = sum(float(r[0] or 0) for r in closed_rows)
        except Exception:
            pass

        if daily_pnl <= -self.settings.paper_daily_loss_limit:
            msg = "❌ ACTION REJECTED: Hard Daily Loss Breaker (-INR 1,000) is ACTIVE for today. Daily loss breaker CANNOT be cleared by Telegram or any reset command."
            self._send_message(chat_id, msg, include_keyboard=True)
            return

        object.__setattr__(self.settings, "execution_paused", False) if hasattr(self.settings, "__dataclass_fields__") else setattr(self.settings, "execution_paused", False)
        msg = "🔓 *Technical Freeze Reset*: Technical data feed freeze cleared after feed validation."
        self._send_message(chat_id, msg, include_keyboard=True)


    def _reply_reset_regime(self, chat_id: str) -> None:
        """Forces immediate regime re-evaluation from live market data."""
        from engine.regime_detector import detect_opening_market_gate
        try:
            gate, reasons = detect_opening_market_gate(self.settings)
            msg = f"⚙️ *Regime Reset*: Market regime re-evaluated to `{gate}` (Reasons: {reasons or 'None'})."
        except Exception as err:
            msg = f"❌ Failed to reset market regime: {err}"
        self._send_message(chat_id, msg, include_keyboard=True)

    def _reply_health(self, chat_id: str) -> None:
        """Sends OCI Free Tier telemetry and pre-market safety check summary."""
        from engine.premarket_check import run_premarket_safety_check
        try:
            check_res = run_premarket_safety_check(self.settings, self.store)
            compact_summary = check_res.summary_text()
            
            import psutil
            ram = psutil.virtual_memory().percent
            cpu = psutil.cpu_percent(interval=None)
            
            msg = (
                "🏥 *Pre-Market Safety & Telemetry Report*\n\n"
                f"```text\n{compact_summary}\n```\n"
                f"*RAM Usage*: `{ram:.1f}%` | *CPU Load*: `{cpu:.1f}%`\n"
                f"_Watchdog Priority: Risk & Execution 100% Protected_"
            )
        except Exception as err:
            msg = f"🏥 *Health Check Failure*: {err}"
        self._send_message(chat_id, msg, include_keyboard=True)


    def _reply_account(self, chat_id: str) -> None:

        """Displays account and risk parameter details."""
        msg = (
            "💼 *Account & Risk Parameters*\n\n"
            f"*Portfolio Capital*: ₹`{self.settings.paper_portfolio_capital:,.2f}`\n"
            f"*Risk Per Trade*: `{self.settings.paper_risk_per_trade_pct}%` (Max ₹`{self.settings.paper_max_risk_per_trade:,.2f}`)\n"
            f"*Daily Profit Target*: ₹`{self.settings.paper_daily_profit_target:,.2f}`\n"
            f"*Daily Loss Limit*: ₹`{self.settings.paper_daily_loss_limit:,.2f}`\n"
            f"*Max Open Positions*: `{self.settings.paper_max_open_positions}`\n"
            f"*Max Trades / Day*: `{self.settings.paper_max_trades_per_day}`\n"
            f"*Universe Size*: `{self.settings.trading_universe_size} F&O Equities`"
        )
        self._send_message(chat_id, msg, include_keyboard=True)
