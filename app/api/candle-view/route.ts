import { NextResponse } from "next/server";
import { evaluateCandleSignal, type CandleBar, type CandleMarket } from "@/lib/candle-view";
import { RECOMMENDATION_PUBLICATION } from "@/lib/recommendation-publication";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type YahooResult = {
  meta?: { longName?: string; shortName?: string };
  timestamp?: number[];
  indicators?: { quote?: Array<{ open?: Array<number | null>; high?: Array<number | null>; low?: Array<number | null>; close?: Array<number | null>; volume?: Array<number | null> }> };
};

export async function GET(request: Request) {
  if (!RECOMMENDATION_PUBLICATION.enabled) return NextResponse.json({ ok: false, publication: RECOMMENDATION_PUBLICATION, error: RECOMMENDATION_PUBLICATION.reason }, { status: 423 });
  const params = new URL(request.url).searchParams;
  const market: CandleMarket = params.get("market") === "us" ? "us" : "india";
  const rawSymbol = (params.get("symbol") || "").trim().toUpperCase().replace(/[^A-Z0-9.\-^]/g, "");
  if (!rawSymbol) return NextResponse.json({ ok: false, error: "Enter a stock ticker to evaluate." }, { status: 400 });
  const symbol = market === "india" && !rawSymbol.endsWith(".NS") ? `${rawSymbol}.NS` : rawSymbol;

  try {
    const [intraday, daily] = await Promise.all([fetchChart(symbol, "1mo", "15m"), fetchChart(symbol, "1mo", "1d")]);
    const bars15m = toBars(intraday);
    const dailyVolumes = daily.indicators?.quote?.[0]?.volume?.filter((value): value is number => typeof value === "number") || [];
    const result = evaluateCandleSignal({ symbol: rawSymbol.replace(/\.NS$/, ""), name: intraday.meta?.longName || intraday.meta?.shortName, market, bars15m, dailyVolumes });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Candle evaluation failed." }, { status: 422 });
  }
}

async function fetchChart(symbol: string, range: string, interval: string): Promise<YahooResult> {
  const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`, {
    headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store", signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Market data is unavailable for ${symbol}.`);
  const payload = await response.json() as { chart?: { result?: YahooResult[]; error?: { description?: string } } };
  const result = payload.chart?.result?.[0];
  if (!result) throw new Error(payload.chart?.error?.description || `No market data found for ${symbol}.`);
  return result;
}

function toBars(result: YahooResult): CandleBar[] {
  const quote = result.indicators?.quote?.[0];
  return (result.timestamp || []).flatMap((timestamp, index) => {
    const open = quote?.open?.[index], high = quote?.high?.[index], low = quote?.low?.[index], close = quote?.close?.[index];
    if ([open, high, low, close].some((value) => typeof value !== "number")) return [];
    return [{ timestamp, open: open!, high: high!, low: low!, close: close!, volume: quote?.volume?.[index] || 0 }];
  });
}
