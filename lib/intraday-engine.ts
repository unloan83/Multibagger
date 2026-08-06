import { readSnapshotFile, writeSnapshotFile } from "@/lib/snapshot-storage";

export type IntradaySlot = "09:08" | "10:45" | "13:45";

export type IntradayPick = {
  symbol: string; name: string; price: number; previousClose: number; changePercent: number;
  rvol: number; vwap: number; vwapDistancePercent: number; orbHigh: number; orbLow: number;
  orbStatus: "ORB Breakout Above" | "VWAP Bounce" | "Intraday Momentum";
  rsi5m: number; macdHistogram: number; atr: number; target: number; stopLoss: number;
  upside: number; score: number; action: "BUY"; theme: string; sector: string;
  marketCapCategory: string; agentRationale: string; executionSlot: IntradaySlot;
};

export type ScreenedIntradayStock = {
  symbol: string; price: number; changePercent: number; volume: number;
  status: "BUY" | "REJECTED" | "DATA_UNAVAILABLE"; reasons: string[];
};

export type IntradaySnapshot = {
  asOf: string; slot: IntradaySlot; slotLabel: string; source: "NSE_LIVE_YAHOO_INTRADAY" | "UNAVAILABLE";
  isLive: boolean; reason: string | null; evaluatedUniverseSize: number;
  marketBreadth: { advancers: number; decliners: number; advanceDeclineRatio: number };
  indexTrend: { nifty50ChangePercent: number | null; bankNiftyChangePercent: number | null; trend: "Bullish" | "Neutral" | "Bearish" | "Unavailable" };
  screened: ScreenedIntradayStock[]; picks: IntradayPick[];
};

const INTRADAY_SNAPSHOT_FILE = "intraday_recommendations.json";
const MIN_PRICE = 150;
const MAX_PRICE = 3_000;
const MIN_VOLUME = 100_000;

export const INTRADAY_SLOT_DESCRIPTIONS: Record<IntradaySlot, { label: string; timeIST: string; objective: string }> = {
  "09:08": { label: "Slot 1: Pre-Market & Opening Range Breakout", timeIST: "9:08 AM IST", objective: "Discover the live NSE leaders and wait for a confirmed 15-minute opening range." },
  "10:45": { label: "Slot 2: Mid-Morning Volume & VWAP Confirmation", timeIST: "10:45 AM IST", objective: "Require live price, volume, VWAP, RVOL and 5-minute momentum confirmation." },
  "13:45": { label: "Slot 3: Afternoon Trend Acceleration & Closing Rally", timeIST: "1:45 PM IST", objective: "Retest live NSE leaders for an intact intraday continuation setup." },
};

type NseMover = { symbol?: string; series?: string; ltp?: number | string; prev_price?: number | string; net_price?: number | string; trade_quantity?: number | string };
type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number };
type YahooChartPayload = { chart?: { result?: Array<{ meta?: { longName?: string; shortName?: string }; timestamp?: number[]; indicators?: { quote?: Array<{ open?: unknown[]; high?: unknown[]; low?: unknown[]; close?: unknown[]; volume?: unknown[] }> } }> } };

export async function runIntradayPipeline(slot: IntradaySlot = "09:08"): Promise<IntradaySnapshot> {
  const [gainers, losers, nifty, bankNifty] = await Promise.all([
    loadNseMovers("gainers"), loadNseMovers("loosers"), loadIndexChange("%5ENSEI"), loadIndexChange("%5ENSEBANK"),
  ]);
  const eligible = gainers.filter((row) => row.series === "EQ" && num(row.ltp) >= MIN_PRICE && num(row.ltp) <= MAX_PRICE && num(row.trade_quantity) >= MIN_VOLUME);
  const results = await Promise.all(eligible.map((row) => analyseMover(row, slot)));
  const screened = results.map((result) => result.screened);
  const picks = results.flatMap((result) => result.pick ? [result.pick] : []).sort((a, b) => b.score - a.score).slice(0, 10);
  const advancers = gainers.length;
  const decliners = losers.length;
  const indexValues = [nifty, bankNifty].filter((value): value is number => value !== null);
  const averageIndexChange = indexValues.length ? indexValues.reduce((sum, value) => sum + value, 0) / indexValues.length : null;
  const snapshot: IntradaySnapshot = {
    asOf: new Date().toISOString(), slot, slotLabel: INTRADAY_SLOT_DESCRIPTIONS[slot].label,
    source: "NSE_LIVE_YAHOO_INTRADAY", isLive: true, reason: picks.length ? null : "The live NSE leaders were evaluated, but none cleared every momentum gate.", evaluatedUniverseSize: eligible.length,
    marketBreadth: { advancers, decliners, advanceDeclineRatio: decliners ? round(advancers / decliners) : 0 },
    indexTrend: { nifty50ChangePercent: nifty, bankNiftyChangePercent: bankNifty, trend: averageIndexChange === null ? "Unavailable" : averageIndexChange > .25 ? "Bullish" : averageIndexChange < -.25 ? "Bearish" : "Neutral" },
    screened, picks,
  };
  await writeSnapshotFile(INTRADAY_SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2));
  return snapshot;
}

