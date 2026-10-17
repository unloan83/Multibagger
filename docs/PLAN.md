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

## Category order

| # | Category | Code | Status |
|---|---|---|---|
| 1 | Intraday | `engine/`, `features/upstox/` | Paused (see tested strategies) |
| 2 | Short-term (2 days-4 weeks) | to be added | Not started |
| 3 | Long-term (3-24 months) | `features/breeze/` (expert triage, fundamentals) | Expert data empty |
| 4 | Options: call, put, long, short | `features/options-quant/` | **Untested; first to test** |
| 5 | ETF (idle money) | regime detector `engine/regime_detector.py` | After options |

## Next

1. Options: forward paper test of the existing bull-call / bear-put spread engine on the Breeze VM, using live
   option-chain data, plus futures OI state (`oi_intelligence.py`) as a direction input.
