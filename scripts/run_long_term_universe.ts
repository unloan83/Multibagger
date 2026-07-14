import { GET as refreshLongTermUniverse } from "@/app/api/snapshots/long-term-universe/route";

/**
 * Local runner for the long-term universe cron job.
 * Mimics what Vercel Cron does: calls GET /api/snapshots/long-term-universe
 * with a vercel-cron user-agent so the auth guard passes without CRON_SECRET.
 *
 * Usage:
 *   npm run longterm:snapshot
 *   node --import tsx scripts/run_long_term_universe.ts
 *
 * This takes 2-5 minutes (full NIFTY 500 screen + thematic filtering).
 */
async function main() {
  console.log("Running thematic long-term universe screen — this takes 2-5 minutes ...");

  const response = await refreshLongTermUniverse(cronRequest("/api/snapshots/long-term-universe"));
  const payload = await response.json() as {
    ok?: boolean;
    asOf?: string;
    marketRegime?: string;
    totalStocks?: number;
    slotSummary?: Record<string, Record<string, number>>;
    sectorDetails?: Array<{
      key: string;
      title: string;
      large: number;
      mid: number;
      small: number;
      emerging: number;
      total: number;
    }>;
    durationMs?: number;
    error?: string;
  };

  if (!response.ok || !payload.ok) {
    throw new Error(payload.error ?? "Long-term universe snapshot failed.");
  }

  console.log(`\nSnapshot: ${payload.asOf}`);
  console.log(`Regime:   ${payload.marketRegime}`);
  console.log(`Duration: ${((payload.durationMs ?? 0) / 1000).toFixed(1)}s`);
  console.log(`\nSector breakdown (target: 96 stocks):`);
  (payload.sectorDetails ?? []).forEach((s) => {
    console.log(`  ${s.title.padEnd(40)} L:${s.large} M:${s.mid} S:${s.small} E:${s.emerging} = ${s.total}`);
  });
  const total = (payload.sectorDetails ?? []).reduce((sum, s) => sum + s.total, 0);
  console.log(`\nTotal: ${total} stocks`);
}

main().catch(fail);

function cronRequest(path: string) {
  return new Request(`http://github-actions.local${path}`, {
    headers: { "user-agent": "vercel-cron/1.0" },
  });
}

function fail(error: unknown) {
  console.error(error instanceof Error ? error.message : "Long-term universe snapshot failed.");
  process.exitCode = 1;
}
