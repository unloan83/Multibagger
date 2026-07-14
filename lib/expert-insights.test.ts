import assert from "node:assert/strict";
import test from "node:test";
import {
  STOCKS_PER_MARKET_CAP_CATEGORY,
  selectCategoryStocks,
  validateRecommendationContract,
} from "@/lib/expert-insights";
import type { ExpertActionMatrix } from "@/lib/expert-insights";
import type { ScreenedStock } from "@/lib/wealth-screening";

function candidate(
  symbol: string,
  score: number,
  eligible: boolean,
  gateFailures: string[] = [],
): ScreenedStock {
  return {
    symbol,
    score,
    eligible,
    gateFailures,
    capBucket: "large",
    factorScores: {
      growth: 12,
      quality: 12,
      momentum: 10,
      risk: 10,
    },
    metrics: {
      longTermPotentialPercent: 10,
    },
  } as ScreenedStock;
}

test("selects exactly three stocks for a populated market-cap category", () => {
  const selected = selectCategoryStocks([
    candidate("D", 90, false, ["One failed gate."]),
    candidate("B", 75, true),
    candidate("A", 80, true),
    candidate("C", 70, false, ["One failed gate."]),
  ]);

  assert.equal(selected.length, STOCKS_PER_MARKET_CAP_CATEGORY);
  assert.deepEqual(selected.map((stock) => stock.symbol), ["A", "B", "D"]);
});

test("returns all available stocks instead of fabricating missing candidates", () => {
  const selected = selectCategoryStocks([candidate("A", 80, true)]);
  assert.equal(selected.length, 1);
});

test("rejects snapshots that violate the three-per-category contract", () => {
  const quote = (symbol: string) => ({ symbol }) as never;
  const matrix = {
    categories: [
      { key: "largeCap", longTermUpsides: [quote("A"), quote("B")], intradayBreakouts: [] },
      { key: "midCap", longTermUpsides: [quote("C"), quote("D"), quote("E")], intradayBreakouts: [] },
      { key: "smallCap", longTermUpsides: [quote("F"), quote("G"), quote("H")], intradayBreakouts: [] },
    ],
  } as unknown as ExpertActionMatrix;

  assert.deepEqual(validateRecommendationContract(matrix), [
    "largeCap contains 2 stocks; expected 3.",
  ]);
});
