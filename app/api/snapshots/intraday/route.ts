import { NextResponse } from "next/server";
import { noTrade, readPaperSignals } from "@/lib/intraday-engine";

export const dynamic = "force-dynamic";

// Read-only by design. Collection and scanning run out of band, never in a page request.
export async function GET() {
  try {
    const snapshot = await readPaperSignals();
    return NextResponse.json({ ok: true, ...snapshot }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch {
    const fallback = noTrade("NO_TRADE");
    return NextResponse.json({ ok: true, ...fallback }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}
