# Tested strategies (do not re-test)

Results already produced on the OCI VMs by the earlier repos. They are recorded here so the same ideas are not
backtested again. Source repos stay readable on GitHub at the commits named below.

| Strategy | Category | Where tested | Result | Verdict |
|---|---|---|---|---|
| CPR + futures OI (DualEngine/Daybagger) | Intraday | Daybagger `research/CPR_OI_PROMOTION_GATES.md`, Opportunity §6.3 | Did not pass its locked gates | Retired. OI classifier kept as an input (`features/options-quant/python/oi_intelligence.py`) |
| Supertrend ATR | Intraday | Daybagger `research/PREREGISTERED_SUPERTREND_EXPERIMENT.md` | Did not pass | Retired |
| Trend pullback (short) | Intraday | Daybagger `research/model_registry.json` (2026-05-06..09-02) | 1,800 trades, -25.9 bps/trade net, profit factor 0.04, win rate 8.7% | Retired |
| Meta-intelligence v3 / v4 direct-return ML | Intraday | Daybagger `research/model_registry.json` | 0 qualifying trades; dev and holdout expectancy not positive | Retired |
| Alpha/Beta/Gamma intraday paper agents (this repo) | Intraday | `docs/trade-audits/2026-08-18-to-2026-08-21.md` | 14 paper trades, -₹10,232 net; strict replay rejects all 14 | Paused, not proven |
| Daily breakout, trend pullback (algo-trading-core) | Short-term | Opportunity §6.3 | Did not pass | Retired |
| Cross-sectional momentum v1 (Nifty 500) | Long-term | Opportunity `governance/S2_STEP5_SUMMARY.md` (2026-10-15) | +20.2%/yr net excess vs benchmark, P(excess>0) 0.985; max drawdown 52% vs benchmark 36%; top-3 periods 60% of excess | Rejected on drawdown and concentration |
| Plain 12-1 momentum | Long-term | Opportunity S2 run (2026-10-13) | +32.46%/yr net, 2015-2023 | Strongest result so far; needs a drawdown control |
| Multifactor stock v2 | Long-term | Opportunity S2 run (2026-10-13) | Fixed-cost drag 107 bps > 100 limit | Rejected |
| Options (calls, puts, long, short) | Options | — | Never tested | Next to test |
| ETF idle-money switch | ETF | — | Not tested | After options |

Lessons carried forward:
1. Intraday indicator rules lost money after costs every time. Intraday now needs a news/expert catalyst plus market
   direction, not indicators alone.
2. Momentum is the only family with a positive net result. Its problem is drawdown, not return.
3. Options are the only untested category.
