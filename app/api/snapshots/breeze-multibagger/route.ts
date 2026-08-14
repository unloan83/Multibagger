import { NextResponse } from "next/server";
import { buildBreezeMultibaggerSnapshot, writeBreezeMultibaggerSnapshot } from "@/lib/breeze-multibagger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!canRun(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const snapshot = await buildBreezeMultibaggerSnapshot({ refreshEtfs: true });
    await writeBreezeMultibaggerSnapshot(snapshot);
    return NextResponse.json({ ok: true, asOf: snapshot.asOf, stocks: snapshot.topCandidates.length, etfs: snapshot.etfOpportunities.length, ipos: snapshot.upcomingIpos.length, history: snapshot.historyCount });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Refresh failed.", detail: String(error) }, { status: 500 });
  }
}

function canRun(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (secret) return auth === `Bearer ${secret}`;
  return (request.headers.get("user-agent") ?? "").toLowerCase().includes("vercel-cron");
}
