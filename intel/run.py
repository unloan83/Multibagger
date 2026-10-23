"""Daily market-intelligence job.

    python -m intel.run morning        # before 09:00 IST: score open picks, then log today's picks or NO TRADE
    python -m intel.run options-fill   # after 09:15 IST: price today's option spread from live bid/ask
    python -m intel.run report         # print the paper scorecard
    python -m intel.run probe          # check every data source once (no secrets printed)

Exit codes: 0 ok, 10 degraded (an optional source failed), 20 blocked (fail-closed), 30 error.
Paper only: nothing here can place a broker order.
"""
from __future__ import annotations

import argparse
import fcntl
import json
import subprocess
import sys
from dataclasses import asdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from engine.trading_calendar import load_authoritative_calendar  # noqa: E402
from features.upstox.python import daily_data  # noqa: E402

from . import config as C  # noqa: E402
from . import news, scoring, signals, sources, store  # noqa: E402

IST = ZoneInfo("Asia/Kolkata")
OK, DEGRADED, BLOCKED, ERROR = 0, 10, 20, 30


class Blocked(Exception):
    pass


# ---------- calendar ----------

class Calendar:
    def __init__(self, holidays: set[str]):
        self.holidays = holidays
        self.years = {h[:4] for h in holidays}

    def is_session(self, d: date) -> bool:
        if str(d.year) not in self.years:
            raise Blocked(f"CALENDAR_NOT_COVERED_{d.year}")
        return d.weekday() < 5 and d.isoformat() not in self.holidays

    def prev_session(self, d: date) -> date:
        d -= timedelta(days=1)
        while not self.is_session(d):
            d -= timedelta(days=1)
        return d

    def sessions_between(self, start: date, end: date) -> int:
        """Sessions in (start, end]."""
        n, d = 0, start
        while d < end:
            d += timedelta(days=1)
            n += self.is_session(d)
        return n


def load_calendar() -> Calendar:
    ok, _checksum, holidays, meta = load_authoritative_calendar()
    if not ok:
        raise Blocked(f"CALENDAR_UNVERIFIED: {meta.get('error')}")
    return Calendar(set(holidays))


# ---------- universe ----------

def load_wide_universe() -> list[dict[str, Any]]:
    """Nifty 500 and related index members: the stocks an analyst call may name."""
    return json.loads((ROOT / "data/market-universe.json").read_text())


def load_universe() -> tuple[list[dict[str, Any]], dict[str, str], set[str]]:
    """Nifty 200 scan members, NSE ISIN-based Upstox keys for the wide universe, and the F&O-liquid set."""
    wide = load_wide_universe()
    members = [u for u in wide if "NIFTY 200" in u.get("sources", [])]
    isin = {s["symbol"]: s["isin"] for s in json.loads((ROOT / "data/multibagger-universe.json").read_text())
            ["securities"] if "NSE" in str(s.get("exchange", "")).split("/") and s.get("isin")}
    keys = {u["symbol"]: f"NSE_EQ|{isin[u['symbol']]}" for u in wide if u["symbol"] in isin}
    for etf in (C.ETF_RISK, C.ETF_IDLE):
        if etf in isin:
            keys[etf] = f"NSE_EQ|{isin[etf]}"
    fno = set(json.loads((ROOT / "data/active-intraday-universe.json").read_text()).get("symbols", []))
    return members, keys, fno


# ---------- data access (injectable for tests) ----------

class Fetcher:
    def candles(self, key: str, start: date, end: date) -> list[dict[str, Any]]:
        return daily_data.daily_candles(key, start.isoformat(), end.isoformat())

    def feeds(self) -> tuple[list[news.Item], list[str]]:
        items, errors = [], []
        for source, urls in news.FEEDS.items():
            for url in urls:
                try:
                    items += news.parse_feed(source, sources.fetch_text(url))
                except Exception as err:  # one bad feed must not stop the run
                    errors.append(f"{source}:{type(err).__name__}")
        return items, errors

    def fii_dii(self) -> tuple[str, float]:
        return sources.fetch_fii_dii()

    def expiries(self) -> list[dict[str, Any]]:
        return daily_data.option_expiries()

    def chain(self, expiry: str) -> list[dict[str, Any]]:
        return daily_data.option_chain(expiry)


