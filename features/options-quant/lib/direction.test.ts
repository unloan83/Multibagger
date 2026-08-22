import assert from "node:assert/strict";
import test from "node:test";
import type { MarketCandle, OptionsBroker } from "@/features/options-quant/brokers/types";
import { buildLiveDirectionEvidence } from "@/features/options-quant/lib/direction";

const now = new Date("2026-08-17T04:30:00.000Z");

function candles(open: number, step: number, lastTimestamp = "2026-08-17T10:00:00+05:30"): MarketCandle[] {
  const last = Date.parse(lastTimestamp);
  return Array.from({ length: 20 }, (_, index) => {
    const close = open + step * index;
    return {
      timestamp: new Date(last - (19 - index) * 60_000).toISOString(),
      open: index === 0 ? open : open + step * (index - 1),
      high: close + Math.abs(step),
      low: close - Math.abs(step),
      close,
      volume: 0,
      openInterest: 0,
    };
  });
}

function broker(nifty = candles(25_000, 5), bank = candles(55_000, 11)): OptionsBroker {
  return {
    name: "TEST",
    getIntradayCandles: async (key) => key.includes("Bank") ? bank : nifty,
    getOptionContracts: async () => [{
      expiry: "2026-08-20",
      instrumentKey: "NSE_FO|one",
      tradingSymbol: "NIFTY",
      optionType: "CE",
      strike: 25_000,
      lotSize: 75,
    }],
    getOptionChain: async () => [{
      expiry: "2026-08-20",
      strike: 25_000,
      spot: 25_095,
      call: { instrumentKey: "c", tradingSymbol: "c", side: "BUY", optionType: "CE", strike: 25_000, bid: 100, ask: 101, ltp: 100.5, iv: 14, delta: 0.5, theta: -2, oi: 100_000, volume: 20_000, bidAskSpreadPercent: 1 },
      put: { instrumentKey: "p", tradingSymbol: "p", side: "BUY", optionType: "PE", strike: 25_000, bid: 90, ask: 91, ltp: 90.5, iv: 14, delta: -0.5, theta: -2, oi: 125_000, volume: 20_000, bidAskSpreadPercent: 1 },
    }],
    estimateCharges: async () => 0,
    submitSandboxSpread: async () => [],
    submitSandboxExit: async () => [],
  };
}

test("builds bullish direction only from fresh traceable Upstox market observations", async () => {
  const evidence = await buildLiveDirectionEvidence(broker(), now);
  assert.equal(evidence.direction, "BULLISH");
  assert.ok(evidence.confidence >= 70);
  assert.ok(evidence.trendStrength >= 60);
  assert.ok(evidence.bankNiftyConfirmation >= 50);
  assert.ok(evidence.optionChainConfirmation >= 45);
  assert.equal(evidence.sourceIds.length, 3);
  assert.equal(evidence.observations.putCallOiRatio, 1.25);
});

test("rejects stale intraday candles instead of manufacturing direction", async () => {
  await assert.rejects(
    buildLiveDirectionEvidence(broker(candles(25_000, 5, "2026-08-17T09:30:00+05:30")), now),
    /stale or future-dated/,
  );
});

test("classifies a NIFTY opening-range hold as RANGE and does not infer direction", async () => {
  const evidence = await buildLiveDirectionEvidence(broker(candles(25_000, 0), candles(55_000, 0)), now);
  assert.equal(evidence.direction, "RANGE");
  assert.equal(evidence.observations.niftyOpeningRangeDirection, "RANGE");
});
