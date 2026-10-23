"""News feeds: headline catalysts and named-analyst calls from mainstream market news RSS feeds.

Only published news articles are read (no Telegram/WhatsApp tip groups). Every extracted call keeps its
source URL so it can be traced. Extraction favours precision: an item without an unambiguous stock,
action and price levels is not a call.
"""
from __future__ import annotations

import html
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Iterable

FEEDS = {
    "moneycontrol": [
        "https://www.moneycontrol.com/rss/marketreports.xml",
        "https://www.moneycontrol.com/rss/buzzingstocks.xml",
    ],
    "etmarkets": ["https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms"],
    "business_standard": ["https://www.business-standard.com/rss/markets-106.rss"],
    "cnbctv18": ["https://www.cnbctv18.com/commonfeeds/v1/cne/rss/market.xml"],
    # Zee Business answers 403 to the VM (2026-10-23); its RSS is left out until a reachable feed is found.
}

# Brokerages named in rating calls; aliases map to one name so each track record is counted once.
BROKERS = {
    "goldman sachs": "Goldman Sachs", "morgan stanley": "Morgan Stanley", "jpmorgan": "JPMorgan",
    "jp morgan": "JPMorgan", "clsa": "CLSA", "jefferies": "Jefferies", "nomura": "Nomura", "ubs": "UBS",
    "citi": "Citi", "macquarie": "Macquarie", "bernstein": "Bernstein", "hsbc": "HSBC", "bofa": "BofA",
    "bank of america": "BofA", "kotak institutional": "Kotak Institutional Equities",
    "motilal oswal": "Motilal Oswal", "mofsl": "Motilal Oswal", "icici securities": "ICICI Securities",
    "axis securities": "Axis Securities", "axis direct": "Axis Securities", "jm financial": "JM Financial",
    "emkay": "Emkay", "nuvama": "Nuvama", "pl capital": "PL Capital", "prabhudas lilladher": "PL Capital",
    "sharekhan": "Sharekhan", "hdfc securities": "HDFC Securities", "anand rathi": "Anand Rathi",
    "choice broking": "Choice Broking", "elara": "Elara", "antique": "Antique", "investec": "Investec",
    "bnp paribas": "BNP Paribas", "incred": "InCred", "centrum": "Centrum", "phillipcapital": "PhillipCapital",
    "sbi securities": "SBI Securities", "geojit": "Geojit", "ventura": "Ventura", "iifl": "IIFL",
}
_BUY_WORDS = re.compile(r"\b(buy|accumulate|outperform|overweight|top(?: \w+)? pick)\b", re.I)
_SELL_WORDS = re.compile(r"\b(sell(?![- ]off)|reduce|underperform|underweight)\b", re.I)
_TARGET = re.compile(r"target(?: price)?(?: of| to| at)?\s*(?:rs\.?|₹|inr)\s*([\d,]+(?:\.\d+)?)"
                     r"|(?:rs\.?|₹|inr)\s*([\d,]+(?:\.\d+)?)\s*target", re.I)

POSITIVE = ("bags order", "wins order", "order win", "secures order", "upgrade", "profit jumps", "profit rises",
            "net profit up", "beats estimates", "record high", "approval", "buyback", "bonus issue",
            "stake buy", "raises guidance", "surges", "rallies", "soars")
NEGATIVE = ("downgrade", "profit falls", "profit declines", "net loss", "loss widens", "misses estimates",
            "probe", "raid", "fraud", "penalty", "default", "resigns", "pledge", "plunges", "slumps",
            "tanks", "sebi order", "ban", "cuts guidance", "block deal", "stake sale", "ofs")
MACRO_TODAY = ("rbi policy", "monetary policy", "fed decision", "fomc", "union budget", "election result",
               "exit poll", "gdp data", "cpi data", "inflation data")

_NUM = r"(?:rs\.?|₹|inr)?\s*([\d,]+(?:\.\d+)?)"
_CALL = re.compile(
    r"\b(?P<action>buy|sell|accumulate|short)\b\s+(?P<stock>[A-Za-z0-9&.' \-]{2,40}?)\s*[,;:]?\s*"
    r"(?:with\s+|for\s+)?(?:a\s+)?(?:target|tgt)(?:\s+price)?\s*(?:of|at)?\s*" + _NUM +
    r"[,;]?\s*(?:and\s+|with\s+)?(?:a\s+)?(?:stop[\s-]?loss|sl)\s*(?:of|at)?\s*" + _NUM,
    re.IGNORECASE,
)
_ANALYST_TAIL = re.compile(r"[:|\-–—]\s*(?P<name>[A-Z][a-zA-Z.]+(?:\s+[A-Z][a-zA-Z.]+){1,3})\s*$")
_ANALYST_VERB = re.compile(
    r"(?P<name>[A-Z][a-zA-Z.]+(?:\s+[A-Z][a-zA-Z.]+){1,3})\s+(?:recommends|suggests|says|advises|bets)\b")
_STOP_WORDS = {"Stocks", "Stock", "Market", "Markets", "Nifty", "Sensex", "Today", "Buy", "Sell", "Trade"}


@dataclass
class Item:
    source: str
    title: str
    summary: str
    link: str
    published: datetime | None


@dataclass
class AnalystCall:
    analyst: str
    source: str
    symbol: str
    side: str
    target: float
    stop: float
    horizon: str  # INTRADAY | SHORT_TERM | LONG_TERM
    link: str
    published: str


