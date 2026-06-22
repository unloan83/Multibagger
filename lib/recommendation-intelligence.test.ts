import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRecommendationIntelligence,
  buildLearningFeedback,
  classifyNewsSentiment,
  rankSectorDirections,
  scoreGovernmentPolicy,
} from "@/lib/recommendation-intelligence";
import type { ValidationRecord } from "@/lib/intelligence-validation";

test("classifies company, sector and market headlines conservatively", () => {
  const positive = classifyNewsSentiment(
    ["Company wins record government order and reports strong profit growth"],
    ["Sector investment receives a boost"],
    ["Market remains neutral"],
  );
  const negative = classifyNewsSentiment(
    ["Regulatory investigation follows weak results and a profit decline"],
  );
  const neutral = classifyNewsSentiment(["Company schedules annual meeting"]);

  assert.equal(positive.classification, "Positive");
  assert(positive.score > 0);
  assert.equal(negative.classification, "Negative");
  assert(negative.score < 0);
  assert.equal(neutral.classification, "Neutral");
});

test("scores policy only when government and sector context are both present", () => {
  const positive = scoreGovernmentPolicy(
    "Power",
    ["Government approves power grid investment and renewable subsidy scheme"],
    [],
  );
  const irrelevant = scoreGovernmentPolicy(
    "Healthcare",
    ["Company reports strong quarterly profit"],
    ["Government approves railway infrastructure spending"],
  );

  assert.equal(positive.classification, "Positive");
  assert(positive.score > 0);
  assert.equal(irrelevant.score, 0);
});

test("ranks sectors using returns, breadth, news and policy", () => {
  const sectors = rankSectorDirections(
    [
      { sector: "Defense", return20Percent: 12, return60Percent: 24, trendAligned: true },
      { sector: "Defense", return20Percent: 8, return60Percent: 18, trendAligned: true },
      { sector: "Textiles", return20Percent: -8, return60Percent: -14, trendAligned: false },
    ],
    {
      Defense: ["Government procurement order boosts defense manufacturing"],
      Textiles: ["Weak demand causes sector decline"],
    },
    ["Government budget increases defense spending and procurement outlay"],
  );

  assert.equal(sectors[0].sector, "Defense");
  assert.equal(sectors[0].label, "Top Sector");
  assert.equal(sectors.at(-1)?.label, "Weak Sector");
});

test("caps contextual scoring so intelligence cannot override the base engine", () => {
  const intelligence = applyRecommendationIntelligence({
    baseScore: 60,
    technicalStrength: 90,
    fundamentalStrength: 90,
    sectorDirection: {
      sector: "Defense",
      rank: 1,
      score: 100,
      label: "Top Sector",
      return20Percent: 20,
      return60Percent: 30,
      trendBreadthPercent: 100,
      newsSentimentScore: 10,
      policyScore: 10,
    },
    newsSentiment: { classification: "Positive", score: 10, sampleSize: 10 },
    policy: { classification: "Positive", score: 10, matchedHeadlines: 5 },
    expertFocusCount: 20,
    learningAdjustment: 10,
  });

  assert.equal(intelligence.contextAdjustment, 12);
  assert.equal(intelligence.finalScore, 72);
});

test("learning feedback uses 7, 30 and 90 day reviews with sample guards", () => {
  const records = Array.from({ length: 10 }, (_, index) =>
    validationRecord(index < 8 ? "Hit" : "Miss", index),
  );
  const feedback = buildLearningFeedback(records, new Date("2026-06-22T00:00:00.000Z"));

  assert.equal(feedback.windows.length, 3);
  assert.equal(feedback.windows[1].hitRate, 80);
  assert.equal(feedback.adjustment, 2);
  assert.equal(feedback.sectorAccuracy.Defense, 80);
  assert(feedback.recommendationQualityScore > 0);
});

function validationRecord(
  status: ValidationRecord["validationStatus"],
  index: number,
): ValidationRecord {
  return {
    timestamp: new Date(Date.UTC(2026, 5, 21 - index)).toISOString(),
    date: "2026-06-21",
    source: "expert-insight",
    portfolioName: "Test",
    section: "1-3 Yr Plan",
    symbol: `TEST${index}`,
    company: "Test",
    action: "Accumulate",
    horizon: "6-12 months",
    predictedPrice: 100,
    targetPrice: 120,
    predictedUpsidePercent: 20,
    score: 75,
    confidence: index < 8 ? 80 : 65,
    validationStatus: status,
    hitTimestamp: "",
    actualPrice: status === "Hit" ? 120 : 90,
    caveat: "",
    rationale: "",
    portfolioId: "test",
    recommendationId: `test-${index}`,
    sector: "Defense",
    stopLoss: 92,
    qualityScore: 90,
    qualityStatus: "PASS",
    validationTimestamp: "",
    validationDate: "",
    returnPercent: status === "Hit" ? 20 : -10,
    marketRegime: "Risk-On",
    qualityFactors: {
      marketRegimeAvailable: true,
      sectorStrengthAvailable: true,
      trendConfirmationAvailable: true,
      riskScoreAssigned: true,
      confidenceCalculated: true,
      portfolioFitChecked: true,
      recommendationHorizonAssigned: true,
    },
  };
}
