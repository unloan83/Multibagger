import { NextResponse } from "next/server";
import {
  generateExpertActionMatrix,
  writeExpertActionMatrixSnapshot,
} from "@/lib/expert-insights";
import { logRecommendationsToSheet } from "@/lib/google-sheets";
import { RECOMMENDATION_PUBLICATION } from "@/lib/recommendation-publication";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET /api/snapshots/wealth
 *
 * Runs the NIFTY 500 wealth screening engine, validates the output contract,
 * writes the result to data/wealth_recommendations.json, and logs to Google Sheets.
 *
 * Called by Vercel Cron or manually via the local runner script.
 */
export async function GET(request: Request) {
  if (!RECOMMENDATION_PUBLICATION.enabled) return NextResponse.json({ ok: true, skipped: true, publication: RECOMMENDATION_PUBLICATION });
  if (!canRunSnapshot(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();

  let matrix: Awaited<ReturnType<typeof generateExpertActionMatrix>>;
  try {
    matrix = await generateExpertActionMatrix();
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "Screener failed.", detail: String(err) },
      { status: 500 },
    );
  }

  try {
    await writeExpertActionMatrixSnapshot(matrix);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "Failed to write snapshot.", detail: String(err) },
      { status: 422 },
    );
  }

  // Log to Google Sheets (non-blocking — logs on best-effort basis)
  if (process.env.GOOGLE_SHEET_ID) {
    const recommendations = matrix.categories.flatMap((category) => {
      const longTerm = category.longTermUpsides.map((q) => ({
        source: "wealth-snapshot",
        category: category.key,
        type: "longTerm" as const,
        symbol: q.symbol,
        name: q.name,
        action: q.action,
        score: q.score,
        price: q.price,
        target: q.target,
        upside: q.upside,
        sector: q.sector,
        marketRegime: matrix.marketRegime,
      }));
      const intraday = category.intradayBreakouts.map((q) => ({
        source: "wealth-snapshot",
        category: category.key,
        type: "intraday" as const,
        symbol: q.symbol,
        name: q.name,
        action: q.action,
        score: q.score,
        price: q.price,
        target: q.target,
        upside: q.upside,
        sector: q.sector,
        marketRegime: matrix.marketRegime,
      }));
      return [...longTerm, ...intraday];
    });

    logRecommendationsToSheet(recommendations).catch(() => {});
  }

  const longTermTotal = matrix.categories.reduce(
    (sum, category) => sum + category.longTermUpsides.length,
    0,
  );
  const intradayTotal = matrix.categories.reduce(
    (sum, category) => sum + category.intradayBreakouts.length,
    0,
  );
  const durationMs = Date.now() - startedAt.getTime();

  return NextResponse.json({
    ok: true,
    asOf: matrix.asOf,
    marketRegime: matrix.marketRegime,
    universeSize: matrix.universeSize,
    evaluatedSize: matrix.evaluatedSize,
    eligibleSize: matrix.eligibleSize,
    abstained: matrix.abstained,
    longTermTotal,
    intradayTotal,
    capBreakdown: matrix.categories.map((category) => ({
      key: category.key,
      title: category.title,
      longTerm: category.longTermUpsides.length,
      intraday: category.intradayBreakouts.length,
    })),
    durationMs,
  });
}

function canRunSnapshot(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") ?? "";

  if (cronSecret && authorization === `Bearer ${cronSecret}`) return true;
  if (!cronSecret) {
    return (request.headers.get("user-agent") ?? "").toLowerCase().includes("vercel-cron");
  }
  return false;
}
