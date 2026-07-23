import fs from "node:fs/promises";
import path from "node:path";
import { readSnapshotFile, writeSnapshotFile } from "@/lib/snapshot-storage";
import { buildMarketOverview } from "@/lib/market-overview";
import {
  isGoogleSheetsConfigured,
  readValidationRecords,
} from "@/lib/google-sheets";
import {
  MIN_INTRADAY_POTENTIAL_PERCENT,
  MIN_LONG_TERM_POTENTIAL_PERCENT,
  qualifiesForHighPotentialIntraday,
  qualifiesForLongTermAccumulation,
} from "@/lib/analysis";
import {
  buildLearningFeedback,
  readExpertConsensusCounts,
  type LearningFeedback,
  type ReviewWindow,
  type SectorDirection,
} from "@/lib/recommendation-intelligence";
import { filterLearningValidationHistory } from "@/lib/learning-history";
import {
  getMarketUniverse,
  screenWealthUniverse,
  type FactorScores,
  type MarketCapBucket,
  type ScreeningRegime,
  type ScreenedStock,
} from "@/lib/wealth-screening";
import type { StockSignalMetrics } from "@/lib/analysis";

export type ExpertQuote = {
  symbol: string;
  name: string;
  price: number;
  previousClose: number;
  changePercent: number;
  volume: number;
  volumeShock: number;
  target: number;
  upside: number;
  score: number;
  action: "Accumulate" | "Watchlist";
  remark: string;
  caveats: string[];
  metrics: StockSignalMetrics;
  theme: string;
  sector: string;
  factorScores: FactorScores;
  reasons: string[];
  marketCapCr: number;
  dataQuality: number;
  fundamentalAsOf: string;
  averageDailyTurnoverCr: number;
  catalystSummary: string;
  intelligence: ScreenedStock["intelligence"];
};

export type ExpertCategory = {
  key: string;
  title: string;
  longTermUpsides: ExpertQuote[];
  intradayBreakouts: ExpertQuote[];
};

export type ConsecutivePick = {
  symbol: string;
  name: string;
  appearances: number;
  categories: string[];
};

export type ExclusionDiagnostic = {
  symbol: string;
  name: string;
  score: number;
  reason: string;
};

type IntradayPredictionPrior = {
  score: number;
  gainerDays: number;
  portfolioTrackDays: number;
};

export type ExpertActionMatrix = {
  title: string;
  verified: string;
  source: string;
  asOf: string;
  refreshCycle: string;
  caveat: string;
  universeSize: number;
  evaluatedSize: number;
  eligibleSize: number;
  abstained: boolean;
  marketRegime: ScreeningRegime;
  rejectionSummary: Array<{ reason: string; count: number }>;
  methodology: string[];
  exclusionDiagnostics: ExclusionDiagnostic[];
  consecutivePicks: ConsecutivePick[];
  categories: ExpertCategory[];
  intelligenceReview?: {
    recommendationQualityScore: number;
    confidenceAccuracy: number;
    reviewWindows: ReviewWindow[];
    sectorAccuracy: Record<string, number>;
    sectorDirections: SectorDirection[];
  };
};

const categoryMeta: Record<
  MarketCapBucket,
  { key: string; title: string }
> = {
  large: { key: "largeCap", title: "Large-Cap Quality Compounders" },
  mid: { key: "midCap", title: "Mid-Cap Growth Leaders" },
  small: { key: "smallCap", title: "Small-Cap Wealth Candidates" },
};

export const STOCKS_PER_MARKET_CAP_CATEGORY = 3;

export async function buildExpertActionMatrix(): Promise<ExpertActionMatrix> {
  const snapshot = await readSnapshot();

  if (snapshot) {
    return snapshot;
  }

  if (process.env.VERCEL) {
    return unavailableMatrix(
      "The scheduled recommendation snapshot is missing or stale; the engine is abstaining.",
    );
  }

  return generateExpertActionMatrix();
}

