import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  scoreUpstoxCandidateTriage,
  evaluateUpstoxFunnel,
  updateExpertPerformance,
  readExpertReliabilityStore,
  DEFAULT_UPSTOX_TRIAGE_WEIGHTS,
  UpstoxCandidateRaw,
} from "./upstox-market-triage";

describe("Upstox Market Intelligence Triage Layer", () => {

  test("1. Composite Triage Score Calculation & Configurable Weights", () => {
    const candidate: UpstoxCandidateRaw = {
      symbol: "TESTSTOCK",
      name: "Test Stock Ltd",
      instrumentKey: "NSE_EQ|TEST",
      cmp: 500,
      target: 560,
      stopLoss: 480,
      signal: "BUY",
      score: 90,
      rvol: 3.0,
      marketSectorBias: {
        fiiDiiNetBuyer: true,
        sectorTrend: "BULLISH",
        sectorRelativeStrength: 75,
      },
      smartMoneySignals: {
        bulkBlockDeals: true,
        deliveryVolumeSpike: true,
        unusualVolume: true,
        futuresOptionsActivity: "LONG_BUILDUP",
      },
      expertTips: [
        {
          sourceId: "sebi_ra_core",
          sourceName: "SEBI Registered Research Analysts",
          isSebiRegistered: true,
          isIndependent: true,
          stance: "BUY",
        },
      ],
      catalysts: [
        { headline: "Record Q1 Profit", impact: "HIGH_POSITIVE" },
      ],
    };

    const details = scoreUpstoxCandidateTriage(candidate, DEFAULT_UPSTOX_TRIAGE_WEIGHTS);

    assert.equal(details.marketAlignment, "Strong");
    assert.equal(details.smartMoney, "Strong");
    assert.equal(details.expertConsensus, "Strong");
    assert.ok(details.triageScore >= 85, `Expected high triage score, got ${details.triageScore}`);
    assert.equal(details.confluencePassed, true);
    assert.equal(details.confluenceSignal, "Strong Candidate");
  });

  test("2. Expert Reliability Learning & Source Deduplication", () => {
    const initialStore = readExpertReliabilityStore();
    assert.ok(initialStore.icici_direct != null, "ICICI Direct source record should exist");
    const oldReliability = initialStore.icici_direct.reliabilityScore;

    // Simulate winning trade performance update for ICICI Direct
    updateExpertPerformance("icici_direct", true, 3.5, -0.5, "Banking", "bullish");

    const updatedStore = readExpertReliabilityStore();
    assert.ok(updatedStore.icici_direct.totalRecommendations > initialStore.icici_direct.totalRecommendations);
    assert.ok(updatedStore.icici_direct.reliabilityScore >= oldReliability, "Winning trade should maintain or boost reliability score");
  });

  test("3. Confluence Rules — Reject Expert Tip Without Live Technical Confirmation", () => {
    const unsupportedTip: UpstoxCandidateRaw = {
      symbol: "UNSUPPORTED",
      name: "Unsupported Tip Inc",
      instrumentKey: "NSE_EQ|UNSUP",
      cmp: 200,
      target: 210,
      stopLoss: 195,
      signal: "BUY",
      score: 30, // Weak technical score
      rvol: 0.8, // Low volume
      marketSectorBias: {
        fiiDiiNetBuyer: false,
        sectorTrend: "BEARISH",
        sectorRelativeStrength: 30,
      },
      smartMoneySignals: {
        futuresOptionsActivity: "SHORT_BUILDUP",
      },
      expertTips: [
        {
          sourceId: "unverified_social_tips",
          sourceName: "Unverified / Social Media Tips",
          isSebiRegistered: false,
          isIndependent: false,
          stance: "BUY",
        },
      ],
    };

    const details = scoreUpstoxCandidateTriage(unsupportedTip);

    assert.equal(details.confluencePassed, false);
    assert.equal(details.confluenceSignal, "Reject / No Trade");
    assert.ok(details.rejectionReasons.length > 0);
  });

  test("4. Daily Selection Funnel Workflow", () => {
    const rawCandidates: UpstoxCandidateRaw[] = [
      {
        symbol: "STRONG1",
        name: "Strong Co 1",
        instrumentKey: "NSE_EQ|STR1",
        cmp: 300,
        target: 335, // >10% upside
        stopLoss: 285,
        signal: "BUY",
        score: 92,
        rvol: 3.5,
        marketSectorBias: { sectorTrend: "BULLISH", fiiDiiNetBuyer: true },
        smartMoneySignals: { unusualVolume: true, bulkBlockDeals: true },
      },
      {
        symbol: "LOWPRICE",
        name: "Low Price Penny",
        instrumentKey: "NSE_EQ|LOW",
        cmp: 50, // Rejection: CMP < 150
        target: 65,
        stopLoss: 45,
        signal: "BUY",
        score: 80,
      },
      {
        symbol: "BEARSECTOR",
        name: "Bear Sector Stock",
        instrumentKey: "NSE_EQ|BEAR",
        cmp: 400,
        target: 450,
        stopLoss: 380,
        signal: "BUY",
        score: 85,
        marketSectorBias: { sectorTrend: "BEARISH" }, // Rejection by Step 2 Sector Filter
      },
    ];

    const finalShortlist = evaluateUpstoxFunnel(rawCandidates);

    assert.equal(finalShortlist.length, 1);
    assert.equal(finalShortlist[0].symbol, "STRONG1");
    assert.equal(finalShortlist[0].marketAlignment, "Strong");
    assert.equal(finalShortlist[0].smartMoney, "Strong");
  });
});
