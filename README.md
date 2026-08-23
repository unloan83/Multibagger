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

`Upstox read-only WebSocket → DuckDB → NIFTY-500 F&O liquidity prefilter → opening market gate → isolated Alpha/Beta/Gamma paper agents → paper accounting → authenticated API/Blob → portal`

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
PAPER_SUBMIT_UPSTOX_SANDBOX_ORDERS=false
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

The Upstox V3 collector resolves the current NSE F&O/NIFTY-500 intersection once and reuses that instrument master for warm-up, collection and screening. At 08:30 IST the engine retains stocks with 20-session median volume of at least 500,000, median range of at least 1.5%, and spread no wider than 8 bps; the entry path checks the live spread again. The 09:15–09:30 gate combines NIFTY opening range, VWAP slope, breadth, realised volatility and India VIX into `NORMAL`, `REDUCED` or `NO_TRADE` without treating low VIX or a narrow range as a lone kill switch.

Alpha exclusively owns 09:30–11:00 IST and trades top/bottom-three sector VWAP pullbacks with ADX14 above 25. Beta owns 11:00–13:30 and trades top/bottom-three 15-minute breakouts with relative volume above 3× and ADX9 above 20. Gamma owns 13:30–15:00 and only fades BB(20,2.5) extremes in neutral/range sectors with ADX21 below 20. Risk is dynamically ₹250–₹500 per trade, aggregate open risk is capped at ₹750, the daily stop-entry thresholds are +₹4,000 and -₹1,000, and no setup remains `NO_TRADE`. At +1.5R half is exited and the runner moves to cost-adjusted breakeven before following its agent-specific exit rule.

On `VM.Standard.E2.1.Micro`, deploy `deploy/multibagger-paper.service` with the hard-capped `NSE_UNIVERSE_SIZE=500` from `deploy/worker.env.example`. Only the F&O intersection is collected, database aggregation builds the universe without loading all bars into RAM, scans run in 50-symbol batches, 35 days are retained for the 20-session screen, and systemd enforces `MemoryMax=750M`. A stream watchdog restarts the service if active-session quotes or one-minute candles silently stall. `multibagger-resource-watchdog.timer` records host/worker memory, swap, disk, load, and restart counts every ten minutes. Upstox credentials belong only in `/etc/upstox/upstox.env`; worker settings belong in `/etc/multibagger/worker.env`. The service hard-codes `ENABLE_LIVE_TRADING=false` and `LIVE_TRADING_ENABLED=false`, permits only Upstox sandbox orders when configured, and writes paper state only under `/var/lib/multibagger`.

If the watchdog reports sustained resource pressure, at most one active agent can be offloaded to the laptop with `npm run engine:local-agent -- AUTO` (or an explicit `ALPHA`, `BETA`, or `GAMMA`). OCI keeps its collector and the other two agents. The wrapper refuses to split while any paper position is open, gives the laptop the second permitted Upstox WebSocket connection, and synchronizes the paper database back before restoring all three OCI agents. A remote 10-hour safety release restores the excluded agent after a laptop failure. If the return upload is interrupted, `npm run engine:local-agent -- RECOVER` retries it from retained local state. Local scratch state remains under `.local-paper-fallback/`; no OCI resources are provisioned or upgraded.

Equity exits are evaluated from completed five-minute context with a 60-second minimum hold: Alpha closes beyond EMA9 against the trade, Beta requires two VWAP closes against it, and Gamma exits on the mean/VWAP recross. Every scan, signal, rejection, partial, mark and final exit is retained for audit. Options code remains bypassed and live trading remains prohibited.

Breeze Multibagger is deliberately outside this paper scheduler. Its legacy OCI service is masked and it has no Vercel scheduled invocation; the feature remains available only as an isolated, manually invoked long-horizon research workflow.

OCI operational alerts use `TELEGRAM_TOKEN` and `TELEGRAM_CHAT_ID` from the protected `/etc/multibagger/telegram.env` file. Telegram receives Upstox worker lifecycle alerts, each completed 15-minute Upstox and Options full scan, position closures/changes, P&L and target status, failures, timeouts, and missed full scans. Successful one- or two-minute risk-monitor heartbeats are deliberately silent. Repeated failure alerts are rate-limited so an outage cannot send a message every minute; Telegram delivery failures never interrupt paper trading.

Store both Upstox tokens in `/home/user/projects/Multibagger/.env.local`, then run `/home/user/projects/sync-upstox-credentials.sh`. The helper securely installs the live-data and sandbox tokens, warms 35 calendar days for the 20-session screen, and starts the worker only during the NSE session (otherwise the timer starts it). The standard daily token also works but expires at 03:30 IST the following day.

## Verify

```bash
npm run engine:test
npm run lint
npm run build
```

The replay command applies the v4 regime and dual-strategy gates point-in-time. Missing VIX, breadth, event-calendar or setup evidence fails closed. Rejection-based avoided loss is not evidence of positive expectancy and never enables orders.