def parse_feed(source: str, xml_text: str) -> list[Item]:
    root = ET.fromstring(xml_text)
    out = []
    for node in root.iter("item"):
        def text(tag: str) -> str:
            el = node.find(tag)
            return html.unescape(re.sub(r"<[^>]+>", " ", el.text or "")).strip() if el is not None else ""
        published = None
        raw = text("pubDate")
        if raw:
            try:
                published = parsedate_to_datetime(raw)
                if published.tzinfo is None:
                    published = published.replace(tzinfo=timezone.utc)
            except (TypeError, ValueError):
                published = None
        out.append(Item(source, text("title"), text("description"), text("link"), published))
    return out


def since(items: Iterable[Item], start: datetime, now: datetime) -> list[Item]:
    """Items published in [start, now]. Undated items are dropped: an undatable call cannot be scored honestly."""
    return [i for i in items if i.published and start <= i.published <= now]


def _norm(name: str) -> str:
    name = re.sub(r"[^a-z0-9& ]", " ", name.lower())
    name = re.sub(r"\b(ltd|limited|india|the|co|corp|corporation|company|inc)\b", " ", name)
    return re.sub(r"\s+", " ", name).strip()


class SymbolMatcher:
    """Map a stock mention to an NSE symbol by exact symbol or normalised company name."""

    def __init__(self, universe: list[dict[str, Any]]):
        self.by_symbol = {u["symbol"].upper(): u["symbol"] for u in universe}
        self.by_name: dict[str, str] = {}
        for u in universe:
            key = _norm(u.get("company") or u.get("name") or "")
            if key:
                self.by_name[key] = u["symbol"]

    def match(self, mention: str) -> str | None:
        raw = mention.strip().strip(".'")
        if raw.upper().replace(" ", "") in self.by_symbol:
            return self.by_symbol[raw.upper().replace(" ", "")]
        key = _norm(raw)
        if not key:
            return None
        if key in self.by_name:
            return self.by_name[key]
        hits = {sym for name, sym in self.by_name.items() if name.startswith(key + " ") and len(key) >= 4}
        return hits.pop() if len(hits) == 1 else None

    def mentions(self, text: str) -> set[str]:
        """Symbols whose full normalised company name appears in the text."""
        t = f" {_norm(text)} "
        return {sym for name, sym in self.by_name.items() if len(name) >= 5 and f" {name} " in t}


def _horizon(text: str, entry_hint: float | None, target: float) -> str:
    low = text.lower()
    if "intraday" in low or "today" in low:
        return "INTRADAY"
    if "long term" in low or "long-term" in low or (entry_hint and abs(target / entry_hint - 1) >= 0.25):
        return "LONG_TERM"
    return "SHORT_TERM"


def _analyst(text: str, source: str) -> str:
    for rx in (_ANALYST_TAIL, _ANALYST_VERB):
        m = rx.search(text)
        if m and m.group("name").split()[0] not in _STOP_WORDS:
            return m.group("name").strip()
    return f"{source} desk"


def extract_calls(items: Iterable[Item], matcher: SymbolMatcher) -> list[AnalystCall]:
    calls = []
    for item in items:
        for text in (item.title, f"{item.title}. {item.summary}"):
            found = False
            for m in _CALL.finditer(text):
                symbol = matcher.match(m.group("stock"))
                if not symbol:
                    continue
                target, stop = float(m.group(3).replace(",", "")), float(m.group(4).replace(",", ""))
                side = "SELL" if m.group("action").lower() in ("sell", "short") else "BUY"
                if target <= 0 or stop <= 0 or (side == "BUY") != (target > stop):
                    continue
                calls.append(AnalystCall(
                    analyst=_analyst(item.title, item.source), source=item.source, symbol=symbol, side=side,
                    target=target, stop=stop, horizon=_horizon(text, None, target), link=item.link,
                    published=item.published.isoformat() if item.published else ""))
                found = True
            if found:
                break
    calls += extract_broker_calls(items, matcher)
    unique = {(c.analyst, c.symbol, c.side, c.target, c.stop): c for c in calls}
    return list(unique.values())


def extract_broker_calls(items: Iterable[Item], matcher: SymbolMatcher) -> list[AnalystCall]:
    """Brokerage rating calls ("MOFSL reiterates Sell on Cyient, target ₹1,020"). They carry a target but no stop,
    so they are stored with stop 0 and scored on target-or-time. Anything ambiguous is skipped: one broker, one
    stock, one direction and one target price, or no call."""
    calls = []
    for item in items:
        text = f"{item.title}. {item.summary}"
        low = text.lower()
        brokers = {name for alias, name in BROKERS.items() if re.search(rf"\b{re.escape(alias)}\b", low)}
        targets = {float((a or b).replace(",", "")) for a, b in _TARGET.findall(text)}
        buy, sell = bool(_BUY_WORDS.search(text)), bool(_SELL_WORDS.search(text))
        if len(brokers) != 1 or len(targets) != 1 or buy == sell:
            continue
        stocks = matcher.mentions(item.title) or matcher.mentions(text)
        if len(stocks) != 1:
            continue
        calls.append(AnalystCall(
            analyst=brokers.pop(), source=item.source, symbol=stocks.pop(), side="BUY" if buy else "SELL",
            target=targets.pop(), stop=0.0, horizon="POSITIONAL", link=item.link,
            published=item.published.isoformat() if item.published else ""))
    return calls


def catalysts(items: Iterable[Item], matcher: SymbolMatcher) -> tuple[dict[str, int], bool]:
    """Net headline tone per symbol, and whether a market-moving macro event is flagged for today."""
    tone: dict[str, int] = {}
    macro = False
    for item in items:
        low = f"{item.title} {item.summary}".lower()
        if "today" in low and any(k in low for k in MACRO_TODAY):
            macro = True
        score = sum(k in low for k in POSITIVE) - sum(k in low for k in NEGATIVE)
        if score == 0:
            continue
        for sym in matcher.mentions(item.title):
            tone[sym] = tone.get(sym, 0) + (1 if score > 0 else -1)
    return tone, macro
