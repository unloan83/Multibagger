import { NextResponse } from "next/server";
import { runSwingPipeline } from "@/lib/swing-engine";
import { logRecommendationsToSheet } from "@/lib/google-sheets";
import { RECOMMENDATION_PUBLICATION } from "@/lib/recommendation-publication";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET /api/snapshots/swing
 * Triggers the Swing/Positional EOD Pipeline (7:00 PM IST)
 */
export async function GET() {
  if (!RECOMMENDATION_PUBLICATION.legacyEnabled) return NextResponse.json({ ok: true, skipped: true, publication: RECOMMENDATION_PUBLICATION });
  const startedAt = new Date();

  try {
    const snapshot = await runSwingPipeline();

    // Optional Google Sheets logging
    if (process.env.GOOGLE_SHEET_ID) {
      const recs = snapshot.picks.map((pick) => ({
        source: "swing-snapshot-eod",
        category: pick.marketCapCategory,
        type: "longTerm" as const,
        symbol: pick.symbol,
        name: pick.name,
        action: pick.action,
        score: pick.score,
        price: pick.price,
        target: pick.target,
        upside: pick.upside,
        sector: pick.sector,
        marketRegime: snapshot.marketRegime,
      }));
      logRecommendationsToSheet(recs).catch(() => {});
    }

    const durationMs = Date.now() - startedAt.getTime();

    return NextResponse.json({
      ok: true,
      asOf: snapshot.asOf,
      runTimeIST: snapshot.runTimeIST,
      marketRegime: snapshot.marketRegime,
      evaluatedUniverseSize: snapshot.evaluatedUniverseSize,
      totalPicks: snapshot.picks.length,
      picksByHorizon: snapshot.picksByHorizon,
      durationMs,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "Swing EOD pipeline execution failed.", detail: String(err) },
      { status: 500 },
    );
  }
}
