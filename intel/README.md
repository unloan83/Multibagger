# Daily market intelligence (`daily-intel-v1`, SHADOW / paper only)

One job per trading day, 08:40 IST on the Breeze VM:

1. Scores every open paper pick and analyst call against real daily bars (Upstox historical candles).
2. Reads market mood: Nifty trend (20/50/200-day averages), India VIX level and 5-day change, breadth
   (% of Nifty 200 above the 50-day average), FII+DII net cash (NSE).
3. Reads news RSS from Moneycontrol, ET Markets, Business Standard and CNBC-TV18: headline tone per stock and
   macro-event days (news since the previous close), plus calls from the last 30 hours of two kinds:
   trader calls with target and stop, and brokerage rating calls ("MOFSL reiterates Sell on Cyient, target ₹1,020").
   Zee Business answers 403 to the VM and NSE FII/DII answers 403 as well; mood runs without FII/DII.
4. Logs picks per category with entry, stop and target, or a `NO TRADE` reason. Picks are write-once.

A second job at 09:25 IST prices the Nifty option spread from live bid/ask (needs `UPSTOX_ACCESS_TOKEN` or
`UPSTOX_ANALYTICS_TOKEN` in `.env`; without it options record `NOT_FILLED`).

## Rules that keep it honest

- Stale index data blocks every category (`MARKET_DATA_STALE`); stale stocks are quarantined, not guessed.
- Equity picks fill at the next open only if the open respects the entry limit (intraday: gap ≤ 3%). When one
  daily bar touches both stop and target, the stop is assumed first.
- Analyst calls are scored like picks (enter at the next open, the analyst's own levels). Brokerage calls have
  no stop: they exit at the target or after 63 sessions, and R is the share of the predicted move achieved.
  A call republished within 10 days counts once. An analyst moves the model's picks only after 10 scored calls
  with a shrunk mean above +0.1R. Until then calls are only measured.
- A category with 30 closed picks and net expectancy ≤ 0 is marked `FAILED` and stops new entries.
- Results are net of a provisional cost model (`config.COST_MODEL_VERSION`). Scorecard: net P&L, win rate,
  profit factor, expectancy, max drawdown, costs, capital utilisation, per category and per analyst.

## Commands

    python3 -m intel.run probe          # check every source once
    python3 -m intel.run morning
    python3 -m intel.run options-fill
    python3 -m intel.run report         # scorecard
    python3 -m pytest intel/tests -q

State lives in `$MB_INTEL_HOME` (default `var/intel`): `intel.db` and `reports/<date>-<job>.json`.
Exit codes: 0 ok, 10 degraded (an optional source failed), 20 blocked, 30 error. Standard library only.
