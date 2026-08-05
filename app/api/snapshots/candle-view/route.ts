import { NextResponse } from "next/server";
import { runCandleScanner } from "@/lib/candle-scanner";
import type { CandleMarket } from "@/lib/candle-view";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const market: CandleMarket = new URL(request.url).searchParams.get("market") === "us" ? "us" : "india";
  try { return NextResponse.json({ ok: true, snapshot: await runCandleScanner(market) }); }
  catch (error) { return NextResponse.json({ ok: false, error: String(error) }, { status: 500 }); }
}
