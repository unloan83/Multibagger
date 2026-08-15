## Summary

Describe the change and how it was verified.

## Trading Model Gate

Choose exactly one scope option. Model-related changes must choose **Gate applies** and complete every item.

- [ ] **Not a trading-model change.** This cannot alter data, signals, recommendations, risk, orders, execution, costs, or performance reporting. <!-- trading-model-gate:not-applicable -->
- [ ] **Gate applies.** This changes or supports trading-model behaviour. <!-- trading-model-gate:applies -->

When the gate applies:

- [ ] Uses real, reliable, traceable market data and defines missing/stale-data handling. <!-- trading-model-gate:real-data -->
- [ ] Has a plausible path from recommendation to an executable order through the intended broker API. <!-- trading-model-gate:broker-executable -->
- [ ] Defines an objective baseline and measures incremental net P&L/risk contribution. <!-- trading-model-gate:measurable-pnl -->
- [ ] Supports replay/backtesting where appropriate and live shadow validation before scaling. <!-- trading-model-gate:shadow-validation -->
- [ ] Has a testable mechanism to improve returns, reduce drawdown, or improve risk control after costs. <!-- trading-model-gate:risk-adjusted-improvement -->
- [ ] Automatically tracks Net P&L, Win Rate, Profit Factor, Expectancy/Trade, Maximum Drawdown, Brokerage/Taxes/Slippage, and Capital Utilisation. <!-- trading-model-gate:required-metrics -->
- [ ] Follows Real Data -> Signal -> Live/Shadow Validation -> Small Real-Money Test -> Performance Measurement -> Scale or Kill. <!-- trading-model-gate:development-sequence -->
- [ ] Defaults to NO TRADE when quality is inadequate and never trades to hit a daily target. <!-- trading-model-gate:no-trade -->
- [ ] Defines risk limits, kill criteria, and `FAILED` handling without disguising poor performance through extra indicators or UI. <!-- trading-model-gate:scale-or-kill -->
- [ ] Prioritises Capital Protection + Positive Expectancy + Controlled Drawdown + Scalable Real Returns. <!-- trading-model-gate:capital-protection -->

Evidence/links (data source, validation run, metrics, risk limits, and broker/shadow path):

<!-- Add evidence here. A checked box is an attestation, not proof of profitability or permission for live trading. -->
