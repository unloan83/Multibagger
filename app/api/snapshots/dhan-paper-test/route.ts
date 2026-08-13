import { NextResponse } from "next/server";
import { getPaperSession, runPaperCycle } from "@/lib/dhan-paper-trading";
import { RECOMMENDATION_PUBLICATION } from "@/lib/recommendation-publication";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  if (!RECOMMENDATION_PUBLICATION.legacyEnabled) return NextResponse.json({ ok: true, skipped: true, publication: RECOMMENDATION_PUBLICATION });
  try {
    const session = await getPaperSession();
    if (!session || session.status !== "ACTIVE") return NextResponse.json({ ok: true, skipped: true, reason: "No active paper session." });
    return NextResponse.json({ ok: true, session: await runPaperCycle() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Paper cycle failed." }, { status: 500 });
  }
}
