import type { PriceBar } from "@/lib/analysis";
import {
  parseQuantity,
  resolveStockProfile,
  type PortfolioInputRow,
  type PortfolioList,
  type PortfolioPosition,
} from "@/lib/portfolio";

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      meta?: {
        currency?: string;
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        regularMarketVolume?: number;
        symbol?: string;
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
    error?: {
      description?: string;
    };
  };
};

type YahooSearchResponse = {
  news?: Array<{
    title?: string;
  }>;
};

type YahooQuoteSummaryResponse = {
  quoteSummary?: {
    result?: Array<{
      assetProfile?: {
        sector?: string;
        industry?: string;
      };
    }>;
  };
};

export function normalizeQuoteRows(
  rows: Array<Partial<PortfolioInputRow>>,
): PortfolioInputRow[] {
  return rows
    .map((row) => {
      const rowWithLooseKeys = row as Partial<PortfolioInputRow> & {
        "stock code"?: string;
        code?: string;
        symbol?: string;
        ticker?: string;
      };
      const stockCode = String(
        rowWithLooseKeys.stockCode ??
          rowWithLooseKeys["stock code"] ??
          rowWithLooseKeys.symbol ??
          rowWithLooseKeys.ticker ??
          rowWithLooseKeys.code ??
          "",
      )
        .trim()
        .toUpperCase();
      const company = String(row.company ?? "").trim();
      const stock = String(row.stock ?? (stockCode || company)).trim();
      const rawQuantity = parseQuantity(row.quantity);
      const list: PortfolioList =
        row.list === "watchlist" || rawQuantity <= 0 ? "watchlist" : "current";
      const quantity = list === "watchlist" ? 0 : rawQuantity;

      return {
        list,
        stockCode,
        company,
        stock,
        quantity,
      };
    })
    .filter((row) => row.stock && (row.list === "watchlist" || row.quantity > 0));
}

export async function resolveQuotePositions(
  rows: Array<Partial<PortfolioInputRow>>,
): Promise<PortfolioPosition[]> {
  const normalizedRows = normalizeQuoteRows(rows);
  return Promise.all(normalizedRows.map(resolveQuote));
}

async function resolveQuote(row: PortfolioInputRow): Promise<PortfolioPosition> {
  const profile = resolveStockProfile(
    row.stockCode || row.stock || row.company,
    row.company,
  );
  const yahooSymbol = `${profile.symbol}.NS`;
  const [quote, newsHeadlines, yahooSector] = await Promise.all([
    fetchYahooQuote(yahooSymbol),
    fetchYahooHeadlines(profile.symbol),
    profile.sector === "Unclassified" ? fetchYahooSector(yahooSymbol) : "",
  ]);

  return {
    list: row.list,
    stock: row.stock,
    symbol: profile.symbol,
    company: profile.company,
    sector: yahooSector || profile.sector,
    quantity: row.list === "current" ? row.quantity : 0,
    currentPrice: quote.currentPrice,
    previousClose: quote.previousClose,
    volume: quote.volume,
    bars: quote.bars,
    newsHeadlines,
    currency: "INR",
  };
}

async function fetchYahooSector(symbol: string) {
  try {
    const response = await fetch(
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=assetProfile`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
        },
        next: { revalidate: 86400 },
      },
    );

    if (!response.ok) {
      return "";
    }

    const data = (await response.json()) as YahooQuoteSummaryResponse;
    const profile = data.quoteSummary?.result?.[0]?.assetProfile;

    return profile?.sector ?? profile?.industry ?? "";
  } catch {
    return "";
  }
}

async function fetchYahooQuote(symbol: string) {
  const fallback = {
    currentPrice: 0,
    previousClose: 0,
    volume: 0,
    bars: [] as PriceBar[],
  };

  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=3mo&interval=1d`,
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
    const currentPrice = meta?.regularMarketPrice ?? 0;
    const previousClose = meta?.previousClose ?? meta?.chartPreviousClose ?? 0;
    const volume = meta?.regularMarketVolume ?? 0;
    const quote = data.chart?.result?.[0]?.indicators?.quote?.[0];
    const bars = buildPriceBars(quote);

    return {
      currentPrice,
      previousClose,
      volume,
      bars,
    };
  } catch {
    return fallback;
  }
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

async function fetchYahooHeadlines(symbol: string) {
  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&newsCount=3`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
        },
        next: { revalidate: 900 },
      },
    );

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as YahooSearchResponse;

    return (data.news ?? [])
      .map((item) => item.title?.trim())
      .filter((title): title is string => Boolean(title))
      .slice(0, 3);
  } catch {
    return [];
  }
}
