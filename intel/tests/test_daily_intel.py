from __future__ import annotations

import ast
import json
import math
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

from intel import config as C
from intel import news, run, scoring, signals, store

ROOT = Path(__file__).resolve().parents[2]
IST = run.IST


def make_bars(end: date, n: int, start_px: float, daily: float, wiggle: float = 0.01, vol: float = 2e6):
    days, d = [], end
    while len(days) < n:
        if d.weekday() < 5:
            days.append(d)
        d -= timedelta(days=1)
    days.reverse()
    out, px = [], start_px
    for i, d in enumerate(days):
        px *= 1 + daily + wiggle * math.sin(i)
        out.append({"date": d.isoformat(), "open": px * 0.998, "high": px * 1.01, "low": px * 0.99,
                    "close": px, "volume": vol})
    return out


def bar(d: str, o: float, h: float, low: float, c: float):
    return {"date": d, "open": o, "high": h, "low": low, "close": c, "volume": 1e6}


# ---------- news ----------

UNIVERSE = [{"symbol": "TATASTEEL", "company": "Tata Steel Ltd."},
            {"symbol": "INFY", "company": "Infosys Ltd."},
            {"symbol": "LT", "company": "Larsen & Toubro Ltd."}]


def item(title: str, summary: str = "", hours_ago: float = 1.0):
    now = datetime(2026, 10, 19, 2, 30, tzinfo=timezone.utc)
    return news.Item("moneycontrol", title, summary, "https://example.test/a", now - timedelta(hours=hours_ago))


def test_extracts_named_analyst_call_with_levels():
    calls = news.extract_calls([item("Buy Tata Steel, target Rs 180, stop loss Rs 160: Sumeet Bagadia")],
                               news.SymbolMatcher(UNIVERSE))
    assert len(calls) == 1
    c = calls[0]
    assert (c.analyst, c.symbol, c.side, c.target, c.stop) == ("Sumeet Bagadia", "TATASTEEL", "BUY", 180.0, 160.0)


def test_rejects_unmapped_stock_and_inconsistent_levels():
    m = news.SymbolMatcher(UNIVERSE)
    assert news.extract_calls([item("Buy Unknown Widgets, target 50, stop loss 40: Jane Doe")], m) == []
    assert news.extract_calls([item("Buy Infosys, target 1400, stop loss 1500: Jane Doe")], m) == []


def test_desk_attribution_when_no_analyst_named():
    calls = news.extract_calls([item("Sell INFY with target ₹1,420 and stop loss ₹1,510")],
                               news.SymbolMatcher(UNIVERSE))
    assert calls[0].analyst == "moneycontrol desk" and calls[0].side == "SELL"


def test_catalyst_tone_and_macro_flag():
    tone, macro = news.catalysts([item("Larsen & Toubro bags order worth Rs 5,000 crore"),
                                  item("Infosys profit falls 5% on weak demand"),
                                  item("RBI policy today: what to expect")], news.SymbolMatcher(UNIVERSE))
    assert tone == {"LT": 1, "INFY": -1}
    assert macro is True


def test_since_drops_undated_and_old_items():
    now = datetime(2026, 10, 19, 3, 0, tzinfo=timezone.utc)
    old = item("x", hours_ago=30)
    undated = news.Item("s", "y", "", "", None)
    new = item("z", hours_ago=1)
    assert news.since([old, undated, new], now - timedelta(hours=15), now) == [new]


def test_parse_feed_reads_rss_items():
    xml = ("<rss><channel><item><title>Buy LT, target 4000, stop loss 3700: A B</title>"
           "<link>https://x.test/1</link><pubDate>Mon, 19 Oct 2026 07:30:00 +0530</pubDate>"
           "<description>&lt;p&gt;text&lt;/p&gt;</description></item></channel></rss>")
    items = news.parse_feed("etmarkets", xml)
    assert items[0].title.startswith("Buy LT") and items[0].published.utcoffset() == timedelta(hours=5, minutes=30)
    assert items[0].summary == "text"


# ---------- signals ----------

