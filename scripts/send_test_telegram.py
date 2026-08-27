#!/usr/bin/env python3
import json
import urllib.request

TOKEN = "8526197794:AAFw50jwofc5l9J7fkwQfZDvBZ_pvWMVtcE"
CHAT_ID = "8424853134"

url = f"https://api.telegram.org/bot{TOKEN}/sendMessage"
payload = {
    "chat_id": CHAT_ID,
    "text": "🤖 Multibagger Intraday Control Panel Test\n\nStatus: 🟢 ACTIVE\nEngine: Weighted Opportunity Core\nRegime: STRONGLY_POSITIVE\nMarket Data: LIVE\n\nSystem responsive and online!",
    "reply_markup": {
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
                {"text": "🏥 Health Check", "callback_data": "cb_health"},
                {"text": "📈 Force Re-Scan", "callback_data": "cb_rescan"},
            ],
        ]
    }
}

req = urllib.request.Request(
    url,
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json"}
)

try:
    with urllib.request.urlopen(req, timeout=10) as response:
        res = json.loads(response.read().decode())
        print("TELEGRAM POST RESULT:", res)
except Exception as err:
    print("TELEGRAM POST ERROR:", err)
