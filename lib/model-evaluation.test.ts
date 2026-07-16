import assert from "node:assert/strict";
import test from "node:test";
import { evaluateRecommendationModel } from "@/lib/model-evaluation";
import type { ValidationRecord } from "@/lib/intelligence-validation";

test("model evaluation remains insufficient without a meaningful held-out sample", () => {
  const report = evaluateRecommendationModel(
    Array.from({ length: 20 }, (_, index) => record(index, true)),
    new Date("2026-12-01T00:00:00.000Z"),
  );
  assert.equal(report.status, "INSUFFICIENT_DATA");
  assert.equal(report.promotionGate.eligible, false);
});

test("walk-forward evaluation can clear the review gate on strong held-out evidence", () => {
  const report = evaluateRecommendationModel(
    Array.from({ length: 80 }, (_, index) => record(index, true)),
    new Date("2026-12-01T00:00:00.000Z"),
  );
  assert.equal(report.status, "ELIGIBLE_FOR_REVIEW");
  assert.equal(report.outOfSample.hitRate, 100);
  assert.equal(report.outOfSample.excessReturnVsCashPercent, 2);
  assert.equal(report.outOfSample.maximumDrawdownPercent, 0);
  assert(report.walkForward.length > 0);
});

function record(index: number, hit: boolean): ValidationRecord {
  const timestamp = new Date(Date.UTC(2026, 6, 16 + index, 5)).toISOString();
  return {
    timestamp, date: timestamp.slice(0, 10), source: "portfolio-recommendation", portfolioName: "Test",
    section: "1-3 Yr Plan", symbol: `TEST${index}`, company: `Test ${index}`, action: "Accumulate",
    horizon: "6-12 months", predictedPrice: 100, targetPrice: 115, predictedUpsidePercent: 15,
    score: 80, confidence: 80, validationStatus: hit ? "Hit" : "Miss", hitTimestamp: "",
    actualPrice: hit ? 102 : 98, caveat: "", rationale: "Qualified", portfolioId: "test",
    recommendationId: `rec-${index}`, sector: "Technology", stopLoss: 92, qualityScore: 100,
    qualityStatus: "PASS", validationTimestamp: timestamp, validationDate: timestamp.slice(0, 10),
    returnPercent: hit ? 2 : -2, marketRegime: index % 2 ? "Risk-On" : "Correction",
    qualityFactors: {
      marketRegimeAvailable: true, sectorStrengthAvailable: true, trendConfirmationAvailable: true,
      riskScoreAssigned: true, confidenceCalculated: true, portfolioFitChecked: true,
      recommendationHorizonAssigned: true,
    },
  };
}
