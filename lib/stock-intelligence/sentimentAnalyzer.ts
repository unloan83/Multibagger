import type { AnalyzedEvidence, EvidenceFreshness, IntelligenceEvidence, IntelligenceImpact } from "./types";

const positiveTerms = [
  "approval", "award", "beat", "buyback", "dividend", "expansion", "growth", "guidance raised",
  "launch", "order win", "outperform", "profit", "record", "recovery", "strong", "upgrade", "wins",
];
const negativeTerms = [
  "ban", "cut", "default", "delay", "downgrade", "fraud", "investigation", "loss", "miss",
  "penalty", "probe", "recall", "resign", "slump", "weak", "warning",
];
const uncertaintyTerms = ["alleged", "could", "may", "reportedly", "rumour", "uncertain", "unconfirmed"];

export function analyzeSentiment(evidence: IntelligenceEvidence[], now = new Date()): AnalyzedEvidence[] {
  return evidence.map((item) => analyzeEvidence(item, now));
}

export function analyzeEvidence(item: IntelligenceEvidence, now = new Date()): AnalyzedEvidence {
  const normalized = item.title.toLowerCase();
  const positive = positiveTerms.filter((term) => normalized.includes(term)).length;
  const negative = negativeTerms.filter((term) => normalized.includes(term)).length;
  const raw = positive - negative;
  const impactScore = clamp(raw === 0 ? 0 : raw * 2, -5, 5);
  const impact: IntelligenceImpact =
    positive > 0 && negative > 0 ? "Mixed" : impactScore > 0 ? "Positive" : impactScore < 0 ? "Negative" : "Neutral";
  const freshness = freshnessFor(item.publishedAt, now);
  const confidence = clampCredibility(
    25 + credibilityPoints(item.credibility) + freshnessPoints(freshness) + (positive + negative > 0 ? 15 : 0)
      - uncertaintyTerms.filter((term) => normalized.includes(term)).length * 10,
    item.credibility,
  );

  return {
    ...item,
    impact,
    impactScore,
    confidence,
    freshness,
    explanation: impact === "Neutral"
      ? "The headline does not contain a clear directional catalyst."
      : `${impact} language was detected in a ${item.credibility}-credibility source.`,
  };
}

export function freshnessFor(publishedAt: string, now = new Date()): EvidenceFreshness {
  const age = now.getTime() - Date.parse(publishedAt);
  if (!Number.isFinite(age) || age < 0) return "older";
  if (age <= 86_400_000) return "today";
  if (age <= 7 * 86_400_000) return "this week";
  return "older";
}

function credibilityPoints(value: IntelligenceEvidence["credibility"]) {
  return value === "high" ? 25 : value === "medium" ? 15 : 0;
}

function freshnessPoints(value: EvidenceFreshness) {
  return value === "today" ? 15 : value === "this week" ? 8 : -10;
}

function clampCredibility(value: number, credibility: IntelligenceEvidence["credibility"]) {
  const maximum = credibility === "high" ? 95 : credibility === "medium" ? 78 : 45;
  return clamp(value, 15, maximum);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}
