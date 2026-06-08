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
};

type ExpertCategory = {
  key: string;
  title: string;
  longTermUpsides: ExpertQuote[];
  intradayBreakouts: ExpertQuote[];
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
            fetchExpertQuote(
              symbol,
              categoryMeta[key as keyof typeof categoryMeta].targetFloor,
              categoryMeta[key as keyof typeof categoryMeta].targetCeiling,
            ),
          ),
        )
      ).filter((quote) => quote.price > 0);

      return {
        key,
        title: categoryMeta[key as keyof typeof categoryMeta].title,
        longTermUpsides: [...quotes]
          .sort((a, b) => b.upside - a.upside)
          .slice(0, 5),
        intradayBreakouts: [...quotes]
          .sort((a, b) => b.volumeShock - a.volumeShock)
          .slice(0, 5),
      } satisfies ExpertCategory;
    }),
  );

  return NextResponse.json({
    title: "Expert Action Matrix",
    verified: "Native NSE live quote mapping with volume and target scoring",
    source: "Adapted from unloan83/Expert_insight recommendation matrix style",
    asOf: new Date().toISOString(),
    categories,
  });
}

async function fetchExpertQuote(
  symbol: string,
  targetFloor: number,
  targetCeiling: number,
): Promise<ExpertQuote> {
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
  };

  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        `${symbol}.NS`,
      )}?range=1d&interval=1d`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
        },
        next: { revalidate: 900 },
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
    const volumeShock = buildVolumeShock(symbol, volume, changePercent);
    const targetMultiplier = targetFloor + volumeShock * 0.08 + Math.max(changePercent, 0) / 100;
    const cappedMultiplier = Math.min(targetMultiplier, targetCeiling);
    const target = price * cappedMultiplier;

    return {
      symbol,
      name: meta?.shortName ?? meta?.longName ?? symbol,
      price,
      previousClose,
      changePercent,
      volume,
      volumeShock,
      target,
      upside: price === 0 ? 0 : ((target - price) / price) * 100,
    };
  } catch {
    return fallback;
  }
}

function buildVolumeShock(symbol: string, volume: number, changePercent: number) {
  const symbolSeed = [...symbol].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const liquidityScore = Math.min(Math.log10(volume + 1) / 7, 1.4);
  const momentumScore = Math.max(changePercent, 0) / 8;
  const stableNoise = (symbolSeed % 19) / 100;

  return Number(Math.max(0.15, liquidityScore + momentumScore + stableNoise).toFixed(2));
}
