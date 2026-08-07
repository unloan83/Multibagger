import { NextResponse } from "next/server";
import { readSnapshotFile, writeSnapshotFile } from "@/lib/snapshot-storage";
import { RECOMMENDATION_PUBLICATION } from "@/lib/recommendation-publication";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type WatchlistRecommendation = {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  notes: string;
};

type Market = "india" | "us";

function watchlistFile(market: Market) {
  return market === "us" ? "us_watchlist.json" : "watchlist.json";
}

async function getWatchlistSymbols(market: Market): Promise<string[]> {
  try {
    const raw = await readSnapshotFile(watchlistFile(market));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { symbols?: string[] };
    return parsed.symbols || [];
  } catch {
    return [];
  }
}

async function saveWatchlistSymbols(market: Market, symbols: string[]): Promise<void> {
  const data = JSON.stringify({ symbols: Array.from(new Set(symbols)) }, null, 2);
  await writeSnapshotFile(watchlistFile(market), data);
}

export async function GET(request: Request) {
  try {
    const market = getMarket(new URL(request.url).searchParams.get("market"));
    const symbols = await getWatchlistSymbols(market);
    const holdings = await fetchWatchlistRecommendations(symbols);
    return NextResponse.json({ ok: true, publication: RECOMMENDATION_PUBLICATION, holdings });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err), holdings: [] },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { symbol?: string; market?: string };
    const market = getMarket(body.market);
    let symbol = (body.symbol || "").trim().toUpperCase();
    if (!symbol) {
      return NextResponse.json({ ok: false, error: "Stock symbol is required" }, { status: 400 });
    }

    if (market === "india" && !symbol.includes(".")) {
      symbol = `${symbol}.NS`;
    }

    const symbols = await getWatchlistSymbols(market);
    if (!symbols.includes(symbol)) {
      symbols.push(symbol);
      await saveWatchlistSymbols(market, symbols);
    }

    const holdings = await fetchWatchlistRecommendations(symbols);
    return NextResponse.json({ ok: true, publication: RECOMMENDATION_PUBLICATION, holdings });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as { symbol?: string; market?: string };
    const market = getMarket(body.market);
    const rawSymbol = (body.symbol || "").trim().toUpperCase();
    if (!rawSymbol) {
      return NextResponse.json({ ok: false, error: "Stock symbol is required" }, { status: 400 });
    }

    let symbols = await getWatchlistSymbols(market);
    symbols = symbols.filter(
      (s) => s.toUpperCase() !== rawSymbol && s.replace(".NS", "").toUpperCase() !== rawSymbol
    );

    await saveWatchlistSymbols(market, symbols);

    const holdings = await fetchWatchlistRecommendations(symbols);
    return NextResponse.json({ ok: true, publication: RECOMMENDATION_PUBLICATION, holdings });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 }
    );
  }
}

async function fetchWatchlistRecommendations(symbols: string[]): Promise<WatchlistRecommendation[]> {
  const results = await Promise.allSettled(
    symbols.map(async (fullSymbol) => {
      const cleanSymbol = fullSymbol.replace(".NS", "").toUpperCase();
      let price = 0;
      let previousClose = 0;
      let changePercent = 0;
      let name = cleanSymbol;

      try {
        const response = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(fullSymbol)}?range=2d&interval=1d`,
          { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8_000) }
        );
        if (response.ok) {
          const data = (await response.json()) as {
            chart?: {
              result?: Array<{
                meta?: {
                  regularMarketPrice?: number;
                  previousClose?: number;
                  chartPreviousClose?: number;
                  shortName?: string;
                  longName?: string;
                };
              }>;
            };
          };
          const meta = data.chart?.result?.[0]?.meta;
          if (meta) {
            price = meta.regularMarketPrice ?? 0;
            previousClose = meta.previousClose ?? meta.chartPreviousClose ?? 0;
            if (previousClose > 0 && price > 0) {
              changePercent = ((price - previousClose) / previousClose) * 100;
            }
            name = meta.longName ?? meta.shortName ?? cleanSymbol;
          }
        }
      } catch {
        // fallback
      }

      if (!(price > 0) || !(previousClose > 0)) throw new Error(`Live quote unavailable for ${cleanSymbol}`);

      const notes = "Live quote only; recommendation publishing is withheld.";

      return {
        symbol: cleanSymbol,
        name,
        price,
        changePercent,
        notes,
      } as WatchlistRecommendation;
    })
  );

  return results
    .filter((r) => r.status === "fulfilled" && r.value !== null)
    .map((r) => (r as PromiseFulfilledResult<WatchlistRecommendation>).value);
}

function getMarket(value: string | null | undefined): Market {
  return value?.toLowerCase() === "us" ? "us" : "india";
}
