import { NextResponse } from "next/server";
import { createEmptyState, readOptionsQuantState } from "@/features/options-quant/lib/store";

export async function getOptionsQuantDashboard() {
  try {
    const state = await readOptionsQuantState();
    return NextResponse.json({ ok: true, state }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch {
    return NextResponse.json(
      { ok: true, state: createEmptyState() },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}
