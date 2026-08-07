import { NextResponse } from "next/server";
import { RECOMMENDATION_PUBLICATION } from "@/lib/recommendation-publication";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({
      ok: true,
      asOf: new Date().toISOString(), publication: RECOMMENDATION_PUBLICATION, marketRegime: "Unavailable", categories: [],
      intradayPipeline: { asOf: new Date().toISOString(), source: "UNAVAILABLE", isLive: false, reason: RECOMMENDATION_PUBLICATION.reason, evaluatedUniverseSize: 0, screened: [], picks: [] },
      swingPipeline: { asOf: new Date().toISOString(), source: "UNAVAILABLE", abstained: true, reason: RECOMMENDATION_PUBLICATION.reason, picksByHorizon: { "1week": [], "1month": [], "3months": [], "6months": [] }, picks: [] },
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err), categories: [] },
      { status: 500 },
    );
  }
}
