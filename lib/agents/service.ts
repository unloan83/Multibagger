import {
  agentGrowth,
  agentInfo,
  agentMacroPolicy,
  agentOrchestrator,
  agentPerformance,
  agentPortfolio,
  agentRiskValidation,
  agentSentiment,
  reconcileRecommendationLogs,
  toRecommendationLogs,
  type AgentOrchestratorOutput,
  type RawIntelligenceEvent,
} from "@/lib/agents";
import {
  appendAgentRecommendationLogs,
  readAgentRecommendationLogs,
  writeAgentRecommendationLogs,
} from "@/lib/agents/googleLogStore";
import type { MarketOverview } from "@/lib/decision-intelligence";
import type { ValidationRecord } from "@/lib/intelligence-validation";
import { generateRecommendations, type ManagedPortfolio, type Recommendation } from "@/lib/portfolio";
import { collectAttributedMarketIntelligence } from "@/lib/agents/marketIntelligence";

export async function runMultiAgentRecommendationSystem({
  portfolio,
  market,
  history,
  persist = false,
}: {
  portfolio: ManagedPortfolio;
  market: MarketOverview | null;
  history: ValidationRecord[];
  persist?: boolean;
}): Promise<AgentOrchestratorOutput> {
  const now = new Date();
  const [events, allLogs] = await Promise.all([
    collectIntelligenceEvents(portfolio),
    readAgentRecommendationLogs(),
  ]);
  const portfolioHistory = history.filter((record) => record.portfolioId === portfolio.id);
  const currentPrices = Object.fromEntries(
    portfolio.positions.map((position) => [normalize(position.symbol), position.currentPrice]),
  );
  const reconciledLogs = reconcileRecommendationLogs(allLogs, history, currentPrices);
  const portfolioLogs = reconciledLogs.filter((log) => log.portfolioId === portfolio.id);
  if (persist && recommendationLogsChanged(allLogs, reconciledLogs)) {
    await writeAgentRecommendationLogs(reconciledLogs);
  }
  const recommendationGroups = generateRecommendations(
    portfolio,
    validationHistoryToRecommendations(portfolioHistory),
  );
  const existingRecommendations = [
    ...recommendationGroups.intraday,
    ...recommendationGroups.longTermPlan,
    ...recommendationGroups.multibaggerCandidates,
    ...recommendationGroups.etfs,
  ];
  const info = agentInfo(events, now);
  const macroPolicy = agentMacroPolicy({ info, market, now });
  const sentiment = agentSentiment(info, now);
  const portfolioOutput = agentPortfolio({ portfolio, info, macroPolicy, sentiment, now });
  const growth = agentGrowth({
    portfolio,
    existingRecommendations,
    info,
    macroPolicy,
    sentiment,
    portfolioAnalysis: portfolioOutput,
    now,
  });
  const riskValidation = agentRiskValidation({
    growth,
    info,
    macroPolicy,
    sentiment,
    portfolio: portfolioOutput,
    now,
  });
  const performance = agentPerformance({ history: portfolioHistory, logs: portfolioLogs, now });
  const output = agentOrchestrator({
    info,
    macroPolicy,
    sentiment,
    portfolio: portfolioOutput,
    growth,
    riskValidation,
    performance,
    now,
  });

  if (persist) {
    const currentLogic = Object.fromEntries(output.growth.candidates.map((candidate) => [
      candidate.symbol,
      { action: candidate.proposedAction, confidence: candidate.confidence },
    ]));
    const sourceTypesBySymbol = Object.fromEntries(output.recommendations.map((recommendation) => {
      const sector = output.growth.candidates.find(
        (candidate) => candidate.symbol === recommendation.symbol,
      )?.sector;
      const sourceTypes = output.info.events
        .filter((event) =>
          event.affectedStocks?.some((symbol) => normalize(symbol) === recommendation.symbol) ||
          (sector ? event.affectedSectors?.includes(sector) : false),
        )
        .map((event) => event.source.kind);
      return [recommendation.symbol, [...new Set(sourceTypes)]];
    }));
    await appendAgentRecommendationLogs(
      toRecommendationLogs(output.recommendations, portfolio.id, now.toISOString(), {
        entryPrices: currentPrices,
        currentLogic,
        sourceTypes: [...new Set(output.info.events.map((event) => event.source.kind))],
        sourceTypesBySymbol,
      }),
    );
  }
  return output;
}

