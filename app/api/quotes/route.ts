import { NextResponse } from "next/server";
import {
  PortfolioInputRow,
  PortfolioList,
  PortfolioPosition,
  parseQuantity,
  resolveStockProfile,
} from "@/lib/portfolio";

export const dynamic = "force-dynamic";

type QuoteRequest = {
  rows?: Array<Partial<PortfolioInputRow>>;
};

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

export async function POST(request: Request) {
  const body = (await request.json()) as QuoteRequest;
  const rows = normalizeRows(body.rows ?? []);

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "No valid stocks found in the uploaded CSV." },
      { status: 400 },
    );
  }

  const positions = await Promise.all(rows.map(resolveQuote));
  const unresolved = positions.filter((position) => !position.currentPrice);

  return NextResponse.json({
    positions,
    unresolved: unresolved.map((position) => position.stock),
    refreshedAt: new Date().toISOString(),
  });
}

function normalizeRows(rows: Array<Partial<PortfolioInputRow>>): PortfolioInputRow[] {
  return rows
    .map((row) => {
      const rowWithLooseKeys = row as Partial<PortfolioInputRow> & {
        "stock code"?: string;
        code?: string;
      };
      const stockCode = String(
        rowWithLooseKeys.stockCode ?? rowWithLooseKeys["stock code"] ?? rowWithLooseKeys.code ?? "",
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

async function resolveQuote(row: PortfolioInputRow): Promise<PortfolioPosition> {
  const profile = resolveStockProfile(row.stockCode || row.stock || row.company);
  const yahooSymbol = `${profile.symbol}.NS`;
  const [quote, newsHeadlines] = await Promise.all([
    fetchYahooQuote(yahooSymbol),
    fetchYahooHeadlines(profile.symbol),
  ]);

  return {
    list: row.list,
    stock: row.stock,
    symbol: profile.symbol,
    company: profile.company,
    sector: profile.sector,
    quantity: row.list === "current" ? row.quantity : 0,
    currentPrice: quote.currentPrice,
    previousClose: quote.previousClose,
    volume: quote.volume,
    newsHeadlines,
    currency: "INR",
  };
}

async function fetchYahooQuote(symbol: string) {
  const fallback = {
    currentPrice: 0,
    previousClose: 0,
    volume: 0,
  };

  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
        },
        next: { revalidate: 60 },
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

    return {
      currentPrice,
      previousClose,
      volume,
    };
  } catch {
    return fallback;
  }
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
