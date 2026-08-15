import { NextResponse } from "next/server";
import { readOptionsQuantState } from "@/features/options-quant/lib/store";

export async function getOptionsQuantDashboard() {
  const state = await readOptionsQuantState();
  return NextResponse.json({ ok: true, state }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
