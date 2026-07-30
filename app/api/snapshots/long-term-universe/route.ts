import { NextResponse } from "next/server";
import {
  screenLongTermUniverse,
  writeLongTermUniverseSnapshot,
} from "@/lib/long-term-universe";
import { buildMarketOverview } from "@/lib/market-overview";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET /api/snapshots/long-term-universe
 *
 * Runs the thematic long-term screening engine across 6 thematic sectors
 * and writes the result to data/long_term_universe.json.
 *
 * Called by Vercel Cron or manually via the local runner script.
 */
export async function GET(request: Request) {
  if (!canRunSnapshot(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();

  let overview: Awaited<ReturnType<typeof buildMarketOverview>>;
  try {
    overview = await buildMarketOverview();
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "Market overview failed.", detail: String(err) },
      { status: 500 },
    );
  }

  const regime = deriveRegime(overview.sentiment, overview.averageMove);

  let universe: Awaited<ReturnType<typeof screenLongTermUniverse>>;
  try {
    universe = await screenLongTermUniverse(regime, startedAt);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "Long-term screener failed.", detail: String(err) },
      { status: 500 },
    );
  }

  try {
    await writeLongTermUniverseSnapshot(universe);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "Failed to write snapshot.", detail: String(err) },
      { status: 500 },
    );
  }

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

function canRunSnapshot(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") ?? "";

  if (cronSecret && authorization === `Bearer ${cronSecret}`) return true;
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
