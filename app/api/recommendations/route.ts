import { NextResponse } from "next/server";
import { readWealthRecommendationsSnapshot } from "@/lib/expert-insights";
import { readIntradayRecommendations } from "@/lib/intraday-engine";
import { readSwingRecommendations } from "@/lib/swing-engine";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [snapshot, intraday, swing] = await Promise.all([
      readWealthRecommendationsSnapshot(),
      readIntradayRecommendations(),
      readSwingRecommendations(),
    ]);

    return NextResponse.json({
      ok: true,
      asOf: snapshot?.asOf || new Date().toISOString(),
      marketRegime: snapshot?.marketRegime || "Unavailable",
      categories: snapshot?.categories || [],
      intradayPipeline: intraday,
      swingPipeline: swing,
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err), categories: [] },
      { status: 500 },
    );
  }
}
