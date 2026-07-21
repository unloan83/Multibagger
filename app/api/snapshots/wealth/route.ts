import { NextResponse } from "next/server";
import { isRequestAuthenticated } from "@/lib/auth";
import {
  generateExpertActionMatrix,
  validateRecommendationContract,
  writeExpertActionMatrixSnapshot,
} from "@/lib/expert-insights";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// The full NIFTY 500 screen fetches hundreds of Yahoo Finance data points.
// Allow up to 5 minutes so the serverless function does not time out.
export const maxDuration = 300;

/**
 * GET /api/snapshots/wealth
 *
 * Runs the NIFTY 500 wealth screening engine, validates the output contract,
 * and writes the result to data/wealth_recommendations.json.
 *
 * This endpoint is called automatically by Vercel Cron (see vercel.json).
 * It can also be called manually by an authenticated admin session.
 *
 * The resulting snapshot is consumed by agentWealthUniverse which reads it
 * on every agent-recommendations request without making extra network calls.
 */
export async function GET(request: Request) {
  if (!(await canRunSnapshot(request))) {
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

  const contractErrors = validateRecommendationContract(matrix);
  if (contractErrors.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "Wealth snapshot failed contract validation.",
        contractErrors,
        asOf: matrix.asOf,
      },
      { status: 422 },
    );
  }

  try {
    await writeExpertActionMatrixSnapshot(matrix);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "Failed to write snapshot.", detail: String(err) },
      { status: 500 },
    );
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

async function canRunSnapshot(request: Request) {
  try {
    if (await isRequestAuthenticated()) return true;
  } catch {
    // cookies() throws outside a Next.js request scope (e.g. local runner scripts)
  }

  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") ?? "";

  if (cronSecret && authorization === `Bearer ${cronSecret}`) {
    return true;
  }

  if (!cronSecret) {
    return (request.headers.get("user-agent") ?? "").toLowerCase().includes("vercel-cron");
  }

  return false;
}