def test_mood_and_short_term_picks():
    end = date(2026, 10, 16)
    nifty = make_bars(end, 300, 20000, 0.001)
    vix = make_bars(end, 300, 14, -0.0005, wiggle=0.0)
    mood = signals.market_mood(nifty, vix, 70.0, 500.0)
    assert mood.state == "RISK_ON" and mood.nifty_above_200dma
    strong = signals.stock_stats("AAA", make_bars(end, 300, 100, 0.003, wiggle=0.002))
    flat = signals.stock_stats("BBB", make_bars(end, 300, 100, 0.0, wiggle=0.002))
    picks, reason = signals.short_term_picks([strong, flat], mood, set(), {})
    assert reason is None and [p["symbol"] for p in picks] == ["AAA"]
    p = picks[0]
    assert p["stop"] < p["ref"] < p["target"] and p["entry"] > p["ref"]
    assert signals.short_term_picks([strong], mood, {"AAA"}, {})[1] == "NO_QUALIFYING_MOMENTUM"


def test_risk_off_means_no_trade():
    end = date(2026, 10, 16)
    nifty = make_bars(end, 300, 20000, -0.001)
    vix = make_bars(end, 300, 14, 0.004, wiggle=0.0)
    mood = signals.market_mood(nifty, vix, 30.0, -800.0)
    assert mood.state == "RISK_OFF"
    assert signals.short_term_picks([], mood, set(), {}) == ([], "MOOD_RISK_OFF")
    assert signals.long_term_picks([], mood, set(), {}, True)[1] == "NIFTY_BELOW_200DMA"
    assert signals.etf_pick(mood, None)[0][0]["symbol"] == C.ETF_IDLE
    assert signals.etf_pick(mood, C.ETF_IDLE) == ([], f"HOLD_{C.ETF_IDLE}")
    assert signals.options_direction(mood) == "BEAR_PUT"


def test_intraday_needs_aligned_catalyst():
    end = date(2026, 10, 16)
    nifty = make_bars(end, 300, 20000, 0.001)
    vix = make_bars(end, 300, 14, -0.0005, wiggle=0.0)
    mood = signals.market_mood(nifty, vix, 70.0, 500.0)
    st = signals.stock_stats("AAA", make_bars(end, 300, 100, 0.001))
    picks, _ = signals.intraday_picks({"AAA": st}, {"AAA"}, mood, {"AAA": 1}, {}, False)
    assert picks[0]["side"] == "BUY"
    assert signals.intraday_picks({"AAA": st}, {"AAA"}, mood, {"AAA": -1}, {}, False)[1] == "NO_ALIGNED_CATALYST"
    assert signals.intraday_picks({"AAA": st}, {"AAA"}, mood, {"AAA": 1}, {}, True)[1] == "MACRO_EVENT_DAY"
    assert signals.intraday_picks({"AAA": st}, set(), mood, {"AAA": 1}, {}, False)[0] == []


def chain_row(strike, spot, ce, pe):
    def leg(b, a):
        return {"key": f"K{strike}", "bid": b, "ask": a, "ltp": (a + b) / 2, "oi": 1}
    return {"strike": strike, "spot": spot, "ce": leg(*ce), "pe": leg(*pe)}


def test_select_spread_and_expiry_payoff():
    chain = [chain_row(25000, 25010, (150, 151), (140, 141)), chain_row(25200, 25010, (70, 71), (260, 262)),
             chain_row(24800, 25010, (260, 262), (65, 66))]
    s, reason = signals.select_spread(chain, "BULL_CALL")
    assert reason is None and s["debit"] == 81 and s["sell_strike"] == 25200
    assert signals.spread_value_at_expiry("BULL_CALL", 25000, 25200, 25300) == 200
    assert signals.spread_value_at_expiry("BEAR_PUT", 25000, 24800, 24900) == 100
    wide = [chain_row(25000, 25010, (100, 140), (140, 141)), chain_row(25200, 25010, (70, 71), (1, 2))]
    assert signals.select_spread(wide, "BULL_CALL")[1] == "OPTION_SPREAD_TOO_WIDE"


# ---------- scoring ----------

PICK = {"id": 1, "run_date": "2026-10-19", "category": "SHORT_TERM", "side": "BUY", "ref": 100.0,
        "entry": 101.0, "stop": 96.0, "target": 108.0, "max_hold_days": 3}


