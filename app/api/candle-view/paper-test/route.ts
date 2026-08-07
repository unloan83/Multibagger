import { NextResponse } from "next/server";
import { runPaperCycle, startPaperSession } from "@/lib/dhan-paper-trading";
import { RECOMMENDATION_PUBLICATION } from "@/lib/recommendation-publication";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  return NextResponse.json({ ok: true, session: null, configured: false, quoteProvider: null, publication: RECOMMENDATION_PUBLICATION });
}

export async function POST(request: Request) {
  if (!RECOMMENDATION_PUBLICATION.enabled) return NextResponse.json({ ok: false, publication: RECOMMENDATION_PUBLICATION, error: RECOMMENDATION_PUBLICATION.reason }, { status: 423 });
  console.log("[paper-test] request started");
  try {
    const body = await request.json().catch(() => ({})) as { action?: string };
    const session = body.action === "start" ? await startPaperSession() : await runPaperCycle();
    const latestCycle = session.cycles.at(-1);
    console.log("[paper-test] request completed", { action: body.action, outcome: latestCycle?.outcome, evaluated: latestCycle?.evaluated, qualified: latestCycle?.qualified, trades: session.trades.length });
    return NextResponse.json({ ok: true, session, configured: true, quoteProvider: "YAHOO_INTRADAY_FREE" });
  } catch (error) {
    console.error("[paper-test] request failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Paper cycle failed." }, { status: 422 });
  }
}
