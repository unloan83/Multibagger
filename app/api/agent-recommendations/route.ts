import { NextResponse } from "next/server";
import { normalizePortfolioName } from "@/lib/account-utils";
import { canAccessPortfolio, getCurrentSessionUser } from "@/lib/auth";
import { runMultiAgentRecommendationSystem } from "@/lib/agents/service";
import { buildMarketOverview } from "@/lib/market-overview";
import {
  isGoogleSheetsConfigured,
  readPortfoliosFromSheets,
  readValidationRecords,
} from "@/lib/google-sheets";
import {
  readPortfoliosFromCsvBackup,
  shouldUsePortfolioCsvBackup,
} from "@/lib/portfolio-backup";
import {
  buildPortfolioInputRow,
  identifySector,
  parseQuantity,
  type ManagedPortfolio,
  type PortfolioInputRow,
  type PortfolioPosition,
} from "@/lib/portfolio";
import { resolveQuotePositions } from "@/lib/quote-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

type RequestBody = {
  portfolioId?: string;
  inputs?: Array<Partial<PortfolioInputRow>>;
  positions?: Array<Partial<PortfolioPosition>>;
};

export async function POST(request: Request) {
  const user = await getCurrentSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as RequestBody;
  const portfolios = await loadPortfolios();
  const portfolio = await resolvePortfolio(portfolios, body, user);

  if (!portfolio) {
    return NextResponse.json(
      { error: "No portfolio is mapped to this profile. Please contact admin." },
      { status: 403 },
    );
  }

  const postedPositions = sanitizePositions(body.positions ?? [], portfolio.inputs);
  const positions = postedPositions.length
    ? postedPositions
    : portfolio.inputs.length
      ? await resolveQuotePositions(portfolio.inputs)
      : portfolio.positions;

  if (!positions.some((position) => position.currentPrice > 0)) {
    return NextResponse.json(
      { error: "No current quote snapshot is available for agent recommendations." },
      { status: 400 },
    );
  }

  const enrichedPortfolio: ManagedPortfolio = {
    ...portfolio,
    inputs: portfolio.inputs.length ? portfolio.inputs : positions.map(positionToInput),
    positions,
    refreshedAt: new Date().toISOString(),
  };
  const [market, history] = await Promise.all([
    buildMarketOverview(),
    readValidationRecords(),
  ]);
  const output = await runMultiAgentRecommendationSystem({
    portfolio: enrichedPortfolio,
    market,
    history,
    persist: false,
  });
  const prices = Object.fromEntries(
    positions.map((position) => [normalizeSymbol(position.symbol), position.currentPrice]),
  );

  return NextResponse.json({
    generatedAt: output.generatedAt,
    portfolioId: enrichedPortfolio.id,
    portfolioName: enrichedPortfolio.name,
    mode: "agent-orchestrated",
    disclaimer: output.disclaimer,
    summaries: {
      info: output.info.sourceSummary.join(" ") || `${output.info.events.length} intelligence events evaluated.`,
      macroPolicy: output.macroPolicy.reasons.join(" ") || `Macro-policy score ${output.macroPolicy.marketScore}.`,
      sentiment: `${output.sentiment.market.classification} market sentiment; low-quality source share ${(output.sentiment.lowQualityShare * 100).toFixed(0)}%.`,
      portfolio: output.portfolio.reasons.join(" ") || `${output.portfolio.stocks.length} portfolio holdings evaluated.`,
      growth: `${output.growth.candidates.length} portfolio candidates evaluated by the growth agent.`,
      riskValidation: `${output.riskValidation.decisions.length} risk-validation decisions completed.`,
      fundamental: output.fundamental.summary,
      technical: output.technical.summary,
      intraday: output.intraday.summary,
      swing: output.swing.summary,
      longTerm: output.longTerm.summary,
      earningsQuality: output.earningsQuality.summary,
      rebalance: output.rebalance.summary,
      riskManagement: output.riskManagement.reasons.join(" ") || "Risk management checks completed.",
      bayesian: output.bayesian.summary,
    },
    recommendations: output.recommendations.map((recommendation) => ({
      symbol: recommendation.symbol,
      company: recommendation.company,
      action: recommendation.action,
      timeframe: recommendation.timeframe,
      confidence: recommendation.confidence,
      score: recommendation.score,
      reason: recommendation.reason,
      whatChangedRecently: recommendation.whatChangedRecently,
      positiveTriggers: recommendation.positiveTriggers,
      negativeConcerns: recommendation.negativeConcerns,
      sourceSummary: recommendation.sourceSummary,
      portfolioImpact: recommendation.portfolioImpact,
      target: recommendation.target,
      stopLoss: recommendation.stopLoss,
      expectedMove: recommendation.expectedMove,
      expectedCagr: recommendation.expectedCagr,
      riskLevel: recommendation.riskLevel,
      agentScores: recommendation.agentScores,
      agentReasons: recommendation.agentReasons,
      currentPrice: prices[recommendation.symbol] ?? 0,
    })),
  }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

async function loadPortfolios() {
  if (shouldUsePortfolioCsvBackup()) {
    const backups = await readPortfoliosFromCsvBackup();
    if (backups.length) return backups;
  }

  if (isGoogleSheetsConfigured()) {
    try {
      const portfolios = await readPortfoliosFromSheets();
      if (portfolios.length) return portfolios;
    } catch (error) {
      console.error("Agent recommendation portfolio storage unavailable:", error);
    }
  }

  return readPortfoliosFromCsvBackup();
}

async function resolvePortfolio(
  portfolios: ManagedPortfolio[],
  body: RequestBody,
  user: NonNullable<Awaited<ReturnType<typeof getCurrentSessionUser>>>,
) {
  const requestedId = body.portfolioId?.trim();
  const normalizedRequest = normalizePortfolioName(requestedId ?? "");
  const mappedName = normalizePortfolioName(user.portfolioName ?? "");
  const requested = requestedId
    ? portfolios.find((portfolio) =>
        portfolio.id === requestedId ||
        normalizePortfolioName(portfolio.id) === normalizedRequest ||
        normalizePortfolioName(portfolio.name) === normalizedRequest)
    : undefined;

  if (requested) {
    const authorized = user.role === "admin" ||
      normalizePortfolioName(requested.name) === mappedName ||
      await canAccessPortfolio(requested.id);
    if (authorized) return requested;
  }

  const mapped = portfolios.find((portfolio) => normalizePortfolioName(portfolio.name) === mappedName);
  if (mapped) return mapped;

  const canUseSubmittedSnapshot = Boolean(requestedId) && (
    user.role === "admin" ||
    normalizedRequest === mappedName ||
    await canAccessPortfolio(requestedId!)
  );

  return canUseSubmittedSnapshot
    ? buildSubmittedPortfolio(requestedId!, user.portfolioName, body)
    : undefined;
}

function buildSubmittedPortfolio(
  id: string,
  mappedName: string | undefined,
  body: RequestBody,
): ManagedPortfolio | undefined {
  const positions = sanitizePositions(body.positions ?? [], []);
  const inputs = sanitizeInputs(body.inputs ?? []);
  const inferredInputs = positions.map(positionToInput);
  const finalInputs = inputs.length ? inputs : inferredInputs;

  if (!positions.length && !finalInputs.length) return undefined;

  return {
    id,
    name: mappedName?.trim() || id,
    appetite: "moderate",
    inputs: finalInputs,
    positions,
    refreshedAt: new Date().toISOString(),
  };
}

function sanitizeInputs(inputs: Array<Partial<PortfolioInputRow>>) {
  return inputs
    .map((input) =>
      buildPortfolioInputRow({
        stockCode: normalizeSymbol(input.stockCode || input.stock),
        company: cleanText(input.company || input.stock, 120),
        quantity: parseQuantity(input.quantity),
        buyPrice: parseQuantity(input.buyPrice),
      }),
    )
    .filter((input) => input.stockCode || input.company);
}

function sanitizePositions(
  positions: Array<Partial<PortfolioPosition>>,
  allowedInputs: PortfolioInputRow[],
): PortfolioPosition[] {
  const allowedSymbols = new Set(
    allowedInputs.map((input) => normalizeSymbol(input.stockCode || input.stock)).filter(Boolean),
  );

  return positions.flatMap((position) => {
    const symbol = normalizeSymbol(position.symbol || position.stock);
    if (!symbol) return [];
    if (allowedSymbols.size && !allowedSymbols.has(symbol)) return [];

    const company = cleanText(position.company || position.stock, 120) || symbol;
    const quantity = parseQuantity(position.quantity);
    const list = position.list === "watchlist" || quantity <= 0 ? "watchlist" : "current";

    return [{
      list,
      stock: cleanText(position.stock || company, 120) || symbol,
      symbol,
      company,
      sector: identifySector(symbol, company, cleanText(position.sector, 80) || "Unclassified"),
      quantity: list === "watchlist" ? 0 : quantity,
      currentPrice: finiteNumber(position.currentPrice),
      previousClose: finiteNumber(position.previousClose),
      volume: finiteNumber(position.volume),
      bars: (Array.isArray(position.bars) ? position.bars : []).slice(-250).flatMap((bar) =>
        [bar.close, bar.high, bar.low, bar.volume].every(Number.isFinite)
          ? [{ close: bar.close, high: bar.high, low: bar.low, volume: bar.volume }]
          : [],
      ),
      newsHeadlines: (Array.isArray(position.newsHeadlines) ? position.newsHeadlines : [])
        .map((headline) => cleanText(headline, 500))
        .filter(Boolean)
        .slice(0, 10),
      currency: "INR" as const,
    }];
  });
}

function positionToInput(position: PortfolioPosition): PortfolioInputRow {
  return buildPortfolioInputRow({
    stockCode: position.symbol,
    company: position.company,
    quantity: position.quantity,
  });
}

function normalizeSymbol(value: unknown) {
  return String(value ?? "").trim().toUpperCase().replace(/\.(NS|BO)$/u, "");
}

function cleanText(value: unknown, maxLength = 200) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}
