import assert from "node:assert/strict";
import test from "node:test";
import {
  MIN_INTRADAY_POTENTIAL_PERCENT,
  MIN_LONG_TERM_POTENTIAL_PERCENT,
  analyzeStockSignal,
  qualifiesForHighPotentialIntraday,
  qualifiesForLongTermAccumulation,
  qualifiesForPersistentDeclineSell,
} from "@/lib/analysis";
import {
  evaluateSafetyGates,
  type FundamentalProfile,
  type TechnicalCandidate,
} from "@/lib/wealth-screening";
import { generateRecommendations, type ManagedPortfolio } from "@/lib/portfolio";
import { calculateStopLoss } from "@/lib/intelligence-validation";
import type { StockSignalMetrics } from "@/lib/analysis";

const bars = Array.from({ length: 220 }, (_, index) => ({
  close: 100 + index * 0.1,
  high: 101 + index * 0.1,
  low: 99 + index * 0.1,
  volume: 2_000_000,
}));

const metrics: StockSignalMetrics = {
  historyDays: 220,
  dayChangePercent: 1,
  return5Percent: 3,
  return20Percent: 8,
  return60Percent: 16,
  return120Percent: 24,
  drawdownFrom60DayHighPercent: -2,
  volumeShock: 1.2,
  ema20: 120,
  ema50: 115,
  ema200: 105,
  vwap: 119,
  vwapDistancePercent: 1,
  atr: 2,
  atrPercent: 1.7,
  trendScore: 20,
  momentumScore: 15,
  liquidityScore: 30,
  riskScore: 8,
  finalScore: 72,
  intradayPotentialPercent: 0,
  longTermPotentialPercent: 20,
  persistentDeclineScore: 0,
  expectedDownsidePercent: 0,
  target: 0,
  upsidePercent: 0,
  caveats: [],
};

const row: TechnicalCandidate = {
  stock: {
    symbol: "TEST",
    company: "Test Ltd.",
    theme: "Capital Goods",
    capHint: "mid",
    benchmark: "^CNXINFRA",
    source: "NIFTY 500",
  },
  name: "Test Ltd.",
  price: 120,
  previousClose: 119,
  volume: 2_000_000,
  bars,
  averageDailyTurnoverCr: 24,
  metrics,
};

const fundamentals: FundamentalProfile = {
  marketCap: 200_000_000_000,
  revenueGrowth: 0.15,
  earningsGrowth: 0.2,
  returnOnEquity: 0.16,
  debtToEquity: 40,
  profitMargins: 0.12,
  trailingPe: 30,
  ttmRevenue: 50_000_000_000,
  ttmNetIncome: 6_000_000_000,
  operatingCashFlow: 6_500_000_000,
  cashConversion: 1.08,
  positiveRevenueGrowthYears: 3,
  positiveEarningsGrowthYears: 3,
  revenueQuarters: 10,
  incomeQuarters: 10,
  balanceSheetQuarters: 4,
  revenueYears: 4,
  incomeYears: 4,
  latestReportDate: new Date().toISOString().slice(0, 10),
};

function failures(overrides: {
  row?: TechnicalCandidate;
  fundamentals?: FundamentalProfile;
  headlines?: string[];
  total?: number;
  regime?: "Risk-On" | "Risk-Off";
} = {}) {
  return evaluateSafetyGates({
    row: overrides.row ?? row,
    fundamentals: overrides.fundamentals ?? fundamentals,
    headlines: overrides.headlines ?? [],
    capBucket: "mid",
    dataQuality: 100,
    total: overrides.total ?? 80,
    regime: overrides.regime ?? "Risk-On",
    relativeStrengthPercent: 10,
  });
}

test("allows a complete, profitable, liquid candidate", () => {
  assert.deepEqual(failures(), []);
});

test("allows official NSE cap-bucket universe sources", () => {
  for (const source of [
    "NIFTY 200",
    "NIFTY MidSmallcap 400",
    "NIFTY Smallcap 250",
    "NIFTY Microcap 250",
  ]) {
    assert.deepEqual(
      failures({
        row: {
          ...row,
          stock: {
            ...row.stock,
            source,
          },
        },
      }),
      [],
    );
  }
});

test("allows blended NIFTY 500 and cap-bucket source labels", () => {
  assert.deepEqual(
    failures({
      row: {
        ...row,
        stock: { ...row.stock, source: "NIFTY 500 + NIFTY 200" },
      },
    }),
    [],
  );
});

test("rejects unverified universe sources", () => {
  const result = failures({
    row: {
      ...row,
      stock: { ...row.stock, source: "Unverified Screen" },
    },
  });
  assert(result.some((item) => item.includes("official NSE cap-bucket universe")));
});

test("rejects incomplete fundamentals", () => {
  const result = failures({
    fundamentals: {
      ...fundamentals,
      revenueQuarters: 5,
      incomeQuarters: 4,
    },
  });
  assert(result.some((item) => item.includes("Five quarterly observations")));
});

