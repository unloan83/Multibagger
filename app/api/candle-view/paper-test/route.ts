import { NextResponse } from "next/server";
import { getPaperSession, runPaperCycle, startPaperSession } from "@/lib/dhan-paper-trading";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  return NextResponse.json({ ok: true, session: await getPaperSession(), configured: true, quoteProvider: "YAHOO_INTRADAY_FREE" });
}

export async function POST(request: Request) {
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
