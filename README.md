# Multibagger

## Active portal models

The portal intentionally exposes only models with a path to real data, broker execution and measurable performance:

- **Breeze Multibagger** — market-intelligence triage that prioritises the existing fundamental model; expert opinion cannot trigger a buy on its own.
- **Upstox Intraday** — fail-closed broker-feed signals with automatic simulated fills, exits and cost-adjusted paper performance. It does not create synthetic picks or real-money orders.
- **Options Quant** — NIFTY bull-call and bear-put debit spreads in shadow validation, with `NO TRADE` as the default when direction, liquidity or risk evidence is insufficient.

The legacy Term, Candle, Watchlist and generic History page models—including their US variants—have been removed. Historical data files are retained for audit and research; they are not presented as current recommendations.

## Trading-model governance

All model changes are governed by the mandatory [Trading Model Development Gate](docs/trading-model-development-gate.md). Pull requests use a checked attestation and an automated path-aware status check; model changes cannot mark the gate as not applicable. Configure branch protection to require `Trading model governance / validate` so the checkbox cannot be bypassed by merging an unchecked pull request.

## Feature isolation

Breeze, Upstox and Options Quant own separate code boundaries under `features/breeze/`, `features/upstox/` and `features/options-quant/`. Next.js route files under `app/api/` are intentionally thin public-endpoint adapters. Synthetic Upstox recommendation seeds are not part of the production portal.

The existing Next.js portal reads paper signals produced out of band by a fail-closed NSE intraday engine. The OCI intraday worker uses Upstox exclusively for market data and sandbox execution; Breeze is isolated to its long-horizon feature:

`Upstox read-only WebSocket → DuckDB → regime + 250-stock F&O prefilter → VWAP/range scanner → Upstox sandbox BUY/SELL + paper accounting → authenticated API/Blob → portal`

Page and API GET requests never scan the market. A missing, stale, expired, malformed, or non-qualifying signal set returns `NO_TRADE` with an empty list.

## Engine setup

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements-engine.txt
npm ci
```

Required server/worker environment:

```bash
UPSTOX_ACCESS_TOKEN=... # Prefer the one-year read-only Analytics Token
UPSTOX_SANDBOX_ACCESS_TOKEN=...
MARKET_DATA_PROVIDER=upstox
ENABLE_LIVE_TRADING=false
LIVE_TRADING_ENABLED=false
UPSTOX_MODE=SANDBOX
PAPER_SUBMIT_UPSTOX_SANDBOX_ORDERS=true
SIGNAL_INGEST_TOKEN=long-random-shared-secret
SIGNAL_INGEST_URL=https://your-portal.example/api/recommendations
BLOB_READ_WRITE_TOKEN=... # portal/Vercel durable snapshot storage
```

Optional tuning/storage variables include `MARKET_DATA_DB`, `SIGNAL_SNAPSHOT_PATH`, `NSE_UNIVERSE_PATH`, `NSE_UNIVERSE_SIZE` (default and hard maximum 500), `MIN_PRICE_INR` (default 150), `MAX_PRICE_INR` (default 750), `MAX_DATA_AGE_SECONDS`, `MIN_DAILY_VALUE_INR`, `MIN_RELATIVE_VOLUME`, `MAX_SPREAD_BPS`, and the `PAPER_*` risk/cost controls documented in `deploy/worker.env.example`.

## Run

Start the collector during the NSE session. Its internal scheduler runs the equity scan and the lightweight active-position monitor after enough one-minute history has accumulated:

```bash
npm run engine:collect
npm run engine:scan
python3 -m scripts.market_engine backtest --start 2026-01-01 --end 2026-06-30
```

The Upstox V3 collector subscribes to the 500-stock source universe plus NIFTY and India VIX. At 08:30 IST the engine keeps at most 250 F&O stocks meeting volume, daily-range and spread filters; price must be within 0.5% of the daily pivot, previous-session VWAP, previous-day high or previous-day low. NIFTY is classified as `TRENDING`, `RANGE`, `HIGH_VOL` or `TRANSITION` from 15-minute ADX, VIX, ATR% and breadth. Only VWAP pullback continuation in `TRENDING` and range-extreme mean reversion in `RANGE` may enter; ORB is a fallback requiring more than 2× first-five-minute volume. Risk is capped at 0.25% of capital and ₹1,000 including modeled costs, with 1.5R–2R targets, one open position and four trades daily. Both the daily profit target and loss breaker are ₹4,000.

On `VM.Standard.E2.1.Micro`, deploy `deploy/multibagger-paper.service` with the hard-capped `NSE_UNIVERSE_SIZE=500` from `deploy/worker.env.example`. The worker batches candle writes and scans in 50-symbol chunks, retains only 14 days of minute bars, and systemd enforces `MemoryMax=750M`. A stream watchdog restarts the service if active-session quotes or one-minute candles silently stall. `multibagger-resource-watchdog.timer` records host/worker memory, swap, disk, load, and restart counts every ten minutes; it sends a rate-limited Telegram warning below 150 MiB available memory, above 650 MiB worker memory, above 80% disk, or above 80% swap. Upstox credentials belong only in `/etc/upstox/upstox.env`; worker settings belong in `/etc/multibagger/worker.env`. The service hard-codes `ENABLE_LIVE_TRADING=false`, contains no real-money broker-order call, and writes paper state only under `/var/lib/multibagger`.

Equity exits are evaluated once per completed one-minute candle, with a 60-second minimum hold for normal thesis exits. Hard stops remain protective; break-even and trailing both begin at 1R, with a 1.5×ATR trailing distance. Every exit trigger and regime state change is logged. Options code remains bypassed and live trading remains prohibited.

Breeze Multibagger is deliberately outside this paper scheduler. Its legacy OCI service is masked and it has no Vercel scheduled invocation; the feature remains available only as an isolated, manually invoked long-horizon research workflow.

OCI operational alerts use `TELEGRAM_TOKEN` and `TELEGRAM_CHAT_ID` from the protected `/etc/multibagger/telegram.env` file. Telegram receives Upstox worker lifecycle alerts, each completed 15-minute Upstox and Options full scan, position closures/changes, P&L and target status, failures, timeouts, and missed full scans. Successful one- or two-minute risk-monitor heartbeats are deliberately silent. Repeated failure alerts are rate-limited so an outage cannot send a message every minute; Telegram delivery failures never interrupt paper trading.

Store both Upstox tokens in `/home/user/projects/Multibagger/.env.local`, then run `/home/user/projects/sync-upstox-credentials.sh`. The helper securely installs the live-data and sandbox tokens, warms eight days of Upstox history, and starts the worker only during the NSE session (otherwise the timer starts it). The standard daily token also works but expires at 03:30 IST the following day.

## Verify

```bash
npm run engine:test
npm run lint
npm run build
```

The replay command applies the v4 regime and dual-strategy gates point-in-time. Missing VIX, breadth, event-calendar or setup evidence fails closed. Rejection-based avoided loss is not evidence of positive expectancy and never enables orders.
