import assert from "node:assert/strict";
import test from "node:test";
import { analyzeEvidence, freshnessFor } from "./sentimentAnalyzer";
import { combineRecommendation, getIntelligenceWeights } from "./recommendationCombiner";
import type { AnalyzedEvidence, ExistingRecommendationSignal } from "./types";

const signal: ExistingRecommendationSignal = {
  symbol: "TEST",
  company: "Test Industries",
  sector: "Industrials",
  source: "opportunity",
  action: "BUY",
  score: 82,
  confidence: 80,
  timeframe: "6–12 months",
  reason: "Existing engine passed its safety gates.",
  currentPrice: 100,
  target: 120,
  stopLoss: 92,
};

test("default weights preserve the controlled 60/25/15 structure", () => {
  assert.deepEqual(getIntelligenceWeights({}), {
    existingLogic: 60,
    newsSentiment: 25,
    sectorMacro: 15,
  });
});

test("a Buy requires independent, sufficiently confident supporting evidence", () => {
  const evidence = [item("Company wins major order", "Reuters", 3), item("Sector policy approved", "RBI", 2)];
  const result = combineRecommendation({
    signal,
    stockEvidence: evidence.slice(0, 1),
    sectorEvidence: evidence.slice(1),
    newsImpactScore: 3,
    macroImpactScore: 2,
    evidenceConfidence: 82,
    independentSources: 2,
    credibleSources: 2,
    weights: getIntelligenceWeights({}),
  });
  assert.equal(result.action, "Buy");
  assert.equal(result.target, 120);
  assert.equal(result.stopLoss, 92);
});

test("limited evidence downgrades an opportunity to Watch and removes execution levels", () => {
  const evidence = [item("Company wins major order", "Single Source", 4)];
  const result = combineRecommendation({
    signal,
    stockEvidence: evidence,
    sectorEvidence: [],
    newsImpactScore: 4,
    macroImpactScore: 0,
    evidenceConfidence: 45,
    independentSources: 1,
    credibleSources: 1,
    weights: getIntelligenceWeights({}),
  });
  assert.equal(result.action, "Watch");
  assert.equal(result.target, undefined);
  assert.equal(result.stopLoss, undefined);
});

test("multiple low-credibility sources cannot validate an aggressive call", () => {
  const evidence = [item("Blog expects growth", "Blog One", 4), item("Forum expects upgrade", "Blog Two", 3)]
    .map((entry) => ({ ...entry, credibility: "low" as const, confidence: 45 }));
  const result = combineRecommendation({
    signal,
    stockEvidence: evidence,
    sectorEvidence: [],
    newsImpactScore: 4,
    macroImpactScore: 1,
    evidenceConfidence: 60,
    independentSources: 2,
    credibleSources: 0,
    weights: getIntelligenceWeights({}),
  });
  assert.equal(result.action, "Watch");
});

test("a high-confidence existing Sell remains directionally bearish", () => {
  const evidence = [item("Regulator opens investigation", "SEBI", -4), item("Profit warning issued", "Reuters", -3)];
  const result = combineRecommendation({
    signal: { ...signal, source: "portfolio", action: "SELL", score: 82, target: 88, stopLoss: 106 },
    stockEvidence: evidence.slice(0, 1),
    sectorEvidence: evidence.slice(1),
    newsImpactScore: -4,
    macroImpactScore: -2,
    evidenceConfidence: 85,
    independentSources: 2,
    credibleSources: 2,
    weights: getIntelligenceWeights({}),
  });
  assert.equal(result.action, "Sell");
  assert.ok(result.finalScore <= 45);
});

test("freshness and credibility affect evidence confidence", () => {
  const now = new Date("2026-06-27T10:00:00Z");
  assert.equal(freshnessFor("2026-06-27T09:00:00Z", now), "today");
  assert.equal(freshnessFor("2026-06-22T09:00:00Z", now), "this week");
  assert.equal(freshnessFor("2026-06-01T09:00:00Z", now), "older");
  const analyzed = analyzeEvidence({
    id: "1",
    title: "Profit growth beats guidance",
    url: "https://reuters.com/example",
    source: "Reuters",
    publishedAt: "2026-06-27T09:00:00Z",
    category: "quarterly-results",
    credibility: "high",
    queryScope: "stock",
  }, now);
  assert.equal(analyzed.impact, "Positive");
  assert.ok(analyzed.confidence >= 80);
});

function item(title: string, source: string, impactScore: number): AnalyzedEvidence {
  return {
    id: `${source}-${title}`,
    title,
    url: `https://example.com/${source}`,
    source,
    publishedAt: new Date().toISOString(),
    category: "company",
    credibility: "high",
    queryScope: "stock",
    impact: impactScore > 0 ? "Positive" : impactScore < 0 ? "Negative" : "Neutral",
    impactScore,
    confidence: 85,
    freshness: "today",
    explanation: "Test evidence",
  };
}
