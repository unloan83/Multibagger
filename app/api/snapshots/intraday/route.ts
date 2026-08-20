import { NextResponse } from "next/server";
import { readPaperSignals } from "@/lib/intraday-engine";

export const dynamic = "force-dynamic";

// Read-only by design. Collection and scanning run out of band, never in a page request.
export async function GET() {
  try {
    const snapshot = await readPaperSignals();
    return NextResponse.json({ ok: true, ...snapshot }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      status: "DATA_UNAVAILABLE",
      error: error instanceof Error ? error.message : "Intraday paper state is unavailable.",
    }, { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}
