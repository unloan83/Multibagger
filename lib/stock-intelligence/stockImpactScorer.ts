import { evidenceConfidence, weightedImpact } from "./policyImpactAnalyzer";
import type { AnalyzedEvidence, ExistingRecommendationSignal } from "./types";

export function scoreStockImpact(signal: ExistingRecommendationSignal, evidence: AnalyzedEvidence[]) {
  const companyTerms = [signal.symbol, signal.company]
    .flatMap((value) => value.toLowerCase().split(/[^a-z0-9]+/u))
    .filter((value) => value.length >= 3);
  const sectorTerms = (signal.sector || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((value) => value.length >= 4);
  const stockEvidence = evidence.filter((item) =>
    item.queryScope === "stock" && (
      item.relatedSymbols?.includes(signal.symbol) || companyTerms.some((term) => item.title.toLowerCase().includes(term))
    ),
  );
  const sectorEvidence = evidence.filter((item) =>
    item.queryScope !== "stock" && (
      item.queryScope === "macro" || sectorTerms.some((term) => item.title.toLowerCase().includes(term))
    ),
  );

  return {
    stockEvidence: stockEvidence.slice(0, 8),
    sectorEvidence: sectorEvidence.slice(0, 8),
    newsImpactScore: weightedImpact(stockEvidence),
    macroImpactScore: weightedImpact(sectorEvidence),
    evidenceConfidence: evidenceConfidence([...stockEvidence, ...sectorEvidence]),
    independentSources: new Set([...stockEvidence, ...sectorEvidence].map((item) => item.source.toLowerCase())).size,
    credibleSources: new Set(
      [...stockEvidence, ...sectorEvidence]
        .filter((item) => item.credibility !== "low")
        .map((item) => item.source.toLowerCase()),
    ).size,
  };
}