export async function generateExpertActionMatrix(): Promise<ExpertActionMatrix> {
  const market = await buildMarketOverview();
  const marketRegime = getMarketRegime(
    market.sentiment,
    market.averageMove,
  );
  const [validationRecords, expertConsensusCounts] = await Promise.all([
    loadValidationRecords(),
    readExpertConsensusCounts(),
  ]);
  const learning = buildLearningFeedback(filterLearningValidationHistory(validationRecords));
  const intradayPriors = await readIntradayPredictionPriors();
  const screened = await screenWealthUniverse(marketRegime, {
    expertConsensusCounts,
    learning,
  });
  const categories = (Object.keys(categoryMeta) as MarketCapBucket[]).map(
    (bucket) => buildCategory(bucket, screened, marketRegime, intradayPriors),
  );
  const consecutivePicks = await getConsecutiveExpertPicks(categories);
  const selectedSymbols = new Set(
    categories.flatMap((category) =>
      [...category.longTermUpsides, ...category.intradayBreakouts].map(
        (quote) => quote.symbol,
      ),
    ),
  );
  const exclusionDiagnostics = screened
    .filter((stock) => !selectedSymbols.has(stock.symbol))
    .slice(0, 12)
    .map((stock) => ({
      symbol: stock.symbol,
      name: stock.name,
      score: stock.score,
      reason: getExclusionReason(stock),
    }));
  const rejectionSummary = Object.entries(
    screened.reduce<Record<string, number>>((acc, stock) => {
      for (const reason of stock.gateFailures) {
        acc[reason] = (acc[reason] ?? 0) + 1;
      }
      return acc;
    }, {}),
  )
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  return {
    title: "Multi-Factor Wealth Discovery Matrix",
    verified:
      "NIFTY 500 core plus NSE cap-bucket overlays, price trend, sector-relative strength, revenue and earnings growth, profitability, leverage, valuation, liquidity, news catalysts and risk",
    source:
      "Official NIFTY 500 core with top large, mid and small-cap discovery overlays, Yahoo market/fundamental feeds and outcome-learning history",
    asOf: new Date().toISOString(),
    refreshCycle:
      "Technical and catalyst signals refresh intraday; fundamental factors are cached for six hours.",
    caveat:
      "Research screening only—not a guarantee of returns. Verify exchange filings, valuation, governance, liquidity, and position sizing before investing.",
    universeSize: getMarketUniverse().length,
    evaluatedSize: screened.length,
    eligibleSize: screened.filter((stock) => stock.eligible).length,
    abstained: categories.every(
      (category) =>
        category.longTermUpsides.length === 0 &&
        category.intradayBreakouts.length === 0,
    ),
    marketRegime,
    rejectionSummary,
    methodology: [
      "Uniform benchmark-relative screening; no example stock receives a score adjustment or guaranteed inclusion.",
      "Mandatory gates cover data freshness, positive TTM earnings, revenue direction, ROE, leverage, valuation, liquidity, trend, price extension and market regime.",
      "News sentiment, government policy, sector direction, expert consensus and learning feedback are capped context adjustments; they cannot bypass a failed safety gate.",
      "Each market-cap category returns exactly three ranked stocks when at least three were evaluated. Stocks that clear every gate are Accumulate ideas; deterministic backfills remain Watchlist ideas with their failed gates disclosed.",
    ],
    exclusionDiagnostics,
    consecutivePicks,
    categories,
    intelligenceReview: buildMatrixIntelligenceReview(screened, learning),
  };
}

export async function writeExpertActionMatrixSnapshot(
  matrix: ExpertActionMatrix,
) {
  const contractErrors = validateRecommendationContract(matrix);
  if (contractErrors.length) {
    throw new Error(`Invalid recommendation snapshot: ${contractErrors.join(" ")}`);
  }
  await writeSnapshotFile(
    "wealth_recommendations.json",
    `${JSON.stringify(matrix, null, 2)}\n`,
  );
}

export function validateRecommendationContract(matrix: ExpertActionMatrix) {
  const errors: string[] = [];
  const expectedKeys = new Set(Object.values(categoryMeta).map((meta) => meta.key));
  const seenKeys = new Set<string>();

  for (const category of matrix.categories) {
    if (!expectedKeys.has(category.key)) {
      errors.push(`Unknown market-cap category ${category.key}.`);
    }
    if (seenKeys.has(category.key)) {
      errors.push(`Duplicate market-cap category ${category.key}.`);
    }
    seenKeys.add(category.key);
    if (category.longTermUpsides.length !== STOCKS_PER_MARKET_CAP_CATEGORY) {
      errors.push(
        `${category.key} contains ${category.longTermUpsides.length} stocks; expected ${STOCKS_PER_MARKET_CAP_CATEGORY}.`,
      );
    }
    const symbols = category.longTermUpsides.map((quote) => quote.symbol);
    if (new Set(symbols).size !== symbols.length) {
      errors.push(`${category.key} contains duplicate stock symbols.`);
    }
  }
  for (const expectedKey of expectedKeys) {
    if (!seenKeys.has(expectedKey)) errors.push(`Missing market-cap category ${expectedKey}.`);
  }
  return errors;
}

