import { NextResponse } from "next/server";
import { readCandleScan, runCandleScanner } from "@/lib/candle-scanner";
import type { CandleMarket } from "@/lib/candle-view";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function marketOf(request: Request): CandleMarket { return new URL(request.url).searchParams.get("market") === "us" ? "us" : "india"; }

export async function GET(request: Request) {
  const snapshot = await readCandleScan(marketOf(request));
  return NextResponse.json({ ok: true, snapshot });
}

export async function POST(request: Request) {
  try {
    return NextResponse.json({ ok: true, snapshot: await runCandleScanner(marketOf(request)) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Market scan failed." }, { status: 500 });
  }
}