def _code_sha() -> str | None:
    try:
        return subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"], capture_output=True,
                              text=True, timeout=5).stdout.strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


# ---------- scoring of earlier picks ----------

def score_open(conn, bars_by_symbol: dict[str, list[dict]], nifty: list[dict]) -> None:
    def after(sym: str, d: str) -> list[dict]:
        return [b for b in bars_by_symbol.get(sym, []) if b["date"] >= d]

    for p in store.rows(conn, "SELECT * FROM picks WHERE status IN ('PENDING','OPEN')"):
        p.update(json.loads(p["detail"] or "{}"))
        if p["category"] == "OPTIONS":
            res = scoring.score_option_pick(p, [b for b in nifty if b["date"] >= p["fill_date"]])
        elif p["category"] == "ETF":
            nxt = store.rows(conn, "SELECT fill_date, fill_price FROM picks WHERE category='ETF' AND run_date>?"
                             " AND fill_date IS NOT NULL ORDER BY run_date LIMIT 1", (p["run_date"],))
            res = scoring.score_etf(p, after(p["symbol"], p["run_date"]),
                                    (nxt[0]["fill_date"], nxt[0]["fill_price"]) if nxt else None)
        else:
            res = scoring.score_equity_pick(p, after(p["symbol"], p["run_date"]))
        if res:
            store.update(conn, "picks", p["id"], res)

    for c in store.rows(conn, "SELECT * FROM analyst_calls WHERE status IN ('PENDING','OPEN')"):
        res = scoring.score_call(c, after(c["symbol"], c["run_date"]),
                                 C.MAX_HOLD_DAYS.get(c["horizon"], C.MAX_HOLD_DAYS["SHORT_TERM"]))
        if res:
            store.update(conn, "analyst_calls", c["id"], res)


def scorecard(conn) -> dict[str, Any]:
    closed = store.rows(conn, "SELECT * FROM picks WHERE status='CLOSED'")
    by_cat = {cat: scoring.metrics([p for p in closed if p["category"] == cat]) for cat in C.CATEGORIES}
    calls = store.rows(conn, "SELECT * FROM analyst_calls WHERE status='CLOSED'")
    return {"categories": by_cat, "all": scoring.metrics(closed), "analysts": scoring.analyst_weights(calls),
            "cost_model": C.COST_MODEL_VERSION}


# ---------- morning ----------

