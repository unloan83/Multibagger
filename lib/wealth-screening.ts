import marketUniverse from "@/data/market-universe.json";
import {
  analyzeStockSignal,
  buildSignalRemark,
  type PriceBar,
  type StockSignalMetrics,
} from "@/lib/analysis";
<<<<<<< Updated upstream
import {
  applyRecommendationIntelligence,
  classifyNewsSentiment,
  fetchHeadlineIntelligence,
  filterSectorHeadlines,
  rankSectorDirections,
  scoreGovernmentPolicy,
  type LearningFeedback,
  type RecommendationIntelligence,
  type SectorDirection,
} from "@/lib/recommendation-intelligence";

export type MarketCapBucket = "large" | "mid" | "small";
export type ScreeningRegime =
  | "Bull Market"
  | "Risk-On"
  | "Consolidation"
  | "Transition"
  | "Correction"
  | "Risk-Off";

export type UniverseStock = {
  symbol: string;
  company?: string;
  theme: string;
  capHint: MarketCapBucket;
  benchmark: string;
  source?: string;
=======

export type MarketCapBucket = "large" | "mid" | "small";

export type UniverseStock = {
  symbol: string;
  theme: string;
  capHint: MarketCapBucket;
  benchmark: string;
>>>>>>> Stashed changes
};

export type FactorScores = {
  fundamentals: number;
  growth: number;
  momentum: number;
  quality: number;
  sectorStrength: number;
  valuation: number;
  catalyst: number;
<<<<<<< Updated upstream
  liquidity: number;
  dataQuality: number;
  risk: number;
  portfolioFit: number;
  newsSentiment: number;
  governmentPolicy: number;
  expertConsensus: number;
  learningFeedback: number;
=======
  risk: number;
>>>>>>> Stashed changes
  total: number;
};

export type ScreenedStock = {
  symbol: string;
  name: string;
  theme: string;
  sector: string;
  industry: string;
  capBucket: MarketCapBucket;
  price: number;
  previousClose: number;
  changePercent: number;
  volume: number;
  volumeShock: number;
  target: number;
  upside: number;
  score: number;
  action: "Accumulate";
<<<<<<< Updated upstream
  eligible: boolean;
  gateFailures: string[];
  dataQuality: number;
  fundamentalAsOf: string;
=======
>>>>>>> Stashed changes
  remark: string;
  caveats: string[];
  metrics: StockSignalMetrics;
  factorScores: FactorScores;
  reasons: string[];
  marketCapCr: number;
  revenueGrowthPercent: number;
  earningsGrowthPercent: number;
  returnOnEquityPercent: number;
  debtToEquity: number;
  profitMarginPercent: number;
  trailingPe: number;
  relativeStrengthPercent: number;
<<<<<<< Updated upstream
  averageDailyTurnoverCr: number;
  catalystSummary: string;
  intelligence: RecommendationIntelligence;
=======
  catalystSummary: string;
>>>>>>> Stashed changes
};

type YahooChartResult = {
  meta?: {
    regularMarketPrice?: number;
    previousClose?: number;
    chartPreviousClose?: number;
    regularMarketVolume?: number;
    shortName?: string;
    longName?: string;
  };
  indicators?: {
    quote?: Array<{
      close?: Array<number | null>;
      high?: Array<number | null>;
      low?: Array<number | null>;
      volume?: Array<number | null>;
    }>;
  };
};

<<<<<<< Updated upstream
export type FundamentalProfile = {
=======
type FundamentalProfile = {
  sector: string;
  industry: string;
>>>>>>> Stashed changes
  marketCap: number;
  revenueGrowth: number;
  earningsGrowth: number;
  returnOnEquity: number;
  debtToEquity: number;
  profitMargins: number;
  trailingPe: number;
<<<<<<< Updated upstream
  ttmRevenue: number;
  ttmNetIncome: number;
  operatingCashFlow: number;
  cashConversion: number;
  positiveRevenueGrowthYears: number;
  positiveEarningsGrowthYears: number;
  revenueQuarters: number;
  incomeQuarters: number;
  balanceSheetQuarters: number;
  revenueYears: number;
  incomeYears: number;
  latestReportDate: string;
};

export type TechnicalCandidate = {
  stock: UniverseStock;
  name: string;
  price: number;
  previousClose: number;
  volume: number;
  bars: PriceBar[];
  averageDailyTurnoverCr: number;
  metrics: StockSignalMetrics;
};

export type WealthScreeningOptions = {
  expertConsensusCounts?: Record<string, number>;
  learning?: LearningFeedback;
};

const severeRiskTerms = [
  "fraud",
  "default",
  "insolvency",
  "bankruptcy",
  "accounting irregular",
  "auditor resign",
  "sebi order",
  "enforcement directorate",
=======
};

const catalystPositive = [
  "order",
  "contract",
  "capacity",
  "expansion",
  "approval",
  "launch",
  "profit",
  "revenue",
  "growth",
  "partnership",
  "acquisition",
  "investment",
  "award",
  "wins",
  "record",
];

const catalystNegative = [
  "cancel",
  "default",
  "fraud",
  "probe",
  "penalty",
  "downgrade",
  "loss",
  "decline",
  "delay",
  "lawsuit",
  "warning",
>>>>>>> Stashed changes
];

export function getMarketUniverse() {
  return marketUniverse as UniverseStock[];
}

<<<<<<< Updated upstream
export async function screenWealthUniverse(
  regime: ScreeningRegime = "Consolidation",
  options: WealthScreeningOptions = {},
): Promise<ScreenedStock[]> {
=======
export async function screenWealthUniverse(): Promise<ScreenedStock[]> {
>>>>>>> Stashed changes
  const universe = getMarketUniverse();
  const benchmarkReturns = await fetchBenchmarkReturns(
    [...new Set(universe.map((stock) => stock.benchmark))],
  );
  const technicalRows = (
    await mapWithConcurrency(universe, 10, fetchTechnicalCandidate)
<<<<<<< Updated upstream
  ).filter((row): row is TechnicalCandidate => Boolean(row));

  const shortlist = technicalRows
    .sort((a, b) => b.metrics.finalScore - a.metrics.finalScore)
    .filter((row) => row.bars.length >= 80 && row.price > 0);
  const sectors = [...new Set(shortlist.map((row) => row.stock.theme))];
  const [rawMarketHeadlines, policyHeadlines, sectorHeadlinePairs] =
    await Promise.all([
      fetchHeadlineIntelligence("India stock market economy", 10),
      fetchHeadlineIntelligence(
        "India government policy budget PLI infrastructure defence energy regulation",
        15,
      ),
      Promise.all(
        sectors.map(async (sector) => [
          sector,
          await fetchHeadlineIntelligence(`India ${sector} sector`, 8),
        ] as const),
      ),
    ]);
  const marketHeadlines = rawMarketHeadlines.filter((headline) => {
    const normalized = headline.toLowerCase();
    return ["india", "nifty", "sensex", "rupee", "rbi", "sebi"].some(
      (term) => normalized.includes(term),
    );
  });
  const sectorNews = Object.fromEntries(
    sectorHeadlinePairs.map(([sector, headlines]) => [
      sector,
      filterSectorHeadlines(sector, headlines),
    ]),
  );
  const sectorDirections = rankSectorDirections(
    shortlist.map((row) => ({
      sector: row.stock.theme,
      return20Percent: periodReturn(row.bars, 20),
      return60Percent: periodReturn(row.bars, 60),
      trendAligned: row.metrics.ema20 >= row.metrics.ema50,
    })),
    sectorNews,
    policyHeadlines,
  );
  const sectorDirectionMap = Object.fromEntries(
    sectorDirections.map((sector) => [sector.sector, sector]),
  );

  const enriched = await mapWithConcurrency(shortlist, 10, async (row) => {
=======
  ).filter((row): row is NonNullable<typeof row> => Boolean(row));
  const shortlist = technicalRows
    .sort((a, b) => b.metrics.finalScore - a.metrics.finalScore)
    .filter((row) => row.metrics.finalScore >= 42 && row.metrics.riskScore <= 24)
    .slice(0, 36);
  const enriched = await mapWithConcurrency(shortlist, 6, async (row) => {
>>>>>>> Stashed changes
    const [fundamentals, headlines] = await Promise.all([
      fetchFundamentals(`${row.stock.symbol}.NS`),
      fetchHeadlines(row.stock.symbol, row.name),
    ]);
<<<<<<< Updated upstream
    return scoreCandidate({
      row,
      fundamentals,
      headlines,
      benchmarkReturn: benchmarkReturns[row.stock.benchmark] ?? 0,
      regime,
      sectorHeadlines: sectorNews[row.stock.theme] ?? [],
      marketHeadlines,
      policyHeadlines,
      sectorDirection:
        sectorDirectionMap[row.stock.theme] ??
        neutralSectorDirection(row.stock.theme),
      expertFocusCount:
        options.expertConsensusCounts?.[row.stock.symbol] ?? 0,
      learning: options.learning,
    });
  });

  return enriched.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    return b.score - a.score;
  });
}

async function fetchTechnicalCandidate(
  stock: UniverseStock,
): Promise<TechnicalCandidate | null> {
  const chart = await fetchChart(`${stock.symbol}.NS`);
  const meta = chart?.meta;
  const price = meta?.regularMarketPrice ?? 0;
=======
    return scoreCandidate(
      row,
      fundamentals,
      headlines,
      benchmarkReturns[row.stock.benchmark] ?? 0,
    );
  });

  return enriched
    .filter((row) => row.price > 0)
    .sort((a, b) => b.score - a.score);
}

