import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { readPaperSignals, validSnapshot } from "@/lib/intraday-engine";
import { writeSnapshotFile } from "@/lib/snapshot-storage";
import { RECOMMENDATION_PUBLICATION } from "@/lib/recommendation-publication";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const snapshot = await readPaperSignals();
  const picks = snapshot.signals.map((signal) => ({
    symbol: signal.symbol, name: signal.symbol, price: signal.entry, previousClose: signal.entry,
    changePercent: 0, target: signal.target, stopLoss: signal.stop,
    upside: ((signal.target - signal.entry) / signal.entry) * 100,
    score: signal.rank_score, rank_score: signal.rank_score, action: "PAPER_BUY",
    remark: `${signal.strategy} paper signal; expires ${signal.expiry}`,
    theme: signal.strategy, sector: "NSE Cash", strategy: signal.strategy,
    timestamp: signal.timestamp, expiry: signal.expiry, run_id: signal.run_id,
  }));
  return NextResponse.json({
    ok: true, status: snapshot.status, asOf: snapshot.asOf, publication: RECOMMENDATION_PUBLICATION,
    intradayPipeline: { asOf: snapshot.asOf, source: snapshot.source, isLive: snapshot.status === "SIGNALS", reason: snapshot.reason, evaluatedUniverseSize: snapshot.evaluatedUniverseSize, screened: [], picks },
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

// Authenticated snapshot ingestion for the external collector/scanner job. It never scans.
export async function POST(request: Request) {
  const expected = process.env.SIGNAL_INGEST_TOKEN || "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!expected || !safeEqual(expected, supplied)) return NextResponse.json({ ok: false }, { status: 401 });
  const body = await request.json();
  if (!validSnapshot(body)) {
    return NextResponse.json({ ok: false, error: "Invalid snapshot" }, { status: 400 });
  }
  await writeSnapshotFile("paper_signals.json", JSON.stringify(body));
  return NextResponse.json({ ok: true, status: body.status });
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