def test_target_stop_and_time_exits():
    win = scoring.score_equity_pick(PICK, [bar("2026-10-19", 100, 103, 99, 102), bar("2026-10-21", 102, 109, 101, 108)])
    assert win["exit_reason"] == "TARGET" and win["net_pnl"] > 0 and win["costs"] > 0
    both = scoring.score_equity_pick(PICK, [bar("2026-10-19", 100, 110, 95, 100)])
    assert both["exit_reason"] == "STOP"  # same bar: assume the worse outcome
    gap = scoring.score_equity_pick(PICK, [bar("2026-10-19", 100, 101, 99, 100), bar("2026-10-21", 90, 91, 89, 90)])
    assert gap["exit_price"] == 90  # gap through stop fills at the open
    timed = scoring.score_equity_pick(PICK, [bar(f"2026-10-2{i}", 100, 101, 99, 100.5) for i in (1, 2, 3)])
    assert timed["status"] == "NOT_FILLED"  # first bar is not the decision session
    timed = scoring.score_equity_pick(PICK, [bar("2026-10-19", 100, 101, 99, 100)] +
                                      [bar(f"2026-10-2{i}", 100, 101, 99, 100.5) for i in (1, 2)])
    assert timed["exit_reason"] == "TIME_EXIT" and timed["exit_price"] == 100.5
    still = scoring.score_equity_pick(PICK, [bar("2026-10-19", 100, 101, 99, 100)])
    assert still["status"] == "OPEN"


def test_entry_limit_and_intraday_gap():
    assert scoring.score_equity_pick(PICK, [bar("2026-10-19", 102, 103, 101, 102)])["exit_reason"] == \
        "OPEN_ABOVE_ENTRY_LIMIT"
    intra = {**PICK, "category": "INTRADAY", "max_hold_days": 1, "side": "SELL", "stop": 102.0, "target": 96.0}
    assert scoring.score_equity_pick(intra, [bar("2026-10-19", 104, 105, 103, 104)])["exit_reason"] == "GAP_TOO_LARGE"
    res = scoring.score_equity_pick(intra, [bar("2026-10-19", 101, 101.5, 98, 99)])
    assert res["exit_reason"] == "TIME_EXIT" and res["gross_pnl"] > 0


def test_analyst_call_scoring_and_weights():
    call = {"side": "BUY", "stop": 95.0, "target": 110.0}
    r = scoring.score_call(call, [bar("2026-10-19", 100, 111, 99, 108)], 10)
    assert r["exit_reason"] == "TARGET" and r["r_multiple"] == 2.0
    assert scoring.score_call(call, [bar("2026-10-19", 112, 113, 111, 112)], 10)["status"] == "NOT_FILLED"
    w = scoring.analyst_weights([{"analyst": "A", "r_multiple": 1.0}] * 12 + [{"analyst": "B", "r_multiple": 2.0}] * 3)
    assert w["A"]["proven"] and not w["B"]["proven"]  # B has too few calls, however good


def test_metrics_and_kill_rule():
    closed = [{"id": i, "fill_date": "2026-10-19", "exit_date": "2026-10-20", "notional": 1e5,
               "net_pnl": x, "gross_pnl": x + 10, "costs": 10} for i, x in enumerate([100, -50, 200, -100])]
    m = scoring.metrics(closed)
    assert m["net_pnl"] == 150 and m["win_rate"] == 0.5 and m["profit_factor"] == 2.0
    assert m["expectancy"] == 37.5 and m["max_drawdown"] == 100 and m["costs"] == 40
    assert scoring.kill_check(m) is None
    losing = [dict(c, id=i, net_pnl=-1) for i, c in enumerate(closed * 8)]
    assert scoring.kill_check(scoring.metrics(losing)).startswith("FAILED")


# ---------- end to end with recorded-shape fake data ----------

class FakeFetcher(run.Fetcher):
    def __init__(self, end: date, stale: bool = False):
        _, keys, _ = run.load_universe()
        self.by_key = {v: k for k, v in keys.items()}
        self.end = end - timedelta(days=1) if stale else end
        self.series = {}

    def candles(self, key, start, end):
        if key not in self.series:
            sym = self.by_key.get(key, key)
            trend = 0.003 if sym in ("RELIANCE", "TCS", "INFY") else 0.0003
            vix = "VIX" in key
            self.series[key] = make_bars(self.end, 320, 14 if vix else 1000, -0.0005 if vix else trend,
                                         wiggle=0.0 if vix else 0.002, vol=5e6)
        return [b for b in self.series[key] if b["date"] <= end.isoformat()]

    def feeds(self):
        published = datetime(2026, 10, 19, 1, 0, tzinfo=timezone.utc)
        return [news.Item("moneycontrol", "Buy Infosys, target Rs 1,500, stop loss Rs 1,300: Jane Analyst", "",
                          "https://example.test/c", published)], []

    def fii_dii(self):
        return self.end.isoformat(), 1200.0


