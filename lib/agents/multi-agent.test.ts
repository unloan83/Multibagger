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
  reconcileRecommendationLogs,
  toRecommendationLogs,
} from "@/lib/agents";
import { toEvent } from "@/lib/agents/marketIntelligence";
import type {
  AgentFundamentalOutput,
  AgentEarningsQualityOutput,
  AgentIntradayOutput,
  AgentLongTermOutput,
  AgentRebalanceOutput,
  AgentSwingOutput,
  AgentTechnicalOutput,
} from "@/lib/agents/types";
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

const emptyFundamental = (): AgentFundamentalOutput => ({
  agent: "Fundamental",
  generatedAt: new Date().toISOString(),
  byStock: {},
  summary: "No fundamental data available.",
});

const emptyTechnical = (): AgentTechnicalOutput => ({
  agent: "Technical",
  generatedAt: new Date().toISOString(),
  byStock: {},
  summary: "No technical data available.",
});

const emptyIntraday = (): AgentIntradayOutput => ({
  agent: "Intraday",
  generatedAt: new Date().toISOString(),
  byStock: {},
  summary: "No intraday data available.",
});

const emptySwing = (): AgentSwingOutput => ({
  agent: "Swing",
  generatedAt: new Date().toISOString(),
  byStock: {},
  summary: "No swing data available.",
});

const emptyLongTerm = (): AgentLongTermOutput => ({
  agent: "LongTerm",
  generatedAt: new Date().toISOString(),
  byStock: {},
  summary: "No long-term data available.",
});

const emptyEarningsQuality = (): AgentEarningsQualityOutput => ({
  agent: "EarningsQuality",
  generatedAt: new Date().toISOString(),
  byStock: {},
  summary: "No earnings quality data available.",
});

const emptyRebalance = (): AgentRebalanceOutput => ({
  agent: "Rebalance",
  generatedAt: new Date().toISOString(),
  byStock: {},
  summary: "No rebalance data available.",
});

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
    fundamental: emptyFundamental(),
    technical: emptyTechnical(),
    intraday: emptyIntraday(),
    swing: emptySwing(),
    longTerm: emptyLongTerm(),
    earningsQuality: emptyEarningsQuality(),
    rebalance: emptyRebalance(),
    portfolioInput: portfolio,
    now,
  });

  assert.equal(risk.decisions[0].checks.poorConfidence, true);
  assert.equal(risk.decisions[0].downgradeTo, "Watch");
  assert(["Watch", "Hold"].includes(final.recommendations[0].action));
});

test("reliable specialist evidence prevents a no-news weak-source downgrade", () => {
  const now = new Date("2026-06-30T05:00:00.000Z");
  const info = agentInfo([], now);
  const macro = agentMacroPolicy({ info, market: null, now });
  const sentiment = agentSentiment(info, now);
  const portfolioOutput = agentPortfolio({ portfolio, info, macroPolicy: macro, sentiment, now });
  const recommendation: Recommendation = {
    id: "specialist-buy",
    portfolioId: portfolio.id,
    portfolioName: portfolio.name,
    section: "1-3 Yr Plan",
    symbol: "TEST",
    company: "Test Ltd",
    action: "Accumulate",
    horizon: "6-12 months",
    rationale: "Strong specialist evidence.",
    confidence: 75,
    createdAt: now.toISOString(),
    status: "NA",
  };
  const growth = agentGrowth({ portfolio, existingRecommendations: [recommendation], now });
  const fundamental = emptyFundamental();
  fundamental.byStock.TEST = {
    metrics: { peRatio: 18, pbRatio: 2, debtEquity: 20, returnOnEquity: 0.18, revenueGrowth: 0.15, profitMargin: 0.12, marketCap: 1_000_000, dividendYield: 0.01 },
    score: 2,
    confidence: 75,
    reasons: ["Fundamentals independently support the candidate."],
  };
  const risk = agentRiskValidation({
    growth,
    info,
    macroPolicy: macro,
    sentiment,
    portfolio: portfolioOutput,
    fundamental,
    now,
  });

  assert.equal(risk.decisions[0].checks.weakSources, false);
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
    fundamental: emptyFundamental(),
    technical: emptyTechnical(),
    intraday: emptyIntraday(),
    swing: emptySwing(),
    longTerm: emptyLongTerm(),
    earningsQuality: emptyEarningsQuality(),
    rebalance: emptyRebalance(),
    portfolioInput: portfolio,
    now,
  });
  const logs = toRecommendationLogs(output.recommendations, portfolio.id, now.toISOString());

  assert.equal(logs.length, 1);
  assert.deepEqual(Object.keys(logs[0].agentScores).sort(), [
    "earningsQuality", "existingLogic", "fundamental", "info", "intraday", "longTerm", "macroPolicy", "portfolio", "rebalance", "riskValidation", "sentiment", "swing", "technical",
  ].sort());
  assert.equal(logs[0].status, "pending");
  assert.equal(logs[0].shadowMode, true);
  assert.equal(logs[0].outcomes.length, 3);
});

