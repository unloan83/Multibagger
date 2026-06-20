import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateSafetyGates,
  type FundamentalProfile,
  type TechnicalCandidate,
} from "@/lib/wealth-screening";
import type { StockSignalMetrics } from "@/lib/analysis";

const bars = Array.from({ length: 220 }, (_, index) => ({
  close: 100 + index * 0.1,
  high: 101 + index * 0.1,
  low: 99 + index * 0.1,
  volume: 2_000_000,
}));

const metrics: StockSignalMetrics = {
  dayChangePercent: 1,
  volumeShock: 1.2,
  ema20: 120,
  ema50: 115,
  vwap: 119,
  vwapDistancePercent: 1,
  atr: 2,
  atrPercent: 1.7,
  trendScore: 20,
  momentumScore: 15,
  liquidityScore: 30,
  riskScore: 8,
  finalScore: 72,
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