export async function readIntradayRecommendations(): Promise<IntradaySnapshot> {
  try {
    const raw = await readSnapshotFile(INTRADAY_SNAPSHOT_FILE);
    if (raw) {
      const data = JSON.parse(raw) as IntradaySnapshot;
      const age = Date.now() - Date.parse(data.asOf);
      if (data.source === "NSE_LIVE_YAHOO_INTRADAY" && data.isLive === true && Number.isFinite(age) && age >= 0 && age < 20 * 60_000) return data;
    }
  } catch { /* A missing or legacy snapshot must never become a recommendation. */ }
  try { return await runIntradayPipeline(currentSlot()); }
  catch (error) {
    const slot = currentSlot();
    return { asOf: new Date().toISOString(), slot, slotLabel: INTRADAY_SLOT_DESCRIPTIONS[slot].label,
      source: "UNAVAILABLE", isLive: false, reason: error instanceof Error ? error.message : "Live market feeds are unavailable.",
      evaluatedUniverseSize: 0, marketBreadth: { advancers: 0, decliners: 0, advanceDeclineRatio: 0 },
      indexTrend: { nifty50ChangePercent: null, bankNiftyChangePercent: null, trend: "Unavailable" }, screened: [], picks: [] };
  }
}

async function loadNseMovers(index: "gainers" | "loosers"): Promise<NseMover[]> {
  const response = await fetch(`https://www.nseindia.com/api/live-analysis-variations?index=${index}`, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json", Referer: "https://www.nseindia.com/market-data/top-gainers-losers" },
    cache: "no-store", signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`NSE ${index} feed returned ${response.status}`);
  const payload = await response.json() as { allSec?: { data?: NseMover[] } };
  if (!Array.isArray(payload.allSec?.data)) throw new Error(`NSE ${index} feed did not contain live rows`);
  return payload.allSec.data;
}

async function analyseMover(row: NseMover, slot: IntradaySlot): Promise<{ screened: ScreenedIntradayStock; pick: IntradayPick | null }> {
  const symbol = String(row.symbol || "").trim();
  const price = num(row.ltp); const previousClose = num(row.prev_price); const changePercent = num(row.net_price); const volume = num(row.trade_quantity);
  const base = { symbol, price, changePercent, volume };
  try {
    const chart = await loadChart(`${encodeURIComponent(symbol)}.NS`);
    const bars = chart.bars;
    if (bars.length < 20) throw new Error("insufficient 5-minute history");
    const sessionKey = indiaDate(bars.at(-1)!.time);
    const session = bars.filter((bar) => indiaDate(bar.time) === sessionKey);
    if (session.length < 4) throw new Error("opening range is incomplete");
    const priorSessions = [...new Set(bars.map((bar) => indiaDate(bar.time)).filter((day) => day !== sessionKey))];
    const comparableVolumes = priorSessions.map((day) => bars.filter((bar) => indiaDate(bar.time) === day).slice(0, session.length).reduce((sum, bar) => sum + bar.volume, 0)).filter(Boolean);
    const historicalAverage = comparableVolumes.length ? comparableVolumes.reduce((sum, value) => sum + value, 0) / comparableVolumes.length : 0;
    const rvol = historicalAverage ? volume / historicalAverage : 0;
    const cumulativeVolume = session.reduce((sum, bar) => sum + bar.volume, 0);
    const vwap = cumulativeVolume ? session.reduce((sum, bar) => sum + ((bar.high + bar.low + bar.close) / 3) * bar.volume, 0) / cumulativeVolume : 0;
    const opening = session.slice(0, 3); const orbHigh = Math.max(...opening.map((bar) => bar.high)); const orbLow = Math.min(...opening.map((bar) => bar.low));
    const closes = bars.map((bar) => bar.close); const rsi5m = rsi(closes, 14); const macdHistogram = macd(closes); const atr = averageTrueRange(bars, 14);
    const reasons: string[] = [];
    if (!(price > vwap)) reasons.push("price is not above live VWAP");
    if (!(price >= orbHigh)) reasons.push("15-minute opening range has not broken/held");
    if (!(rvol >= .8)) reasons.push("relative volume is below 0.8x");
    if (!(rsi5m >= 52 && rsi5m <= 82)) reasons.push("5-minute RSI is outside 52–82");
    if (!(macdHistogram >= 0)) reasons.push("5-minute MACD momentum is negative");
    if (!(changePercent >= 2)) reasons.push("day gain is below 2%");
    if (reasons.length) return { screened: { ...base, status: "REJECTED", reasons }, pick: null };
    const vwapDistancePercent = ((price - vwap) / vwap) * 100;
    const score = Math.min(100, Math.round(45 + Math.min(changePercent, 15) * 1.4 + Math.min(rvol, 4) * 5 + Math.min(Math.max(rsi5m - 52, 0), 15) * .5 + (macdHistogram >= 0 ? 8 : 0)));
    const target = round(price * 1.03);
    const stopLoss = round(Math.min(price * .98, Math.max(vwap || 0, price - atr * 1.5)));
    const pick: IntradayPick = {
      symbol, name: chart.name || symbol, price, previousClose, changePercent: round(changePercent), rvol: round(rvol), vwap: round(vwap),
      vwapDistancePercent: round(vwapDistancePercent), orbHigh: round(orbHigh), orbLow: round(orbLow), orbStatus: "ORB Breakout Above",
      rsi5m: round(rsi5m), macdHistogram: round(macdHistogram), atr: round(atr), target, stopLoss,
      upside: round(((target - price) / price) * 100), score, action: "BUY", theme: "Live NSE momentum", sector: "NSE Equity",
      marketCapCategory: "Live screened", executionSlot: slot,
      agentRationale: `Live NSE gainer with ${volume.toLocaleString("en-IN")} shares traded, ${round(rvol)}x RVOL, price ${round(vwapDistancePercent)}% above VWAP and a held 15-minute opening-range breakout.`,
    };
    return { screened: { ...base, status: "BUY", reasons: [] }, pick };
  } catch (error) {
    return { screened: { ...base, status: "DATA_UNAVAILABLE", reasons: [error instanceof Error ? error.message : "live chart unavailable"] }, pick: null };
  }
}

