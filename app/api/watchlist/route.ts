import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type WatchlistHolding = {
  symbol: string;
  price: number;
  changePercent: number;
  name: string;
};

export async function GET() {
  try {
    const jsonPath = path.join(process.cwd(), "data", "watchlist.json");
    const raw = await fs.readFile(jsonPath, "utf8");
    const { symbols } = JSON.parse(raw) as { symbols: string[] };

    const holdings = await fetchWatchlistPrices(symbols);

    return NextResponse.json({ ok: true, holdings });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err), holdings: [] },
      { status: 200 },
    );
  }
}

async function fetchWatchlistPrices(symbols: string[]): Promise<WatchlistHolding[]> {
  const results = await Promise.allSettled(
    symbols.map(async (symbol) => {
      const response = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2d&interval=1d`,
        { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8_000) },
      );
      if (!response.ok) return null;
      const data = (await response.json()) as {
        chart?: { result?: Array<{ meta?: Record<string, unknown> }> };
      };
      const meta = data.chart?.result?.[0]?.meta as
        | { regularMarketPrice?: number; previousClose?: number; shortName?: string; longName?: string }
        | undefined;
      if (!meta) return null;
      const price = meta.regularMarketPrice ?? 0;
      const previousClose = meta.previousClose ?? meta.chartPreviousClose ?? 0;
      const changePercent =
        previousClose > 0 && price > 0
          ? ((price - previousClose) / previousClose) * 100
          : 0;

      return {
        symbol: symbol.replace(".NS", ""),
        price,
        changePercent,
        name: meta.longName ?? meta.shortName ?? symbol,
      };
    }),
  );

  return results
    .filter((r) => r.status === "fulfilled" && r.value !== null)
    .map((r) => (r as PromiseFulfilledResult<WatchlistHolding>).value);
}