export function buildCategory(
  bucket: MarketCapBucket,
  screened: ScreenedStock[],
  marketRegime: ScreeningRegime,
  intradayPriors: Record<string, IntradayPredictionPrior>,
): ExpertCategory {
  const meta = categoryMeta[bucket];
  const bucketStocks = screened.filter((stock) => stock.capBucket === bucket);
  const longTermUpsides = selectCategoryStocks(bucketStocks).map((stock) =>
    toExpertQuote(
      stock,
      marketRegime,
      "longTerm",
      !isLongTermCandidate(stock),
    ),
  );
  const intradayBreakouts = bucketStocks
    .filter((stock) => isMomentumCandidate(stock, intradayPriors[stock.symbol]))
    .sort(
      (a, b) =>
        getIntradayRankScore(b, intradayPriors[b.symbol]) -
          getIntradayRankScore(a, intradayPriors[a.symbol]) ||
        b.factorScores.momentum +
          b.factorScores.liquidity -
          (a.factorScores.momentum + a.factorScores.liquidity),
    )
    .slice(0, 5)
    .map((stock) => toExpertQuote(stock, marketRegime, "intraday"));

  return {
    key: meta.key,
    title: meta.title,
    longTermUpsides,
    intradayBreakouts,
  };
}

/**
 * Enforces the output contract independently from the scoring model. Fully
 * qualified ideas rank first, followed by gate-eligible ideas and then the
 * strongest review candidates. Symbol order makes ties reproducible.
 */
export function selectCategoryStocks(stocks: ScreenedStock[]) {
  return [...stocks]
    .sort((a, b) =>
      selectionTier(a) - selectionTier(b) ||
      longTermRankScore(b) - longTermRankScore(a) ||
      a.symbol.localeCompare(b.symbol),
    )
    .slice(0, STOCKS_PER_MARKET_CAP_CATEGORY);
}

function selectionTier(stock: ScreenedStock) {
  if (isLongTermCandidate(stock)) return 0;
  if (stock.eligible) return 1;
  return 2;
}

function longTermRankScore(stock: ScreenedStock) {
  const gatePenalty = Math.min(stock.gateFailures.length, 10) * 4;
  return (
    stock.score * 2 +
    stock.factorScores.growth +
    stock.factorScores.quality +
    stock.factorScores.momentum +
    stock.factorScores.risk -
    gatePenalty
  );
}

function isLongTermCandidate(stock: ScreenedStock) {
  const threshold =
    stock.capBucket === "small" ? 58 : stock.capBucket === "mid" ? 60 : 62;

  return (
    stock.eligible &&
    stock.score >= threshold &&
    stock.factorScores.growth + stock.factorScores.quality >= 18 &&
    qualifiesForLongTermAccumulation(stock.metrics)
  );
}

function isMomentumCandidate(
  stock: ScreenedStock,
  prior?: IntradayPredictionPrior,
) {
  const minimumTurnover =
    stock.capBucket === "large" ? 20 : stock.capBucket === "mid" ? 10 : 5;
  const hasTopGainerPrior = (prior?.score ?? 0) >= 1.5;
  const priorAdjustedSetup =
    hasTopGainerPrior &&
    stock.metrics.intradayPotentialPercent >= 8 &&
    stock.metrics.finalScore >= 60 &&
    stock.metrics.dayChangePercent > 0 &&
    stock.metrics.dayChangePercent <= 10 &&
    stock.metrics.volumeShock >= 0.8 &&
    stock.metrics.ema20 >= stock.metrics.ema50 &&
    stock.metrics.riskScore <= 18;

  return (
    stock.score >= (hasTopGainerPrior ? 58 : 60) &&
    stock.factorScores.momentum >= 9 &&
    stock.factorScores.liquidity >= 8 &&
    stock.averageDailyTurnoverCr >= minimumTurnover &&
    (qualifiesForHighPotentialIntraday(stock.metrics) || priorAdjustedSetup) &&
    !stock.gateFailures.some((failure) =>
      failure.includes("governance or regulatory risk"),
    )
  );
}

