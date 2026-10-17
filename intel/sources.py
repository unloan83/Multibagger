"""Public, keyless market sources: NSE FII/DII cash flows and news RSS feeds."""
from __future__ import annotations

import http.cookiejar
import json
from datetime import datetime
from typing import Any
from urllib.request import HTTPCookieProcessor, Request, build_opener

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"


def fetch_text(url: str, timeout: float = 15.0) -> str:
    opener = build_opener()
    with opener.open(Request(url, headers={"User-Agent": UA}), timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def parse_fii_dii(payload: list[dict[str, Any]]) -> tuple[str, float]:
    """Return (trade_date ISO, FII + DII net cash value in ₹ crore)."""
    dates, net = set(), 0.0
    for row in payload:
        cat = str(row.get("category", "")).upper()
        if not (cat.startswith("FII") or cat.startswith("DII")):
            continue
        dates.add(datetime.strptime(row["date"], "%d-%b-%Y").date().isoformat())
        net += float(str(row["netValue"]).replace(",", ""))
    if len(dates) != 1:
        raise ValueError("FII_DII_DATES_INCONSISTENT")
    return dates.pop(), round(net, 2)


def fetch_fii_dii(timeout: float = 15.0) -> tuple[str, float]:
    jar = http.cookiejar.CookieJar()
    opener = build_opener(HTTPCookieProcessor(jar))
    headers = {"User-Agent": UA, "Accept": "application/json", "Referer": "https://www.nseindia.com/"}
    opener.open(Request("https://www.nseindia.com/", headers=headers), timeout=timeout).read()
    with opener.open(Request("https://www.nseindia.com/api/fiidiiTradeReact", headers=headers),
                     timeout=timeout) as resp:
        return parse_fii_dii(json.loads(resp.read().decode("utf-8")))
