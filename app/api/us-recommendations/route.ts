import { NextResponse } from "next/server";
import { readUsMarketSnapshot } from "@/lib/us-market-engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, ...(await readUsMarketSnapshot()) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error), termPicks: [], intradayPicks: [] }, { status: 500 });
  }
}
