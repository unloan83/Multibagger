import type {
  AgentInfoOutput,
  AgentMacroPolicyOutput,
  AgentImpact,
} from "@/lib/agents/types";
import { aggregateScores, average, clamp, impactFromScore } from "@/lib/agents/utils";

const macroKinds = new Set([
  "government_policy", "politics", "global_market", "macro", "sector_news",
]);

export function agentMacroPolicy({
  info,
  market,
  now = new Date(),
}: {
  info: AgentInfoOutput;
  market?: { sentiment: "Positive" | "Negative" | "Neutral"; averageMove: number } | null;
  now?: Date;
}): AgentMacroPolicyOutput {
  const events = info.events.filter((event) => macroKinds.has(event.source.kind));
  const sectors = [...new Set(events.flatMap((event) => event.affectedSectors ?? []))]
    .map((sector) => {
      const relevant = events.filter((event) => event.affectedSectors?.includes(sector));
      const result = aggregateScores(relevant.map((event) => ({
        score: event.impactScore,
        confidence: event.confidence,
        reasons: [event.summary],
      })));
      return {
        sector,
        ...result,
        affectedStocks: [...new Set(relevant.flatMap((event) => event.affectedStocks ?? []))],
        impact: impactFromScore(result.score) as AgentImpact,
      };
    })
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  const eventScore = aggregateScores(events.map((event) => ({
    score: event.impactScore,
    confidence: event.confidence,
    reasons: [event.summary],
  })));
  const marketScore = market
    ? clamp(market.averageMove * 1.5 + (market.sentiment === "Positive" ? 0.8 : market.sentiment === "Negative" ? -0.8 : 0), -5, 5)
    : 0;
  const combined = events.length ? eventScore.score * 0.7 + marketScore * 0.3 : marketScore;
  const confidence = Math.round(clamp(average([
    events.length ? eventScore.confidence : 35,
    market ? 70 : 25,
  ]), 0, 100));

  return {
    agent: "Macro & Policy",
    generatedAt: now.toISOString(),
    marketScore: Math.round(combined * 10) / 10,
    confidence,
    sectors,
    reasons: [
      ...eventScore.reasons,
      market ? `Broad market is ${market.sentiment.toLowerCase()} with ${market.averageMove.toFixed(2)}% average move.` : "Broad market data unavailable.",
    ].slice(0, 6),
  };
}
