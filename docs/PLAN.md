# Multibagger plan (owner decisions 2026-10-17)

- One repo: Multibagger. Other trading repos are no longer developed; what was needed has been moved here and
  their test results are in `docs/TESTED_STRATEGIES.md`. No re-testing of those strategies.
- Workloads run on the Breeze VM (`breeze-trading`).
- Telegram notifications stay as they are until planned separately.
- Repo stays public; secrets stay local and out of Git.
- Effort cap: 1-2 days. Simple models only.

## Model: daily market intelligence

Every trading day before 09:00 IST: market mood (Nifty trend, India VIX, breadth, FII/DII), momentum scan,
news/events and named-analyst morning calls weighted by each analyst's measured track record. Output is a short pick
list with entry, stop and target, or `NO TRADE`. Every pick is logged before the open and scored against real prices.

Code: `intel/` (broker-neutral), Upstox read-only data in `features/upstox/python/daily_data.py`, units
`deploy/multibagger-intel-*`. Details: `intel/README.md`. State: `SHADOW` (paper only, no order code).

## Category order

| # | Category | Rule in `daily-intel-v1` | Status |
|---|---|---|---|
| 1 | Intraday | News or proven-analyst catalyst aligned with market mood; exit at close | Built, paper |
| 2 | Short-term (2 days-4 weeks) | 20-day momentum near 52-week high, stop 2 ATR, target 4 ATR, max 10 sessions | Built, paper |
| 3 | Long-term (3-24 months) | 12-1 momentum, monthly, only while Nifty is above its 200-day average | Built, paper |
| 4 | Options | Nifty debit spread (bull call / bear put) held to expiry; option selling not included | Built, paper; needs Upstox token |
| 5 | ETF (idle money) | NIFTYBEES in an uptrend, LIQUIDBEES otherwise; logged on each switch | Built, paper |

## Next

1. Install the two timers on the Breeze VM and let every category collect paper evidence.
2. A category with 30 closed picks and no positive net expectancy is marked `FAILED` automatically.
