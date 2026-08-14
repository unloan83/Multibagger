import assert from "node:assert/strict";
import test from "node:test";
import { actionForScore, assertResearchOnlySnapshot, classifyScore, type BreezeMultibaggerSnapshot } from "./breeze-multibagger";

test("multibagger classifications use the published score bands", () => {
  assert.equal(classifyScore(85), "Strong Candidate");
  assert.equal(classifyScore(70), "Watch Closely");
  assert.equal(classifyScore(55), "Emerging");
  assert.equal(classifyScore(54), "Avoid/Monitor");
  assert.equal(actionForScore(85), "ACCUMULATE");
  assert.equal(actionForScore(70), "WATCH");
  assert.equal(actionForScore(55), "WAIT");
  assert.equal(actionForScore(54), "AVOID");
});

test("research contract rejects prices above ₹1,000", () => {
  const snapshot: BreezeMultibaggerSnapshot = {
    modelVersion: "breeze-multibagger-v1",
    mode: "RESEARCH_ONLY",
    automaticTrading: false,
    asOf: new Date().toISOString(),
    priceCeiling: 1000,
    universe: { scope: "test", stocksIncluded: true, etfsIncluded: true, upcomingIposIncluded: true, registered: 1, evaluated: 1, registryAsOf: new Date().toISOString() },
    historyCount: 0,
    upcomingIpos: [],
    etfOpportunities: [],
    topCandidates: [{
      id: "STOCK:TEST", symbol: "TEST", name: "Test", kind: "STOCK", exchange: "NSE", price: 1000.01,
      score: 85, classification: "Strong Candidate", growthPotential: "High", horizon: "12–24 months", risk: "Medium",
      keyReason: "Test", action: "WATCH", outlook6To12: "Test", outlook12To24: "Test", source: "Test", sourceAsOf: new Date().toISOString(), factors: {},
    }],
  };
  assert.throws(() => assertResearchOnlySnapshot(snapshot), /price ceiling/u);
});
