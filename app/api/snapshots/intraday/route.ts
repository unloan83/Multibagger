import { NextResponse } from "next/server";
import { runIntradayPipeline, type IntradaySlot } from "@/lib/intraday-engine";
import { logRecommendationsToSheet } from "@/lib/google-sheets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET /api/snapshots/intraday?slot=09:08
 * Triggers the Intraday Real-Time Recommendation Pipeline for 9:08 AM, 10:45 AM, or 1:45 PM IST.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slotParam = searchParams.get("slot") as IntradaySlot | null;
  const slot: IntradaySlot = slotParam && ["09:08", "10:45", "13:45"].includes(slotParam) ? slotParam : "09:08";

  const startedAt = new Date();

  try {
    const snapshot = await runIntradayPipeline(slot);

    // Optional Google Sheets logging
    if (process.env.GOOGLE_SHEET_ID) {
      const recs = snapshot.picks.map((pick) => ({
        source: `intraday-snapshot-${slot}`,
        category: pick.marketCapCategory,
        type: "intraday" as const,
        symbol: pick.symbol,
        name: pick.name,
        action: pick.action,
        score: pick.score,
        price: pick.price,
        target: pick.target,
        upside: pick.upside,
        sector: pick.sector,
        marketRegime: snapshot.indexTrend.trend,
      }));
      logRecommendationsToSheet(recs).catch(() => {});
    }

    const durationMs = Date.now() - startedAt.getTime();

    return NextResponse.json({
      ok: true,
      asOf: snapshot.asOf,
      slot: snapshot.slot,
      slotLabel: snapshot.slotLabel,
      marketBreadth: snapshot.marketBreadth,
      indexTrend: snapshot.indexTrend,
      totalPicks: snapshot.picks.length,
      picks: snapshot.picks,
      durationMs,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "Intraday pipeline execution failed.", detail: String(err) },
      { status: 500 },
    );
  }
}
