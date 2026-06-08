import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

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
        symbol?: string;
      };
    }>;
  };
};

type MarketQuote = {
  symbol: string;
  name: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  volume: number;
};

const indices = [
  { symbol: "^NSEI", name: "NIFTY 50" },
  { symbol: "^BSESN", name: "SENSEX" },
  { symbol: "^NSEBANK", name: "BANK NIFTY" },
];

const indianStockUniverse = [
  "RELIANCE",
  "TCS",
  "HDFCBANK",
  "ICICIBANK",
  "INFY",
  "ITC",
  "LT",
  "SBIN",
  "BHARTIARTL",
  "AXISBANK",
  "KOTAKBANK",
  "MARUTI",
  "SUNPHARMA",
  "TITAN",
  "BAJFINANCE",
  "TATAMOTORS",
  "TATASTEEL",
  "WIPRO",
  "HCLTECH",
  "NTPC",
  "ULTRACEMCO",
  "ASIANPAINT",
  "HINDUNILVR",
  "NESTLEIND",
  "POWERGRID",
  "ONGC",
  "COALINDIA",
  "ADANIENT",
  "ADANIPORTS",
  "M&M",
  "BAJAJFINSV",
  "TECHM",
  "GRASIM",
  "JSWSTEEL",
  "CIPLA",
  "DRREDDY",
  "EICHERMOT",
  "HEROMOTOCO",
  "HINDALCO",
  "TATA_CONSUM",
].filter((symbol) => symbol !== "TATA_CONSUM");

export async function GET() {
  const [indexQuotes, stockQuotes] = await Promise.all([
    Promise.all(indices.map((index) => fetchYahooQuote(index.symbol, index.name))),
    Promise.all(
      indianStockUniverse.map((symbol) => fetchYahooQuote(`${symbol}.NS`, symbol)),
    ),
  ]);
  const validStocks = stockQuotes.filter((quote) => quote.price > 0);
  const averageMove =
    indexQuotes.reduce((sum, quote) => sum + quote.changePercent, 0) /
    Math.max(indexQuotes.length, 1);
  const sentiment =
    averageMove > 0.25 ? "Positive" : averageMove < -0.25 ? "Negative" : "Neutral";

  return NextResponse.json({
    sentiment,
    averageMove,
    indices: indexQuotes,
    gainers: [...validStocks]
      .filter((quote) => quote.changePercent > 0)
      .sort((a, b) => b.changePercent - a.changePercent)
      .slice(0, 10),
    losers: [...validStocks]
      .filter((quote) => quote.changePercent < 0)
      .sort((a, b) => a.changePercent - b.changePercent)
      .slice(0, 10),
    refreshedAt: new Date().toISOString(),
  });
}

async function fetchYahooQuote(symbol: string, fallbackName: string): Promise<MarketQuote> {
  const fallback = {
    symbol: symbol.replace(".NS", ""),
    name: fallbackName,
    price: 0,
    previousClose: 0,
    change: 0,
    changePercent: 0,
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
    const price = meta?.regularMarketPrice ?? 0;
    const previousClose = meta?.previousClose ?? meta?.chartPreviousClose ?? 0;
    const change = price - previousClose;
    const changePercent = previousClose === 0 ? 0 : (change / previousClose) * 100;

    return {
      symbol: symbol.replace(".NS", ""),
      name: meta?.shortName ?? meta?.longName ?? fallbackName,
      price,
      previousClose,
      change,
      changePercent,
      volume: meta?.regularMarketVolume ?? 0,
    };
  } catch {
    return fallback;
  }
}
