import { NextResponse } from "next/server";
import { normalizePortfolioName } from "@/lib/account-utils";
import { getCurrentSessionUser } from "@/lib/auth";
import { buildExpertActionMatrix, type ExpertQuote } from "@/lib/expert-insights";
import { isGoogleSheetsConfigured, readPortfoliosFromSheets, readValidationRecords } from "@/lib/google-sheets";
import { readPortfoliosFromCsvBackup, shouldUsePortfolioCsvBackup } from "@/lib/portfolio-backup";
import { runStockIntelligenceAgent } from "@/lib/stock-intelligence/stockIntelligenceAgent";
import type { ExistingRecommendationSignal } from "@/lib/stock-intelligence/types";
import type { ManagedPortfolio } from "@/lib/portfolio";
import { runMultiAgentRecommendationSystem } from "@/lib/agents/service";
import { resolveQuotePositions } from "@/lib/quote-service";
import { buildMarketOverview } from "@/lib/market-overview";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

type RequestBody = {
  portfolioId?: string;
  signals?: Array<Partial<ExistingRecommendationSignal>>;
};

export async function POST(request: Request) {
  const user = await getCurrentSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as RequestBody;
  const portfolios = await loadPortfolios();
  const portfolio = resolvePortfolio(portfolios, body.portfolioId, user);
  if (!portfolio) {
    return NextResponse.json(
      { error: "No portfolio is mapped to this profile. Please contact admin." },
      { status: 403 },
    );
  }

  const matrix = await buildExpertActionMatrix();
  const portfolioSymbols = new Set(
    portfolio.inputs.map((row) => normalizeSymbol(row.stockCode || row.stock)).filter(Boolean),
  );
  const opportunityEntries: Array<readonly [string, {
    quote: ExpertQuote;
    timeframe: ExistingRecommendationSignal["timeframe"];
  }]> = matrix.categories.flatMap((category) => [
      ...category.longTermUpsides.map((quote) => [normalizeSymbol(quote.symbol), { quote, timeframe: "6–12 months" as const }] as const),
      ...category.intradayBreakouts.map((quote) => [normalizeSymbol(quote.symbol), { quote, timeframe: "Intraday" as const }] as const),
    ]);
  const opportunities = new Map(opportunityEntries);
  const signals = (body.signals ?? [])
    .slice(0, 12)
    .flatMap((candidate): ExistingRecommendationSignal[] => {
      const symbol = normalizeSymbol(candidate.symbol);
      if (!symbol) return [];
      const isPortfolioStock = portfolioSymbols.has(symbol);
      const opportunity = opportunities.get(symbol);
      if (!isPortfolioStock && !opportunity) return [];

      if (opportunity && !isPortfolioStock) {
        const { quote, timeframe } = opportunity;
        return [{
          symbol,
          company: quote.name || symbol,
          sector: quote.sector || quote.theme || "Unclassified",
          source: "opportunity",
          action: quote.action === "Accumulate" ? "BUY" : "WATCH",
          score: clamp(quote.score, 0, 100),
          confidence: clamp(quote.score, 0, 100),
          timeframe,
          reason: quote.remark,
          currentPrice: quote.price,
          target: quote.target,
          stopLoss: positiveNumber(candidate.stopLoss),
          priceVolumeContext: cleanTextArray(candidate.priceVolumeContext),
        }];
      }

      return [{
        symbol,
        company: cleanText(candidate.company, symbol),
        sector: cleanText(candidate.sector, "Unclassified"),
        source: "portfolio",
        action: normalizeAction(candidate.action),
        score: clamp(Number(candidate.score ?? candidate.confidence ?? 50), 0, 100),
        confidence: clamp(Number(candidate.confidence ?? 50), 0, 100),
        timeframe: normalizeTimeframe(candidate.timeframe),
        reason: cleanText(candidate.reason, "Existing portfolio recommendation signal."),
        currentPrice: positiveNumber(candidate.currentPrice),
        target: positiveNumber(candidate.target),
        stopLoss: positiveNumber(candidate.stopLoss),
        priceVolumeContext: cleanTextArray(candidate.priceVolumeContext),
      }];
    });

  if (!signals.length) {
    return NextResponse.json(
      { error: "No mapped portfolio holdings or current market opportunities were provided." },
      { status: 400 },
    );
  }

  const [report, market, history] = await Promise.all([
    runStockIntelligenceAgent({
      portfolioId: portfolio.id,
      portfolioName: portfolio.name,
      signals,
    }),
    buildMarketOverview(),
    readValidationRecords(),
  ]);

  try {
    const positions = await resolveQuotePositions(portfolio.inputs);
    if (positions.some((position) => position.currentPrice > 0)) {
      const enrichedPortfolio: ManagedPortfolio = {
        ...portfolio,
        positions,
        refreshedAt: new Date().toISOString(),
      };
      const agentOutput = await runMultiAgentRecommendationSystem({
        portfolio: enrichedPortfolio,
        market,
        history,
        persist: false,
      });
      const agentBySymbol = new Map(
        agentOutput.recommendations.map((rec) => [rec.symbol, rec]),
      );
      report.recommendations = report.recommendations.map((rec) => {
        const agent = agentBySymbol.get(rec.symbol);
        if (!agent) return rec;
        return {
          ...rec,
          intradayScore: agent.agentScores.intraday,
          swingScore: agent.agentScores.swing,
          longTermScore: agent.agentScores.longTerm,
          expectedMove: agent.expectedMove,
          expectedCagr: agent.expectedCagr,
          riskLevel: agent.riskLevel,
          agentReasons: {
            intraday: agent.agentReasons.intraday,
            swing: agent.agentReasons.swing,
            longTerm: agent.agentReasons.longTerm,
          },
        };
      });
    }
  } catch (error) {
    console.error("Agent enrichment failed (non-fatal):", error);
  }

  return NextResponse.json(report);
}

