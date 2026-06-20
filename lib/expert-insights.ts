import fs from "node:fs/promises";
import path from "node:path";
import { buildMarketOverview } from "@/lib/market-overview";
import {
  MIN_INTRADAY_POTENTIAL_PERCENT,
  qualifiesForHighPotentialIntraday,
} from "@/lib/analysis";
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
};

const categoryMeta: Record<
  MarketCapBucket,
  { key: string; title: string }
> = {
  large: { key: "largeCap", title: "Large-Cap Quality Compounders" },
  mid: { key: "midCap", title: "Mid-Cap Growth Leaders" },
  small: { key: "smallCap", title: "Small-Cap Wealth Candidates" },
};

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
  const screened = await screenWealthUniverse(marketRegime);
  const categories = (Object.keys(categoryMeta) as MarketCapBucket[]).map(
    (bucket) => buildCategory(bucket, screened, marketRegime),
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
      "NSE price trend, sector-relative strength, revenue and earnings growth, profitability, leverage, valuation, liquidity, news catalysts and risk",
    source:
      "Expanded thematic NSE screening universe with Yahoo market/fundamental feeds and outcome-learning history",
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
      "The engine abstains when evidence is incomplete or no stock clears every safety gate; non-selected names retain exclusion diagnostics.",
    ],
    exclusionDiagnostics,
    consecutivePicks,
    categories,
  };
}

export async function writeExpertActionMatrixSnapshot(
  matrix: ExpertActionMatrix,
) {
  const snapshotPath = path.join(
    process.cwd(),
    "data",
    "wealth_recommendations.json",
  );
  await fs.writeFile(snapshotPath, `${JSON.stringify(matrix, null, 2)}\n`, "utf8");
}

function buildCategory(
  bucket: MarketCapBucket,
  screened: ScreenedStock[],
  marketRegime: ScreeningRegime,
): ExpertCategory {
  const meta = categoryMeta[bucket];
  const bucketStocks = screened.filter((stock) => stock.capBucket === bucket);
  const longTermUpsides = bucketStocks
    .filter(isLongTermCandidate)
    .sort(
      (a, b) =>
        b.score + b.factorScores.growth + b.factorScores.quality -
        (a.score + a.factorScores.growth + a.factorScores.quality),
    )
    .slice(0, 6)
    .map((stock) => toExpertQuote(stock, marketRegime));
  const intradayBreakouts = bucketStocks
    .filter(isMomentumCandidate)
    .sort(
      (a, b) =>
        b.metrics.intradayPotentialPercent -
          a.metrics.intradayPotentialPercent ||
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

function isLongTermCandidate(stock: ScreenedStock) {
  const threshold =
    stock.capBucket === "small" ? 58 : stock.capBucket === "mid" ? 60 : 62;

  return (
    stock.eligible &&
    stock.score >= threshold &&
    stock.factorScores.growth + stock.factorScores.quality >= 18 &&
    stock.metrics.ema20 >= stock.metrics.ema50 * 0.97 &&
    stock.metrics.riskScore <= 18
  );
}

function isMomentumCandidate(stock: ScreenedStock) {
  const minimumTurnover =
    stock.capBucket === "large" ? 20 : stock.capBucket === "mid" ? 10 : 5;

  return (
    stock.score >= 60 &&
    stock.factorScores.momentum >= 9 &&
    stock.factorScores.liquidity >= 8 &&
    stock.averageDailyTurnoverCr >= minimumTurnover &&
    qualifiesForHighPotentialIntraday(stock.metrics) &&
    !stock.gateFailures.some((failure) =>
      failure.includes("governance or regulatory risk"),
    )
  );
}

function toExpertQuote(
  stock: ScreenedStock,
  marketRegime: ScreeningRegime,
  source: "longTerm" | "intraday" = "longTerm",
): ExpertQuote {
  const intradayPotential =
    source === "intraday" ? stock.metrics.intradayPotentialPercent : 0;
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
      source === "intraday" ||
      marketRegime === "Bull Market" ||
      marketRegime === "Risk-On"
        ? "Accumulate"
        : "Watchlist",
    remark:
      source === "intraday"
        ? `${stock.remark} Evidence-derived intraday potential ${intradayPotential.toFixed(1)}%; minimum hurdle ${MIN_INTRADAY_POTENTIAL_PERCENT}%.`
        : stock.remark,
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
  if (stock.upside < 8) {
    return "Risk-adjusted target upside is below the minimum entry hurdle.";
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
    const snapshotPath = path.join(
      process.cwd(),
      "data",
      "wealth_recommendations.json",
    );
    const snapshot = JSON.parse(
      await fs.readFile(snapshotPath, "utf8"),
    ) as ExpertActionMatrix;
    const ageHours = (Date.now() - Date.parse(snapshot.asOf)) / 3_600_000;

    if (
      !Number.isFinite(ageHours) ||
      ageHours < -1 ||
      ageHours > 36 ||
      snapshot.universeSize < 450
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
    source: "Official NIFTY 500 universe; scheduled safety-gated screening",
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
  };
}

async function getConsecutiveExpertPicks(
  categories: ExpertCategory[],
): Promise<ConsecutivePick[]> {
  const csvPicks = await readConsecutivePicksFromCsv();
  const liveSymbols = new Set(
    categories.flatMap((category) =>
      [...category.longTermUpsides, ...category.intradayBreakouts].map(
        (quote) => quote.symbol,
      ),
    ),
  );

  return csvPicks.filter((pick) => liveSymbols.has(pick.symbol));
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
