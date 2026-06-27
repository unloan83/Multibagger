import { fetchStockContext } from "./newsFetcher";
import { analyzeSentiment } from "./sentimentAnalyzer";
import { scoreStockImpact } from "./stockImpactScorer";
import { combineRecommendation, getIntelligenceWeights } from "./recommendationCombiner";
import { logRecommendations } from "./recommendationLogger";
import type { ExistingRecommendationSignal, StockIntelligenceReport } from "./types";

const disclaimer = "This is AI-assisted market analysis, not certified investment advice. Please verify before acting." as const;

export async function runStockIntelligenceAgent(input: {
  portfolioId: string;
  portfolioName: string;
  signals: ExistingRecommendationSignal[];
}): Promise<StockIntelligenceReport> {
  const signals = deduplicateSignals(input.signals).slice(0, 12);
  const rawEvidence = await fetchStockContext(signals);
  const analyzedEvidence = analyzeSentiment(rawEvidence);
  const weights = getIntelligenceWeights();
  const recommendations = signals.map((signal) => {
    const impact = scoreStockImpact(signal, analyzedEvidence);
    return combineRecommendation({ signal, weights, ...impact });
  });
  const independentSources = new Set(analyzedEvidence.map((item) => item.source.toLowerCase())).size;
  const recentEvidence = analyzedEvidence.filter((item) => item.freshness !== "older");
  const confidenceNote = buildConfidenceNote(independentSources, recentEvidence.length, recommendations.length);
  const currentPrices = Object.fromEntries(signals.map((signal) => [signal.symbol, signal.currentPrice ?? 0]));

  try {
    await logRecommendations({
      portfolioId: input.portfolioId,
      portfolioName: input.portfolioName,
      recommendations,
      currentPrices,
    });
  } catch (error) {
    console.error("Stock Intelligence Agent logging failed", error);
  }

  return {
    agent: "Stock Intelligence Agent",
    generatedAt: new Date().toISOString(),
    portfolioId: input.portfolioId,
    portfolioName: input.portfolioName,
    weights,
    recommendations,
    confidenceNote,
    sourceStatus: analyzedEvidence.length
      ? `${analyzedEvidence.length} unique items from ${independentSources} sources; ${recentEvidence.length} are from today or this week.`
      : "External sources were unavailable. The agent abstained from aggressive calls.",
    disclaimer,
  };
}

function deduplicateSignals(signals: ExistingRecommendationSignal[]) {
  const seen = new Set<string>();
  return signals.filter((signal) => {
    const symbol = signal.symbol.trim().toUpperCase();
    if (!symbol || seen.has(symbol)) return false;
    seen.add(symbol);
    signal.symbol = symbol;
    return true;
  });
}

function buildConfidenceNote(sourceCount: number, recentCount: number, recommendationCount: number) {
  if (!recommendationCount) return "No eligible portfolio or market-opportunity stocks were available for analysis.";
  if (sourceCount < 2 || recentCount < 2) return "Confidence is reduced because recent independent evidence is limited. Calls are kept at Hold or Watch.";
  return `Confidence reflects cross-checking ${sourceCount} independent sources, evidence freshness, credibility, and the existing recommendation engine.`;
}
