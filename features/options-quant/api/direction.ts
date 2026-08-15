import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { ingestDirectionEvidence } from "@/features/options-quant/lib/engine";

export async function updateOptionsQuantDirection(request: Request) {
  const expected = process.env.OPTIONS_QUANT_INGEST_TOKEN;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !supplied || !safeEqual(expected, supplied)) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  try {
    const state = await ingestDirectionEvidence(await request.json());
    return NextResponse.json({ ok: true, state });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Invalid direction evidence." }, { status: 400 });
  }
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
