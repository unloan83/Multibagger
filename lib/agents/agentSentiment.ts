import type {
  AgentInfoOutput,
  AgentScore,
  AgentSentimentOutput,
} from "@/lib/agents/types";
import { aggregateScores, clamp, normalizeSymbol } from "@/lib/agents/utils";

export function agentSentiment(info: AgentInfoOutput, now = new Date()): AgentSentimentOutput {
  const sentimentKinds = new Set(["company_news", "sector_news", "analyst", "blog", "social"]);
  const events = info.events.filter((event) => sentimentKinds.has(event.source.kind));
  const scoreEvents = (items: typeof events) => aggregateScores(items.map((event) => ({
    score: event.impactScore,
    confidence: event.confidence,
    reasons: [event.summary],
    weight: event.source.kind === "social" ? 0.15 : event.source.kind === "blog" ? 0.5 : 1,
  })));
  const marketScore = scoreEvents(events);
  const byStock = Object.fromEntries(Object.keys(info.byStock).map((symbol) => {
    const result = scoreEvents(events.filter((event) =>
      event.affectedStocks?.some((item) => normalizeSymbol(item) === symbol),
    ));
    return [symbol, { ...result, classification: classification(result) }];
  }));
  const lowQuality = events.filter(
    (event) => event.source.kind === "social" || event.source.credibility === "low",
  ).length;

  return {
    agent: "Sentiment",
    generatedAt: now.toISOString(),
    market: { ...marketScore, classification: classification(marketScore) },
    byStock,
    lowQualityShare: events.length ? Math.round(clamp((lowQuality / events.length) * 100, 0, 100)) : 0,
  };
}

function classification(score: AgentScore) {
  if (score.score >= 0.9) return "bullish" as const;
  if (score.score <= -0.9) return "bearish" as const;
  if (score.reasons.some((reason) => /positive.*negative|mixed/iu.test(reason))) return "mixed" as const;
  return "neutral" as const;
}
