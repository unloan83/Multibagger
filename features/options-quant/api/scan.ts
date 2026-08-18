import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runOptionsQuantCycle } from "@/features/options-quant/lib/engine";

import { createEmptyState } from "@/features/options-quant/lib/store";

export async function scanOptionsQuant(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  try {
    const state = await runOptionsQuantCycle();
    return NextResponse.json({ ok: true, state }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    const fallback = createEmptyState();
    fallback.noTradeReasons = [error instanceof Error ? error.message : "Options Quant scan failed."];
    return NextResponse.json({ ok: true, state: fallback }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}

function isAuthorized(request: Request): boolean {
  const expected = process.env.OPTIONS_QUANT_INGEST_TOKEN || process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(expected && supplied && safeEqual(expected, supplied));
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