async function loadPortfolios() {
  if (shouldUsePortfolioCsvBackup()) {
    const backups = await readPortfoliosFromCsvBackup();
    if (backups.length) return backups;
  }
  return isGoogleSheetsConfigured() ? readPortfoliosFromSheets() : [];
}

function resolvePortfolio(
  portfolios: ManagedPortfolio[],
  requestedId: string | undefined,
  user: NonNullable<Awaited<ReturnType<typeof getCurrentSessionUser>>>,
) {
  if (user.role === "admin" && requestedId) {
    return portfolios.find((portfolio) => portfolio.id === requestedId);
  }
  const mappedName = normalizePortfolioName(user.portfolioName ?? "");
  return portfolios.find((portfolio) => normalizePortfolioName(portfolio.name) === mappedName);
}

function normalizeSymbol(value: unknown) {
  return String(value ?? "").trim().toUpperCase().replace(/\.(NS|BO)$/u, "").replace(/[^A-Z0-9&-]/gu, "").slice(0, 24);
}

function normalizeAction(value: unknown): ExistingRecommendationSignal["action"] {
  const action = String(value ?? "").toUpperCase();
  return action === "BUY" || action === "SELL" || action === "WATCH" ? action : "HOLD";
}

function normalizeTimeframe(value: unknown): ExistingRecommendationSignal["timeframe"] {
  const timeframe = String(value ?? "").toLowerCase();
  if (timeframe.includes("intraday")) return "Intraday";
  if (timeframe.includes("short")) return "Short term";
  if (timeframe.includes("3") && timeframe.includes("6")) return "3–6 months";
  return "6–12 months";
}

function cleanText(value: unknown, fallback: string) {
  return String(value ?? fallback).trim().slice(0, 500) || fallback;
}

function cleanTextArray(value: unknown) {
  return Array.isArray(value) ? value.slice(0, 4).map((item) => cleanText(item, "")).filter(Boolean) : [];
}

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));
}