test("rejects financial companies until a dedicated model exists", () => {
  const result = failures({
    row: {
      ...row,
      stock: { ...row.stock, theme: "Financial Services" },
    },
  });
  assert(result.some((item) => item.includes("banking/NBFC")));
});

test("rejects extended prices and hostile-regime scores", () => {
  const result = failures({
    row: {
      ...row,
      metrics: {
        ...metrics,
        dayChangePercent: 12,
        vwapDistancePercent: 11,
      },
    },
    total: 80,
    regime: "Risk-Off",
  });
  assert(result.some((item) => item.includes("too extended")));
  assert(result.some((item) => item.includes("82/100")));
});

test("uses a tighter EMA20 extension gate during corrections", () => {
  const result = evaluateSafetyGates({
    row: {
      ...row,
      price: 132,
      metrics: {
        ...metrics,
        ema20: 120,
      },
    },
    fundamentals,
    headlines: [],
    capBucket: "mid",
    dataQuality: 100,
    total: 85,
    regime: "Correction",
    relativeStrengthPercent: 10,
  });
  assert(result.some((item) => item.includes("more than 8% above EMA20")));
});

test("requires sector leadership during corrections", () => {
  const result = evaluateSafetyGates({
    row,
    fundamentals,
    headlines: [],
    capBucket: "mid",
    dataQuality: 100,
    total: 85,
    regime: "Correction",
    relativeStrengthPercent: -1,
  });
  assert(result.some((item) => item.includes("regime floor")));
});

test("rejects severe governance headlines", () => {
  const result = failures({
    headlines: ["Auditor resigns after accounting irregularities"],
  });
  assert(result.some((item) => item.includes("governance")));
});

test("rejects excessive valuation and leverage", () => {
  const result = failures({
    fundamentals: {
      ...fundamentals,
      trailingPe: 125,
      debtToEquity: 170,
    },
  });
  assert(result.some((item) => item.includes("80x")));
  assert(result.some((item) => item.includes("Debt-to-equity")));
});

test("does not assign buy-style stop losses to watchlist observations", () => {
  assert.equal(calculateStopLoss(100, "Watchlist", "1-3 Yr Plan"), 0);
  assert.equal(calculateStopLoss(100, "Hold", "1-3 Yr Plan"), 0);
  assert.equal(calculateStopLoss(100, "Accumulate", "1-3 Yr Plan"), 92);
});

function buildIntradayBars(highExcursionPercent: number) {
  return Array.from({ length: 61 }, (_, index) => {
    const close = 100 + index * 0.02;
    const breakoutHigh =
      index > 0 && index % 5 === 0
        ? (100 + (index - 1) * 0.02) * (1 + highExcursionPercent / 100)
        : close * 1.01;

    return {
      close,
      high: breakoutHigh,
      low: close * 0.995,
      volume: 2_000_000,
    };
  });
}

test("qualifies only evidence-backed intraday setups with at least 10% potential", () => {
  const highPotentialBars = buildIntradayBars(12);
  const price = highPotentialBars.at(-1)!.close * 1.02;
  const signal = analyzeStockSignal({
    symbol: "MOMENTUM",
    price,
    previousClose: highPotentialBars.at(-1)!.close,
    volume: 4_000_000,
    bars: highPotentialBars,
    profile: "intraday",
  });

  assert(signal.intradayPotentialPercent >= MIN_INTRADAY_POTENTIAL_PERCENT);
  assert(qualifiesForHighPotentialIntraday(signal));
  assert((signal.target / price - 1) * 100 >= MIN_INTRADAY_POTENTIAL_PERCENT);
});

test("abstains from lower-potential intraday recommendations across portfolios", () => {
  const lowPotentialBars = buildIntradayBars(2);
  const currentPrice = lowPotentialBars.at(-1)!.close * 1.01;
  const portfolio: ManagedPortfolio = {
    id: "intraday-test",
    name: "Intraday Test",
    appetite: "aggressive",
    inputs: [],
    positions: [
      {
        list: "watchlist",
        stock: "LOWMOVE",
        symbol: "LOWMOVE",
        company: "Low Move Ltd.",
        sector: "Industrials",
        quantity: 0,
        currentPrice,
        previousClose: lowPotentialBars.at(-1)!.close,
        volume: 4_000_000,
        bars: lowPotentialBars,
        currency: "INR",
      },
    ],
  };

  assert.deepEqual(generateRecommendations(portfolio).intraday, []);
});

function buildTrendBars(direction: "up" | "down") {
  return Array.from({ length: 240 }, (_, index) => {
    const close =
      direction === "up"
        ? 100 + index * 0.65
        : 400 - index * 1.2;
    return {
      close,
      high: close * 1.01,
      low: close * 0.99,
      volume: 2_000_000,
    };
  });
}