def morning(conn, fetch: Fetcher, today: date, now: datetime) -> tuple[int, dict[str, Any]]:
    cal = load_calendar()
    if not cal.is_session(today):
        return OK, {"run_date": today.isoformat(), "status": "NOT_A_SESSION"}
    prev = cal.prev_session(today)
    run_date, logged_at = today.isoformat(), now.astimezone(timezone.utc).isoformat()
    degraded: list[str] = []
    start = prev - timedelta(days=420)

    members, keys, fno = load_universe()
    try:
        nifty = fetch.candles(daily_data.NIFTY_KEY, start, prev)
        vix = fetch.candles(daily_data.VIX_KEY, start, prev)
    except Exception as err:
        nifty, vix = [], []
        degraded.append(f"INDEX_CANDLES:{err}")

    scan = {u["symbol"] for u in members}
    wanted = scan | {C.ETF_RISK, C.ETF_IDLE}
    for r in store.rows(conn, "SELECT DISTINCT symbol FROM picks WHERE status IN ('PENDING','OPEN') UNION "
                              "SELECT DISTINCT symbol FROM analyst_calls WHERE status IN ('PENDING','OPEN')"):
        wanted.add(r["symbol"])
    bars: dict[str, list[dict]] = {}
    failures = 0
    for sym in sorted(wanted) if nifty else []:  # no index data means the source is down: do not hammer it
        if sym not in keys:
            continue
        try:
            bars[sym] = fetch.candles(keys[sym], start, prev)
            failures = 0
        except Exception as err:
            degraded.append(f"CANDLES_{sym}:{err}")
            failures += 1
            if failures >= 5:
                degraded.append("CANDLES_ABORTED_AFTER_5_CONSECUTIVE_FAILURES")
                break

    score_open(conn, bars, nifty)
    card = scorecard(conn)
    states = store.category_states(conn)
    for cat in C.CATEGORIES:
        verdict = scoring.kill_check(card["categories"][cat])
        if verdict and states.get(cat) != "FAILED":
            store.set_category_state(conn, cat, "FAILED", logged_at, verdict)
            states[cat] = "FAILED"

    picks: list[dict[str, Any]] = []
    no_trade: dict[str, str] = {}
    report: dict[str, Any] = {"run_date": run_date, "prev_session": prev.isoformat(), "model": C.MODEL_VERSION,
                              "state": C.STRATEGY_STATE}

    local = now.astimezone(IST)
    if local.hour * 60 + local.minute >= 9 * 60 + 15:
        # The open is already known; a pick logged now could not be scored honestly.
        for cat in C.CATEGORIES:
            no_trade[cat] = "AFTER_OPEN_SCORING_ONLY"
        status = OK
    elif not nifty or not vix or nifty[-1]["date"] != prev.isoformat() or vix[-1]["date"] != prev.isoformat():
        for cat in C.CATEGORIES:
            no_trade[cat] = "MARKET_DATA_STALE"
        report["blocked"] = "MARKET_DATA_STALE"
        status = BLOCKED
    else:
        status = OK
        fresh_bars = {s: b for s, b in bars.items() if b and b[-1]["date"] == prev.isoformat()}
        quarantined = sorted(set(bars) - set(fresh_bars))
        report["quarantined"] = quarantined

        items, feed_errors = fetch.feeds()
        degraded += [f"FEED_{e}" for e in feed_errors]
        # Only news published after the previous close is actionable at today's open.
        prev_close = datetime(prev.year, prev.month, prev.day, 15, 30, tzinfo=IST)
        recent = news.since(items, prev_close, now)
        matcher = news.SymbolMatcher(members)
        # Calls are measured from today's open, so anything published in the last 30 hours is usable.
        calls = news.extract_calls(news.since(items, now - timedelta(hours=30), now),
                                   news.SymbolMatcher(load_wide_universe()))
        for call in calls:
            store.insert_call(conn, run_date, call)
        tone, macro = news.catalysts(recent, matcher)
        events = json.loads((ROOT / "data/no-trade-events.json").read_text()).get("events", [])
        macro = macro or any(e.get("date") == run_date and e.get("type") in ("RBI_MPC", "UNION_BUDGET")
                             for e in events)

        fii = None
        try:
            fii_date, fii_net = fetch.fii_dii()
            fii = fii_net if fii_date == prev.isoformat() else None
            if fii is None:
                degraded.append(f"FII_DII_STALE_{fii_date}")
        except Exception as err:
            degraded.append(f"FII_DII:{type(err).__name__}")

        universe_bars = {s: b for s, b in fresh_bars.items() if s in scan}
        mood = signals.market_mood(nifty, vix, signals.breadth(universe_bars), fii)
        stats = [st for s, b in universe_bars.items() if (st := signals.stock_stats(s, b))]
        by_sym = {s.symbol: s for s in stats}
        negative = {s for s, t in tone.items() if t < 0}

        proven = {k for k, v in card["analysts"].items() if v["proven"]}
        boost: dict[str, float] = {}
        intraday_side: dict[str, str] = {}
        for call in calls:
            if call.analyst not in proven:
                continue
            w = card["analysts"][call.analyst]["shrunk_r"]
            if call.horizon == "INTRADAY":
                intraday_side[call.symbol] = call.side
            elif call.side == "BUY":
                boost[call.symbol] = boost.get(call.symbol, 0.0) + w

        first_of_month = prev.month != today.month
        results = {
            "INTRADAY": signals.intraday_picks(by_sym, fno, mood, tone, intraday_side, macro),
            "SHORT_TERM": signals.short_term_picks(stats, mood, negative, boost),
            "LONG_TERM": signals.long_term_picks(stats, mood, negative, boost, first_of_month),
        }
        etf_open = store.rows(conn, "SELECT symbol FROM picks WHERE category='ETF' AND status IN"
                                    " ('PENDING','OPEN') ORDER BY run_date DESC LIMIT 1")
        results["ETF"] = signals.etf_pick(mood, etf_open[0]["symbol"] if etf_open else None)
        structure = signals.options_direction(mood)
        results["OPTIONS"] = ([{"category": "OPTIONS", "symbol": "NIFTY", "side": "BUY", "entry": 0.0,
                                "stop": 0.0, "target": 0.0, "score": float(mood.score),
                                "reasons": [structure, f"MOOD_{mood.state}"], "structure": structure}], None) \
            if structure else ([], "NO_MARKET_DIRECTION")

        for cat, (cat_picks, reason) in results.items():
            if states.get(cat) == "FAILED":
                no_trade[cat] = "CATEGORY_FAILED"
            elif cat_picks:
                picks += cat_picks
            else:
                no_trade[cat] = reason or "NO_SIGNAL"
        report.update(mood=asdict(mood), news_items=len(recent), analyst_calls_logged=len(calls),
                      proven_analysts=sorted(proven), macro_event=macro)

    for p in picks:
        store.insert_pick(conn, run_date, logged_at, p, C.MODEL_VERSION,
                          "PENDING_FILL" if p["category"] == "OPTIONS" else "PENDING")
    for cat, reason in no_trade.items():
        store.insert_no_trade(conn, run_date, cat, reason)
    report.update(picks=picks, no_trade=no_trade, degraded=degraded, category_states=states,
                  scorecard=card)
    if status == OK and degraded:
        status = DEGRADED
    return status, report


