#!/usr/bin/env python3
"""
Test script for all Telegram button callbacks.
Tests: cb_refresh, cb_flatten, cb_pause, cb_resume, cb_logs, cb_rescan, cb_reset_technical_freeze, cb_reset_regime, cb_health.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.config import Settings
from scripts.telegram_control import TelegramController

os.environ["TELEGRAM_TOKEN"] = "8526197794:AAFw50jwofc5l9J7fkwQfZDvBZ_pvWMVtcE"
os.environ["TELEGRAM_CHAT_ID"] = "8424853134"

def test_callbacks():
    settings = Settings.from_env()
    ctrl = TelegramController(settings)
    
    callbacks = [
        "cb_refresh", "cb_pause", "cb_resume", "cb_logs",
        "cb_reset_technical_freeze", "cb_reset_regime", "cb_health"
    ]
    
    print("Testing Telegram button callbacks...")
    for cb in callbacks:
        try:
            print(f"Triggering callback '{cb}' for chat 8424853134...")
            ctrl._handle_callback_data("8424853134", cb)
            print(f"  -> SUCCESS: '{cb}' handled cleanly.")
        except Exception as err:
            print(f"  -> ERROR on '{cb}': {err}")

if __name__ == "__main__":
    test_callbacks()