async function fetchTechnicalCandidate(stock: UniverseStock) {
  const chart = await fetchChart(`${stock.symbol}.NS`);
  const meta = chart?.meta;
  const price = meta?.regularMarketPrice ?? 0;

>>>>>>> Stashed changes
  if (!chart || price <= 0) return null;

  const volume = meta?.regularMarketVolume ?? 0;
  const bars = buildPriceBars(chart.indicators?.quote?.[0]);
  const feedPreviousClose = meta?.previousClose ?? meta?.chartPreviousClose ?? 0;
  const barPreviousClose = bars.at(-2)?.close ?? 0;
  const previousClose =
    feedPreviousClose > 0 &&
    Math.abs(((price - feedPreviousClose) / feedPreviousClose) * 100) <= 20
      ? feedPreviousClose
      : barPreviousClose || feedPreviousClose;
  const metrics = analyzeStockSignal({
    symbol: stock.symbol,
    price,
    previousClose,
    volume,
    bars,
    segment: stock.capHint,
    profile: "long-term",
  });

  return {
    stock,
    name: meta?.longName ?? meta?.shortName ?? stock.symbol,
    price,
    previousClose,
    volume,
    bars,
<<<<<<< Updated upstream
    averageDailyTurnoverCr: calculateAverageTurnoverCr(bars),
=======
>>>>>>> Stashed changes
    metrics,
  };
}

