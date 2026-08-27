#!/usr/bin/env python3
"""
Standalone Telegram Bot Poller.
Processes all pending updates from Telegram API queue and responds to /status and button callbacks.
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.config import Settings
from scripts.telegram_control import TelegramController



def main():
    settings = Settings.from_env()
    ctrl = TelegramController(settings)
    print("Starting Telegram Poller Daemon...")
    ctrl.start()
    
    # Run for 30 seconds to consume all pending updates in Telegram queue
    print("Polling for 30 seconds to consume queued messages...")
    time.sleep(30)
    ctrl.stop()
    print("Polling complete.")

if __name__ == "__main__":
    main()