function getIntradayRankScore(
  stock: ScreenedStock,
  prior?: IntradayPredictionPrior,
) {
  const priorBoost = Math.min(prior?.score ?? 0, 4) * 1.25;
  return stock.metrics.intradayPotentialPercent + priorBoost;
}

function toExpertQuote(
  stock: ScreenedStock,
  marketRegime: ScreeningRegime,
  source: "longTerm" | "intraday" = "longTerm",
  forceWatchlist = false,
): ExpertQuote {
  const intradayPotential =
    source === "intraday" ? stock.metrics.intradayPotentialPercent : 0;
  // For intraday picks, isMomentumCandidate() already enforces the correct
  // intraday-specific gates (score, momentum, volume, trend, riskScore, liquidity).
  // The long-term fundamental eligibility flag (stock.eligible) is irrelevant for
  // a same-day trade — only a governance/regulatory risk headline warrants blocking.
  const isSafetyGatedIntradayWatch = source === "intraday" &&
    stock.gateFailures.some((f) => f.includes("governance or regulatory risk"));
  return {
    symbol: stock.symbol,
    name: stock.name,
    price: stock.price,
    previousClose: stock.previousClose,
    changePercent: stock.changePercent,
    volume: stock.volume,
    volumeShock: stock.volumeShock,
    target:
      source === "intraday"
        ? stock.price * (1 + intradayPotential / 100)
        : stock.target,
    upside: source === "intraday" ? intradayPotential : stock.upside,
    score: stock.score,
    action:
      forceWatchlist || isSafetyGatedIntradayWatch
        ? "Watchlist"
        : source === "intraday" ||
      marketRegime === "Bull Market" ||
      marketRegime === "Risk-On"
        ? "Accumulate"
        : "Watchlist",
    remark:
      forceWatchlist
        ? `Ranked category backfill (watchlist, not an accumulation signal): ${getExclusionReason(stock)} ${stock.remark}`
        : isSafetyGatedIntradayWatch
        ? `Momentum watchlist only: ${stock.gateFailures.slice(0, 2).join(" ")} Evidence-derived intraday potential ${intradayPotential.toFixed(1)}%; minimum hurdle ${MIN_INTRADAY_POTENTIAL_PERCENT}%.`
        : source === "intraday"
          ? `${stock.remark} Evidence-derived intraday potential ${intradayPotential.toFixed(1)}%; minimum hurdle ${MIN_INTRADAY_POTENTIAL_PERCENT}%.`
        : `${stock.remark} Evidence-derived long-term potential ${stock.metrics.longTermPotentialPercent.toFixed(1)}%; minimum hurdle ${MIN_LONG_TERM_POTENTIAL_PERCENT}%.`,
    caveats: stock.caveats,
    metrics: stock.metrics,
    theme: stock.theme,
    sector: stock.sector,
    factorScores: stock.factorScores,
    reasons: stock.reasons,
    marketCapCr: stock.marketCapCr,
    dataQuality: stock.dataQuality,
    fundamentalAsOf: stock.fundamentalAsOf,
    averageDailyTurnoverCr: stock.averageDailyTurnoverCr,
    catalystSummary: stock.catalystSummary,
    intelligence: stock.intelligence,
  };
}

function getExclusionReason(stock: ScreenedStock) {
  if (stock.gateFailures.length) {
    return stock.gateFailures.slice(0, 2).join(" ");
  }
  if (stock.metrics.riskScore > 22) {
    return `Risk score ${stock.metrics.riskScore.toFixed(1)} is above the long-term limit.`;
  }
  if (stock.metrics.ema20 < stock.metrics.ema50 * 0.97) {
    return "Trend confirmation is weak because EMA20 remains below EMA50.";
  }
  if (stock.factorScores.growth + stock.factorScores.quality < 10) {
    return "Growth and business-quality evidence is not strong enough for the current shortlist.";
  }
  if (
    stock.metrics.longTermPotentialPercent <
    MIN_LONG_TERM_POTENTIAL_PERCENT
  ) {
    return `Evidence-derived long-term potential is below the ${MIN_LONG_TERM_POTENTIAL_PERCENT}% entry hurdle.`;
  }
  return `Wealth score ${stock.score}/100 ranked below stronger candidates in its market-cap group.`;
}