<<<<<<< Updated upstream
function scoreCandidate({
  row,
  fundamentals,
  headlines,
  benchmarkReturn,
  regime,
  sectorHeadlines,
  marketHeadlines,
  policyHeadlines,
  sectorDirection,
  expertFocusCount,
  learning,
}: {
  row: TechnicalCandidate;
  fundamentals: FundamentalProfile;
  headlines: string[];
  benchmarkReturn: number;
  regime: ScreeningRegime;
  sectorHeadlines: string[];
  marketHeadlines: string[];
  policyHeadlines: string[];
  sectorDirection: SectorDirection;
  expertFocusCount: number;
  learning?: LearningFeedback;
}): ScreenedStock {
  const marketCapCr = fundamentals.marketCap / 10_000_000;
  const capBucket = bucketMarketCap(marketCapCr, row.stock.capHint);
  const stockReturn = periodReturn(row.bars, 60);
  const relativeStrengthPercent = stockReturn - benchmarkReturn;
  const dataQuality = scoreDataQuality(fundamentals, row.bars);
  const growth = scoreGrowth(fundamentals);
  const quality = scoreQuality(fundamentals);
  const valuation = scoreValuation(fundamentals, capBucket);
  const momentum = scoreMomentum(row.metrics, relativeStrengthPercent);
  const sectorStrength = scoreRelativeStrength(relativeStrengthPercent);
  const liquidity = scoreLiquidity(row.averageDailyTurnoverCr, capBucket);
  const risk = scoreSafety(row.metrics, fundamentals, regime);
  const newsSentiment = classifyNewsSentiment(
    headlines,
    sectorHeadlines,
    marketHeadlines,
  );
  const policy = scoreGovernmentPolicy(
    row.stock.theme,
    sectorHeadlines,
    policyHeadlines,
  );
  const catalyst = clamp(Math.round((newsSentiment.score + 10) / 2), 0, 10);
  const fundamentalsScore = Math.round((growth + quality + valuation) / 3);
  const baseTotal = clamp(
    growth +
      quality +
      valuation +
      momentum +
      sectorStrength +
      liquidity +
      risk,
    0,
    100,
  );
  const learningAdjustment =
    (learning?.sectorAdjustments[row.stock.theme] ?? 0) +
    (learning?.typeAdjustments["1-3 Yr Plan"] ?? 0) +
    (learning?.adjustment ?? 0);
  const intelligence = applyRecommendationIntelligence({
    baseScore: baseTotal,
    technicalStrength: clamp(
      Math.round(((momentum + liquidity + risk) / 35) * 100),
      0,
      100,
    ),
    fundamentalStrength: clamp(
      Math.round(((growth + quality + valuation) / 55) * 100),
      0,
      100,
    ),
    sectorDirection,
    newsSentiment,
    policy,
    expertFocusCount,
    learningAdjustment,
  });
  const total = intelligence.finalScore;
  const gateFailures = evaluateSafetyGates({
    row,
    fundamentals,
    headlines,
    capBucket,
    dataQuality,
    total: baseTotal,
    regime,
    relativeStrengthPercent,
  });
  const eligible = gateFailures.length === 0;
  const reasons = buildReasons({
    fundamentals,
    relativeStrengthPercent,
    metrics: row.metrics,
    theme: row.stock.theme,
    averageDailyTurnoverCr: row.averageDailyTurnoverCr,
    regime,
  });
  reasons.push(...intelligence.reasons);
  const caveats = buildScreeningCaveats(
    row.metrics,
    fundamentals,
    headlines,
    gateFailures,
  );
=======
function scoreCandidate(
  row: NonNullable<Awaited<ReturnType<typeof fetchTechnicalCandidate>>>,
  fundamentals: FundamentalProfile,
  headlines: string[],
  benchmarkReturn: number,
): ScreenedStock {
  const stockReturn = periodReturn(row.bars, 60);
  const relativeStrengthPercent = stockReturn - benchmarkReturn;
  const growth = scoreGrowth(fundamentals);
  const quality = scoreQuality(fundamentals);
  const valuation = scoreValuation(fundamentals);
  const momentum = clamp(Math.round(row.metrics.finalScore * 0.2), 0, 20);
  const sectorStrength = clamp(Math.round(8 + relativeStrengthPercent * 0.35), 0, 15);
  const catalyst = scoreCatalysts(headlines);
  const risk = clamp(Math.round(10 - row.metrics.riskScore * 0.35), 0, 10);
  const fundamentalsScore = [
    fundamentals.marketCap,
    fundamentals.revenueGrowth,
    fundamentals.earningsGrowth,
    fundamentals.returnOnEquity,
    fundamentals.profitMargins,
  ].filter((value) => value !== 0).length;
  const total = clamp(
    fundamentalsScore + growth + quality + valuation + momentum + sectorStrength + catalyst + risk,
    0,
    100,
  );
  const targetMultiplier = clamp(
    1.08 + Math.max(0, total - 55) / 180 + Math.max(0, relativeStrengthPercent) / 500,
    1.06,
    row.stock.capHint === "small" ? 1.42 : row.stock.capHint === "mid" ? 1.32 : 1.25,
  );
  const target = row.price * targetMultiplier;
  const reasons = buildReasons({
    fundamentals,
    headlines,
    relativeStrengthPercent,
    metrics: row.metrics,
    theme: row.stock.theme,
  });
  const caveats = buildScreeningCaveats(row.metrics, fundamentals, headlines);
  const marketCapCr = fundamentals.marketCap / 10_000_000;
  const capBucket = bucketMarketCap(marketCapCr, row.stock.capHint);
  const catalystSummary =
    headlines[0] ?? "No fresh company-specific catalyst was available from the news feed.";
>>>>>>> Stashed changes

  return {
    symbol: row.stock.symbol,
    name: row.name,
    theme: row.stock.theme,
<<<<<<< Updated upstream
    sector: row.stock.theme,
    industry: row.stock.theme,
=======
    sector: fundamentals.sector || row.stock.theme,
    industry: fundamentals.industry,
>>>>>>> Stashed changes
    capBucket,
    price: row.price,
    previousClose: row.previousClose,
    changePercent:
      row.previousClose > 0
        ? ((row.price - row.previousClose) / row.previousClose) * 100
        : 0,
    volume: row.volume,
    volumeShock: row.metrics.volumeShock,
<<<<<<< Updated upstream
    // No invented fair-value target. A target remains pending until a
    // defensible valuation model using audited cash flows is available.
    target: 0,
    upside: 0,
    score: total,
    action: "Accumulate",
    eligible,
    gateFailures,
    dataQuality,
    fundamentalAsOf: fundamentals.latestReportDate,
    remark: eligible
      ? `${buildSignalRemark(row.metrics, "long-term")} Decision score ${total}/100 | ${reasons.slice(0, 3).join(" ")}`
      : `Not recommended: ${gateFailures.join(" ")}`,
=======
    target,
    upside: ((target - row.price) / row.price) * 100,
    score: total,
    action: "Accumulate",
    remark: `${buildSignalRemark(row.metrics, "long-term")} Wealth score ${total}/100 | ${reasons.slice(0, 3).join(" ")}`,
>>>>>>> Stashed changes
    caveats,
    metrics: row.metrics,
    factorScores: {
      fundamentals: fundamentalsScore,
      growth,
      momentum,
      quality,
      sectorStrength,
      valuation,
      catalyst,
<<<<<<< Updated upstream
      liquidity,
      dataQuality,
      risk,
      portfolioFit: intelligence.contributions.portfolioFit,
      newsSentiment: intelligence.contributions.newsSentiment,
      governmentPolicy: intelligence.contributions.governmentPolicy,
      expertConsensus: intelligence.contributions.expertConsensus,
      learningFeedback: intelligence.contributions.learningFeedback,
=======
      risk,
>>>>>>> Stashed changes
      total,
    },
    reasons,
    marketCapCr,
    revenueGrowthPercent: fundamentals.revenueGrowth * 100,
    earningsGrowthPercent: fundamentals.earningsGrowth * 100,
    returnOnEquityPercent: fundamentals.returnOnEquity * 100,
    debtToEquity: fundamentals.debtToEquity,
    profitMarginPercent: fundamentals.profitMargins * 100,
    trailingPe: fundamentals.trailingPe,
    relativeStrengthPercent,
<<<<<<< Updated upstream
    averageDailyTurnoverCr: row.averageDailyTurnoverCr,
    catalystSummary:
      headlines[0] ??
      "No verified company-specific catalyst is included in the score.",
    intelligence,
  };
}

export function evaluateSafetyGates({
  row,
  fundamentals,
  headlines,
  capBucket,
  dataQuality,
  total,
  regime,
  relativeStrengthPercent,
}: {
  row: TechnicalCandidate;
  fundamentals: FundamentalProfile;
  headlines: string[];
  capBucket: MarketCapBucket;
  dataQuality: number;
  total: number;
  regime: ScreeningRegime;
  relativeStrengthPercent: number;
}) {
  const failures: string[] = [];
  const minimumTurnover = capBucket === "large" ? 10 : capBucket === "mid" ? 5 : 2;
  const minimumScore =
    regime === "Risk-Off"
      ? 82
      : regime === "Correction"
        ? 78
        : capBucket === "small"
          ? 75
          : capBucket === "mid"
            ? 72
            : 70;

  if (row.bars.length < 100) failures.push("Insufficient price history.");
  if (row.stock.source !== "NIFTY 500") {
    failures.push("Security is not verified against the official NIFTY 500 universe.");
  }
  if (row.stock.theme.toLowerCase().includes("financial")) {
    failures.push(
      "Financial companies require a separate banking/NBFC capital-adequacy model.",
    );
  }
  if (fundamentals.revenueQuarters < 5 || fundamentals.incomeQuarters < 5) {
    failures.push("Five quarterly observations are required for year-over-year validation.");
  }
  if (fundamentals.revenueYears < 3 || fundamentals.incomeYears < 3) {
    failures.push("At least three annual observations are required for growth validation.");
  }
  if (dataQuality < 80) failures.push("Fundamental data is incomplete or stale.");
  if (fundamentals.marketCap < 10_000_000_000) {
    failures.push("Verified market capitalisation is below INR 1,000 Cr.");
  }
  if (fundamentals.ttmRevenue <= 0) failures.push("Positive TTM revenue is not verified.");
  if (fundamentals.ttmNetIncome <= 0) failures.push("Positive TTM earnings are not verified.");
  if (fundamentals.operatingCashFlow <= 0) {
    failures.push("Positive operating cash flow is not verified.");
  }
  if (fundamentals.cashConversion < 0.7) {
    failures.push("Operating cash flow is below 70% of reported earnings.");
  }
  if (fundamentals.positiveRevenueGrowthYears < 2) {
    failures.push("Revenue growth is not consistent across at least two of the last three years.");
  }
  if (fundamentals.positiveEarningsGrowthYears < 2) {
    failures.push("Earnings growth is not consistent across at least two of the last three years.");
  }
  if (fundamentals.revenueGrowth < 0.05) {
    failures.push("Latest annual revenue growth is below the 5% floor.");
  }
  if (fundamentals.earningsGrowth < -0.1) failures.push("TTM earnings deterioration exceeds 10%.");
  if (fundamentals.returnOnEquity < 0.08) failures.push("ROE is below the 8% quality floor.");
  if (fundamentals.debtToEquity > 100) failures.push("Debt-to-equity exceeds the safety limit.");
  if (fundamentals.trailingPe <= 0 || fundamentals.trailingPe > 80) {
    failures.push("Valuation is unavailable, loss-making, or above the 80x safety ceiling.");
  }
  if (row.averageDailyTurnoverCr < minimumTurnover) {
    failures.push(`Average daily turnover is below INR ${minimumTurnover} Cr.`);
  }
  if (Math.abs(row.metrics.dayChangePercent) > 10) {
    failures.push("Current price move is too extended for a fresh recommendation.");
  }
  const ema20Extension =
    row.metrics.ema20 > 0
      ? ((row.price - row.metrics.ema20) / row.metrics.ema20) * 100
      : Number.POSITIVE_INFINITY;
  const maximumEma20Extension =
    regime === "Risk-Off" || regime === "Correction" ? 8 : 12;
  if (ema20Extension > maximumEma20Extension) {
    failures.push(
      `Price is more than ${maximumEma20Extension}% above EMA20 for the current regime.`,
    );
  }
  if (row.metrics.ema20 < row.metrics.ema50) {
    failures.push("EMA20 is below EMA50.");
  }
  const minimumRelativeStrength = regime === "Risk-Off" ? 5 : regime === "Correction" ? 0 : -5;
  if (relativeStrengthPercent < minimumRelativeStrength) {
    failures.push(
      `Sector-relative return is below the ${minimumRelativeStrength}% regime floor.`,
    );
  }
  if (row.metrics.riskScore > 18) failures.push("Technical risk exceeds the safety limit.");
  if (hasSevereRiskHeadline(headlines)) {
    failures.push("A severe governance or regulatory risk headline requires manual review.");
  }
  if (total < minimumScore) {
    failures.push(`Decision score is below the ${minimumScore}/100 regime-adjusted threshold.`);
  }

  return [...new Set(failures)];
}

async function fetchChart(symbol: string): Promise<YahooChartResult | null> {
  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`,
=======
    catalystSummary,
  };
}

async function fetchChart(symbol: string): Promise<YahooChartResult | null> {
  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=6mo&interval=1d`,
>>>>>>> Stashed changes
      {
        headers: { "User-Agent": "Mozilla/5.0" },
        next: { revalidate: 900 },
      },
    );
    if (!response.ok) return null;
    const data = (await response.json()) as {
      chart?: { result?: YahooChartResult[] };
    };
    return data.chart?.result?.[0] ?? null;
  } catch {
    return null;
  }
}

