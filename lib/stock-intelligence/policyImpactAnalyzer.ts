import type { AnalyzedEvidence, IntelligenceImpact } from "./types";

const policyCategories = new Set(["policy", "political-economic", "regulatory", "sector", "market"]);

export function analyzePolicyImpact(evidence: AnalyzedEvidence[]) {
  const relevant = evidence.filter((item) => policyCategories.has(item.category));
  const score = weightedImpact(relevant);
  const confidence = evidenceConfidence(relevant);
  const impact: IntelligenceImpact = score >= 1.25 ? "Positive" : score <= -1.25 ? "Negative" : conflicting(relevant) ? "Mixed" : relevant.length ? "Neutral" : "Unknown";

  return {
    impact,
    score,
    confidence,
    evidence: relevant,
    summary: relevant.length
      ? `${relevant.length} sector, policy, regulatory, or macro items were assessed.`
      : "No reliable recent sector or policy evidence was available.",
  };
}

export function weightedImpact(items: AnalyzedEvidence[]) {
  if (!items.length) return 0;
  const weighted = items.reduce((sum, item) => sum + item.impactScore * item.confidence / 100, 0);
  const denominator = items.reduce((sum, item) => sum + item.confidence / 100, 0);
  return roundOne(clamp(denominator ? weighted / denominator : 0, -5, 5));
}

export function evidenceConfidence(items: AnalyzedEvidence[]) {
  if (!items.length) return 0;
  const sourceCount = new Set(items.map((item) => item.source.toLowerCase())).size;
  const average = items.reduce((sum, item) => sum + item.confidence, 0) / items.length;
  const conflictPenalty = conflicting(items) ? 15 : 0;
  return Math.round(clamp(average + Math.min(12, (sourceCount - 1) * 4) - conflictPenalty, 0, 100));
}

function conflicting(items: AnalyzedEvidence[]) {
  return items.some((item) => item.impactScore > 0) && items.some((item) => item.impactScore < 0);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}
