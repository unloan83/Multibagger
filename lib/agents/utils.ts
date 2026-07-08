import type { AgentImpact, AgentScore, SourceCredibility } from "@/lib/agents/types";

export function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
export function round(value: number, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function credibilityScore(credibility: SourceCredibility) {
  if (credibility === "high") return 90;
  if (credibility === "medium") return 65;
  return 30;
}

export function impactFromScore(score: number, hasConflict = false): AgentImpact {
  if (hasConflict) return "mixed";
  if (score >= 0.75) return "positive";
  if (score <= -0.75) return "negative";
  return "neutral";
}

export function aggregateScores(scores: Array<AgentScore & { weight?: number }>): AgentScore {
  if (!scores.length) return { score: 0, confidence: 0, reasons: ["No relevant evidence available."] };
  const totalWeight = scores.reduce(
    (sum, item) => sum + (item.weight ?? 1) * Math.max(0.1, item.confidence / 100),
    0,
  );
  const score = scores.reduce(
    (sum, item) => sum + item.score * (item.weight ?? 1) * Math.max(0.1, item.confidence / 100),
    0,
  ) / totalWeight;
  return {
    score: round(clamp(score, -5, 5), 1),
    confidence: Math.round(clamp(average(scores.map((item) => item.confidence)), 0, 100)),
    reasons: scores.flatMap((item) => item.reasons).slice(0, 5),
  };
}

export function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase().replace(/\.(NS|BO)$/u, "");
}

export function scoreToPercent(score: number) {
  return clamp((score + 5) * 10, 0, 100);
}
