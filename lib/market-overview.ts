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

export type MarketQuote = {
  symbol: string;
  name: string;
  segment: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  volume: number;
};

export type MarketMoverGroup = {
  segment: string;
  gainers: MarketQuote[];
  losers: MarketQuote[];
};

export type MarketOverview = {
  sentiment: "Positive" | "Negative" | "Neutral";
  averageMove: number;
  indices: MarketQuote[];
  moverGroups: MarketMoverGroup[];
  gainers: MarketQuote[];
  losers: MarketQuote[];
  refreshedAt: string;
};

const indices = [
  { symbol: "^NSEI", name: "NIFTY 50" },
  { symbol: "^BSESN", name: "SENSEX" },
  { symbol: "^NSEBANK", name: "BANK NIFTY" },
];

const marketMoverUniverse = {
  "Large Cap": [
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
    "NTPC",
  ],
  "Mid Cap": [
    "MAXHEALTH",
    "POLYCAB",
    "DIXON",
    "PERSISTENT",
    "CUMMINSIND",
    "RECLTD",
    "VBL",
    "AUBANK",
    "FEDERALBNK",
    "INDHOTEL",
    "ASHOKLEY",
    "MPHASIS",
    "COFORGE",
    "BALKRISIND",
    "LUPIN",
    "IDEA",
  ],
  "Small Cap": [
    "GIPCL",
    "NUCLEUS",
    "TEXRAIL",
    "RAMASTEEL",
    "DWARKESH",
    "MOREPENLAB",
    "SUZLON",
    "IREDA",
    "RVNL",
    "BEML",
    "MTARTECH",
    "GRAVITA",
    "KPEL",
    "JWL",
    "SENCO",
    "HBLPOWER",
  ],
};

export async function buildMarketOverview(): Promise<MarketOverview> {
  const [indexQuotes, stockQuotes] = await Promise.all([
    Promise.all(indices.map((index) => fetchYahooQuote(index.symbol, index.name))),
    Promise.all(
      Object.entries(marketMoverUniverse).flatMap(([segment, symbols]) =>
        symbols.map((symbol) => fetchYahooQuote(`${symbol}.NS`, symbol, segment)),
      ),
    ),
  ]);
  const validStocks = stockQuotes.filter((quote) => quote.price > 0);
  const moverGroups: MarketMoverGroup[] = Object.keys(marketMoverUniverse).map(
    (segment) => {
      const segmentQuotes = validStocks.filter((quote) => quote.segment === segment);

      return {
        segment,
        gainers: [...segmentQuotes]
          .sort((a, b) => b.changePercent - a.changePercent)
          .slice(0, 4),
        losers: [...segmentQuotes]
          .sort((a, b) => a.changePercent - b.changePercent)
          .slice(0, 4),
      };
    },
  );
  const averageMove =
    indexQuotes.reduce((sum, quote) => sum + quote.changePercent, 0) /
    Math.max(indexQuotes.length, 1);
  const sentiment =
    averageMove > 0.25 ? "Positive" : averageMove < -0.25 ? "Negative" : "Neutral";

  return {
    sentiment,
    averageMove,
    indices: indexQuotes,
    moverGroups,
    gainers: moverGroups.flatMap((group) => group.gainers),
    losers: moverGroups.flatMap((group) => group.losers),
    refreshedAt: new Date().toISOString(),
  };
}

async function fetchYahooQuote(
  symbol: string,
  fallbackName: string,
  segment = "Index",
): Promise<MarketQuote> {
  const fallback = {
    symbol: symbol.replace(".NS", ""),
    name: fallbackName,
    segment,
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
      segment,
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
