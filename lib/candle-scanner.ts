import indiaUniverse from "@/data/market-universe.json";
import { evaluateCandleSignal, type CandleBar, type CandleMarket, type CandleViewResult } from "@/lib/candle-view";
import { readSnapshotFile, writeSnapshotFile } from "@/lib/snapshot-storage";

export type CandleScanSnapshot = {
  asOf: string;
  market: CandleMarket;
  universeName: string;
  universeSize: number;
  evaluated: number;
  unavailable: number;
  shortlisted: CandleViewResult[];
};

type Candidate = { symbol: string; name: string };
type YahooResult = {
  meta?: { longName?: string; shortName?: string };
  timestamp?: number[];
  indicators?: { quote?: Array<{ open?: Array<number | null>; high?: Array<number | null>; low?: Array<number | null>; close?: Array<number | null>; volume?: Array<number | null> }> };
};

const US_SYMBOLS = [
  "AAL", "AAPL", "ABNB", "AMD", "AMZN", "BAC", "CCL", "CLF", "CMCSA", "COIN", "CSCO", "CVS", "DAL", "DIS", "DKNG", "F", "FCX", "GOLD", "GOOGL", "GRAB",
  "HIMS", "HOOD", "HPQ", "INTC", "JD", "KEY", "KHC", "LCID", "LYFT", "MARA", "MRVL", "MU", "NCLH", "NEE", "NIO", "NU", "NVDA", "ON", "OPEN", "ORCL",
  "PARA", "PATH", "PFE", "PINS", "PLTR", "PYPL", "RBLX", "RIG", "RIOT", "RIVN", "ROKU", "SBUX", "SHOP", "SLB", "SMCI", "SNAP", "SOFI", "T", "TGT", "TJX",
  "TSM", "UBER", "VFC", "VZ", "WBD", "WFC", "X", "XPEV", "YUMC", "Z", "AFRM", "APA", "BKR", "C", "CAG", "CHWY", "CPNG", "CVNA", "DBX", "DOCU",
  "DVN", "ET", "EWZ", "GAP", "GM", "HAL", "HBAN", "HPE", "IBIT", "KMI", "LUV", "MGM", "MOS", "NET", "NOK", "OXY", "PCG", "PBR", "QS", "RF",
  "SCHW", "SIRI", "SNOW", "SQ", "TME", "U", "VALE", "WBA", "WMB", "XOM",
];

export async function runCandleScanner(market: CandleMarket): Promise<CandleScanSnapshot> {
  const candidates: Candidate[] = market === "india"
    ? indiaUniverse.map((row) => ({ symbol: `${row.symbol}.NS`, name: row.company || row.symbol }))
    : US_SYMBOLS.map((symbol) => ({ symbol, name: symbol }));
  const results = await mapConcurrent(candidates, 16, (candidate) => scanCandidate(candidate, market));
  const evaluated = results.filter((result) => result !== undefined).length;
  const shortlisted = results
    .filter((result): result is CandleViewResult => Boolean(result && result.signalBias !== "NO TRADE"))
    .sort((a, b) => b.volumeMultiple - a.volumeMultiple || a.wickPercent - b.wickPercent)
    .slice(0, 10);
  const snapshot: CandleScanSnapshot = {
    asOf: new Date().toISOString(), market,
    universeName: market === "india" ? "Configured NSE cash universe" : "Liquid US momentum universe",
    universeSize: candidates.length, evaluated, unavailable: candidates.length - evaluated, shortlisted,
  };
  await writeSnapshotFile(snapshotFile(market), JSON.stringify(snapshot, null, 2));
  return snapshot;
}

export async function readCandleScan(market: CandleMarket): Promise<CandleScanSnapshot | null> {
  const raw = await readSnapshotFile(snapshotFile(market));
  if (!raw) return null;
  try {
    const snapshot = JSON.parse(raw) as CandleScanSnapshot;
    return { ...snapshot, shortlisted: (snapshot.shortlisted || []).slice(0, 10) };
  } catch { return null; }
}

async function scanCandidate(candidate: Candidate, market: CandleMarket): Promise<CandleViewResult | undefined> {
  try {
    const chart = await fetchChart(candidate.symbol);
    const bars = toBars(chart);
    const timeZone = market === "india" ? "Asia/Kolkata" : "America/New_York";
    const byDate = new Map<string, number>();
    for (const bar of bars) {
      const date = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(bar.timestamp * 1000));
      byDate.set(date, (byDate.get(date) || 0) + bar.volume);
    }
    const dailyVolumes = [...byDate.values()].slice(-11, -1);
    return evaluateCandleSignal({
      symbol: candidate.symbol.replace(/\.NS$/, ""),
      name: chart.meta?.longName || chart.meta?.shortName || candidate.name,
      market, bars15m: bars, dailyVolumes,
    });
  } catch { return undefined; }
}

async function fetchChart(symbol: string): Promise<YahooResult> {
  const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=15m&includePrePost=false`, {
    headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store", signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error("Market data unavailable");
  const payload = await response.json() as { chart?: { result?: YahooResult[] } };
  const result = payload.chart?.result?.[0];
  if (!result) throw new Error("No chart result");
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

async function mapConcurrent<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

function snapshotFile(market: CandleMarket) { return `candle_view_${market}.json`; }
