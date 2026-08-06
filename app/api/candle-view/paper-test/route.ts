import { NextResponse } from "next/server";
import { getPaperSession, hasDhanCredentials, runPaperCycle, startPaperSession } from "@/lib/dhan-paper-trading";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  return NextResponse.json({ ok: true, session: await getPaperSession(), configured: hasDhanCredentials() });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { action?: string };
    const session = body.action === "start" ? await startPaperSession() : await runPaperCycle();
    return NextResponse.json({ ok: true, session, configured: hasDhanCredentials() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Paper cycle failed." }, { status: 422 });
  }
}
