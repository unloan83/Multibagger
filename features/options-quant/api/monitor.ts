import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runOptionsRiskMonitor } from "@/features/options-quant/lib/engine";

export async function monitorOptionsQuant(request: Request) {
  const expected = process.env.OPTIONS_QUANT_INGEST_TOKEN || process.env.CRON_SECRET || "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!expected || !supplied || !safeEqual(expected, supplied)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  try {
    const state = await runOptionsRiskMonitor();
    return NextResponse.json({ ok: true, state }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Options risk monitor failed.",
    }, { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
