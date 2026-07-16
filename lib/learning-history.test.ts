import assert from "node:assert/strict";
import test from "node:test";
import {
  filterLearningAgentLogs,
  filterLearningValidationHistory,
} from "@/lib/learning-history";
import type { AgentRecommendationLog } from "@/lib/agents/types";
import type { ValidationRecord } from "@/lib/intelligence-validation";

const now = new Date("2026-07-17T12:00:00.000Z");

test("learning history excludes pre-epoch, failed-quality and non-actionable records", () => {
  const valid = validation({ recommendationId: "valid" });
  const records = [
    validation({ recommendationId: "legacy", timestamp: "2026-07-15T05:00:00.000Z" }),
    validation({ recommendationId: "failed", qualityStatus: "FAIL" }),
    validation({ recommendationId: "watch", action: "Watchlist", stopLoss: 0 }),
    valid,
    { ...valid, confidence: 80 },
  ];
  const clean = filterLearningValidationHistory(records, now);
  assert.equal(clean.length, 1);
  assert.equal(clean[0].recommendationId, "valid");
  assert.equal(clean[0].confidence, 80);
});

test("Bayesian learning excludes legacy, watch and zero-entry logs", () => {
  const clean = filterLearningAgentLogs([
    agentLog({ id: "legacy", timestamp: "2026-07-15T05:00:00.000Z" }),
    agentLog({ id: "watch", finalAction: "Watch" }),
    agentLog({ id: "zero-entry", entryPrice: 0 }),
    agentLog({ id: "valid" }),
  ], now);
  assert.deepEqual(clean.map((log) => log.id), ["valid"]);
});

function validation(overrides: Partial<ValidationRecord>): ValidationRecord {
  return {
    timestamp: "2026-07-16T05:00:00.000Z", date: "2026-07-16", source: "portfolio-recommendation",
    portfolioName: "Test", section: "1-3 Yr Plan", symbol: "TEST", company: "Test Ltd",
    action: "Accumulate", horizon: "6-12 months", predictedPrice: 100, targetPrice: 115,
    predictedUpsidePercent: 15, score: 75, confidence: 70, validationStatus: "Hit",
    hitTimestamp: "", actualPrice: 115, caveat: "", rationale: "Qualified", portfolioId: "test",
    recommendationId: "base", sector: "Technology", stopLoss: 92, qualityScore: 100,
    qualityStatus: "PASS", validationTimestamp: "2026-07-16T05:00:00.000Z",
    validationDate: "2026-07-16", returnPercent: 15, marketRegime: "Transition",
    qualityFactors: {
      marketRegimeAvailable: true, sectorStrengthAvailable: true, trendConfirmationAvailable: true,
      riskScoreAssigned: true, confidenceCalculated: true, portfolioFitChecked: true,
      recommendationHorizonAssigned: true,
    },
    ...overrides,
  };
}

function agentLog(overrides: Partial<AgentRecommendationLog>): AgentRecommendationLog {
  return {
    id: "base", timestamp: "2026-07-16T05:00:00.000Z", portfolioId: "test", stock: "TEST",
    agentScores: {}, finalAction: "Buy", timeframe: "Long term", target: 115, stopLoss: 92,
    confidence: 70, reason: "Qualified", entryPrice: 100, currentLogicAction: "Buy",
    currentLogicConfidence: 70, sourceTypes: [], outcomes: [], outcomeReason: "", shadowMode: true,
    status: "hit", positiveContributors: [], negativeContributors: [],
    ...overrides,
  };
}
