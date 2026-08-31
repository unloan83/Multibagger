from __future__ import annotations

import logging
import os
import queue
import threading
import time
from pathlib import Path
from typing import Dict, Optional, Tuple
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
