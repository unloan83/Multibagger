# Multibagger — Daily Stock Recommendations

Simple daily stock recommendation engine that scans the NIFTY 500 universe and surfaces the strongest long-term and intraday picks.

## How It Works

1. **Scan** — Fetches live price, volume, and fundamental data for all NIFTY 500 stocks via Yahoo Finance
2. **Score** — Multi-factor scoring: growth, quality, valuation, momentum, sector strength, liquidity, risk
3. **Pick** — Selects top 3 long-term + top 5 intraday picks per market-cap category (large, mid, small)
4. **Deliver** — Sends daily digest via Telegram and/or shows on a simple web dashboard

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:3000` to see today's picks.

## Generate Fresh Recommendations

```bash
# Full NIFTY 500 wealth screening (takes 2-5 minutes)
npm run wealth:snapshot

# Thematic long-term universe screening
npm run longterm:snapshot

# Daily recommendations CSV
npm run csv:morning
npm run csv:afternoon
npm run csv:market-close

# Sync NIFTY 500 universe list
npm run universe:sync
```

## Deploy to Vercel

1. Push to GitHub
2. Import in Vercel as a Next.js project
3. Set optional env vars: `CRON_SECRET`, `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID`
4. Vercel Cron runs the model snapshots on market days. The GitHub Actions
   `Recommendation Scheduler Backup` workflow repeats Intraday and Term checks
   seven minutes later. Freshness guards make these checks idempotent and
   regenerate only a missing or stale scheduled snapshot.

### Automated recommendation schedule

| Model | Primary run (IST) | Recovery check |
| --- | --- | --- |
| Intraday | 9:08 AM, 10:45 AM, 1:45 PM | 7 minutes after each slot |
| Term | 3:45 PM | 3:52 PM |

Vercel Blob is required in production. Recommendation APIs return an error
instead of silently serving an outdated snapshot when regeneration or durable
storage fails.

## Dhan seven-day paper test

The Candle View includes a strictly simulated seven-day paper ledger. It never
calls Dhan order endpoints. Dhan is used only to confirm NSE fill and exit prices
through the Market Quote API; when credentials are absent or expired, the ledger
labels fills as scanner fallbacks.

Configure these server-only environment variables in Vercel:

```bash
DHAN_CLIENT_ID=your_client_id
DHAN_ACCESS_TOKEN=your_access_token
```

Dhan Web access tokens are valid for 24 hours, so replace the token daily during
the test. Never expose either value through `NEXT_PUBLIC_*`. Start the session in
the Candle View and use **Run Paper Cycle** during market hours. A weekday cron
runs one additional daily cycle at 10:40 AM IST. The ledger is stored in the
connected private Vercel Blob store.

## Project Structure

```
app/
  page.tsx            — "Today's Picks" dashboard
  api/snapshots/      — Wealth + long-term universe cron endpoints
lib/
  wealth-screening.ts — Core NIFTY 500 scoring engine
  expert-insights.ts  — Expert action matrix builder
  analysis.ts         — Technical signal analysis
  telegram.ts         — Telegram message delivery
  long-term-universe.ts — Thematic sector screening
  market-overview.ts  — Market sentiment from NIFTY 50
  snapshot-storage.ts — Local file read/write
  recommendation-intelligence.ts — Scoring adjustments (stubs)
scripts/
  update_daily_recommendations.mjs — Daily CSV generator
  run_wealth_snapshot.ts           — Local wealth snapshot runner
  run_long_term_universe.ts        — Local long-term runner
  sync_nifty500_universe.mjs       — Universe sync
data/
  wealth_recommendations.json — Latest wealth snapshot
  long_term_universe.json     — Latest long-term universe
  daily_recommendations.csv   — Historical daily picks
  market-universe.json        — NIFTY 500 stock list
```
