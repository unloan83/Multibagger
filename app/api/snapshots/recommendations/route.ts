import { NextResponse } from "next/server";
import { isRequestAuthenticated } from "@/lib/auth";
import { buildExpertActionMatrix } from "@/lib/expert-insights";
import {
  appendValidationRows,
  isGoogleSheetsConfigured,
  readPortfoliosFromSheets,
  type ValidationRow,
  type ValidationSource,
} from "@/lib/google-sheets";
import {
  generateRecommendations,
  marketRecommendationPortfolio,
  type ManagedPortfolio,
  type Recommendation,
} from "@/lib/portfolio";
import { resolveQuotePositions } from "@/lib/quote-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await canRunSnapshot(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json(
      { error: "Google Sheets is not configured." },
      { status: 503 },
    );
  }

  const timestamp = new Date().toISOString();
  const expertMatrix = await buildExpertActionMatrix();
  const expertRows = expertMatrix.categories.flatMap((category) => [
    ...category.longTermUpsides.map((quote) => ({
      timestamp,
      source: "expert-insight" as const,
      portfolioName: "Expert Insight",
      section: `${category.title} | Long-Term Upsides`,
      symbol: quote.symbol,
      company: quote.name,
      action: quote.action,
      horizon: "6-12 months",
      predictedPrice: quote.price,
      targetPrice: quote.target,
      predictedUpsidePercent: quote.upside,
      score: quote.score,
      confidence: quote.score,
      caveat: quote.caveats[0] ?? expertMatrix.caveat,
      rationale: quote.remark,
    })),
    ...category.intradayBreakouts.map((quote) => ({
      timestamp,
      source: "expert-insight" as const,
      portfolioName: "Expert Insight",
      section: `${category.title} | Intraday Breakouts`,
      symbol: quote.symbol,
      company: quote.name,
      action: quote.action,
      horizon: "Today | 5-15 min refresh",
      predictedPrice: quote.price,
      targetPrice: quote.target,
      predictedUpsidePercent: quote.upside,
      score: quote.score,
      confidence: quote.score,
      caveat: quote.caveats[0] ?? expertMatrix.caveat,
      rationale: quote.remark,
    })),
  ]);

  const sheetPortfolios = await readPortfoliosFromSheets();
  const repricedPortfolios = await Promise.all(
    sheetPortfolios
      .filter((portfolio) => portfolio.inputs.length > 0)
      .map(async (portfolio) => ({
        ...portfolio,
        positions: await resolveQuotePositions(portfolio.inputs),
        refreshedAt: timestamp,
      })),
  );
  const portfolioRows = repricedPortfolios.flatMap((portfolio) =>
    recommendationRowsForPortfolio({
      portfolio,
      recommendations: generateRecommendationList(portfolio),
      source: "portfolio-recommendation",
      timestamp,
    }),
  );

  const repeatedExpertInputs = expertMatrix.consecutivePicks.map((pick) => ({
    stockCode: pick.symbol,
    company: pick.name,
    stock: pick.symbol,
    quantity: 0,
    list: "watchlist" as const,
  }));
  const marketPortfolio =
    repeatedExpertInputs.length === 0
      ? null
      : {
          ...marketRecommendationPortfolio,
          inputs: repeatedExpertInputs,
          positions: await resolveQuotePositions(repeatedExpertInputs),
          refreshedAt: timestamp,
        };
  const marketRows = marketPortfolio
    ? recommendationRowsForPortfolio({
        portfolio: marketPortfolio,
        recommendations: generateRecommendationList(marketPortfolio),
        source: "market-recommendation",
        timestamp,
      })
    : [];

  const rows = [...expertRows, ...portfolioRows, ...marketRows];
  await appendValidationRows(rows);

  return NextResponse.json({
    ok: true,
    appended: rows.length,
    expertRows: expertRows.length,
    portfolioRows: portfolioRows.length,
    marketRecommendationRows: marketRows.length,
    timestamp,
  });
}

async function canRunSnapshot(request: Request) {
  if (await isRequestAuthenticated()) {
    return true;
  }

  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") ?? "";

  if (cronSecret) {
    return authorization === `Bearer ${cronSecret}`;
  }

  return (request.headers.get("user-agent") ?? "").toLowerCase().includes("vercel-cron");
}

function generateRecommendationList(portfolio: ManagedPortfolio) {
  const recommendations = generateRecommendations(portfolio);

  return [
    ...recommendations.intraday,
    ...recommendations.longTermPlan,
    ...recommendations.multibaggerCandidates,
    ...recommendations.etfs,
  ];
}

function recommendationRowsForPortfolio({
  portfolio,
  recommendations,
  source,
  timestamp,
}: {
  portfolio: ManagedPortfolio;
  recommendations: Recommendation[];
  source: ValidationSource;
  timestamp: string;
}): ValidationRow[] {
  return recommendations.map((recommendation) => {
    const position = portfolio.positions.find(
      (item) => item.symbol === recommendation.symbol,
    );
    const predictedPrice = position?.currentPrice ?? 0;
    const targetPrice = recommendation.metrics?.target ?? 0;

    return {
      timestamp,
      source,
      portfolioName: portfolio.name,
      section: recommendation.section,
      symbol: recommendation.symbol,
      company: recommendation.company,
      action: recommendation.action,
      horizon: recommendation.horizon,
      predictedPrice,
      targetPrice,
      predictedUpsidePercent:
        predictedPrice === 0 || targetPrice === 0
          ? 0
          : ((targetPrice - predictedPrice) / predictedPrice) * 100,
      score: recommendation.metrics?.finalScore ?? recommendation.confidence,
      confidence: recommendation.confidence,
      caveat:
        recommendation.caveats?.[0] ??
        "Model output is a screening signal; validate with fundamentals and live market context.",
      rationale: recommendation.rationale,
    };
  });
}
