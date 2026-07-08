import type {
  AgentInfoOutput,
  RawIntelligenceEvent,
  ScoredIntelligenceEvent,
} from "@/lib/agents/types";
import {
  aggregateScores,
  clamp,
  credibilityScore,
  impactFromScore,
  normalizeSymbol,
} from "@/lib/agents/utils";

const positiveTerms = [
  "award", "beat", "boost", "buyback", "dividend", "expansion", "growth", "improve",
  "launch", "order", "profit", "record", "recovery", "strong", "surge", "upgrade", "wins",
];
const negativeTerms = [
  "ban", "cut", "decline", "default", "delay", "downgrade", "fraud", "investigation",
  "loss", "penalty", "probe", "resigns", "slump", "tax hike", "weak",
];

export function agentInfo(
  events: RawIntelligenceEvent[],
  now = new Date(),
): AgentInfoOutput {
  const scored = events
    .filter((event) => event.summary.trim())
    .map((event) => scoreEvent(event, now))
    .sort((a, b) => b.confidence - a.confidence);
  const symbols = new Set(
    scored.flatMap((event) => event.affectedStocks ?? []).map(normalizeSymbol),
  );
  const byStock = Object.fromEntries(
    [...symbols].map((symbol) => [
      symbol,
      aggregateScores(
        scored
          .filter((event) => event.affectedStocks?.some((item) => normalizeSymbol(item) === symbol))
          .map((event) => ({
            score: event.impactScore,
            confidence: event.confidence,
            reasons: [event.summary],
            weight: event.source.kind === "social" ? 0.25 : 1,
          })),
      ),
    ]),
  );

  return {
    agent: "Info",
    generatedAt: now.toISOString(),
    events: scored,
    byStock,
    sourceSummary: scored.slice(0, 8).map(
      (event) => `${event.source.name}: ${event.summary}`,
    ),
  };
}

function scoreEvent(event: RawIntelligenceEvent, now: Date): ScoredIntelligenceEvent {
  const text = event.summary.toLowerCase();
  const positive = positiveTerms.filter((term) => text.includes(term)).length;
  const negative = negativeTerms.filter((term) => text.includes(term)).length;
  const socialFactor = event.source.kind === "social" ? 0.3 : 1;
  const rawImpact = (positive - negative * 1.15) * 1.5 * socialFactor;
  const impactScore = event.source.kind === "social"
    ? clamp(rawImpact, -1.5, 1.5)
    : clamp(rawImpact, -5, 5);
  const publishedAt = event.source.publishedAt ? Date.parse(event.source.publishedAt) : Number.NaN;
  const freshnessMinutes = Number.isFinite(publishedAt)
    ? Math.max(0, (now.getTime() - publishedAt) / 60_000)
    : null;
  const credibility = credibilityScore(event.source.credibility);
  const freshnessFactor = freshnessMinutes === null
    ? 0.65
    : freshnessMinutes <= 360
      ? 1
      : freshnessMinutes <= 1_440
        ? 0.85
        : freshnessMinutes <= 10_080
          ? 0.55
          : 0.25;
  const confidence = Math.round(clamp(credibility * freshnessFactor * socialFactor, 5, 98));
  const hasConflict = positive > 0 && negative > 0;

  return {
    ...event,
    impact: impactFromScore(impactScore, hasConflict),
    impactScore: Math.round(impactScore * 10) / 10,
    freshnessMinutes: freshnessMinutes === null ? null : Math.round(freshnessMinutes),
    sourceCredibility: credibility,
    confidence,
    reasons: [
      `${positive} positive and ${negative} negative language cues.`,
      event.source.kind === "social"
        ? "Social input is capped at low confidence."
        : `${event.source.credibility} credibility source.`,
    ],
  };
}
