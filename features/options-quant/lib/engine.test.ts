import assert from "node:assert/strict";
import test from "node:test";
import type { OptionChainRow, OptionsBroker } from "@/features/options-quant/brokers/types";
import type { OptionsPosition } from "@/features/options-quant/lib/types";
import { buildOpportunity, calculateMetrics } from "@/features/options-quant/lib/engine";
import { getOptionsQuantConfig } from "@/features/options-quant/lib/config";

const broker: OptionsBroker = {
  name: "TEST",
  getOptionContracts: async () => [],
  getOptionChain: async () => [],
  getIntradayCandles: async () => [],
  estimateCharges: async () => 100,
  submitSandboxSpread: async () => ["one", "two"],
  submitSandboxExit: async () => ["three", "four"],
};

const direction = {
  asOf: new Date().toISOString(),
  direction: "BULLISH" as const,
  confidence: 80,
  marketRegime: "RISK_ON",
  trendStrength: 75,
  bankNiftyConfirmation: 65,
  optionChainConfirmation: 60,
  observations: {
    niftyReturnFromOpenBps: 35,
    niftyFastSlowGapBps: 8,
    bankNiftyReturnFromOpenBps: 28,
    bankNiftyFastSlowGapBps: 6,
    putCallOiRatio: 1.1,
    optionExpiry: "2099-01-08",
    latestMarketTimestamp: new Date().toISOString(),
  },
  sourceIds: ["upstox-nifty", "upstox-bank-nifty", "upstox-option-chain"],
  modelVersion: "test-v1",
};

function leg(optionType: "CE" | "PE", strike: number, delta: number, bid: number, ask: number) {
  return {
    instrumentKey: `NSE_FO|${optionType}-${strike}`,
    tradingSymbol: `NIFTY ${strike} ${optionType}`,
    side: "BUY" as const,
    optionType,
    strike,
    bid,
    ask,
    ltp: (bid + ask) / 2,
    iv: 14,
    delta,
    oi: 50_000,
    volume: 10_000,
    bidAskSpreadPercent: ((ask - bid) / ((ask + bid) / 2)) * 100,
  };
}

const chain: OptionChainRow[] = [
  { expiry: "2099-01-08", strike: 25000, spot: 25010, call: leg("CE", 25000, 0.52, 118, 120), put: leg("PE", 25000, -0.48, 105, 107) },
  { expiry: "2099-01-08", strike: 25100, spot: 25010, call: leg("CE", 25100, 0.32, 78, 80), put: leg("PE", 25100, -0.67, 150, 153) },
  { expiry: "2099-01-08", strike: 24900, spot: 25010, call: leg("CE", 24900, 0.68, 160, 163), put: leg("PE", 24900, -0.3, 66, 68) },
];

test("builds only a defined-risk bull call spread from executable quotes", async () => {
  const config = { ...getOptionsQuantConfig(), portfolioCapital: 500_000, riskPerTradePercent: 1 };
  const result = await buildOpportunity(direction, chain, 75, broker, config);
  assert.ok(result.opportunity);
  assert.equal(result.opportunity.strategy, "BULL_CALL_SPREAD");
  assert.equal(result.opportunity.longLeg.side, "BUY");
  assert.equal(result.opportunity.shortLeg.side, "SELL");
  assert.equal(result.opportunity.entryDebitPerUnit, 42);
  assert.equal(result.opportunity.profitTargetRupees, 3_000);
  assert.match(result.opportunity.exitRules.join(" "), /₹3000/);
  assert.ok(result.opportunity.maxLoss > 0);
  assert.ok(result.opportunity.maxProfit > 0);
});

test("rejects a spread whose maximum net profit cannot reach the per-trade target", async () => {
  const config = { ...getOptionsQuantConfig(), portfolioCapital: 500_000, riskPerTradePercent: 2, profitTargetRupees: 5_000 };
  const result = await buildOpportunity(direction, chain, 75, broker, config);
  assert.equal(result.opportunity, null);
  assert.match(result.reasons.join(" "), /cannot reach the configured ₹5000 per-trade target/);
});

test("rejects a spread whose maximum loss exceeds portfolio risk", async () => {
  const config = { ...getOptionsQuantConfig(), portfolioCapital: 10_000, riskPerTradePercent: 1 };
  const result = await buildOpportunity(direction, chain, 75, broker, config);
  assert.equal(result.opportunity, null);
  assert.match(result.reasons.join(" "), /exceeds configured risk budget/);
});

test("performance metrics are net of costs and include drawdown", () => {
  const base = {
    ...(null as unknown as OptionsPosition),
  };
  const positions = [
    { ...base, id: "one", status: "CLOSED", mode: "SHADOW", strategy: "BULL_CALL_SPREAD", openedAt: "2026-01-01T00:00:00Z", netPnl: 500, grossPnl: 650, actualCosts: 100, slippageCost: 50, maxLoss: 1000 },
    { ...base, id: "two", status: "CLOSED", mode: "SHADOW", strategy: "BEAR_PUT_SPREAD", openedAt: "2026-01-02T00:00:00Z", netPnl: -250, grossPnl: -150, actualCosts: 80, slippageCost: 20, maxLoss: 900 },
  ] as OptionsPosition[];
  const metrics = calculateMetrics(positions, 100_000);
  assert.equal(metrics.netPnl, 250);
  assert.equal(metrics.winRate, 50);
  assert.equal(metrics.profitFactor, 2);
  assert.equal(metrics.expectancyPerTrade, 125);
  assert.equal(metrics.maximumDrawdown, 250);
  assert.equal(metrics.costs, 180);
  assert.equal(metrics.slippage, 70);
});
