#!/usr/bin/env python3
"""
Standing Telegram Remote Control Daemon.
Runs continuous long-polling for Telegram bot control panel.
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
    print("Launching Multibagger Telegram Daemon...")
    ctrl.start()
    
    try:
        while True:
            time.sleep(1)
    except (KeyboardInterrupt, SystemExit):
        ctrl.stop()

if __name__ == "__main__":
    main()
