import { NextResponse } from "next/server";
import { runCandleScanner } from "@/lib/candle-scanner";
import type { CandleMarket } from "@/lib/candle-view";
import { RECOMMENDATION_PUBLICATION } from "@/lib/recommendation-publication";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function marketOf(request: Request): CandleMarket { return new URL(request.url).searchParams.get("market") === "us" ? "us" : "india"; }

export async function GET(request: Request) {
  void request;
  return NextResponse.json({ ok: true, publication: RECOMMENDATION_PUBLICATION, snapshot: null });
}

export async function POST(request: Request) {
  if (!RECOMMENDATION_PUBLICATION.enabled) return NextResponse.json({ ok: false, publication: RECOMMENDATION_PUBLICATION, error: RECOMMENDATION_PUBLICATION.reason }, { status: 423 });
  try {
    return NextResponse.json({ ok: true, snapshot: await runCandleScanner(marketOf(request)) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Market scan failed." }, { status: 500 });
  }
}
