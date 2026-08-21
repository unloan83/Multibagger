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

`Upstox read-only WebSocket → DuckDB → ORB/VWAP scanner → Upstox sandbox BUY/SELL + paper accounting → authenticated API/Blob → portal`

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

The Upstox V3 collector subscribes to at most the official NIFTY 500 NSE cash universe and resolves symbols using Upstox's instrument master. It refuses materially incomplete resolution. The scanner accepts only stocks whose latest close is within the configured ₹150–₹750 CMP band, then applies 15-minute opening-range breakout and VWAP pullback/continuation rules with value-liquidity, relative-volume, bid/ask spread, freshness, and ATR risk gates. Qualified signals must first receive an Upstox sandbox BUY order ID, are tracked with cost-adjusted paper accounting, and submit the matching sandbox SELL on stop, target, the 15:15 IST flatten time, or a daily risk lock. The ₹3,000 daily target disables new entries after it is achieved; it never manufactures trades. `rank_score` is a deterministic ranking score, not a confidence or probability.

On `VM.Standard.E2.1.Micro`, deploy `deploy/multibagger-paper.service` with the hard-capped `NSE_UNIVERSE_SIZE=500` from `deploy/worker.env.example`. The worker batches candle writes and scans in 50-symbol chunks, retains only 14 days of minute bars, and systemd enforces `MemoryMax=750M`. A stream watchdog restarts the service if active-session quotes or one-minute candles silently stall. `multibagger-resource-watchdog.timer` records host/worker memory, swap, disk, load, and restart counts every ten minutes; it sends a rate-limited Telegram warning below 150 MiB available memory, above 650 MiB worker memory, above 80% disk, or above 80% swap. Upstox credentials belong only in `/etc/upstox/upstox.env`; worker settings belong in `/etc/multibagger/worker.env`. The service hard-codes `ENABLE_LIVE_TRADING=false`, contains no real-money broker-order call, and writes paper state only under `/var/lib/multibagger`.

The OCI deployment uses `multibagger-paper-start.timer` at 09:05 IST and `multibagger-paper-stop.timer` at 15:35 IST on weekdays. Upstox equity performs a full scan every 15 minutes at 09:20, 09:35, …, 14:35 IST and evaluates active-position stop, break-even, trailing-profit, momentum-reversal, target-protection, and end-of-day events every minute. Options Quant is staggered eight minutes later at 09:28, 09:43, …, 14:43 IST and uses its intervening one-minute timer ticks only for lightweight active-position monitoring. Each model reserves its full-scan minute from the other model's monitor. Both models share a non-blocking host lock: any remaining busy slot is recorded as skipped rather than queued. Full scans have bounded runtimes. Equity job, recommendation, order, mark, exit, P&L, and target history is retained in DuckDB; Options scheduler runs are retained in its OCI SQLite audit database while model state and results remain in the durable Options store. `TRADING_EXECUTION_PAUSED=true` is the global fail-closed gate and blocks both models even if a model-specific enable flag is set.

Breeze Multibagger is deliberately outside this paper scheduler. Its legacy OCI service is masked and it has no Vercel scheduled invocation; the feature remains available only as an isolated, manually invoked long-horizon research workflow.

OCI operational alerts use `TELEGRAM_TOKEN` and `TELEGRAM_CHAT_ID` from the protected `/etc/multibagger/telegram.env` file. Telegram receives Upstox worker lifecycle alerts, each completed 15-minute Upstox and Options full scan, position closures/changes, P&L and target status, failures, timeouts, and missed full scans. Successful one- or two-minute risk-monitor heartbeats are deliberately silent. Repeated failure alerts are rate-limited so an outage cannot send a message every minute; Telegram delivery failures never interrupt paper trading.

Store both Upstox tokens in `/home/user/projects/Multibagger/.env.local`, then run `/home/user/projects/sync-upstox-credentials.sh`. The helper securely installs the live-data and sandbox tokens, warms eight days of Upstox history, and starts the worker only during the NSE session (otherwise the timer starts it). The standard daily token also works but expires at 03:30 IST the following day.

## Verify

```bash
npm run engine:test
npm run lint
npm run build
```

The PyBroker walk-forward command reads recorded Upstox bars from DuckDB and stores validation metrics in `validation_results`. It does not enable live orders.