# ---------- options fill ----------

def options_fill(conn, fetch: Fetcher, today: date, now: datetime) -> tuple[int, dict[str, Any]]:
    cal = load_calendar()
    rows = store.rows(conn, "SELECT * FROM picks WHERE run_date=? AND category='OPTIONS' AND status='PENDING_FILL'",
                      (today.isoformat(),))
    if not rows:
        return OK, {"run_date": today.isoformat(), "status": "NOTHING_TO_FILL"}
    p = rows[0]
    detail = json.loads(p["detail"] or "{}")
    local = now.astimezone(IST)
    if not (9 * 60 + 15 <= local.hour * 60 + local.minute <= 10 * 60):
        store.update(conn, "picks", p["id"], {"status": "NOT_FILLED", "exit_reason": "OUTSIDE_FILL_WINDOW"})
        return BLOCKED, {"status": "OUTSIDE_FILL_WINDOW"}
    try:
        expiries = [e for e in fetch.expiries()
                    if cal.sessions_between(today, date.fromisoformat(e["expiry"])) >= C.OPTIONS_MIN_DAYS_TO_EXPIRY]
        if not expiries:
            raise Blocked("NO_ELIGIBLE_EXPIRY")
        exp = expiries[0]
        spread, reason = signals.select_spread(fetch.chain(exp["expiry"]), detail["structure"])
    except Exception as err:
        spread, reason = None, str(err) if isinstance(err, Blocked) else f"OPTION_DATA:{err}"
    if not spread:
        store.update(conn, "picks", p["id"], {"status": "NOT_FILLED", "exit_reason": reason})
        return OK, {"status": "NOT_FILLED", "reason": reason}  # a recorded NO TRADE, not a job failure
    lot = int(exp["lot_size"])
    if lot <= 0:
        store.update(conn, "picks", p["id"], {"status": "NOT_FILLED", "exit_reason": "LOT_SIZE_MISSING"})
        return OK, {"status": "NOT_FILLED", "reason": "LOT_SIZE_MISSING"}
    detail.update(spread, expiry=exp["expiry"], lot_size=lot, priced_at=now.astimezone(timezone.utc).isoformat())
    store.update(conn, "picks", p["id"], {
        "status": "OPEN", "detail": json.dumps(detail), "fill_date": today.isoformat(),
        "fill_price": spread["debit"], "qty": lot, "notional": spread["debit"] * lot,
        "entry": spread["debit"], "stop": 0.0, "target": C.OPTIONS_WIDTH_POINTS})
    return OK, {"status": "FILLED", **detail}


# ---------- probe ----------