function getMarketRegime(
  sentiment: "Positive" | "Negative" | "Neutral",
  averageMove: number,
): ScreeningRegime {
  if (sentiment === "Positive" && averageMove > 1.2) return "Bull Market";
  if (sentiment === "Positive") return "Risk-On";
  if (sentiment === "Negative" && averageMove < -1.2) return "Risk-Off";
  if (sentiment === "Negative") return "Correction";
  return Math.abs(averageMove) < 0.35 ? "Consolidation" : "Transition";
}

async function readSnapshot(): Promise<ExpertActionMatrix | null> {
  try {
    const json = await readSnapshotFile("wealth_recommendations.json");
    if (!json) return null;
    const snapshot = JSON.parse(json) as ExpertActionMatrix;
    const ageHours = (Date.now() - Date.parse(snapshot.asOf)) / 3_600_000;

    if (
      !Number.isFinite(ageHours) ||
      ageHours < -1 ||
      ageHours > 36 ||
      snapshot.universeSize < 450 ||
      validateRecommendationContract(snapshot).length > 0
    ) {
      return null;
    }

    return snapshot;
  } catch {
    return null;
  }
}

function unavailableMatrix(reason: string): ExpertActionMatrix {
  return {
    title: "Multi-Factor Wealth Discovery Matrix",
    verified: "No recommendation published without a fresh validated snapshot.",
    source: "Official NIFTY 500 plus NSE cap-bucket universe; scheduled safety-gated screening",
    asOf: new Date().toISOString(),
    refreshCycle: "Scheduled twice each market day.",
    caveat: reason,
    universeSize: getMarketUniverse().length,
    evaluatedSize: 0,
    eligibleSize: 0,
    abstained: true,
    marketRegime: "Transition",
    rejectionSummary: [],
    methodology: [
      "The model abstains when the scheduled snapshot is unavailable or older than 36 hours.",
    ],
    exclusionDiagnostics: [],
    consecutivePicks: [],
    categories: (Object.values(categoryMeta)).map((meta) => ({
      key: meta.key,
      title: meta.title,
      longTermUpsides: [],
      intradayBreakouts: [],
    })),
    intelligenceReview: {
      recommendationQualityScore: 0,
      confidenceAccuracy: 0,
      reviewWindows: [],
      sectorAccuracy: {},
      sectorDirections: [],
    },
  };
}

async function loadValidationRecords() {
  if (!isGoogleSheetsConfigured()) return [];
  try {
    return await readValidationRecords();
  } catch {
    return [];
  }
}

function buildMatrixIntelligenceReview(
  screened: ScreenedStock[],
  learning: LearningFeedback,
) {
  const sectors = Object.values(
    screened.reduce<Record<string, SectorDirection>>((acc, stock) => {
      const current = acc[stock.sector];
      if (
        !current ||
        stock.intelligence.sectorDirectionScore > current.score
      ) {
        acc[stock.sector] = stock.intelligence.sectorDirection;
      }
      return acc;
    }, {}),
  )
    .sort((a, b) => b.score - a.score)
    .map((sector, index) => ({ ...sector, rank: index + 1 }));

  return {
    recommendationQualityScore: learning.recommendationQualityScore,
    confidenceAccuracy: learning.confidenceAccuracy,
    reviewWindows: learning.windows,
    sectorAccuracy: learning.sectorAccuracy,
    sectorDirections: sectors,
  };
}

async function getConsecutiveExpertPicks(
  categories: ExpertCategory[],
): Promise<ConsecutivePick[]> {
  const csvPicks = await readConsecutivePicksFromCsv();
  const liveQuotes = categories.flatMap((category) =>
    [...category.longTermUpsides, ...category.intradayBreakouts].map(
      (quote) => ({ category: category.title, quote }),
    ),
  );
  const historical = Object.fromEntries(
    csvPicks.map((pick) => [pick.symbol, pick]),
  );

  return liveQuotes
    .map(({ category, quote }) => {
      const prior = historical[quote.symbol];
      return {
        symbol: quote.symbol,
        name: quote.name,
        appearances: Math.max(
          prior?.appearances ?? 0,
          quote.intelligence.expertFocusCount,
        ),
        categories: [
          ...new Set([...(prior?.categories ?? []), category]),
        ],
      };
    })
    .filter((pick) => pick.appearances > 0)
    .sort((a, b) => b.appearances - a.appearances)
    .slice(0, 12);
}

