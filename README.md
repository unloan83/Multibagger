# Multibagger

## Active portal models

The portal intentionally exposes only models with a path to real data, broker execution and measurable performance:

- **Breeze Multibagger** — market-intelligence triage that prioritises the existing fundamental model; expert opinion cannot trigger a buy on its own.
- **Upstox Intraday** — read-only, fail-closed broker-feed paper signals. It does not create synthetic picks or automatic orders.
- **Options Quant** — NIFTY bull-call and bear-put debit spreads in shadow validation, with `NO TRADE` as the default when direction, liquidity or risk evidence is insufficient.

The legacy Term, Candle, Watchlist and generic History page models—including their US variants—have been removed. Historical data files are retained for audit and research; they are not presented as current recommendations.

## Trading-model governance

All model changes are governed by the mandatory [Trading Model Development Gate](docs/trading-model-development-gate.md). Pull requests use a checked attestation and an automated path-aware status check; model changes cannot mark the gate as not applicable. Configure branch protection to require `Trading model governance / validate` so the checkbox cannot be bypassed by merging an unchecked pull request.

## Feature isolation

Breeze, Upstox and Options Quant own separate code boundaries under `features/breeze/`, `features/upstox/` and `features/options-quant/`. Next.js route files under `app/api/` are intentionally thin public-endpoint adapters. Synthetic Upstox recommendation seeds and their automatic paper-execution path are not part of the production portal.

The existing Next.js portal reads paper signals produced out of band by a fail-closed NSE intraday engine. The OCI worker uses ICICI Breeze for market data; Upstox remains available as an alternate provider:

`Breeze one-minute/quote streams → DuckDB → ORB/VWAP scanner → paper snapshot → authenticated API/Blob → portal`

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
BREEZE_API_KEY=...
BREEZE_API_SECRET=...
BREEZE_SESSION_TOKEN=... # API_Session from the Breeze login flow; refresh daily
MARKET_DATA_PROVIDER=breeze
ENABLE_LIVE_TRADING=false
SIGNAL_INGEST_TOKEN=long-random-shared-secret
SIGNAL_INGEST_URL=https://your-portal.example/api/recommendations
BLOB_READ_WRITE_TOKEN=... # portal/Vercel durable snapshot storage
```

Optional tuning/storage variables: `MARKET_DATA_DB`, `SIGNAL_SNAPSHOT_PATH`, `NSE_UNIVERSE_PATH`, `NSE_UNIVERSE_SIZE` (default and hard maximum 500), `MIN_PRICE_INR` (default 150), `MAX_PRICE_INR` (default 750), `MAX_DATA_AGE_SECONDS`, `MAX_SIGNAL_SNAPSHOT_AGE_SECONDS`, `MIN_DAILY_VALUE_INR`, `MIN_RELATIVE_VOLUME`, and `MAX_SPREAD_BPS`.

## Run

Start the collector during the NSE session, then run scans from a separate scheduled process after enough one-minute history has accumulated:

```bash
npm run engine:collect
npm run engine:scan
python3 -m scripts.market_engine backtest --start 2026-01-01 --end 2026-06-30
```

The collector subscribes to at most the official NIFTY 500 NSE cash universe and resolves symbols using the selected provider's instrument master. It refuses materially incomplete resolution. The scanner accepts only stocks whose latest close is within the configured ₹150–₹750 CMP band, then applies 15-minute opening-range breakout and VWAP pullback/continuation rules with value-liquidity, relative-volume, bid/ask spread, freshness, and ATR risk gates. `rank_score` is a deterministic ranking score, not a confidence or probability.

On `VM.Standard.E2.1.Micro`, deploy `deploy/multibagger-paper.service` with the hard-capped `NSE_UNIVERSE_SIZE=500` from `deploy/worker.env.example`. The worker batches candle writes and scans in 50-symbol chunks, retains only 14 days of minute bars, and systemd enforces `MemoryMax=750M`. Those controls protect the existing 1 GB Always Free VM; the application does not create or resize OCI resources. Credentials belong only in `/etc/breeze/breeze.env`; worker settings belong in `/etc/multibagger/worker.env`. The service hard-codes `ENABLE_LIVE_TRADING=false`, contains no order call, and writes state only under `/var/lib/multibagger`.

The OCI deployment uses `multibagger-paper-start.timer` at 09:05 IST and `multibagger-paper-stop.timer` at 15:35 IST on weekdays. Before each trading day, generate a fresh Breeze `API_Session`, update the local `Breeze_Credentials.env`, and run `/home/user/projects/sync-breeze-credentials.sh`. The helper uploads the protected file and starts/restarts only the paper worker. Run `multibagger-paper-warmup.service` after a new deployment to seed three days of recent historical candles; it skips symbols that already have at least three sessions.

## Verify

```bash
npm run engine:test
npm run lint
npm run build
```

The PyBroker walk-forward command reads recorded Upstox bars from DuckDB and stores validation metrics in `validation_results`. It does not enable live orders.
