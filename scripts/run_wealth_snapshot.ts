import { GET as refreshWealthSnapshot } from "@/app/api/snapshots/wealth/route";

/**
 * Local runner for the wealth snapshot cron job.
 * Mimics what Vercel Cron does: calls GET /api/snapshots/wealth with a
 * vercel-cron user-agent so the auth guard passes without a CRON_SECRET.
 *
 * Usage:
 *   npm run wealth:snapshot
 *   node --import tsx scripts/run_wealth_snapshot.ts
 */
async function main() {
  console.log("Running NIFTY 500 wealth screening — this takes 2-5 minutes ...");

  const response = await refreshWealthSnapshot(cronRequest("/api/snapshots/wealth"));
  const payload = await response.json() as {
    ok?: boolean;
    asOf?: string;
    marketRegime?: string;
    universeSize?: number;
    evaluatedSize?: number;
    eligibleSize?: number;
    longTermTotal?: number;
    intradayTotal?: number;
    abstained?: boolean;
    capBreakdown?: Array<{ key: string; title: string; longTerm: number; intraday: number }>;
    durationMs?: number;
    error?: string;
    contractErrors?: string[];
  };

  if (!response.ok || !payload.ok) {
    throw new Error(
      payload.contractErrors?.join(" ") ?? payload.error ?? "Wealth snapshot failed.",
    );
  }

  console.log(JSON.stringify({
    asOf: payload.asOf,
    marketRegime: payload.marketRegime,
    universeSize: payload.universeSize,
    evaluatedSize: payload.evaluatedSize,
    eligibleSize: payload.eligibleSize,
    abstained: payload.abstained,
    longTermTotal: payload.longTermTotal,
    intradayTotal: payload.intradayTotal,
    capBreakdown: payload.capBreakdown,
    durationMs: payload.durationMs,
  }, null, 2));
}

main().catch(fail);

function cronRequest(path: string) {
  return new Request(`http://github-actions.local${path}`, {
    headers: { "user-agent": "vercel-cron/1.0" },
  });
}

function fail(error: unknown) {
  console.error(error instanceof Error ? error.message : "Wealth snapshot failed.");
  process.exitCode = 1;
}
