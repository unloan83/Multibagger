import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runOptionsQuantScan } from "@/features/options-quant/lib/engine";

export async function scanOptionsQuant(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const state = await runOptionsQuantScan();
  return NextResponse.json({ ok: true, state }, { headers: { "Cache-Control": "no-store, max-age=0" } });
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
