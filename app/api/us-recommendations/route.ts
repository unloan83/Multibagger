import { NextResponse } from "next/server";
import { RECOMMENDATION_PUBLICATION } from "@/lib/recommendation-publication";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, asOf: new Date().toISOString(), market: "US", publication: RECOMMENDATION_PUBLICATION, abstained: true, reason: RECOMMENDATION_PUBLICATION.reason, termPicks: [], intradayPicks: [] });
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error), termPicks: [], intradayPicks: [] }, { status: 500 });
  }
}
