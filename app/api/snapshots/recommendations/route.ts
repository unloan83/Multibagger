import { NextResponse } from "next/server";
import { isRequestAuthenticated } from "@/lib/auth";
import { buildExpertActionMatrix } from "@/lib/expert-insights";
import {
  calculateStopLoss,
  validateRecommendationQuality,
  type QualityFactors,
} from "@/lib/intelligence-validation";
import { buildMarketOverview } from "@/lib/market-overview";
import {
  appendValidationRows,
  isGoogleSheetsConfigured,
  readPortfoliosFromSheets,
  readValidationRecords,
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
  const [expertMatrix, marketOverview] = await Promise.all([
    buildExpertActionMatrix(),
    buildMarketOverview(),
  ]);
  const historicalRecommendations = validationHistoryToRecommendations(
    await readValidationRecords(),
  );
  const marketRegime = getMarketRegime(marketOverview.sentiment, marketOverview.averageMove);
  const validationDate = timestamp.slice(0, 10);
  const expertRows = expertMatrix.categories.flatMap((category) => [
    ...category.longTermUpsides.map((quote, index) => {
      const qualityFactors = expertQualityFactors(quote, marketRegime);
      const qualityScore = Math.round(
        (Object.values(qualityFactors).filter(Boolean).length /
          Object.keys(qualityFactors).length) *
          100,
      );
      return {
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
      portfolioId: "expert-insight",
      recommendationId: `expert-${validationDate}-${quote.symbol}-long-${index}`,
      sector: quote.sector || category.title,
      stopLoss: calculateStopLoss(quote.price, quote.action, "1-3 Yr Plan"),
      qualityScore,
      qualityStatus: (qualityScore >= 85 ? "PASS" : "FAIL") as "PASS" | "FAIL",
      validationTimestamp: timestamp,
      validationDate,
      returnPercent: 0,
      marketRegime,
      qualityFactors,
    };
    }),
    ...category.intradayBreakouts.map((quote, index) => {
      const qualityFactors = expertQualityFactors(quote, marketRegime);
      const qualityScore = Math.round(
        (Object.values(qualityFactors).filter(Boolean).length /
          Object.keys(qualityFactors).length) *
          100,
      );
      return {
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
      portfolioId: "expert-insight",
      recommendationId: `expert-${validationDate}-${quote.symbol}-intraday-${index}`,
      sector: quote.sector || category.title,
      stopLoss: calculateStopLoss(quote.price, quote.action, "Intraday"),
      qualityScore,
      qualityStatus: (qualityScore >= 85 ? "PASS" : "FAIL") as "PASS" | "FAIL",
      validationTimestamp: timestamp,
      validationDate,
      returnPercent: 0,
      marketRegime,
      qualityFactors,
    };
    }),
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
      recommendations: generateRecommendationList(portfolio, historicalRecommendations),
      source: "portfolio-recommendation",
      timestamp,
      marketRegime,
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
        recommendations: generateRecommendationList(marketPortfolio, historicalRecommendations),
        source: "market-recommendation",
        timestamp,
        marketRegime,
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

function expertQualityFactors(
  quote: {
    sector: string;
    dataQuality: number;
    score: number;
    metrics: { ema20: number; ema50: number; riskScore: number };
  },
  marketRegime: string,
): QualityFactors {
  return {
    marketRegimeAvailable: Boolean(marketRegime),
    sectorStrengthAvailable: Boolean(quote.sector),
    trendConfirmationAvailable:
      quote.metrics.ema20 > 0 &&
      quote.metrics.ema50 > 0 &&
      quote.metrics.ema20 >= quote.metrics.ema50,
    riskScoreAssigned: Number.isFinite(quote.metrics.riskScore),
    confidenceCalculated:
      quote.dataQuality >= 80 && quote.score >= 0 && quote.score <= 100,
    portfolioFitChecked: false,
    recommendationHorizonAssigned: true,
  };
}

async function canRunSnapshot(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") ?? "";

  if (cronSecret && authorization === `Bearer ${cronSecret}`) return true;
  if (!cronSecret && (request.headers.get("user-agent") ?? "").toLowerCase().includes("vercel-cron")) {
    return true;
  }
  return isRequestAuthenticated();
}

function generateRecommendationList(
  portfolio: ManagedPortfolio,
  history: Recommendation[],
) {
  const recommendations = generateRecommendations(portfolio, history);

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
  marketRegime,
}: {
  portfolio: ManagedPortfolio;
  recommendations: Recommendation[];
  source: ValidationSource;
  timestamp: string;
  marketRegime: string;
}): ValidationRow[] {
  return recommendations.map((recommendation) => {
    const position = portfolio.positions.find(
      (item) => item.symbol === recommendation.symbol,
    );
    const predictedPrice = position?.currentPrice ?? 0;
    const targetPrice = recommendation.metrics?.target ?? 0;
    const sector = position?.sector ?? "Unclassified";
    const quality = validateRecommendationQuality({
      recommendation,
      marketRegime,
      sector,
      portfolioFitChecked: Boolean(portfolio.id),
    });

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
      portfolioId: portfolio.id,
      recommendationId: recommendation.id,
      sector,
      stopLoss: calculateStopLoss(
        predictedPrice,
        recommendation.action,
        recommendation.section,
        recommendation.metrics?.riskScore,
      ),
      qualityScore: quality.score,
      qualityStatus: quality.status,
      validationTimestamp: timestamp,
      validationDate: timestamp.slice(0, 10),
      returnPercent: 0,
      marketRegime,
      qualityFactors: quality.factors,
    };
  });
}

function validationHistoryToRecommendations(
  records: Awaited<ReturnType<typeof readValidationRecords>>,
): Recommendation[] {
  return records
    .filter(
      (record) =>
        record.qualityStatus === "PASS" &&
        (record.validationStatus === "Hit" || record.validationStatus === "Miss"),
    )
    .map((record) => ({
      id: record.recommendationId,
      portfolioId: record.portfolioId,
      portfolioName: record.portfolioName,
      section: normalizeRecommendationSection(record.section),
      symbol: record.symbol,
      company: record.company,
      action: record.action === "Urgent Sell" ? "Urgent Sell" : "Accumulate",
      horizon: record.horizon,
      rationale: record.rationale,
      confidence: record.confidence,
      createdAt: record.timestamp,
      status: record.validationStatus === "Hit" ? "Hit" : "Miss",
    }));
}

function normalizeRecommendationSection(value: string): Recommendation["section"] {
  if (
    value === "Intraday" ||
    value === "1-3 Yr Plan" ||
    value === "Multibagger" ||
    value === "ETF" ||
    value === "Sector Allocation"
  ) {
    return value;
  }
  return "1-3 Yr Plan";
}

function getMarketRegime(
  sentiment: "Positive" | "Negative" | "Neutral",
  averageMove: number,
) {
  if (sentiment === "Positive" && averageMove > 1.2) return "Bull Market";
  if (sentiment === "Positive") return "Risk-On";
  if (sentiment === "Negative" && averageMove < -1.2) return "Risk-Off";
  if (sentiment === "Negative") return "Correction";
  return Math.abs(averageMove) < 0.35 ? "Consolidation" : "Transition";
}