def test_morning_logs_picks_once_and_scores_next_day(tmp_path, monkeypatch):
    conn = store.connect(tmp_path / "intel.db")
    now = datetime(2026, 10, 19, 3, 10, tzinfo=timezone.utc)  # 08:40 IST Monday
    code, rep = run.morning(conn, FakeFetcher(date(2026, 10, 16)), date(2026, 10, 19), now)
    assert code == run.OK, rep.get("degraded")
    assert rep["mood"]["state"] == "RISK_ON"
    cats = {p["category"] for p in rep["picks"]}
    assert {"SHORT_TERM", "ETF", "OPTIONS"} <= cats
    assert set(rep["picks"][0]) >= {"entry", "stop", "target"}
    assert rep["no_trade"]["LONG_TERM"] == "REBALANCE_MONTHLY_ONLY"
    assert rep["analyst_calls_logged"] == 1
    n = conn.execute("SELECT COUNT(*) FROM picks").fetchone()[0]
    run.morning(conn, FakeFetcher(date(2026, 10, 16)), date(2026, 10, 19), now)
    assert conn.execute("SELECT COUNT(*) FROM picks").fetchone()[0] == n  # idempotent rerun

    # 2026-10-20 is a holiday; next session is 2026-10-21 and sees the 10-19 bar.
    code, rep2 = run.morning(conn, FakeFetcher(date(2026, 10, 19)), date(2026, 10, 21),
                             datetime(2026, 10, 21, 3, 10, tzinfo=timezone.utc))
    assert code == run.OK, rep2["degraded"]
    statuses = {r["status"] for r in store.rows(conn, "SELECT status FROM picks WHERE run_date='2026-10-19'"
                                                      " AND category IN ('SHORT_TERM','ETF')")}
    assert statuses <= {"OPEN", "CLOSED", "NOT_FILLED"} and statuses
    assert store.rows(conn, "SELECT status FROM analyst_calls")[0]["status"] in ("OPEN", "CLOSED", "NOT_FILLED")


def test_stale_market_data_blocks_every_category(tmp_path):
    conn = store.connect(tmp_path / "intel.db")
    code, rep = run.morning(conn, FakeFetcher(date(2026, 10, 16), stale=True), date(2026, 10, 19),
                            datetime(2026, 10, 19, 3, 10, tzinfo=timezone.utc))
    assert code == run.BLOCKED and rep["picks"] == []
    assert set(rep["no_trade"].values()) == {"MARKET_DATA_STALE"} and len(rep["no_trade"]) == len(C.CATEGORIES)


def test_holiday_is_not_a_session(tmp_path):
    conn = store.connect(tmp_path / "intel.db")
    code, rep = run.morning(conn, FakeFetcher(date(2026, 10, 16)), date(2026, 10, 20),
                            datetime(2026, 10, 20, 3, 10, tzinfo=timezone.utc))
    assert code == run.OK and rep["status"] == "NOT_A_SESSION"


def test_options_fill_prices_spread_from_live_quotes(tmp_path):
    conn = store.connect(tmp_path / "intel.db")
    fetch = FakeFetcher(date(2026, 10, 16))
    run.morning(conn, fetch, date(2026, 10, 19), datetime(2026, 10, 19, 3, 10, tzinfo=timezone.utc))
    fetch.expiries = lambda: [{"expiry": "2026-10-20", "lot_size": 65}, {"expiry": "2026-10-27", "lot_size": 65}]
    fetch.chain = lambda exp: [chain_row(25000, 25010, (150, 151), (140, 141)),
                               chain_row(25200, 25010, (70, 71), (260, 262))]
    code, out = run.options_fill(conn, fetch, date(2026, 10, 19), datetime(2026, 10, 19, 3, 55, tzinfo=timezone.utc))
    assert code == run.OK and out["expiry"] == "2026-10-27" and out["debit"] == 81
    row = store.rows(conn, "SELECT * FROM picks WHERE category='OPTIONS'")[0]
    assert row["status"] == "OPEN" and row["qty"] == 65


# ---------- safety ----------

def _sources():
    return sorted((ROOT / "intel").glob("*.py")) + [ROOT / "features/upstox/python/daily_data.py"]


def test_no_order_endpoint_in_model_code():
    for path in _sources():
        text = path.read_text()
        for bad in ("/order/place", "/order/multi", "/order/modify", "place_order", "placeOrder"):
            assert bad not in text, f"{path}: {bad}"


def test_runs_on_vm_python_3_10():
    for path in _sources():
        ast.parse(path.read_text(), feature_version=(3, 10))
