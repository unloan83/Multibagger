import { NextResponse } from "next/server";
import { readWealthRecommendationsSnapshot, type ExpertQuote } from "@/lib/expert-insights";
import { readSnapshotFile, writeSnapshotFile } from "@/lib/snapshot-storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type WatchlistRecommendation = {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  // Intraday recommendation
  intradayAction: "BUY" | "ACCUMULATE" | "WATCH" | "HOLD";
  intradayTarget: number;
  intradayUpside: number;
  // Long-term recommendation (3-6 Months)
  longTermAction: "BUY" | "ACCUMULATE" | "WATCH" | "HOLD";
  longTermTarget: number;
  longTermUpside: number;
  isMultibagger: boolean;
  notes: string;
};

const WATCHLIST_FILE = "watchlist.json";

async function getWatchlistSymbols(): Promise<string[]> {
  try {
    const raw = await readSnapshotFile(WATCHLIST_FILE);
    if (!raw) return ["RELIANCE.NS", "TCS.NS", "INFY.NS"];
    const parsed = JSON.parse(raw) as { symbols?: string[] };
    return parsed.symbols || [];
  } catch {
    return ["RELIANCE.NS", "TCS.NS", "INFY.NS"];
  }
}

async function saveWatchlistSymbols(symbols: string[]): Promise<void> {
  const data = JSON.stringify({ symbols: Array.from(new Set(symbols)) }, null, 2);
  await writeSnapshotFile(WATCHLIST_FILE, data);
}

export async function GET() {
  try {
    const symbols = await getWatchlistSymbols();
    const holdings = await fetchWatchlistRecommendations(symbols);
    return NextResponse.json({ ok: true, holdings });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err), holdings: [] },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { symbol?: string };
    let symbol = (body.symbol || "").trim().toUpperCase();
    if (!symbol) {
      return NextResponse.json({ ok: false, error: "Stock symbol is required" }, { status: 400 });
    }

    if (!symbol.includes(".")) {
      symbol = `${symbol}.NS`;
    }

    const symbols = await getWatchlistSymbols();
    if (!symbols.includes(symbol)) {
      symbols.push(symbol);
      await saveWatchlistSymbols(symbols);
    }

    const holdings = await fetchWatchlistRecommendations(symbols);
    return NextResponse.json({ ok: true, holdings });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as { symbol?: string };
    const rawSymbol = (body.symbol || "").trim().toUpperCase();
    if (!rawSymbol) {
      return NextResponse.json({ ok: false, error: "Stock symbol is required" }, { status: 400 });
    }

    let symbols = await getWatchlistSymbols();
    symbols = symbols.filter(
      (s) => s.toUpperCase() !== rawSymbol && s.replace(".NS", "").toUpperCase() !== rawSymbol
    );

    await saveWatchlistSymbols(symbols);

    const holdings = await fetchWatchlistRecommendations(symbols);
    return NextResponse.json({ ok: true, holdings });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 }
    );
  }
}

async function fetchWatchlistRecommendations(symbols: string[]): Promise<WatchlistRecommendation[]> {
  const snapshotLookup = new Map<string, ExpertQuote>();
  try {
    const snapshot = await readWealthRecommendationsSnapshot();
    if (snapshot?.categories) {
      for (const cat of snapshot.categories) {
        for (const item of cat.longTermUpsides || []) {
          snapshotLookup.set(item.symbol.toUpperCase(), item);
        }
        for (const item of cat.intradayBreakouts || []) {
          if (!snapshotLookup.has(item.symbol.toUpperCase())) {
            snapshotLookup.set(item.symbol.toUpperCase(), item);
          }
        }
      }
    }
  } catch {
    // fallback
  }

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

      // Check if stock is in current recommendations snapshot
      const match = snapshotLookup.get(cleanSymbol);

      let intradayAction: "BUY" | "ACCUMULATE" | "WATCH" | "HOLD" = "WATCH";
      let intradayTarget = price > 0 ? Math.round(price * 1.03 * 10) / 10 : 0;
      let intradayUpside = 3.0;

      let longTermAction: "BUY" | "ACCUMULATE" | "WATCH" | "HOLD" = "ACCUMULATE";
      let longTermTarget = price > 0 ? Math.round(price * 1.25 * 10) / 10 : 0;
      let longTermUpside = 25.0;
      let notes = "Fundamental accumulation watch | Horizon: 3-6 Months";

      if (match) {
        if (match.target && match.target > 0) {
          longTermTarget = match.target;
          if (price > 0) {
            longTermUpside = Math.round(((match.target - price) / price) * 1000) / 10;
          }
        }
        if (match.action) {
          longTermAction = match.action === "Accumulate" ? "BUY" : "WATCH";
        }
        if (match.remark) {
          notes = match.remark;
        }
      }

      // Calculate intraday targets based on momentum/change
      if (changePercent > 1.5) {
        intradayAction = "BUY";
        intradayTarget = Math.round(price * 1.04 * 10) / 10;
        intradayUpside = 4.0;
      } else if (changePercent < -1.5) {
        intradayAction = "HOLD";
        intradayTarget = price;
        intradayUpside = 0;
      }

      const isMultibagger = longTermUpside >= 100 || (longTermTarget >= 2 * price && price > 0);

      return {
        symbol: cleanSymbol,
        name,
        price,
        changePercent,
        intradayAction,
        intradayTarget,
        intradayUpside,
        longTermAction,
        longTermTarget,
        longTermUpside,
        isMultibagger,
        notes,
      } as WatchlistRecommendation;
    })
  );

  return results
    .filter((r) => r.status === "fulfilled" && r.value !== null)
    .map((r) => (r as PromiseFulfilledResult<WatchlistRecommendation>).value);
}