async function loadChart(symbol: string): Promise<{ name: string; bars: Bar[] }> {
  const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=5d&interval=5m&includePrePost=false`, { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`intraday quote returned ${response.status}`);
  const payload = await response.json() as YahooChartPayload; const result = payload.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0]; const timestamps: number[] = result?.timestamp || [];
  const bars = timestamps.map((time, index) => ({ time, open: num(quote?.open?.[index]), high: num(quote?.high?.[index]), low: num(quote?.low?.[index]), close: num(quote?.close?.[index]), volume: num(quote?.volume?.[index]) })).filter((bar) => bar.open && bar.high && bar.low && bar.close);
  return { name: result?.meta?.longName || result?.meta?.shortName || symbol.replace(".NS", ""), bars };
}

async function loadIndexChange(symbol: string): Promise<number | null> {
  try { const chart = await loadChart(symbol); const closes = chart.bars.map((bar) => bar.close); if (closes.length < 2) return null; return round(((closes.at(-1)! - closes[0]) / closes[0]) * 100); } catch { return null; }
}

function rsi(values: number[], period: number) { const changes = values.slice(-period - 1).slice(1).map((value, index) => value - values.slice(-period - 1)[index]); if (changes.length < period) return 0; const gains = changes.reduce((s, v) => s + Math.max(v, 0), 0) / period; const losses = changes.reduce((s, v) => s + Math.max(-v, 0), 0) / period; return losses ? 100 - 100 / (1 + gains / losses) : 100; }
function ema(values: number[], period: number) { if (!values.length) return 0; const k = 2 / (period + 1); return values.slice(1).reduce((value, next) => next * k + value * (1 - k), values[0]); }
function macd(values: number[]) { if (values.length < 35) return 0; const series = values.map((_, index) => ema(values.slice(0, index + 1), 12) - ema(values.slice(0, index + 1), 26)); return series.at(-1)! - ema(series.slice(-9), 9); }
function averageTrueRange(bars: Bar[], period: number) { const sample = bars.slice(-period - 1); const ranges = sample.slice(1).map((bar, index) => Math.max(bar.high - bar.low, Math.abs(bar.high - sample[index].close), Math.abs(bar.low - sample[index].close))); return ranges.length ? ranges.reduce((sum, value) => sum + value, 0) / ranges.length : 0; }
function indiaDate(timestamp: number) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(timestamp * 1000)); }
function currentSlot(): IntradaySlot { const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(); const minutes = num(parts.find((part) => part.type === "hour")?.value) * 60 + num(parts.find((part) => part.type === "minute")?.value); return minutes >= 13 * 60 + 45 ? "13:45" : minutes >= 10 * 60 + 45 ? "10:45" : "09:08"; }
function num(value: unknown) { const parsed = typeof value === "string" ? Number(value.replace(/,/g, "")) : Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function round(value: number) { return Math.round(value * 100) / 100; }
