import assert from "node:assert/strict";
import test from "node:test";
import {
  agentGrowth,
  agentInfo,
  agentMacroPolicy,
  agentOrchestrator,
  agentPerformance,
  agentPortfolio,
  agentRiskValidation,
  agentSentiment,
  buildAgentValidationReport,
  toRecommendationLogs,
} from "@/lib/agents";
import type { ManagedPortfolio, Recommendation } from "@/lib/portfolio";

const portfolio: ManagedPortfolio = {
  id: "private-portfolio",
  name: "Private",
  appetite: "moderate",
  inputs: [{ list: "current", stockCode: "TEST", company: "Test Ltd", stock: "TEST", quantity: 10, buyPrice: 90 }],
  positions: [{
    list: "current",
    stock: "TEST",
    symbol: "TEST",
    company: "Test Ltd",
    sector: "Power",
    quantity: 10,
    currentPrice: 100,
    previousClose: 98,
    volume: 1_000_000,
    currency: "INR",
  }],
};

test("social input is explicitly capped at low confidence", () => {
  const output = agentInfo([{
    summary: "Test wins record order and profit surges",
    affectedStocks: ["TEST"],
    source: { name: "Social post", credibility: "low", kind: "social", publishedAt: new Date().toISOString() },
  }]);
  assert.equal(output.events[0].source.kind, "social");
  assert(output.events[0].confidence <= 10);
  assert(output.events[0].impactScore < 2);
});

test("risk validation downgrades a low-confidence Buy and orchestrator cannot restore it", () => {
  const now = new Date("2026-06-30T05:00:00.000Z");
  const info = agentInfo([], now);
  const macro = agentMacroPolicy({ info, market: null, now });
  const sentiment = agentSentiment(info, now);
  const portfolioOutput = agentPortfolio({ portfolio, info, macroPolicy: macro, sentiment, now });
  const recommendation: Recommendation = {
    id: "test-buy",
    portfolioId: portfolio.id,
    portfolioName: portfolio.name,
    section: "1-3 Yr Plan",
    symbol: "TEST",
    company: "Test Ltd",
    action: "Accumulate",
    horizon: "6-12 months",
    rationale: "Existing logic candidate.",
    confidence: 40,
    createdAt: now.toISOString(),
    status: "NA",
  };
  const growth = agentGrowth({ portfolio, existingRecommendations: [recommendation], now });
  const risk = agentRiskValidation({ growth, info, macroPolicy: macro, sentiment, portfolio: portfolioOutput, now });
  const performance = agentPerformance({ history: [], now });
  const final = agentOrchestrator({
    info,
    macroPolicy: macro,
    sentiment,
    portfolio: portfolioOutput,
    growth,
    riskValidation: risk,
    performance,
    now,
  });

  assert.equal(risk.decisions[0].checks.poorConfidence, true);
  assert.equal(risk.decisions[0].downgradeTo, "Watch");
  assert(["Watch", "Hold"].includes(final.recommendations[0].action));
});

test("performance logs retain every agent score and contribution direction", () => {
  const now = new Date("2026-06-30T05:00:00.000Z");
  const info = agentInfo([], now);
  const macro = agentMacroPolicy({ info, market: { sentiment: "Positive", averageMove: 1 }, now });
  const sentiment = agentSentiment(info, now);
  const portfolioOutput = agentPortfolio({ portfolio, info, macroPolicy: macro, sentiment, now });
  const growth = agentGrowth({ portfolio, existingRecommendations: [], now });
  const risk = agentRiskValidation({ growth, info, macroPolicy: macro, sentiment, portfolio: portfolioOutput, now });
  const output = agentOrchestrator({
    info,
    macroPolicy: macro,
    sentiment,
    portfolio: portfolioOutput,
    growth,
    riskValidation: risk,
    performance: agentPerformance({ history: [], now }),
    now,
  });
  const logs = toRecommendationLogs(output.recommendations, portfolio.id, now.toISOString());

  assert.equal(logs.length, 1);
  assert.deepEqual(Object.keys(logs[0].agentScores).sort(), [
    "existingLogic", "info", "macroPolicy", "portfolio", "riskValidation", "sentiment",
  ].sort());
  assert.equal(logs[0].status, "pending");
  assert.equal(logs[0].shadowMode, true);
  assert.equal(logs[0].outcomes.length, 3);
});

test("validation report blocks promotion when official source coverage is missing", () => {
  const now = new Date("2026-06-30T05:00:00.000Z");
  const info = agentInfo([], now);
  const macro = agentMacroPolicy({ info, market: { sentiment: "Neutral", averageMove: 0 }, now });
  const sentiment = agentSentiment(info, now);
  const portfolioOutput = agentPortfolio({ portfolio, info, macroPolicy: macro, sentiment, now });
  const growth = agentGrowth({ portfolio, existingRecommendations: [], now });
  const risk = agentRiskValidation({ growth, info, macroPolicy: macro, sentiment, portfolio: portfolioOutput, now });
  const output = agentOrchestrator({
    info,
    macroPolicy: macro,
    sentiment,
    portfolio: portfolioOutput,
    growth,
    riskValidation: risk,
    performance: agentPerformance({ history: [], now }),
    now,
  });
  const report = buildAgentValidationReport({
    output,
    portfolio,
    history: [],
    logs: toRecommendationLogs(output.recommendations, portfolio.id, now.toISOString()),
    now,
  });

  assert.equal(report.mode, "shadow");
  assert.equal(report.agentHealth.length, 8);
  assert.equal(report.promotionGate.status, "SHADOW_ONLY");
  assert.equal(
    report.sourceCoverage.find((item) => item.area === "exchange filings")?.status,
    "missing",
  );
  assert(report.accessGaps.some((gap) => gap.requiredAccess.includes("NSE/BSE")));
});