async function readConsecutivePicksFromCsv(): Promise<ConsecutivePick[]> {
  try {
    const csvPath = path.join(process.cwd(), "data", "daily_recommendations.csv");
    const csv = await fs.readFile(csvPath, "utf8");
    const [headerLine, ...lines] = csv.split(/\r?\n/u).filter(Boolean);
    const headers = parseCsvLine(headerLine);
    const rows = lines.map((line) => {
      const cells = parseCsvLine(line);
      return Object.fromEntries(
        headers.map((header, index) => [header, cells[index] ?? ""]),
      );
    });
    const expertRows = rows.filter(
      (row) =>
        row.source === "expert-action-matrix" &&
        row.action === "Accumulate" &&
        row.symbol &&
        row.date,
    );
    const sortedDates = [...new Set(expertRows.map((row) => row.date))]
      .sort()
      .slice(-2);

    if (sortedDates.length < 2) return [];

    const bySymbol = expertRows
      .filter((row) => sortedDates.includes(row.date))
      .reduce<Record<string, ConsecutivePick & { dates: Set<string> }>>(
        (acc, row) => {
          const current =
            acc[row.symbol] ??
            {
              symbol: row.symbol,
              name: row.stock_name || row.symbol,
              appearances: 0,
              categories: [],
              dates: new Set<string>(),
            };
          current.dates.add(row.date);
          current.categories = [
            ...new Set([...current.categories, row.segment]),
          ];
          acc[row.symbol] = current;
          return acc;
        },
        {},
      );

    return Object.values(bySymbol)
      .filter((item) => item.dates.size >= 2)
      .map((item) => ({
        symbol: item.symbol,
        name: item.name,
        appearances: item.dates.size,
        categories: item.categories,
      }))
      .slice(0, 12);
  } catch {
    return [];
  }
}

async function readIntradayPredictionPriors(): Promise<
  Record<string, IntradayPredictionPrior>
> {
  try {
    const csvPath = path.join(process.cwd(), "data", "daily_recommendations.csv");
    const csv = await fs.readFile(csvPath, "utf8");
    const rows = parseCsvRows(csv);
    const recentGainerDates = [
      ...new Set(
        rows
          .filter(
            (row) =>
              row.source === "market-movers" &&
              row.category === "gainer" &&
              row.date,
          )
          .map((row) => row.date),
      ),
    ]
      .sort()
      .slice(-10);
    const recentDateSet = new Set(recentGainerDates);
    const priors: Record<string, IntradayPredictionPrior> = {};
    const seenGainers = new Set<string>();
    const seenPortfolioTracks = new Set<string>();

    for (const row of rows) {
      if (!row.symbol || !row.date || !recentDateSet.has(row.date)) continue;

      const changePercent = Number(row.change_percent);
      const symbol = row.symbol.toUpperCase();
      const prior =
        priors[symbol] ??
        {
          score: 0,
          gainerDays: 0,
          portfolioTrackDays: 0,
        };

      if (
        row.source === "market-movers" &&
        row.category === "gainer" &&
        changePercent > 0
      ) {
        const key = `${row.date}:${symbol}:gainer`;
        if (!seenGainers.has(key)) {
          prior.gainerDays += 1;
          prior.score += 1;
          seenGainers.add(key);
        }
      }

      if (
        row.source === "portfolio-analysis" &&
        row.category === "portfolio-short-term" &&
        row.action === "Track" &&
        changePercent > 0
      ) {
        const key = `${row.date}:${symbol}:portfolio`;
        if (!seenPortfolioTracks.has(key)) {
          prior.portfolioTrackDays += 1;
          prior.score += 0.5;
          seenPortfolioTracks.add(key);
        }
      }

      if (prior.score > 0) {
        priors[symbol] = prior;
      }
    }

    return priors;
  } catch {
    return {};
  }
}

function parseCsvRows(csv: string) {
  const [headerLine, ...lines] = csv.split(/\r?\n/u).filter(Boolean);
  const headers = parseCsvLine(headerLine);

  return lines.map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(
      headers.map((header, index) => [header, cells[index] ?? ""]),
    );
  });
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells;
}
