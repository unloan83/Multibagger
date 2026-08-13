import { NextResponse } from "next/server";
import { runTermAgentAnalysis } from "@/lib/term-agent-analysis";
import { RECOMMENDATION_PUBLICATION } from "@/lib/recommendation-publication";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/** Refreshes the term-analysis snapshot after the Indian market closes. */
export async function GET(request: Request) {
  if (!RECOMMENDATION_PUBLICATION.legacyEnabled) return NextResponse.json({ ok: true, skipped: true, publication: RECOMMENDATION_PUBLICATION });
  if (!canRunSnapshot(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const snapshot = await runTermAgentAnalysis();
    return NextResponse.json({
      ok: true,
      asOf: snapshot.asOf,
      totalPicks: snapshot.totalPicks,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "Term pipeline execution failed.", detail: String(error) },
      { status: 500 },
    );
  }
}

function canRunSnapshot(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") ?? "";

  if (cronSecret && authorization === `Bearer ${cronSecret}`) return true;
  if (!cronSecret) {
    return (request.headers.get("user-agent") ?? "")
      .toLowerCase()
      .includes("vercel-cron");
  }
  return false;
}
