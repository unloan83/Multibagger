import { NextResponse } from "next/server";
import { getBreezeMultibaggerSnapshot } from "@/features/breeze/lib/breeze-multibagger";

export async function getBreezeMultibagger() {
  try {
    const snapshot = await getBreezeMultibaggerSnapshot();
    return NextResponse.json({ ok: true, snapshot }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Breeze Multibagger snapshot is unavailable.", detail: String(error) }, { status: 503 });
  }
}