test("performance uses trading-day windows and meaningful return thresholds", () => {
  const timestamp = "2026-07-03T10:00:00.000Z"; // Friday
  const scores = {
    existingLogic: 2,
    info: 1,
    macroPolicy: 1,
    sentiment: 1,
    portfolio: 1,
    riskValidation: 1,
    fundamental: 1,
    technical: 1,
    intraday: 1,
    swing: 1,
    longTerm: 1,
    earningsQuality: 1,
    rebalance: 1,
  };
  const logs = toRecommendationLogs([{
    symbol: "TEST",
    company: "Test Ltd",
    action: "Buy",
    timeframe: "Intraday",
    confidence: 70,
    score: 2,
    reason: "Threshold test.",
    whatChangedRecently: [],
    positiveTriggers: [],
    negativeConcerns: [],
    sourceSummary: [],
    portfolioImpact: "Suitable for validation only.",
    agentScores: scores,
    agentReasons: {},
  }], portfolio.id, timestamp, { entryPrices: { TEST: 100 } });

  assert.equal(logs[0].outcomes[0].dueAt, "2026-07-06T10:00:00.000Z");
  const weakMove = reconcileRecommendationLogs(
    logs,
    [],
    { TEST: 100.2 },
    new Date("2026-07-06T10:01:00.000Z"),
  );
  assert.equal(weakMove[0].outcomes[0].status, "miss");
  const qualifiedMove = reconcileRecommendationLogs(
    logs,
    [],
    { TEST: 100.6 },
    new Date("2026-07-06T10:01:00.000Z"),
  );
  assert.equal(qualifiedMove[0].outcomes[0].status, "hit");
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
    fundamental: emptyFundamental(),
    technical: emptyTechnical(),
    intraday: emptyIntraday(),
    swing: emptySwing(),
    longTerm: emptyLongTerm(),
    earningsQuality: emptyEarningsQuality(),
    rebalance: emptyRebalance(),
    portfolioInput: portfolio,
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
  assert.equal(report.agentHealth.length, 16);
  assert.equal(report.promotionGate.status, "SHADOW_ONLY");
  assert.equal(
    report.sourceCoverage.find((item) => item.area === "exchange filings")?.status,
    "missing",
  );
  assert(report.accessGaps.some((gap) => gap.requiredAccess.includes("NSE/BSE")));
});

test("market intelligence classifies official and attributed sources", () => {
  const filing = toEvent({
    title: "TEST files dividend corporate announcement",
    url: "https://www.nseindia.com/companies-listing/corporate-filings-announcements",
    publishedAt: "2026-07-01T08:00:00.000Z",
    publisher: "NSE",
  }, portfolio);
  const macro = toEvent({
    title: "India inflation and rupee outlook shifts after crude oil move",
    url: "https://www.reuters.com/markets/asia/",
    publishedAt: "2026-07-01T08:00:00.000Z",
    publisher: "Reuters",
  }, portfolio);

  assert.equal(filing.source.kind, "exchange_filing");
  assert.equal(filing.source.credibility, "high");
  assert.ok(filing.affectedStocks?.includes("TEST"));
  assert.equal(macro.source.kind, "macro");
  assert.equal(macro.source.credibility, "high");
});
