import type { ManagedPortfolio, Recommendation } from "@/lib/portfolio";
import { calculateStopLoss } from "@/lib/intelligence-validation";
import type {
  AgentFundamentalOutput,
  AgentGrowthOutput,
  AgentInfoOutput,
  AgentMacroPolicyOutput,
  AgentPortfolioOutput,
  AgentSentimentOutput,
  AgentTechnicalOutput,
  AgentTimeframe,
  GrowthCandidate,
} from "@/lib/agents/types";
import { clamp, normalizeSymbol } from "@/lib/agents/utils";

export function agentGrowth({
  portfolio,
  existingRecommendations,
  info,
  macroPolicy,
  sentiment,
  portfolioAnalysis,
  now = new Date(),
}: {
  portfolio: ManagedPortfolio;
  existingRecommendations: Recommendation[];
  info?: AgentInfoOutput;
  macroPolicy?: AgentMacroPolicyOutput;
  sentiment?: AgentSentimentOutput;
  portfolioAnalysis?: AgentPortfolioOutput;
  now?: Date;
}): AgentGrowthOutput {
  const recommendationSymbols = new Set(existingRecommendations.map((item) => normalizeSymbol(item.symbol)));
  const fromExisting = existingRecommendations.map((recommendation) => toCandidate(recommendation, portfolio));
  const watchOnly: GrowthCandidate[] = portfolio.positions
    .filter((position) => !recommendationSymbols.has(normalizeSymbol(position.symbol)))
    .map((position) => ({
      symbol: normalizeSymbol(position.symbol),
      company: position.company,
      sector: position.sector,
      proposedAction: "Watch",
      timeframe: position.list === "watchlist" ? "6-12 months" : "Short term",
      existingLogicScore: 50,
      supportingScores: supportScores(
        normalizeSymbol(position.symbol),
        position.sector,
        info,
        macroPolicy,
        sentiment,
        portfolioAnalysis,
      ),
      confidence: 35,
      reason: "Existing stock logic has not produced a qualified Buy or Sell signal.",
      positiveTriggers: position.newsHeadlines?.slice(0, 2) ?? [],
      negativeConcerns: ["No qualified signal from the existing evidence gate."],
    }));
  const candidates = [...fromExisting, ...watchOnly]
    .map((candidate) => ({
      ...candidate,
      supportingScores: supportScores(
        candidate.symbol,
        candidate.sector,
        info,
        macroPolicy,
        sentiment,
        portfolioAnalysis,
      ),
    }))
    .sort((a, b) => b.existingLogicScore - a.existingLogicScore)
    .slice(0, 20);
  const timeframes: AgentTimeframe[] = ["Intraday", "Short term", "3-6 months", "6-12 months", "Long term"];

  return {
    agent: "Growth",
    generatedAt: now.toISOString(),
    candidates,
    groups: Object.fromEntries(timeframes.map((timeframe) => [
      timeframe,
      candidates.filter((item) => item.timeframe === timeframe).map((item) => item.symbol),
    ])) as Record<AgentTimeframe, string[]>,
  };
}

function toCandidate(recommendation: Recommendation, portfolio: ManagedPortfolio): GrowthCandidate {
  const position = portfolio.positions.find(
    (item) => normalizeSymbol(item.symbol) === normalizeSymbol(recommendation.symbol),
  );
  const metrics = recommendation.metrics;
  const proposedAction = recommendation.action === "Urgent Sell" ? "Sell" : "Buy";
  const score = clamp(metrics?.finalScore ?? recommendation.confidence, 0, 100);
  const stopLoss = position?.currentPrice && position.currentPrice > 0
    ? calculateStopLoss(
        position.currentPrice,
        recommendation.action,
        recommendation.section,
        metrics?.riskScore,
      )
    : undefined;
  return {
    symbol: normalizeSymbol(recommendation.symbol),
    company: recommendation.company,
    sector: position?.sector ?? "Unclassified",
    proposedAction,
    timeframe: mapTimeframe(recommendation),
    existingLogicScore: Math.round(score),
    supportingScores: { info: 0, macroPolicy: 0, sentiment: 0, portfolio: 0, fundamental: 0, technical: 0 },
    confidence: recommendation.confidence,
    reason: recommendation.rationale,
    positiveTriggers: proposedAction === "Buy" ? [recommendation.rationale] : [],
    negativeConcerns: [
      ...(recommendation.caveats ?? []),
      ...(proposedAction === "Sell" ? [recommendation.rationale] : []),
    ].slice(0, 4),
    volatilityScore: metrics?.riskScore,
    liquidityScore: metrics?.liquidityScore,
    target: metrics?.target && metrics.target > 0 ? Math.round(metrics.target * 100) / 100 : undefined,
    stopLoss: stopLoss ? Math.round(stopLoss * 100) / 100 : undefined,
  };
}

function supportScores(
  symbol: string,
  sector: string,
  info?: AgentInfoOutput,
  macroPolicy?: AgentMacroPolicyOutput,
  sentiment?: AgentSentimentOutput,
  portfolio?: AgentPortfolioOutput,
  fundamental?: AgentFundamentalOutput,
  technical?: AgentTechnicalOutput,
) {
  return {
    info: info?.byStock[symbol]?.score ?? 0,
    macroPolicy:
      macroPolicy?.sectors.find((item) => item.sector === sector)?.score ??
      (macroPolicy?.marketScore ?? 0) * 0.5,
    sentiment: sentiment?.byStock[symbol]?.score ?? (sentiment?.market.score ?? 0) * 0.4,
    portfolio: portfolio?.stocks.find((item) => item.symbol === symbol)?.score ?? 0,
    fundamental: fundamental?.byStock[symbol]?.score ?? 0,
    technical: technical?.byStock[symbol]?.score ?? 0,
  };
}

function mapTimeframe(recommendation: Recommendation): AgentTimeframe {
  if (recommendation.section === "Intraday") return "Intraday";
  if (recommendation.section === "Multibagger") return "Long term";
  const horizon = recommendation.horizon.toLowerCase();
  if (horizon.includes("3-6")) return "3-6 months";
  if (horizon.includes("6-12")) return "6-12 months";
  if (horizon.includes("year")) return "Long term";
  return "Short term";
}
