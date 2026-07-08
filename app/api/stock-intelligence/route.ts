import { NextResponse } from "next/server";
import { normalizePortfolioName } from "@/lib/account-utils";
import { canAccessPortfolio, getCurrentSessionUser } from "@/lib/auth";
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

const responseCache = new Map<string, { json: unknown; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

function cacheKey(body: RequestBody, userEmail: string): string {
  const stable = { portfolioId: body.portfolioId, signals: body.signals ?? [] };
  return `${userEmail}::${JSON.stringify(stable)}`;
}

function getCached(key: string): unknown | null {
  const entry = responseCache.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.json;
  responseCache.delete(key);
  return null;
}

function setCached(key: string, json: unknown): void {
  responseCache.set(key, { json, expiresAt: Date.now() + CACHE_TTL_MS });
  if (responseCache.size > 50) {
    const now = Date.now();
    for (const [k, v] of responseCache) {
      if (v.expiresAt < now) responseCache.delete(k);
    }
  }
}

type RequestBody = {
  portfolioId?: string;
  signals?: Array<Partial<ExistingRecommendationSignal>>;
};

export async function POST(request: Request) {
  const user = await getCurrentSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as RequestBody;
  const cacheKeyStr = cacheKey(body, user.email);
  const cached = getCached(cacheKeyStr);
  if (cached) return NextResponse.json(cached);
  const portfolios = await loadPortfolios();
  const portfolio = await resolvePortfolio(portfolios, body, user);
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
      const isPortfolioStock = portfolioSymbols.has(symbol) || candidate.source === "portfolio";
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
          action: agent.action,
          confidence: agent.confidence,
          finalScore: agent.score,
          reason: agent.reason,
          whatChanged: agent.whatChangedRecently,
          positiveTriggers: agent.positiveTriggers,
          negativeConcerns: agent.negativeConcerns,
          target: ["Buy", "Sell"].includes(agent.action) ? agent.target : undefined,
          stopLoss: ["Buy", "Sell"].includes(agent.action) ? agent.stopLoss : undefined,
          intradayScore: agent.agentScores.intraday,
          swingScore: agent.agentScores.swing,
          longTermScore: agent.agentScores.longTerm,
          earningsQualityScore: agent.agentScores.earningsQuality,
          rebalanceScore: agent.agentScores.rebalance,
          expectedMove: agent.expectedMove,
          expectedCagr: agent.expectedCagr,
          riskLevel: agent.riskLevel,
          agentReasons: {
            existingLogic: agent.agentReasons.existingLogic,
            info: agent.agentReasons.info,
            macroPolicy: agent.agentReasons.macroPolicy,
            sentiment: agent.agentReasons.sentiment,
            portfolio: agent.agentReasons.portfolio,
            riskValidation: agent.agentReasons.riskValidation,
            fundamental: agent.agentReasons.fundamental,
            technical: agent.agentReasons.technical,
            intraday: agent.agentReasons.intraday,
            swing: agent.agentReasons.swing,
            longTerm: agent.agentReasons.longTerm,
            earningsQuality: agent.agentReasons.earningsQuality,
            rebalance: agent.agentReasons.rebalance,
          },
        };
      });
    }
  } catch (error) {
    console.error("Agent enrichment failed (non-fatal):", error);
  }

  setCached(cacheKeyStr, report);
  return NextResponse.json(report);
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
      console.error("Stock intelligence portfolio storage unavailable:", error);
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

  const canUseSubmittedSignals = Boolean(requestedId) && (
    user.role === "admin" ||
    normalizedRequest === mappedName ||
    await canAccessPortfolio(requestedId!)
  );
  return canUseSubmittedSignals ? buildSignalPortfolio(requestedId!, user.portfolioName, body.signals ?? []) : undefined;
}

function buildSignalPortfolio(
  id: string,
  mappedName: string | undefined,
  signals: Array<Partial<ExistingRecommendationSignal>>,
): ManagedPortfolio | undefined {
  const holdings = signals
    .filter((signal) => signal.source === "portfolio")
    .slice(0, 50)
    .flatMap((signal) => {
      const symbol = normalizeSymbol(signal.symbol);
      if (!symbol) return [];
      const quantity = clamp(Number(signal.quantity ?? 1), 0, 1_000_000_000);
      const currentPrice = clamp(Number(signal.currentPrice ?? 0), 0, 1_000_000_000);
      const previousClose = clamp(Number(signal.previousClose ?? currentPrice), 0, 1_000_000_000);
      return [{
        input: {
          list: quantity > 0 ? "current" as const : "watchlist" as const,
          stockCode: symbol,
          company: cleanText(signal.company, symbol),
          stock: symbol,
          quantity,
        },
        position: {
          list: quantity > 0 ? "current" as const : "watchlist" as const,
          stock: symbol,
          symbol,
          company: cleanText(signal.company, symbol),
          sector: cleanText(signal.sector, "Unclassified"),
          quantity,
          currentPrice,
          previousClose,
          volume: positiveNumber(signal.volume),
          currency: "INR" as const,
        },
      }];
    });
  if (!holdings.length) return undefined;
  return {
    id,
    name: mappedName?.trim() || id,
    appetite: "moderate",
    inputs: holdings.map(({ input }) => input),
    positions: holdings.map(({ position }) => position),
    refreshedAt: new Date().toISOString(),
  };
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
