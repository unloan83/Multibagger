# Trading-model development gate

These instructions apply to every existing or future trading model in this repository, including Breeze, Upstox, Options Quant, scanners, strategies, recommendation engines, order execution, portfolio/risk logic, and performance reporting.

Before changing trading-model behavior, confirm every item in [`docs/trading-model-development-gate.md`](docs/trading-model-development-gate.md). If any of the five admission questions is **No**, do not implement the feature. A model-related pull request must complete the Trading Model Gate section in the pull-request template.

Mandatory rules:

- Use traceable, real/reliable market data. Never fabricate AI scores, signals, fills, performance, or institutional/expert evidence.
- Signals must have a plausible route to an executable broker order. Research-only intermediate work is allowed only when it directly supports that route and can be validated.
- Each model must measure net P&L, win rate, profit factor, expectancy per trade, maximum drawdown, brokerage/taxes/slippage, and capital utilisation. Never present gross or cost-free results as deployable performance.
- Follow: Real Data -> Signal -> Live/Shadow Validation -> Small Real-Money Test -> Performance Measurement -> Scale or Kill.
- Prefer `NO TRADE` when quality or data is insufficient. Never manufacture trades to meet a daily profit target.
- A strategy without sufficient evidence of positive expectancy after costs must not be scaled. When sufficient testing shows no genuine edge, mark it `FAILED`, disable new entries, and retain its measurement history for audit.
- Optimise for capital protection, positive expectancy, controlled drawdown, and scalable real returns. Do not add indicators or redesign UI as a substitute for demonstrated edge.
- Keep Breeze, Upstox, and Options Quant implementation isolated in their respective `features/breeze`, `features/upstox`, and `features/options-quant` domains; shared code must be broker-neutral.
- Never describe a trading model as **ready**, **all set**, **operational**, or equivalent based only on implemented code, passing tests, a successful build, or a partial deployment. Readiness requires current, traceable end-to-end evidence from the deployed environment covering credentials/configuration, real market-data ingestion, signal or explicit `NO TRADE` evaluation, broker sandbox/order-path validation where applicable, entry and exit lifecycle, state persistence, performance accounting, scheduler/service operation, and safety/kill-switch behavior.
- Every readiness report must distinguish **implemented**, **configured**, **deployed**, and **end-to-end verified**. It must list every missing, disabled, stale, untested, or still-running dependency. If any required item lacks evidence, state that the model is **not ready** and name the blocker; never convert expected future behavior into a completion claim.

Documentation-only, test-only, and operational changes may mark the gate not applicable only when they cannot alter signals, order decisions, risk, execution, costs, or reported performance.
