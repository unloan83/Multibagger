# Options Quant

Production-oriented NIFTY defined-risk debit-spread module. It is isolated from Breeze and Upstox equity features while using the broker-neutral `OptionsBroker` port.

## Current stage

`SHADOW_AND_SANDBOX_ONLY`. The code has no live-money order method or live order URL. Upstox live APIs supply option contracts, executable bid/ask, OI, volume, IV, Greeks, and charge estimates. The Upstox sandbox multi-order API is optional and is used only to validate the two-leg order payload/lifecycle.

The module returns `NO TRADE` unless all of these are present and current:

- authenticated Upstox market data;
- fresh Upstox NIFTY 50 and Bank NIFTY one-minute candles plus NIFTY option-chain OI;
- configured portfolio capital and per-trade risk;
- eligible NIFTY expiry and liquid delta-qualified legs;
- acceptable bid/ask spreads, costs, slippage, maximum loss, and risk/reward;
- enough maximum net spread profit to support the configured per-trade target (₹3,000 by default);
- active NSE entry window and no existing open spread.

## Integration flow

1. The OCI timer wakes once per minute during the NSE monitoring window. It calls the protected full-scan endpoint every 15 minutes at 09:28, 09:43, …, 14:43 IST, eight minutes after the Upstox equity scan.
2. Intervening ticks call `POST /api/options-quant/monitor`, which fetches only the data required to enforce stop, target, direction-reversal, and expiry exits for an active spread; it cannot open a position.
3. A host-wide non-blocking lock is shared with the equity worker. Overlapping invocations are recorded as skipped, not queued, and full scans have a hard runtime limit.
4. The protected scan builds a direction from Upstox NIFTY 50 and Bank NIFTY intraday candles plus NIFTY put/call OI, then evaluates the spread and submits sandbox legs only if every gate passes.
5. `GET /api/options-quant` is read-only and renders live opportunity, active positions, risk, P&L, target status, and performance evidence. OCI also retains scheduler outcome and target-status history in SQLite.

On a resource-constrained OCI host, `scripts/options_quant_server.ts` runs the same engine as a
localhost-only service. Setting `OPTIONS_QUANT_STATE_DB` stores the complete state transactionally
in SQLite, and the existing Python scheduler calls `http://127.0.0.1:8787/scan` or `/monitor`.
The service is prebuilt off-host and capped by systemd; it does not require Next.js, Docker, or an
on-host TypeScript build. The Vercel dashboard remains unavailable until a separately protected
HTTPS read path to OCI is configured and verified.

`OPTIONS_QUANT_ENABLED=false` is the new-entry kill switch. Open sandbox positions continue to be monitored for exits. The scheduler and API both remain fail-closed outside the monitoring window, for stale data, and for incomplete Upstox responses.

Direction body:

```json
{
  "asOf": "2026-08-17T04:15:00.000Z",
  "direction": "BULLISH",
  "confidence": 78,
  "marketRegime": "INTRADAY_TREND_UP",
  "trendStrength": 74,
  "bankNiftyConfirmation": 67,
  "optionChainConfirmation": 61,
  "observations": {
    "niftyReturnFromOpenBps": 32,
    "niftyFastSlowGapBps": 6,
    "bankNiftyReturnFromOpenBps": 28,
    "bankNiftyFastSlowGapBps": 5,
    "putCallOiRatio": 1.11,
    "optionExpiry": "2026-08-20",
    "latestMarketTimestamp": "2026-08-17T09:45:00+05:30"
  },
  "sourceIds": ["upstox-v3-intraday:NSE_INDEX|Nifty 50:1m", "upstox-v3-intraday:NSE_INDEX|Nifty Bank:1m", "upstox-v2-option-chain:NSE_INDEX|Nifty 50:2026-08-20"],
  "modelVersion": "upstox-nifty-direction-v1"
}
```

The example documents the contract; it is never loaded as trading data. No analyst, institutional, confidence, or fill value is fabricated.

## Promotion policy

Phase 1 uses real executable quotes for shadow fills. Sandbox order submission requires all sandbox safety flags plus `OPTIONS_QUANT_SUBMIT_SANDBOX_ORDERS=true`. No real-money implementation should be added until shadow metrics meet the configured minimum sample and risk thresholds. Real-money promotion additionally requires human approval, broker reconciliation, minimum real trades, positive expectancy after costs, acceptable profit factor and drawdown, and an operational kill switch.

`OPTIONS_QUANT_PROFIT_TARGET_RUPEES` controls the estimated net P&L exit for each spread and defaults to `3000`. A candidate is rejected when its maximum net profit cannot reach that target. The target is an exit rule, not a quota: the engine remains `NO TRADE` when its evidence and risk gates fail.

`OPTIONS_QUANT_DAILY_PROFIT_TARGET_RUPEES` defaults to `3000` and locks new spread entries after that day's closed net P&L reaches the target. It never relaxes the direction, liquidity, or risk gates to manufacture another trade.