function recommendationLogsChanged(
  previous: Awaited<ReturnType<typeof readAgentRecommendationLogs>>,
  next: Awaited<ReturnType<typeof readAgentRecommendationLogs>>,
) {
  if (previous.length !== next.length) return true;
  return next.some((log, index) => {
    const prior = previous[index];
    return (
      !prior ||
      log.status !== prior.status ||
      log.outcomeReason !== prior.outcomeReason ||
      JSON.stringify(log.outcomes) !== JSON.stringify(prior.outcomes)
    );
  });
}

async function collectIntelligenceEvents(portfolio: ManagedPortfolio): Promise<RawIntelligenceEvent[]> {
  const embedded: RawIntelligenceEvent[] = portfolio.positions.flatMap((position) =>
    (position.newsHeadlines ?? []).map((summary) => ({
      summary,
      affectedStocks: [position.symbol],
      affectedSectors: [position.sector],
      source: {
        name: "Portfolio market-data feed",
        credibility: "medium" as const,
        kind: "company_news" as const,
      },
    })),
  );
  const [feedEvents, attributedEvents] = await Promise.all([
    readPortfolioAgnosticFeed(),
    collectAttributedMarketIntelligence(portfolio),
  ]);
  const symbols = new Set(portfolio.positions.map((position) => normalize(position.symbol)));
  const sectors = new Set(portfolio.positions.map((position) => position.sector.toLowerCase()));
  const relevant = feedEvents.filter((event) => {
    const eventSymbols = (event.affectedStocks ?? []).map(normalize);
    const eventSectors = (event.affectedSectors ?? []).map((sector) => sector.toLowerCase());
    const isMarketWide = eventSymbols.length === 0 && eventSectors.length === 0;
    return isMarketWide || eventSymbols.some((symbol) => symbols.has(symbol)) || eventSectors.some((sector) => sectors.has(sector));
  });
  const unique = new Map<string, RawIntelligenceEvent>();
  [...embedded, ...attributedEvents, ...relevant].forEach((event) =>
    unique.set(event.source.url?.trim().toLowerCase() || event.summary.trim().toLowerCase(), event),
  );
  return [...unique.values()];
}

async function readPortfolioAgnosticFeed(): Promise<RawIntelligenceEvent[]> {
  const url = process.env.MARKET_INTELLIGENCE_FEED_URL?.trim();
  if (!url) return [];
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 900 },
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { events?: RawIntelligenceEvent[] } | RawIntelligenceEvent[];
    const events = Array.isArray(payload) ? payload : payload.events ?? [];
    return events.filter(isRawEvent).slice(0, 500);
  } catch {
    return [];
  }
}

function isRawEvent(value: RawIntelligenceEvent) {
  return Boolean(
    value &&
    typeof value.summary === "string" &&
    value.source &&
    typeof value.source.name === "string" &&
    ["high", "medium", "low"].includes(value.source.credibility),
  );
}

function validationHistoryToRecommendations(history: ValidationRecord[]): Recommendation[] {
  return history.map((record) => ({
    id: record.recommendationId,
    portfolioId: record.portfolioId,
    portfolioName: record.portfolioName,
    section: normalizeSection(record.section),
    symbol: record.symbol,
    company: record.company,
    action: record.action === "Urgent Sell" ? "Urgent Sell" : "Accumulate",
    horizon: record.horizon,
    rationale: record.rationale,
    confidence: record.confidence,
    createdAt: record.timestamp,
    status: record.validationStatus === "Hit" || record.validationStatus === "Miss"
      ? record.validationStatus
      : "NA",
  }));
}

function normalizeSection(section: string): Recommendation["section"] {
  if (section.includes("Intraday")) return "Intraday";
  if (section.includes("Multibagger")) return "Multibagger";
  if (section.includes("ETF")) return "ETF";
  if (section.includes("Sector")) return "Sector Allocation";
  return "1-3 Yr Plan";
}

function normalize(symbol: string) {
  return symbol.trim().toUpperCase().replace(/\.(NS|BO)$/u, "");
}
