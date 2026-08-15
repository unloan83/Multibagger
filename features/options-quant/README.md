# Options Quant

Production-oriented NIFTY defined-risk debit-spread module. It is isolated from Breeze and Upstox equity features while using the broker-neutral `OptionsBroker` port.

## Current stage

`SHADOW_AND_SANDBOX_ONLY`. The code has no live-money order method or live order URL. Upstox live APIs supply option contracts, executable bid/ask, OI, volume, IV, Greeks, and charge estimates. The Upstox sandbox multi-order API is optional and is used only to validate the two-leg order payload/lifecycle.

The module returns `NO TRADE` unless all of these are present and current:

- authenticated Upstox market data;
- authenticated market-intelligence direction evidence with regime, breadth/sector, institutional and expert provenance;
- configured portfolio capital and per-trade risk;
- eligible NIFTY expiry and liquid delta-qualified legs;
- acceptable bid/ask spreads, costs, slippage, maximum loss, and risk/reward;
- active NSE entry window and no existing open spread.

## Integration flow

1. The existing market-intelligence process posts its NIFTY direction evidence to `POST /api/options-quant/direction` with `Authorization: Bearer $OPTIONS_QUANT_INGEST_TOKEN`.
2. A protected scheduler posts to `POST /api/options-quant/scan` with the same token (or `CRON_SECRET`) during market hours.
3. `GET /api/options-quant` is read-only and renders live opportunity, active positions, risk, P&L, and performance evidence.

The OCI/worker scheduler can run `npm run options:scan` every minute during the NSE session. The command is a thin entry point into this feature domain and remains fail-closed outside the monitoring window.

Direction body:

```json
{
  "asOf": "2026-08-17T04:15:00.000Z",
  "direction": "BULLISH",
  "confidence": 78,
  "marketRegime": "RISK_ON",
  "breadthSectorStrength": 72,
  "institutionalTriage": 66,
  "expertTriage": 61,
  "sourceIds": ["market-regime-v3", "breadth-feed-v2", "institutional-triage-v1"],
  "modelVersion": "market-intelligence-2026.08"
}
```

The example documents the contract; it is never loaded as trading data.

## Promotion policy

Phase 1 uses real executable quotes for shadow fills. Sandbox order submission requires all sandbox safety flags plus `OPTIONS_QUANT_SUBMIT_SANDBOX_ORDERS=true`. No real-money implementation should be added until shadow metrics meet the configured minimum sample and risk thresholds. Real-money promotion additionally requires human approval, broker reconciliation, minimum real trades, positive expectancy after costs, acceptable profit factor and drawdown, and an operational kill switch.