def probe(fetch: Fetcher) -> tuple[int, dict[str, Any]]:
    out: dict[str, Any] = {}
    end = datetime.now(IST).date()

    def attempt(name: str, fn: Callable[[], Any]) -> None:
        try:
            out[name] = fn()
        except Exception as err:
            out[name] = f"FAIL {type(err).__name__}: {err}"

    attempt("nifty_last_bar", lambda: fetch.candles(daily_data.NIFTY_KEY, end - timedelta(days=10), end)[-1])
    attempt("vix_last_bar", lambda: fetch.candles(daily_data.VIX_KEY, end - timedelta(days=10), end)[-1])
    _, keys, _ = load_universe()
    out["universe_keys"] = len(keys)
    attempt("reliance_last_bar", lambda: fetch.candles(keys["RELIANCE"], end - timedelta(days=10), end)[-1])
    attempt("fii_dii", fetch.fii_dii)
    items, errors = fetch.feeds()
    out["feed_items"], out["feed_errors"] = len(items), errors
    out["calls_in_feeds"] = [asdict(c) for c in news.extract_calls(items, news.SymbolMatcher(load_wide_universe()))][:10]
    attempt("option_expiries", lambda: fetch.expiries()[:3])
    failed = [k for k, v in out.items() if isinstance(v, str) and v.startswith("FAIL")]
    out["failed"] = failed
    return (DEGRADED if failed or errors else OK), out


# ---------- CLI ----------

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="intel.run")
    ap.add_argument("command", choices=["morning", "options-fill", "report", "probe"])
    args = ap.parse_args(argv)
    now = datetime.now(timezone.utc)
    today = now.astimezone(IST).date()
    C.HOME.mkdir(parents=True, exist_ok=True)
    fetch = Fetcher()
    if args.command == "probe":
        code, out = probe(fetch)
        print(json.dumps(out, indent=2, default=str))
        return code
    with open(C.HOME / "intel.lock", "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("ANOTHER_RUN_IN_PROGRESS", file=sys.stderr)
            return BLOCKED
        conn = store.connect(C.DB_PATH)
        try:
            if args.command == "report":
                out = {"scorecard": scorecard(conn), "category_states": store.category_states(conn),
                       "today": store.rows(conn, "SELECT category, symbol, side, entry, stop, target, status"
                                                 " FROM picks WHERE run_date=?", (today.isoformat(),)),
                       "no_trade_today": store.rows(conn, "SELECT category, reason FROM no_trades WHERE run_date=?",
                                                    (today.isoformat(),))}
                print(json.dumps(out, indent=2, default=str))
                return OK
            kind = args.command
            conn.execute("INSERT OR REPLACE INTO runs (run_date, kind, started_at, status, model_version, code_sha)"
                         " VALUES (?,?,?,?,?,?)", (today.isoformat(), kind, now.isoformat(), "RUNNING",
                                                   C.MODEL_VERSION, _code_sha()))
            conn.commit()
            try:
                fn = morning if kind == "morning" else options_fill
                code, out = fn(conn, fetch, today, now)
            except Blocked as err:
                code, out = BLOCKED, {"blocked": str(err)}
            except Exception as err:
                conn.rollback()
                code, out = ERROR, {"error": f"{type(err).__name__}: {err}"}
            status = {OK: "SUCCESS", DEGRADED: "DEGRADED", BLOCKED: "BLOCKED"}.get(code, "ERROR")
            conn.execute("UPDATE runs SET finished_at=?, status=?, detail=? WHERE run_date=? AND kind=?",
                         (datetime.now(timezone.utc).isoformat(), status, json.dumps(out, default=str)[:200000],
                          today.isoformat(), kind))
            conn.commit()
            reports = C.HOME / "reports"
            reports.mkdir(exist_ok=True)
            path = reports / f"{today.isoformat()}-{kind}.json"
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps(out, indent=2, default=str))
            tmp.replace(path)
            print(json.dumps({"status": status, "report": str(path),
                              "picks": [{k: p.get(k) for k in ("category", "symbol", "side", "entry", "stop", "target")}
                                        for p in out.get("picks", [])],
                              "no_trade": out.get("no_trade"), "degraded": out.get("degraded"),
                              "blocked": out.get("blocked"), "error": out.get("error")}, indent=2, default=str))
            return code
        finally:
            conn.close()


if __name__ == "__main__":
    sys.exit(main())
