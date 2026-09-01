from __future__ import annotations

import logging
import os
import queue
import threading
import time
from pathlib import Path
from typing import Dict, Optional, Tuple, Any
import requests

logger = logging.getLogger("notifier")

ROOT = Path(__file__).resolve().parents[1]

def _load_env_tokens() -> Tuple[str, str]:
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.getenv("TELEGRAM_CHAT_ID", "").strip()

    if not token or not chat_id:
        for env_file_name in [".env.local", ".env"]:
            env_file = ROOT / env_file_name
            if env_file.exists():
                for line in env_file.read_text().splitlines():
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip("\"'")
                        if k == "TELEGRAM_BOT_TOKEN" and not token:
                            token = v
                        elif k == "TELEGRAM_CHAT_ID" and not chat_id:
                            chat_id = v
    return token, chat_id

class TelegramNotifierWorker:
    def __init__(self):
        self._queue: queue.Queue[str] = queue.Queue(maxsize=1000)
        self.sent_count = 0
        self.failed_count = 0
        self.is_running = False
        self._thread: Optional[threading.Thread] = None

    def start(self):
        if self.is_running:
            return
        self.is_running = True
        self._thread = threading.Thread(target=self._worker_loop, name="TelegramNotifierWorker", daemon=True)
        self._thread.start()
        logger.info("Telegram background notification worker started.")

    def stop(self, timeout: float = 2.0):
        self.is_running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=timeout)

    def enqueue_alert(self, message: str) -> bool:
        if not self.is_running:
            self.start()
        try:
            self._queue.put_nowait(message)
            return True
        except queue.Full:
            self.failed_count += 1
            logger.error("NOTIFIER_FAILURE: Telegram notification queue full. Message dropped.")
            return False

    def _worker_loop(self):
        token, chat_id = _load_env_tokens()
        while self.is_running or not self._queue.empty():
            try:
                message = self._queue.get(timeout=0.5)
            except queue.Empty:
                continue

            if not token or not chat_id:
                logger.info("[Telegram Notifier - Local Log Only]: %s", message)
                self.sent_count += 1
                self._queue.task_done()
                continue

            url = f"https://api.telegram.org/bot{token}/sendMessage"
            payload = {
                "chat_id": chat_id,
                "text": message,
                "parse_mode": "HTML",
                "disable_web_page_preview": True,
            }

            try:
                resp = requests.post(url, json=payload, timeout=3.0)
                if resp.status_code == 200:
                    self.sent_count += 1
                    logger.info("Telegram alert dispatched successfully.")
                else:
                    self.failed_count += 1
                    logger.warning("NOTIFIER_FAILURE: Telegram API returned HTTP %d: %s", resp.status_code, resp.text)
            except Exception as e:
                self.failed_count += 1
                logger.warning("NOTIFIER_FAILURE: Telegram alert dispatch failed: %s", e)
            finally:
                self._queue.task_done()

_global_notifier = TelegramNotifierWorker()
_global_notifier.start()

def send_telegram_alert(message: str) -> bool:
    """Truly non-blocking Telegram dispatch wrapper. Enqueues message into background thread and returns immediately."""
    return _global_notifier.enqueue_alert(message)

def get_notifier_stats() -> Dict[str, int]:
    return {
        "sent_count": _global_notifier.sent_count,
        "failed_count": _global_notifier.failed_count,
        "pending_count": _global_notifier._queue.qsize(),
    }

def shutdown_notifier(timeout: float = 2.0):
    _global_notifier.stop(timeout=timeout)


def send_telegram_inline_keyboard(message: str, reply_markup: dict) -> bool:
    """Sends a Telegram message with inline keyboard markup synchronously."""
    token, chat_id = _load_env_tokens()
    if not token or not chat_id:
        logger.info("[Telegram Inline Keyboard - Local Log Only]: %s | Markup: %s", message, reply_markup)
        return True
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": message,
        "parse_mode": "HTML",
        "reply_markup": reply_markup,
        "disable_web_page_preview": True,
    }
    try:
        resp = requests.post(url, json=payload, timeout=3.0)
        if resp.status_code == 200:
            logger.info("Telegram inline keyboard dispatched successfully.")
            return True
        logger.warning("Telegram inline keyboard API error %d: %s", resp.status_code, resp.text)
        return False
    except Exception as e:
        logger.warning("Telegram inline keyboard dispatch failed: %s", e)
        return False


def send_strategy_selected_telegram_alert(cand: Any) -> bool:
    """Sends notification-only Telegram alert when a strategy candidate is selected automatically."""
    p = cand.params
    source = getattr(cand, "backtest_source", "IN_HOUSE_ENGINE")
    direction = getattr(p, "direction", "LONG")
    msg = (
        f"<b>Strategy Selected</b> | Direction={direction} | ADX={int(p.adx_threshold)} | VWAP={p.vwap_mode} | "
        f"SL={p.stop_loss_pct:.1f}% | Target={p.target_pct:.1f}% | Entry={p.entry_time} | "
        f"Backtest Source={source} | P&L=₹{cand.backtest_pnl:,.0f} | Win={cand.win_rate:.0f}% | DD=₹{cand.max_drawdown:,.0f}\n\n"
        f"<i>Activated Automatically (#1 Rank: {cand.name})</i>"
    )
    return send_telegram_alert(msg)


