import { NextResponse } from "next/server";
import { runUsMarketPipeline } from "@/lib/us-market-engine";
import { RECOMMENDATION_PUBLICATION } from "@/lib/recommendation-publication";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!RECOMMENDATION_PUBLICATION.enabled) return NextResponse.json({ ok: true, skipped: true, publication: RECOMMENDATION_PUBLICATION });
  if (!canRun(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const snapshot = await runUsMarketPipeline();
    return NextResponse.json({ ok: true, asOf: snapshot.asOf, termPicks: snapshot.termPicks.length, intradayPicks: snapshot.intradayPicks.length });
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}

function canRun(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") === `Bearer ${secret}`) return true;
  return !secret && (request.headers.get("user-agent") ?? "").toLowerCase().includes("vercel-cron");
}
