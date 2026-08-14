import { NextResponse } from "next/server";
import { getBreezeMultibaggerSnapshot } from "@/lib/breeze-multibagger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const snapshot = await getBreezeMultibaggerSnapshot();
    return NextResponse.json({ ok: true, snapshot }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Breeze Multibagger snapshot is unavailable.", detail: String(error) }, { status: 503 });
  }
}