def send_strategy_proposal_telegram_alert(cand: Any, current_idx: int = 0, total_count: int = 5) -> bool:
    """Sends Telegram strategy proposal formatted as specified with interactive inline action buttons."""
    p = cand.params
    source = getattr(cand, "backtest_source", "IN_HOUSE_ENGINE")
    direction = getattr(p, "direction", "LONG")
    msg = (
        f"<b>ALGORITHMIC BACKTEST SOURCE = {source}</b>\n\n"
        f"<b>Strategy proposed:</b> Direction={direction} | ADX={int(p.adx_threshold)} | VWAP={p.vwap_mode} | "
        f"SL={p.stop_loss_pct:.1f}% | Target={p.target_pct:.1f}% | Entry={p.entry_time} | "
        f"Backtest P&L=₹{cand.backtest_pnl:,.0f} | Win={cand.win_rate:.0f}% | DD=₹{cand.max_drawdown:,.0f}\n\n"
        f"<i>Candidate #{cand.rank} of {total_count} ({cand.name})</i>"
    )
    next_idx = (current_idx + 1) % max(total_count, 1)
    reply_markup = {
        "inline_keyboard": [
            [
                {"text": "✅ Accept Strategy", "callback_data": f"cb:accept:{cand.candidate_id}"},
                {"text": "🔄 Choose Another", "callback_data": f"cb:next:{next_idx}"},
            ],
            [
                {"text": "✏️ Select Parameters", "callback_data": f"cb:param_select:{cand.candidate_id}"},
                {"text": "❌ No Trade", "callback_data": "cb:notrade"},
            ]
        ]
    }
    return send_telegram_inline_keyboard(msg, reply_markup)


def handle_telegram_callback(callback_data: str, db_path: str) -> str:
    """Handles Telegram callback query actions from inline buttons."""
    from .intelligence import get_candidates_from_store, set_active_strategy, deactivate_active_strategy

    if callback_data.startswith("cb:accept:"):
        cand_id = callback_data.split(":", 2)[2]
        activated = set_active_strategy(cand_id, db_path, approved_by="TELEGRAM")
        if activated:
            p = activated.params
            summary = f"Source={activated.backtest_source} | Direction={p.direction} | ADX={int(p.adx_threshold)} | VWAP={p.vwap_mode} | SL={p.stop_loss_pct:.1f}% | Target={p.target_pct:.1f}% | Entry={p.entry_time}"
            msg = f"✅ <b>Strategy Accepted & Activated:</b> {activated.name}\n<code>{summary}</code>\nPaper execution enabled."
            send_telegram_alert(msg)
            return f"Strategy accepted: {activated.name}"
        return "Failed to activate strategy: candidate not found."

    elif callback_data.startswith("cb:next:"):
        try:
            idx = int(callback_data.split(":", 2)[2])
        except (IndexError, ValueError):
            idx = 0
        candidates = get_candidates_from_store(db_path)
        valid = [c for c in candidates if c.status != "REJECTED"]
        if not valid:
            send_telegram_alert("❌ No valid candidate strategies available.")
            return "No valid candidate strategies."
        target_cand = valid[idx % len(valid)]
        send_strategy_proposal_telegram_alert(target_cand, current_idx=idx, total_count=len(valid))
        return f"Proposed strategy candidate #{target_cand.rank}"

    elif callback_data.startswith("cb:param_select"):
        candidates = get_candidates_from_store(db_path)
        valid = [c for c in candidates if c.status != "REJECTED"]
        buttons = []
        for c in valid:
            p = c.params
            btn_text = f"Rank #{c.rank}: ADX={int(p.adx_threshold)} SL={p.stop_loss_pct}% TP={p.target_pct}% E={p.entry_time}"
            buttons.append([{"text": btn_text, "callback_data": f"cb:accept:{c.candidate_id}"}])
        buttons.append([{"text": "❌ No Trade", "callback_data": "cb:notrade"}])
        msg = "<b>Select Parameters:</b>\nChoose from pre-tested candidate sets (untested values restricted)."
        send_telegram_inline_keyboard(msg, {"inline_keyboard": buttons})
        return "Parameter selection menu sent."

    elif callback_data == "cb:notrade":
        deactivate_active_strategy(db_path)
        msg = "❌ <b>Trading Deactivated:</b> System state set to NO_TRADE. No orders will be submitted."
        send_telegram_alert(msg)
        return "Trading set to NO_TRADE."

    return f"Unknown callback query: {callback_data}"
