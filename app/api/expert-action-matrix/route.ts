import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  analyzeStockSignal,
  buildSignalRemark,
  type PriceBar,
  type StockSignalMetrics,
} from "@/lib/analysis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type YahooChartResponse = {
  chart?: {
    result?: Array<{
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
    }>;
  };
};

type ExpertQuote = {
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
  action: "Accumulate";
  remark: string;
  caveats: string[];
  metrics: StockSignalMetrics;
};

type ExpertCategory = {
  key: string;
  title: string;
  longTermUpsides: ExpertQuote[];
  intradayBreakouts: ExpertQuote[];
};

type ConsecutivePick = {
  symbol: string;
  name: string;
  appearances: number;
  categories: string[];
};

const expertUniverse = {
  largeCap: [
    "RELIANCE",
    "HDFCBANK",
    "TCS",
    "ICICIBANK",
    "INFY",
    "NTPC",
    "POWERGRID",
    "SBIN",
    "SUNPHARMA",
    "BHARTIARTL",
    "PATANJALI",
    "MAXHEALTH",
    "RECLTD",
    "VBL",
  ],
  midCap: ["AHLUCONT", "BALAMINES", "POLYCAB", "DIXON", "PERSISTENT", "CUMMINSIND"],
  smallCap: [
    "GIPCL",
    "NUCLEUS",
    "TEXRAIL",
    "ORISSAMINE",
    "RAMASTEEL",
    "DWARKESH",
    "MOREPENLAB",
    "SUZLON",
    "IREDA",
    "RVNL",
  ],
  etf: ["GOLDBEES", "AUTOBEES", "ITBEES", "NIFTYBEES", "BANKBEES", "JUNIORBEES"],
};

const categoryMeta = {
  largeCap: {
    title: "Large-Cap Bluechips",
    targetFloor: 1.15,
    targetCeiling: 1.45,
  },
  midCap: {
    title: "Mid-Cap Momentum",
    targetFloor: 1.12,
    targetCeiling: 1.32,
  },
  smallCap: {
    title: "Small-Cap Alpha",
    targetFloor: 1.15,
    targetCeiling: 2.35,
  },
  etf: {
    title: "ETFs & Index BeES",
    targetFloor: 1.08,
    targetCeiling: 1.08,
  },
};

export async function GET() {
  const categories = await Promise.all(
    Object.entries(expertUniverse).map(async ([key, symbols]) => {
      const quotes = (
        await Promise.all(
          symbols.map((symbol) =>
            fetchExpertQuote(symbol, categoryMeta[key as keyof typeof categoryMeta].title),
          ),
        )
      ).filter((quote) => quote.price > 0);
      const buyCandidates = quotes.filter(isBuyCandidate);

      return {
        key,
        title: categoryMeta[key as keyof typeof categoryMeta].title,
        longTermUpsides: [...buyCandidates]
          .sort((a, b) => b.score + b.upside - (a.score + a.upside))
          .slice(0, 5),
        intradayBreakouts: [...buyCandidates]
          .sort((a, b) => b.metrics.finalScore + b.volumeShock * 5 - (a.metrics.finalScore + a.volumeShock * 5))
          .slice(0, 5),
      } satisfies ExpertCategory;
    }),
  );
  const consecutivePicks = await getConsecutiveExpertPicks(categories);

  return NextResponse.json({
    title: "Expert Action Matrix",
    verified: "NSE quote, EMA20/50, VWAP, ATR, volume shock, target, risk and caveat scoring",
    source: "Adapted from unloan83/Expert_insight recommendation matrix style",
    asOf: new Date().toISOString(),
    refreshCycle: "Intraday breakout signals refresh every 5 minutes; long-term targets refresh every 15 minutes.",
    caveat: "For research and screening only. Validate with fundamentals, news, liquidity, and risk controls before investing.",
    consecutivePicks,
    categories,
  });
}

async function fetchExpertQuote(symbol: string, segment: string): Promise<ExpertQuote> {
  const fallback = {
    symbol,
    name: symbol,
    price: 0,
    previousClose: 0,
    changePercent: 0,
    volume: 0,
    volumeShock: 0,
    target: 0,
    upside: 0,
    score: 0,
    action: "Accumulate" as const,
    remark: "Quote unavailable.",
    caveats: ["Quote unavailable; do not act without live validation."],
    metrics: analyzeStockSignal({ symbol, price: 0, previousClose: 0 }),
  };

  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        `${symbol}.NS`,
      )}?range=3mo&interval=1d`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
        },
        next: { revalidate: 300 },
      },
    );

    if (!response.ok) {
      return fallback;
    }

    const data = (await response.json()) as YahooChartResponse;
    const meta = data.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice ?? 0;
    const previousClose = meta?.previousClose ?? meta?.chartPreviousClose ?? 0;
    const changePercent =
      previousClose === 0 ? 0 : ((price - previousClose) / previousClose) * 100;
    const volume = meta?.regularMarketVolume ?? 0;
    const bars = buildPriceBars(data.chart?.result?.[0]?.indicators?.quote?.[0]);
    const metrics = analyzeStockSignal({
      symbol,
      price,
      previousClose,
      volume,
      bars,
      segment,
      profile: "intraday",
    });

    return {
      symbol,
      name: meta?.shortName ?? meta?.longName ?? symbol,
      price,
      previousClose,
      changePercent,
      volume,
      volumeShock: metrics.volumeShock,
      target: metrics.target,
      upside: metrics.upsidePercent,
      score: metrics.finalScore,
      action: "Accumulate",
      remark: buildSignalRemark(metrics, "intraday"),
      caveats: metrics.caveats,
      metrics,
    };
  } catch {
    return fallback;
  }
}

function isBuyCandidate(quote: ExpertQuote) {
  return (
    quote.score >= 52 &&
    quote.upside > 0 &&
    quote.metrics.ema20 >= quote.metrics.ema50 * 0.985 &&
    quote.metrics.riskScore <= 14
  );
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
      return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
    });
    const expertRows = rows.filter((row) =>
      row.source === "expert-action-matrix" &&
      row.action === "Accumulate" &&
      row.symbol &&
      row.date,
    );
    const sortedDates = [...new Set(expertRows.map((row) => row.date))].sort().slice(-2);

    if (sortedDates.length < 2) {
      return [];
    }

    const bySymbol = expertRows
      .filter((row) => sortedDates.includes(row.date))
      .reduce<Record<string, ConsecutivePick & { dates: Set<string> }>>((acc, row) => {
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
        current.categories = [...new Set([...current.categories, row.segment])];
        acc[row.symbol] = current;
        return acc;
      }, {});

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

function buildPriceBars(quote?: {
  close?: Array<number | null>;
  high?: Array<number | null>;
  low?: Array<number | null>;
  volume?: Array<number | null>;
}): PriceBar[] {
  const closes = quote?.close ?? [];

  return closes
    .map((close, index) => ({
      close: close ?? 0,
      high: quote?.high?.[index] ?? close ?? 0,
      low: quote?.low?.[index] ?? close ?? 0,
      volume: quote?.volume?.[index] ?? 0,
    }))
    .filter((bar) => bar.close > 0 && bar.high > 0 && bar.low > 0);
}
