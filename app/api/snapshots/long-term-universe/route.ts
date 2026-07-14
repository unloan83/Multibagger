import { NextResponse } from "next/server";
import { isRequestAuthenticated } from "@/lib/auth";
import {
  screenLongTermUniverse,
  writeLongTermUniverseSnapshot,
} from "@/lib/long-term-universe";
import { buildMarketOverview } from "@/lib/market-overview";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Full NIFTY 500 screen fetches hundreds of data points.
// Allow up to 5 minutes to match the wealth snapshot endpoint.
export const maxDuration = 300;

/**
 * GET /api/snapshots/long-term-universe
 *
 * Runs the thematic long-term screening engine across the 6 thematic sectors
 * and writes the result to data/long_term_universe.json.
 *
 * Target output: 96 stocks (6 sectors × 4 large + 4 mid + 4 small + 4 emerging).
 * Actual count may be lower if strict quality gates eliminate candidates.
 *
 * This endpoint is called automatically by Vercel Cron (vercel.json).
 * It can also be triggered manually by an authenticated admin session.
 *
 * The snapshot is consumed read-only by agentWealthUniverse on every
 * agent-recommendations request — no live network calls at request time.
 */
export async function GET(request: Request) {
  if (!(await canRunSnapshot(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();

  // Determine market regime from the latest market overview
  const overview = await buildMarketOverview();
  const regime = deriveRegime(overview.sentiment, overview.averageMove);

  const universe = await screenLongTermUniverse(regime, startedAt);

  await writeLongTermUniverseSnapshot(universe);

  const durationMs = Date.now() - startedAt.getTime();

  return NextResponse.json({
    ok: true,
    asOf: universe.asOf,
    marketRegime: universe.marketRegime,
    totalStocks: universe.totalStocks,
    slotSummary: universe.slotSummary,
    sectorDetails: universe.sectors.map((s) => ({
      key: s.key,
      title: s.title,
      large: s.slotCounts.large,
      mid: s.slotCounts.mid,
      small: s.slotCounts.small,
      emerging: s.slotCounts.emerging,
      total: Object.values(s.slotCounts).reduce((a, b) => a + b, 0),
    })),
    durationMs,
  });
}

async function canRunSnapshot(request: Request) {
  try {
    if (await isRequestAuthenticated()) return true;
  } catch {
    // cookies() throws outside a Next.js request scope (e.g. local runner scripts)
  }

  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") ?? "";

  if (cronSecret && authorization === `Bearer ${cronSecret}`) {
    return true;
  }

  if (!cronSecret) {
    return (request.headers.get("user-agent") ?? "").toLowerCase().includes("vercel-cron");
  }

  return false;
}

function deriveRegime(
  sentiment: string,
  averageMove: number,
): "Bull Market" | "Risk-On" | "Consolidation" | "Transition" | "Correction" | "Risk-Off" {
  const norm = sentiment.toLowerCase();
  if (norm.includes("bullish") && averageMove > 1) return "Bull Market";
  if (norm.includes("bullish") || averageMove > 0.5) return "Risk-On";
  if (norm.includes("bearish") && averageMove < -1) return "Risk-Off";
  if (norm.includes("bearish") || averageMove < -0.5) return "Correction";
  if (averageMove < 0) return "Transition";
  return "Consolidation";
}
