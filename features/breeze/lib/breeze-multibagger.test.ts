import assert from "node:assert/strict";
import test from "node:test";
import { assertResearchOnlySnapshot, classifyScore, combineCompanyAndSectorScore, type BreezeMultibaggerSnapshot } from "./breeze-multibagger";
import { calculateSourceReliability, DEFAULT_MARKET_INTELLIGENCE_WEIGHTS, resolveMarketIntelligenceWeights, scoreMarketIntelligenceTriage, type MarketTriageInput } from "./market-intelligence-triage";

const strongInput: MarketTriageInput = {
  symbol: "TEST", kind: "STOCK", modelScore: 82, companyGatePassed: true, dataQuality: 95,
  averageDailyTurnoverCr: 50, risk: "Low", horizon: "12–24 months", sectorContextScore: 75,
  factorScores: { growth: 18, momentum: 12, quality: 18, valuation: 12, catalyst: 8, liquidity: 10, risk: 9 },
  fundamentals: { debtToEquity: 25, cashConversion: 1.1, revenueGrowthPercent: 20, earningsGrowthPercent: 25, returnOnEquityPercent: 18 },
};

test("multibagger classifications and sector blend retain the existing model contract", () => {
  assert.equal(classifyScore(85), "Strong Candidate");
  assert.equal(classifyScore(70), "Watch Closely");
  assert.equal(classifyScore(55), "Emerging");
  assert.equal(classifyScore(54), "Avoid/Monitor");
  assert.equal(combineCompanyAndSectorScore(80, 100), 84);
  assert.equal(combineCompanyAndSectorScore(40, 100), 52);
});

test("requested triage weights are the default and remain normalized", () => {
  assert.deepEqual(DEFAULT_MARKET_INTELLIGENCE_WEIGHTS, {
    fundamentals: 35, growthMomentum: 20, institutionalSmartMoney: 15,
    sectorTheme: 10, expertConsensus: 10, valuationCatalyst: 10,
  });
  assert.equal(Math.round(Object.values(resolveMarketIntelligenceWeights({ fundamentals: 70 })).reduce((sum, value) => sum + value, 0)), 100);
});

test("expert recommendations cannot directly trigger BUY", () => {
  const triage = scoreMarketIntelligenceTriage({ ...strongInput, companyGatePassed: false }, {
    asOf: "2026-08-15", stocks: {}, expertRecommendations: [
      { sourceId: "broker-a", sourceName: "Broker A", independent: false, symbol: "TEST", recommendationDate: "2026-08-14", stance: "BUY", return6Month: 30 },
    ],
  }, DEFAULT_MARKET_INTELLIGENCE_WEIGHTS);
  assert.equal(triage.action, "REJECT");
  assert.equal(triage.deepValidationPassed, false);
});

test("duplicate calls from one source count once and reliability uses historical outcomes", () => {
  const records = [
    { sourceId: "research-a", sourceName: "Research A", independent: true, symbol: "TEST", recommendationDate: "2026-07-01", stance: "BUY" as const, return3Month: 12, return6Month: 20, return12Month: 35 },
    { sourceId: "research-a", sourceName: "Research A", independent: true, symbol: "TEST", recommendationDate: "2026-08-01", stance: "BUY" as const, return3Month: 10, return6Month: 18, return12Month: 30 },
  ];
  const reliability = calculateSourceReliability(records);
  assert.equal(reliability.length, 1);
  assert.ok(reliability[0].score > 50);
  const triage = scoreMarketIntelligenceTriage(strongInput, {
    asOf: "2026-08-15", stocks: { TEST: { sourceAsOf: "2026-06-30", fiiChangeQoQ: 1, mutualFundChangeQoQ: 1.5 } }, expertRecommendations: records,
  }, DEFAULT_MARKET_INTELLIGENCE_WEIGHTS);
  assert.equal(triage.sourceReliability.length, 1);
  assert.equal(triage.action, "BUY");
});

test("research contract rejects prices above ₹1,000", () => {
  const triage = scoreMarketIntelligenceTriage(strongInput, { asOf: "2026-08-15", stocks: {}, expertRecommendations: [] }, DEFAULT_MARKET_INTELLIGENCE_WEIGHTS);
  const candidate = {
    id: "STOCK:TEST", symbol: "TEST", name: "Test", kind: "STOCK" as const, exchange: "NSE" as const, sector: "Test", industry: "Test", price: 1000.01,
    score: 85, classification: "Strong Candidate" as const, growthPotential: "HIGH", horizon: "12–24 months" as const, risk: "Low" as const,
    keyReason: "Test", action: triage.action, outlook6To12: "Test", outlook12To24: "Test", source: "Test", sourceAsOf: new Date().toISOString(), factors: {}, triage,
  };
  const snapshot: BreezeMultibaggerSnapshot = {
    modelVersion: "breeze-multibagger-v4", mode: "RESEARCH_ONLY", automaticTrading: false, asOf: new Date().toISOString(), priceCeiling: 1000,
    universe: { scope: "test", stocksIncluded: true, etfsIncluded: true, upcomingIposIncluded: true, registered: 1, evaluated: 1, registryAsOf: new Date().toISOString() },
    historyCount: 0, sectorShortlists: [], upcomingIpos: [], etfOpportunities: [], topCandidates: [candidate], marketIntelligenceWatchlist: [candidate], rankedCandidates: [candidate], triageWeights: DEFAULT_MARKET_INTELLIGENCE_WEIGHTS,
  };
  assert.throws(() => assertResearchOnlySnapshot(snapshot), /price ceiling/u);
});