async function fetchFundamentals(symbol: string): Promise<FundamentalProfile> {
  const fallback: FundamentalProfile = {
<<<<<<< Updated upstream
=======
    sector: "",
    industry: "",
>>>>>>> Stashed changes
    marketCap: 0,
    revenueGrowth: 0,
    earningsGrowth: 0,
    returnOnEquity: 0,
    debtToEquity: 0,
    profitMargins: 0,
    trailingPe: 0,
<<<<<<< Updated upstream
    ttmRevenue: 0,
    ttmNetIncome: 0,
    operatingCashFlow: 0,
    cashConversion: 0,
    positiveRevenueGrowthYears: 0,
    positiveEarningsGrowthYears: 0,
    revenueQuarters: 0,
    incomeQuarters: 0,
    balanceSheetQuarters: 0,
    revenueYears: 0,
    incomeYears: 0,
    latestReportDate: "",
=======
>>>>>>> Stashed changes
  };

  try {
    const now = Math.floor(Date.now() / 1000);
<<<<<<< Updated upstream
    const period1 = now - 60 * 60 * 24 * 1_100;
=======
    const period1 = now - 60 * 60 * 24 * 730;
>>>>>>> Stashed changes
    const types = [
      "quarterlyTotalRevenue",
      "quarterlyNetIncome",
      "quarterlyStockholdersEquity",
      "quarterlyTotalDebt",
<<<<<<< Updated upstream
      "annualTotalRevenue",
      "annualNetIncome",
      "trailingTotalRevenue",
      "trailingNetIncome",
      "annualOperatingCashFlow",
      "trailingOperatingCashFlow",
=======
>>>>>>> Stashed changes
      "trailingMarketCap",
      "trailingPeRatio",
    ].join(",");
    const response = await fetch(
      `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?symbol=${encodeURIComponent(symbol)}&type=${types}&merge=false&period1=${period1}&period2=${now + 86_400}`,
      {
        headers: { "User-Agent": "Mozilla/5.0" },
        next: { revalidate: 21_600 },
      },
    );
    if (!response.ok) return fallback;
    const data = (await response.json()) as {
      timeseries?: {
        result?: Array<
          Record<
            string,
            | Array<{
<<<<<<< Updated upstream
                asOfDate?: string;
=======
>>>>>>> Stashed changes
                reportedValue?: { raw?: number };
              }>
            | { type?: string[] }
            | number[]
          >
        >;
      };
    };
    const rows = data.timeseries?.result ?? [];
<<<<<<< Updated upstream
    const series = (type: string) => {
=======
    const values = (type: string) => {
>>>>>>> Stashed changes
      const row = rows.find(
        (item) =>
          (item.meta as { type?: string[] } | undefined)?.type?.[0] === type,
      );
<<<<<<< Updated upstream
      return (
        (row?.[type] as
          | Array<{ asOfDate?: string; reportedValue?: { raw?: number } }>
          | undefined) ?? []
      )
        .map((item) => ({
          date: item.asOfDate ?? "",
          value: item.reportedValue?.raw ?? 0,
        }))
        .filter((item) => Number.isFinite(item.value) && item.value !== 0)
        .sort((a, b) => a.date.localeCompare(b.date));
    };
    const revenue = series("quarterlyTotalRevenue");
    const income = series("quarterlyNetIncome");
    const annualRevenue = series("annualTotalRevenue");
    const annualIncome = series("annualNetIncome");
    const equity = series("quarterlyStockholdersEquity");
    const debt = series("quarterlyTotalDebt");
    const ttmRevenue =
      series("trailingTotalRevenue").at(-1)?.value ?? sumLast(revenue, 4);
    const ttmNetIncome =
      series("trailingNetIncome").at(-1)?.value ?? sumLast(income, 4);
    const operatingCashFlow =
      series("trailingOperatingCashFlow").at(-1)?.value ??
      series("annualOperatingCashFlow").at(-1)?.value ??
      0;
    const latestAnnualRevenue = annualRevenue.at(-1)?.value ?? 0;
    const priorAnnualRevenue = annualRevenue.at(-2)?.value ?? 0;
    const latestAnnualIncome = annualIncome.at(-1)?.value ?? 0;
    const priorAnnualIncome = annualIncome.at(-2)?.value ?? 0;
    const latestEquity = equity.at(-1)?.value ?? 0;
    const latestDebt = debt.at(-1)?.value ?? 0;

    return {
      marketCap: series("trailingMarketCap").at(-1)?.value ?? 0,
      revenueGrowth: growthRate(latestAnnualRevenue, priorAnnualRevenue),
      earningsGrowth: growthRate(latestAnnualIncome, priorAnnualIncome),
      returnOnEquity: latestEquity > 0 ? ttmNetIncome / latestEquity : 0,
      debtToEquity:
        latestEquity > 0 ? (latestDebt / latestEquity) * 100 : 0,
      profitMargins: ttmRevenue > 0 ? ttmNetIncome / ttmRevenue : 0,
      trailingPe: series("trailingPeRatio").at(-1)?.value ?? 0,
      ttmRevenue,
      ttmNetIncome,
      operatingCashFlow,
      cashConversion:
        ttmNetIncome > 0 ? operatingCashFlow / ttmNetIncome : 0,
      positiveRevenueGrowthYears: countPositiveGrowthPeriods(annualRevenue),
      positiveEarningsGrowthYears: countPositiveGrowthPeriods(annualIncome),
      revenueQuarters: revenue.length,
      incomeQuarters: income.length,
      balanceSheetQuarters: Math.min(equity.length, debt.length),
      revenueYears: annualRevenue.length,
      incomeYears: annualIncome.length,
      latestReportDate:
        [revenue.at(-1)?.date, income.at(-1)?.date, equity.at(-1)?.date]
          .filter(Boolean)
          .sort()
          .at(-1) ?? "",
=======
      const series = row?.[type] as
        | Array<{ reportedValue?: { raw?: number } }>
        | undefined;
      return (series ?? [])
        .map((item) => item.reportedValue?.raw ?? 0)
        .filter((value) => Number.isFinite(value) && value !== 0);
    };
    const latest = (type: string) => values(type).at(-1) ?? 0;
    const yearOverYearGrowth = (type: string) => {
      const series = values(type);
      const current = series.at(-1) ?? 0;
      const prior = series.at(-5) ?? series[0] ?? 0;
      return prior !== 0 ? (current - prior) / Math.abs(prior) : 0;
    };
    const revenue = latest("quarterlyTotalRevenue");
    const netIncome = latest("quarterlyNetIncome");
    const equity = latest("quarterlyStockholdersEquity");
    const debt = latest("quarterlyTotalDebt");

    return {
      sector: "",
      industry: "",
      marketCap: latest("trailingMarketCap"),
      revenueGrowth: yearOverYearGrowth("quarterlyTotalRevenue"),
      earningsGrowth: yearOverYearGrowth("quarterlyNetIncome"),
      returnOnEquity: equity > 0 ? (netIncome * 4) / equity : 0,
      debtToEquity: equity > 0 ? (debt / equity) * 100 : 0,
      profitMargins: revenue > 0 ? netIncome / revenue : 0,
      trailingPe: latest("trailingPeRatio"),
>>>>>>> Stashed changes
    };
  } catch {
    return fallback;
  }
}

async function fetchHeadlines(symbol: string, companyName: string) {
  try {
    const response = await fetch(
<<<<<<< Updated upstream
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=1&newsCount=8`,
=======
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=1&newsCount=5`,
>>>>>>> Stashed changes
      {
        headers: { "User-Agent": "Mozilla/5.0" },
        next: { revalidate: 1800 },
      },
    );
    if (!response.ok) return [];
    const data = (await response.json()) as {
      news?: Array<{ title?: string }>;
    };
    const identityTokens = [
      symbol.toLowerCase(),
      ...companyName
        .toLowerCase()
        .split(/[^a-z0-9]+/u)
        .filter(
          (token) =>
            token.length >= 5 &&
            !["limited", "india", "industries", "company"].includes(token),
        ),
    ];

    return (data.news ?? [])
      .map((item) => item.title?.trim())
      .filter((title): title is string => Boolean(title))
      .filter((title) => {
        const normalized = title.toLowerCase();
        return identityTokens.some((token) => normalized.includes(token));
      })
<<<<<<< Updated upstream
      .slice(0, 8);
=======
      .slice(0, 5);
>>>>>>> Stashed changes
  } catch {
    return [];
  }
}

async function fetchBenchmarkReturns(symbols: string[]) {
  const rows = await mapWithConcurrency(symbols, 5, async (symbol) => {
    const chart = await fetchChart(symbol);
    const bars = buildPriceBars(chart?.indicators?.quote?.[0]);
    return [symbol, periodReturn(bars, 60)] as const;
  });
  return Object.fromEntries(rows);
}

<<<<<<< Updated upstream
function scoreDataQuality(fundamentals: FundamentalProfile, bars: PriceBar[]) {
  let score = 0;
  if (bars.length >= 200) score += 20;
  else if (bars.length >= 100) score += 12;
  if (fundamentals.revenueQuarters >= 5) score += 15;
  if (fundamentals.incomeQuarters >= 5) score += 15;
  if (fundamentals.revenueYears >= 3) score += 10;
  if (fundamentals.incomeYears >= 3) score += 10;
  if (fundamentals.balanceSheetQuarters >= 3) score += 15;
  if (fundamentals.marketCap > 0) score += 10;
  if (fundamentals.trailingPe > 0) score += 5;
  if (isRecentReport(fundamentals.latestReportDate)) score += 10;
  return clamp(score);
}

function scoreGrowth(fundamentals: FundamentalProfile) {
  const revenue = growthPoints(fundamentals.revenueGrowth);
  const earnings = growthPoints(fundamentals.earningsGrowth);
  return clamp(Math.round(revenue * 0.45 + earnings * 0.55), 0, 20);
}

function scoreQuality(fundamentals: FundamentalProfile) {
  const roe =
    fundamentals.returnOnEquity >= 0.2
      ? 10
      : fundamentals.returnOnEquity >= 0.15
        ? 8
        : fundamentals.returnOnEquity >= 0.1
          ? 5
          : fundamentals.returnOnEquity >= 0.08
            ? 3
            : 0;
  const margin =
    fundamentals.profitMargins >= 0.2
      ? 6
      : fundamentals.profitMargins >= 0.12
        ? 5
        : fundamentals.profitMargins >= 0.08
          ? 3
          : fundamentals.profitMargins > 0
            ? 1
            : 0;
  const leverage =
    fundamentals.debtToEquity <= 30
      ? 4
      : fundamentals.debtToEquity <= 70
        ? 3
        : fundamentals.debtToEquity <= 100
          ? 1
          : 0;
  const cashConversion =
    fundamentals.cashConversion >= 1
      ? 3
      : fundamentals.cashConversion >= 0.7
        ? 2
        : fundamentals.cashConversion >= 0.5
          ? 1
          : 0;
  return clamp(roe + margin + leverage + cashConversion, 0, 20);
}

function scoreValuation(
  fundamentals: FundamentalProfile,
  capBucket: MarketCapBucket,
) {
  const pe = fundamentals.trailingPe;
  const growthAnchor = clamp(fundamentals.earningsGrowth * 100, 5, 35);
  const peg = pe > 0 ? pe / growthAnchor : Number.POSITIVE_INFINITY;
  const capAdjustment = capBucket === "large" ? 0 : capBucket === "mid" ? 5 : 10;
  const ceiling = 50 + capAdjustment;

  if (pe <= 0 || pe > 100) return 0;
  if (pe <= 20 && peg <= 1.5) return 15;
  if (pe <= 35 && peg <= 2) return 12;
  if (pe <= ceiling && peg <= 2.5) return 8;
  if (pe <= 80) return 4;
  return 1;
}

function scoreMomentum(
  metrics: StockSignalMetrics,
  relativeStrengthPercent: number,
) {
  let score = 0;
  if (metrics.ema20 >= metrics.ema50) score += 5;
  if (metrics.vwapDistancePercent >= -8 && metrics.vwapDistancePercent <= 12) {
    score += 4;
  }
  if (relativeStrengthPercent >= 15) score += 4;
  else if (relativeStrengthPercent >= 5) score += 3;
  else if (relativeStrengthPercent >= 0) score += 1;
  if (metrics.volumeShock >= 1 && metrics.volumeShock <= 3) score += 2;
  return score;
}

function scoreRelativeStrength(relativeStrengthPercent: number) {
  if (relativeStrengthPercent >= 20) return 10;
  if (relativeStrengthPercent >= 10) return 8;
  if (relativeStrengthPercent >= 3) return 6;
  if (relativeStrengthPercent >= 0) return 4;
  if (relativeStrengthPercent >= -5) return 2;
  return 0;
}

function scoreLiquidity(turnoverCr: number, capBucket: MarketCapBucket) {
  const full = capBucket === "large" ? 100 : capBucket === "mid" ? 50 : 20;
  if (turnoverCr >= full) return 10;
  if (turnoverCr >= full / 2) return 8;
  if (turnoverCr >= full / 5) return 6;
  if (turnoverCr >= 2) return 3;
  return 0;
}

function scoreSafety(
  metrics: StockSignalMetrics,
  fundamentals: FundamentalProfile,
  regime: ScreeningRegime,
) {
  let score = 10;
  score -= Math.min(4, Math.round(metrics.riskScore / 5));
  if (fundamentals.debtToEquity > 70) score -= 2;
  if (fundamentals.trailingPe > 60) score -= 2;
  if (["Correction", "Risk-Off"].includes(regime)) score -= 2;
  return clamp(score, 0, 10);
=======
function scoreGrowth(fundamentals: FundamentalProfile) {
  return clamp(
    Math.round(
      Math.max(0, fundamentals.revenueGrowth * 30) +
        Math.max(0, fundamentals.earningsGrowth * 24),
    ),
    0,
    15,
  );
}

function scoreQuality(fundamentals: FundamentalProfile) {
  const margin = Math.max(0, fundamentals.profitMargins) * 35;
  const roe = Math.max(0, fundamentals.returnOnEquity) * 30;
  const debtPenalty = fundamentals.debtToEquity > 150 ? 5 : fundamentals.debtToEquity > 80 ? 2 : 0;
  return clamp(Math.round(margin + roe - debtPenalty), 0, 15);
}

function scoreValuation(fundamentals: FundamentalProfile) {
  if (!fundamentals.trailingPe) return 4;
  if (fundamentals.trailingPe <= 15) return 10;
  if (fundamentals.trailingPe <= 30) return 8;
  if (fundamentals.trailingPe <= 50) return 6;
  if (fundamentals.trailingPe <= 80) return 3;
  return 1;
}

function scoreCatalysts(headlines: string[]) {
  const text = headlines.join(" ").toLowerCase();
  const positive = catalystPositive.filter((word) => text.includes(word)).length;
  const negative = catalystNegative.filter((word) => text.includes(word)).length;
  return clamp(5 + positive * 2 - negative * 3, 0, 10);
>>>>>>> Stashed changes
}

function buildReasons({
  fundamentals,
<<<<<<< Updated upstream
  relativeStrengthPercent,
  metrics,
  theme,
  averageDailyTurnoverCr,
  regime,
}: {
  fundamentals: FundamentalProfile;
  relativeStrengthPercent: number;
  metrics: StockSignalMetrics;
  theme: string;
  averageDailyTurnoverCr: number;
  regime: ScreeningRegime;
}) {
  const reasons = [`Industry theme: ${theme}.`];
  reasons.push(
    `Latest annual revenue growth ${formatPercent(fundamentals.revenueGrowth * 100)} and earnings growth ${formatPercent(fundamentals.earningsGrowth * 100)}.`,
  );
  reasons.push(
    `ROE ${formatPercent(fundamentals.returnOnEquity * 100)}, margin ${formatPercent(fundamentals.profitMargins * 100)}, debt/equity ${fundamentals.debtToEquity.toFixed(0)}.`,
  );
  reasons.push(
    `Operating cash conversion ${fundamentals.cashConversion.toFixed(2)}x reported earnings; positive growth years ${fundamentals.positiveRevenueGrowthYears}/3 revenue and ${fundamentals.positiveEarningsGrowthYears}/3 earnings.`,
  );
  reasons.push(
    `Sector-relative return ${formatPercent(relativeStrengthPercent)} with EMA20 ${metrics.ema20 >= metrics.ema50 ? "above" : "below"} EMA50.`,
  );
  reasons.push(
    `Average daily traded value approximately INR ${averageDailyTurnoverCr.toFixed(1)} Cr.`,
  );
  reasons.push(`Market regime: ${regime}.`);
=======
  headlines,
  relativeStrengthPercent,
  metrics,
  theme,
}: {
  fundamentals: FundamentalProfile;
  headlines: string[];
  relativeStrengthPercent: number;
  metrics: StockSignalMetrics;
  theme: string;
}) {
  const reasons = [`Theme: ${theme}.`];
  if (fundamentals.revenueGrowth > 0.08) {
    reasons.push(`Revenue growth ${formatPercent(fundamentals.revenueGrowth * 100)}.`);
  }
  if (fundamentals.earningsGrowth > 0.08) {
    reasons.push(`Earnings growth ${formatPercent(fundamentals.earningsGrowth * 100)}.`);
  }
  if (fundamentals.returnOnEquity > 0.12) {
    reasons.push(`ROE ${formatPercent(fundamentals.returnOnEquity * 100)}.`);
  }
  if (relativeStrengthPercent > 3) {
    reasons.push(`Outperforming sector benchmark by ${formatPercent(relativeStrengthPercent)} over roughly three months.`);
  }
  if (metrics.ema20 >= metrics.ema50 && metrics.finalScore >= 55) {
    reasons.push("Trend and momentum confirmation are positive.");
  }
  if (headlines.length) {
    reasons.push(`Catalyst watch: ${headlines[0]}`);
  }
>>>>>>> Stashed changes
  return reasons;
}

function buildScreeningCaveats(
  metrics: StockSignalMetrics,
  fundamentals: FundamentalProfile,
  headlines: string[],
<<<<<<< Updated upstream
  gateFailures: string[],
) {
  const caveats = [
    ...gateFailures,
    ...metrics.caveats.filter((caveat) => !caveat.includes("VWAP")),
  ];
  if (fundamentals.trailingPe > 60) {
    caveats.push(
      `Valuation is elevated at approximately ${fundamentals.trailingPe.toFixed(1)}x trailing earnings.`,
    );
  }
  if (fundamentals.debtToEquity > 100) {
    caveats.push(
      `Debt-to-equity is elevated at ${fundamentals.debtToEquity.toFixed(0)}.`,
    );
  }
  if (!headlines.length) {
    caveats.push(
      "No verified company-specific news catalyst is included; review current exchange filings manually.",
    );
  }
  caveats.push(
    "Governance, promoter pledging, auditor qualifications, contingent liabilities and cash-flow quality require manual filing review.",
  );
  return [...new Set(caveats)].slice(0, 8);
}

function bucketMarketCap(
  marketCapCr: number,
  hint: MarketCapBucket,
): MarketCapBucket {
=======
) {
  const caveats = [...metrics.caveats];
  if (!fundamentals.marketCap) {
    caveats.push("Fundamental feed was incomplete; verify exchange filings before acting.");
  }
  if (fundamentals.trailingPe > 60) {
    caveats.push(`Valuation is elevated at approximately ${fundamentals.trailingPe.toFixed(1)}x trailing earnings.`);
  }
  if (fundamentals.debtToEquity > 100) {
    caveats.push(`Debt-to-equity is elevated at ${fundamentals.debtToEquity.toFixed(0)}.`);
  }
  if (!headlines.length) {
    caveats.push("No fresh company-specific headline catalyst was available.");
  }
  return [...new Set(caveats)].slice(0, 5);
}

function bucketMarketCap(marketCapCr: number, hint: MarketCapBucket): MarketCapBucket {
>>>>>>> Stashed changes
  if (!marketCapCr) return hint;
  if (marketCapCr >= 50_000) return "large";
  if (marketCapCr >= 10_000) return "mid";
  return "small";
}

function buildPriceBars(quote?: {
  close?: Array<number | null>;
  high?: Array<number | null>;
  low?: Array<number | null>;
  volume?: Array<number | null>;
}): PriceBar[] {
  return (quote?.close ?? [])
    .map((close, index) => ({
      close: close ?? 0,
      high: quote?.high?.[index] ?? close ?? 0,
      low: quote?.low?.[index] ?? close ?? 0,
      volume: quote?.volume?.[index] ?? 0,
    }))
    .filter((bar) => bar.close > 0 && bar.high > 0 && bar.low > 0);
}

<<<<<<< Updated upstream
function calculateAverageTurnoverCr(bars: PriceBar[]) {
  const sample = bars.slice(-20);
  const average =
    sample.reduce((sum, bar) => sum + bar.close * bar.volume, 0) /
    Math.max(sample.length, 1);
  return average / 10_000_000;
}

=======
>>>>>>> Stashed changes
function periodReturn(bars: PriceBar[], periods: number) {
  const sample = bars.slice(-periods);
  const start = sample[0]?.close ?? 0;
  const end = sample.at(-1)?.close ?? 0;
  return start > 0 && end > 0 ? ((end - start) / start) * 100 : 0;
}

<<<<<<< Updated upstream
function neutralSectorDirection(sector: string): SectorDirection {
  return {
    sector,
    rank: 0,
    score: 50,
    label: "Neutral Sector",
    return20Percent: 0,
    return60Percent: 0,
    trendBreadthPercent: 50,
    newsSentimentScore: 0,
    policyScore: 0,
  };
}

function sumLast(
  rows: Array<{ date: string; value: number }>,
  count: number,
) {
  return rows
    .slice(-count)
    .reduce((sum, item) => sum + item.value, 0);
}

function growthRate(current: number, prior: number) {
  return prior > 0 ? (current - prior) / prior : 0;
}

function countPositiveGrowthPeriods(
  rows: Array<{ date: string; value: number }>,
) {
  return rows.slice(-4).reduce((count, row, index, sample) => {
    if (index === 0) return count;
    return count + (row.value > sample[index - 1].value ? 1 : 0);
  }, 0);
}

function growthPoints(growth: number) {
  if (growth >= 0.3) return 20;
  if (growth >= 0.2) return 17;
  if (growth >= 0.12) return 14;
  if (growth >= 0.06) return 10;
  if (growth >= 0) return 6;
  if (growth >= -0.1) return 2;
  return 0;
}

function isRecentReport(date: string) {
  const timestamp = Date.parse(date);
  if (!Number.isFinite(timestamp)) return false;
  const ageDays = (Date.now() - timestamp) / 86_400_000;
  return ageDays >= -30 && ageDays <= 180;
}

function hasSevereRiskHeadline(headlines: string[]) {
  const normalized = headlines.join(" ").toLowerCase();
  return severeRiskTerms.some((term) => normalized.includes(term));
}

=======
>>>>>>> Stashed changes
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
) {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

function formatPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, value));
}
