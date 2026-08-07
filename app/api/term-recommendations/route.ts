import { NextResponse } from "next/server";
import { RECOMMENDATION_PUBLICATION } from "@/lib/recommendation-publication";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(
      { ok: true, asOf: new Date().toISOString(), publication: RECOMMENDATION_PUBLICATION, abstained: true, reason: RECOMMENDATION_PUBLICATION.reason, totalPicks: 0, picks: [], byDuration: { "1week": [], "1month": [], "3months": [], "6months": [] } },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err), picks: [] },
      { status: 500 }
    );
  }
}
