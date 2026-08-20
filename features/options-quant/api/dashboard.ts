import { NextResponse } from "next/server";
import { createEmptyState, readOptionsQuantState } from "@/features/options-quant/lib/store";

export async function getOptionsQuantDashboard() {
  try {
    const state = await readOptionsQuantState();
    if (Date.parse(state.asOf) === 0) {
      state.noTradeReasons = ["No durable Options Quant evaluation has been persisted."];
      return NextResponse.json({
        ok: false,
        error: "Options Quant has no persisted evaluation; no current trading status can be verified.",
        state,
      }, { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } });
    }
    return NextResponse.json({ ok: true, state }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    const state = createEmptyState();
    state.noTradeReasons = ["Options Quant durable state is unavailable; no current trading status can be verified."];
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Options Quant durable state is unavailable.",
      state,
    }, { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}
