# Trading Model Development Gate

This is the admission and lifecycle policy for all existing and future trading-model development in this repository. It improves prioritisation and safety; it does not certify that a strategy is profitable.

## Admission check

All five answers must be **Yes** before implementation:

- [ ] The feature uses real, reliable, traceable market data and defines stale/missing-data behaviour.
- [ ] Its recommendation can ultimately become an executable order through the intended broker API.
- [ ] Its incremental contribution to net P&L and risk can be objectively measured against a baseline.
- [ ] It can be validated with replay/backtesting where appropriate and live shadow trading before scaling.
- [ ] It has a plausible, testable mechanism to improve returns, reduce drawdown, or improve risk control after costs.

If any answer is **No**, stop. Do not build dummy scoring, decorative trading dashboards, theoretical recommendations, or unmeasurable features.

## Required lifecycle

`Real Data -> Signal -> Live/Shadow Validation -> Small Real-Money Test -> Performance Measurement -> Scale or Kill`

Moving to the next stage requires recorded evidence from the previous stage. A small real-money test also requires explicit human approval, broker risk limits, a kill switch, and reconciliation of intended orders against broker fills. No checklist or automation grants permission to place live orders by itself.

Use these strategy states consistently:

- `RESEARCH`: data and signal are being validated; no broker orders.
- `SHADOW`: live data and simulated orders/fills are being measured.
- `SMALL_LIVE`: explicitly approved, capped real-money exposure.
- `SCALE`: positive expectancy and acceptable drawdown demonstrated after all costs.
- `FAILED`: sufficient testing found no genuine edge; new entries are disabled and history is retained.

## Required measurement

Every model must automatically record and expose, for a clearly defined evaluation window:

- Net P&L after brokerage, taxes, fees, and slippage
- Win rate
- Profit factor
- Expectancy per trade
- Maximum drawdown
- Brokerage, taxes, fees, and slippage, separately where available
- Capital utilisation

Record the data source/version, strategy version, timestamps, signal, intended order, broker acknowledgement/fill, position sizing, exit, costs, and rejected/no-trade reason so results can be reproduced. Compare changes to a named baseline and avoid look-ahead, survivorship, and selection bias.

## Decision policy

- `NO TRADE` is the default when data, liquidity, risk limits, or signal quality are inadequate.
- Never create a trade merely to meet a daily profit target.
- Define risk limits and kill criteria before live testing, not after losses occur.
- Do not rescue an unprofitable strategy by adding indicators or cosmetic UI work.
- Scale only on measured, cost-adjusted evidence. Otherwise keep validating or mark the strategy `FAILED`.

## Pull-request enforcement

Model-related pull requests must complete the Trading Model Gate in `.github/pull_request_template.md`. The `Trading model governance` workflow detects model paths and fails when the applicable checkbox or any required attestation is missing.

For branch protection, make `Trading model governance / validate` a required status check. Direct pushes can bypass a pull-request checkbox, so protected branches should require pull requests for model changes.