function buildHighPotentialTrendBars() {
  return Array.from({ length: 240 }, (_, index) => {
    const close = 100 + index * 0.65;
    const breakoutHigh =
      index > 0 && index % 5 === 0
        ? (100 + (index - 1) * 0.65) * 1.1
        : close * 1.01;

    return {
      close,
      high: breakoutHigh,
      low: close * 0.995,
      volume: 2_000_000,
    };
  });
}

test("requires evidence-derived long-term potential before accumulation", () => {
  const trendBars = buildTrendBars("up");
  const signal = analyzeStockSignal({
    symbol: "LONGTERM",
    price: trendBars.at(-1)!.close,
    previousClose: trendBars.at(-2)!.close,
    volume: 3_000_000,
    bars: trendBars,
    profile: "long-term",
  });

  assert(signal.longTermPotentialPercent >= MIN_LONG_TERM_POTENTIAL_PERCENT);
  assert(qualifiesForLongTermAccumulation(signal));
  assert(!qualifiesForPersistentDeclineSell(signal));
});

test("issues sell only for persistent multi-period deterioration", () => {
  const declineBars = buildTrendBars("down");
  const signal = analyzeStockSignal({
    symbol: "DECLINE",
    price: declineBars.at(-1)!.close * 0.98,
    previousClose: declineBars.at(-1)!.close,
    volume: 3_000_000,
    bars: declineBars,
    profile: "long-term",
  });

  assert(signal.persistentDeclineScore >= 70);
  assert(signal.expectedDownsidePercent >= 10);
  assert(qualifiesForPersistentDeclineSell(signal));
  assert(!qualifiesForLongTermAccumulation(signal));
});

test("does not convert a temporary dip or concentration into a sell", () => {
  const trendBars = buildTrendBars("up");
  const currentPrice = trendBars.at(-1)!.close * 0.97;
  const portfolio: ManagedPortfolio = {
    id: "concentrated-test",
    name: "Concentrated Test",
    appetite: "safe",
    inputs: [],
    positions: [
      {
        list: "current",
        stock: "RECOVER",
        symbol: "RECOVER",
        company: "Recover Ltd.",
        sector: "Industrials",
        quantity: 100,
        currentPrice,
        previousClose: trendBars.at(-1)!.close,
        volume: 3_000_000,
        bars: trendBars,
        currency: "INR",
      },
    ],
  };
  const recommendations = generateRecommendations(portfolio);

  assert(
    recommendations.longTermPlan.every(
      (recommendation) => recommendation.action !== "Urgent Sell",
    ),
  );
});

test("keeps stock names unique across recommendation types", () => {
  const highPotentialBars = buildHighPotentialTrendBars();
  const trendBars = buildTrendBars("up");
  const portfolio: ManagedPortfolio = {
    id: "unique-recommendation-types",
    name: "Unique Recommendation Types",
    appetite: "moderate",
    inputs: [],
    positions: [
      {
        list: "current",
        stock: "OVERLAP",
        symbol: "OVERLAP",
        company: "Overlap Tech Ltd.",
        sector: "Information Technology",
        quantity: 1,
        currentPrice: highPotentialBars.at(-1)!.close * 1.01,
        previousClose: highPotentialBars.at(-1)!.close,
        volume: 4_000_000,
        bars: highPotentialBars,
        currency: "INR",
      },
      {
        list: "current",
        stock: "ANCHOR",
        symbol: "ANCHOR",
        company: "Anchor Holdings Ltd.",
        sector: "Fast Moving Consumer Goods",
        quantity: 10_000,
        currentPrice: 200,
        previousClose: 200,
        volume: 2_000_000,
        bars: trendBars,
        currency: "INR",
      },
      {
        list: "watchlist",
        stock: "DAYMOVE",
        symbol: "DAYMOVE",
        company: "Day Move Ltd.",
        sector: "Information Technology",
        quantity: 0,
        currentPrice: highPotentialBars.at(-1)!.close * 1.01,
        previousClose: highPotentialBars.at(-1)!.close,
        volume: 4_000_000,
        bars: highPotentialBars,
        currency: "INR",
      },
      {
        list: "watchlist",
        stock: "BAGGER",
        symbol: "BAGGER",
        company: "Bagger Tech Ltd.",
        sector: "Information Technology",
        quantity: 0,
        currentPrice: trendBars.at(-1)!.close,
        previousClose: trendBars.at(-2)!.close,
        volume: 3_000_000,
        bars: trendBars,
        currency: "INR",
      },
    ],
  };

  const recommendations = generateRecommendations(portfolio);
  const stockRecommendations = [
    ...recommendations.intraday,
    ...recommendations.longTermPlan,
    ...recommendations.multibaggerCandidates,
  ];
  const symbols = stockRecommendations.map((recommendation) => recommendation.symbol);

  assert(recommendations.longTermPlan.some((item) => item.symbol === "OVERLAP"));
  assert(!recommendations.intraday.some((item) => item.symbol === "OVERLAP"));
  assert.equal(new Set(symbols).size, symbols.length);
});
