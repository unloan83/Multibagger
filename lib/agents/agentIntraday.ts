import YahooFinance from "yahoo-finance2";
import type {
  AgentInfoOutput,
  AgentIntradayOutput,
  AgentMacroPolicyOutput,
  AgentWealthUniverseOutput,
  IntradayMetrics,
} from "@/lib/agents/types";
import { clamp, normalizeSymbol } from "@/lib/agents/utils";
import type { ManagedPortfolio } from "@/lib/portfolio";

const yf = new YahooFinance();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** NSE market open hour in UTC (09:15 IST = 03:45 UTC). */
const NSE_OPEN_UTC_HOUR = 3;
const NSE_OPEN_UTC_MIN = 45;

/** Gap threshold — below this it's considered "flat". */
const GAP_FLAT_THRESHOLD_PCT = 0.5;

/** Minimum acceptable dynamic risk:reward ratio. */
const MIN_DYNAMIC_RR = 1.5;

/** Within this % of a NSE circuit limit the stock is flagged as near-circuit. */
const CIRCUIT_PROXIMITY_PCT = 1.0;

/** NSE daily circuit limits. */
const CIRCUIT_LIMITS = [5, 10, 20];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function agentIntraday(
  portfolio: ManagedPortfolio,
  info: AgentInfoOutput,
  macroPolicy: AgentMacroPolicyOutput,
  wealthUniverse: AgentWealthUniverseOutput | undefined,
  now = new Date(),
): Promise<AgentIntradayOutput> {

  // --- Build 3-pool symbol list ---
  const portfolioSymbols = portfolio.positions
    .map((p) => normalizeSymbol(p.symbol))
    .filter(Boolean)
    .slice(0, 30);

  // Universe intraday breakout picks (from wealth_recommendations.json cap-bucket screen)
  const universeSymbols = (wealthUniverse?.byBucket
    ? [
        ...wealthUniverse.byBucket.large.intraday,
        ...wealthUniverse.byBucket.mid.intraday,
        ...wealthUniverse.byBucket.small.intraday,
      ]
    : wealthUniverse?.candidates.filter((c) => c.timeframe === "Intraday") ?? []
  )
    .map((c) => c.symbol)
    .filter(Boolean)
    .slice(0, 15);

  // Build a combined deduplicated symbol set with source tracking
  const symbolSourceMap = new Map<string, "portfolio" | "universe">();
  for (const sym of portfolioSymbols) symbolSourceMap.set(sym, "portfolio");
  for (const sym of universeSymbols) {
    if (!symbolSourceMap.has(sym)) symbolSourceMap.set(sym, "universe");
  }

  const allSymbols = [...symbolSourceMap.keys()];

  // Build sector lookup from portfolio positions + universe candidates
  const sectorBySymbol = new Map<string, string>();
  for (const pos of portfolio.positions) {
    if (pos.sector) sectorBySymbol.set(normalizeSymbol(pos.symbol), pos.sector);
  }
  for (const c of wealthUniverse?.candidates ?? []) {
    if (!sectorBySymbol.has(c.symbol)) sectorBySymbol.set(c.symbol, c.sector);
  }

  // ---------------------------------------------------------------------------
  // Fetch and score
  // ---------------------------------------------------------------------------

  const results = await Promise.allSettled(
    allSymbols.map(async (symbol) => {
      const chart = await yf.chart(symbol, {
        period1: new Date(now.getTime() - 3 * 86_400_000),
        period2: now,
        interval: "15m",
      });

      const rawQuotes = chart?.quotes ?? [];
      if (rawQuotes.length < 10) return null;

      // Separate today's candles from the rest
      const todayStart = getMarketOpenTime(now);
      const todayQuotes = rawQuotes.filter(
        (q) => q.date && new Date(q.date).getTime() >= todayStart.getTime(),
      );
      const prevQuotes = rawQuotes.filter(
        (q) => q.date && new Date(q.date).getTime() < todayStart.getTime(),
      );

      const prices = rawQuotes.map((q) => q.close).filter((p): p is number => p !== null && p > 0);
      const volumes = rawQuotes.map((q) => q.volume).filter((v): v is number => v !== null);
      if (prices.length < 10) return null;

      const todayPrices = todayQuotes.map((q) => q.close).filter((p): p is number => p !== null && p > 0);
      const todayVolumes = todayQuotes.map((q) => q.volume).filter((v): v is number => v !== null);

      const infoSignal = info.byStock[symbol];
      const sector = sectorBySymbol.get(symbol) ?? "";
      const sectorSignal = macroPolicy.sectors.find((s) => s.sector === sector);
      const source = symbolSourceMap.get(symbol) ?? "portfolio";

      const metrics = computeIntradayMetrics(
        prices,
        volumes,
        todayPrices,
        todayVolumes,
        prevQuotes,
        rawQuotes,
        sectorSignal?.score ?? null,
        source,
      );

      // Skip stocks near circuit limits
      if (metrics.isNearCircuit) {
        return {
          symbol,
          metrics,
          score: clamp(-3, -5, 5),
          confidence: 10,
          reasons: [`Skipped: price within ${CIRCUIT_PROXIMITY_PCT}% of a NSE circuit limit.`],
        };
      }

      // Skip if dynamic R:R is below minimum (unless no ORB data yet)
      const rrOk = metrics.dynamicRR === null || metrics.dynamicRR >= MIN_DYNAMIC_RR;
      const score = rrOk
        ? scoreIntraday(metrics, infoSignal, symbol)
        : clamp(scoreIntraday(metrics, infoSignal, symbol) - 1.5, -5, 5);

      const confidence = intradayConfidence(metrics, prices.length);
      const reasons = buildIntradayReasons(metrics, score, infoSignal, symbol);

      return { symbol, metrics, score, confidence, reasons };
    }),
  );

  const byStock: AgentIntradayOutput["byStock"] = {};
  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      byStock[result.value.symbol] = {
        metrics: result.value.metrics,
        score: result.value.score,
        confidence: result.value.confidence,
        reasons: result.value.reasons,
      };
    }
  }

  const scored = Object.values(byStock);
  const avgScore = scored.length
    ? scored.reduce((s, item) => s + item.score, 0) / scored.length
    : 0;
  const portfolioCount = allSymbols.filter((s) => symbolSourceMap.get(s) === "portfolio").length;
  const universeCount = allSymbols.filter((s) => symbolSourceMap.get(s) === "universe").length;

  return {
    agent: "Intraday",
    generatedAt: now.toISOString(),
    byStock,
    summary: scored.length
      ? `${scored.length} stocks scored for intraday (${portfolioCount} portfolio, ${universeCount} universe); avg score ${avgScore.toFixed(1)}/5.`
      : "No intraday data available.",
  };
}

// ---------------------------------------------------------------------------
// Metrics computation
// ---------------------------------------------------------------------------

function computeIntradayMetrics(
  allPrices: number[],
  allVolumes: number[],
  todayPrices: number[],
  todayVolumes: number[],
  prevQuotes: Array<{ close?: number | null }>,
  rawQuotes: Array<{ open?: number | null; high?: number | null; low?: number | null; close?: number | null; volume?: number | null }>,
  sectorScore: number | null,
  source: "portfolio" | "universe" | "mover",
): IntradayMetrics {
  const lastPrice = allPrices.at(-1) ?? 0;
  const prevPrice = allPrices.length >= 2 ? allPrices.at(-2)! : null;
  const openPrice = todayPrices[0] ?? allPrices[0];

  // --- Standard metrics ---
  const rsi14 = allPrices.length >= 16 ? computeRSI(allPrices, 14) : null;
  const shortSMA = allPrices.length >= 10 ? sma(allPrices, 10) : null;
  const atr14 = allPrices.length >= 15 ? computeATR(allPrices, 14) : null;

  const volRecent = allVolumes.slice(-5).reduce((s, v) => s + v, 0) / 5;
  const volPrior = allVolumes.length >= 15
    ? allVolumes.slice(-15, -5).reduce((s, v) => s + v, 0) / 10
    : volRecent;
  const volumeSurge = volPrior > 0 ? volRecent / volPrior : 1;

  const priceChange1h = prevPrice && lastPrice ? ((lastPrice - prevPrice) / prevPrice) * 100 : null;
  const priceChangeOpen = openPrice > 0 ? ((lastPrice - openPrice) / openPrice) * 100 : null;
  const intradayVolatility = atr14 !== null && lastPrice > 0 ? (atr14 / lastPrice) * 100 : null;

  // --- VWAP (today's candles only; fall back to all if today is empty) ---
  const vwapQuotes = todayPrices.length >= 3 ? { prices: todayPrices, volumes: todayVolumes } : { prices: allPrices, volumes: allVolumes };
  const vwap = computeVWAP(rawQuotes, vwapQuotes.prices.length >= 3 ? rawQuotes.slice(-vwapQuotes.prices.length) : rawQuotes);
  const vwapDistancePct = vwap > 0 && lastPrice > 0 ? ((lastPrice - vwap) / vwap) * 100 : null;

  // --- Gap ---
  const prevClose = prevQuotes.length > 0 ? (prevQuotes.at(-1)?.close ?? null) : null;
  const todayOpen = rawQuotes.find((q) => {
    const t = q as { date?: Date | string };
    return t.date && new Date(t.date as string).getHours() <= 5; // rough UTC filter for NSE open
  })?.open ?? null;
  const gapPct = prevClose && prevClose > 0 && todayOpen && todayOpen > 0
    ? ((todayOpen - prevClose) / prevClose) * 100
    : null;
  const gapType: IntradayMetrics["gapType"] = gapPct === null
    ? null
    : gapPct > GAP_FLAT_THRESHOLD_PCT ? "up"
    : gapPct < -GAP_FLAT_THRESHOLD_PCT ? "down"
    : "flat";

  // --- Opening Range Breakout (first 2 × 15m candles = 30 min) ---
  const orbCandles = todayQuotes(rawQuotes).slice(0, 2);
  const orbHigh = orbCandles.length >= 2
    ? Math.max(...orbCandles.map((q) => q.high ?? q.close ?? 0).filter((v) => v > 0))
    : null;
  const orbLow = orbCandles.length >= 2
    ? Math.min(...orbCandles.map((q) => q.low ?? q.close ?? Infinity).filter((v) => v < Infinity))
    : null;
  const priceVsOrb: IntradayMetrics["priceVsOrb"] =
    orbHigh === null || orbLow === null
      ? null
      : lastPrice > orbHigh ? "above"
      : lastPrice < orbLow ? "below"
      : "inside";

  // --- Dynamic R:R ---
  const stopLossDistance = intradayVolatility !== null
    ? clamp(intradayVolatility * 1.2, 0.4, 4)
    : 2;
  // Target: ORB high distance if breaking out, else 2× ATR
  const targetDistance =
    priceVsOrb === "above" && orbHigh !== null && lastPrice > 0
      ? Math.max(((orbHigh - lastPrice) / lastPrice) * 100 + stopLossDistance, stopLossDistance * 1.5)
      : stopLossDistance * 2.0;
  const dynamicRR = stopLossDistance > 0 ? targetDistance / stopLossDistance : null;

  // --- Circuit proximity ---
  const dayChangePct = prevClose && prevClose > 0 && lastPrice > 0
    ? Math.abs(((lastPrice - prevClose) / prevClose) * 100)
    : Math.abs(priceChangeOpen ?? 0);
  const isNearCircuit = CIRCUIT_LIMITS.some(
    (limit) => dayChangePct >= limit - CIRCUIT_PROXIMITY_PCT,
  );

  return {
    rsi14,
    shortSMA,
    atr14,
    volumeSurge,
    priceChange1h,
    priceChangeOpen,
    intradayVolatility,
    lastPrice,
    stopLossDistance,
    targetDistance,
    vwap: vwap > 0 ? vwap : null,
    vwapDistancePct,
    gapPct,
    gapType,
    orbHigh,
    orbLow,
    priceVsOrb,
    dynamicRR,
    isNearCircuit,
    sectorMomentum: sectorScore,
    source,
  };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function scoreIntraday(
  m: IntradayMetrics,
  infoSignal: AgentInfoOutput["byStock"][string] | undefined,
  symbol: string,
): number {
  let score = 0;
  let count = 0;

  // --- ORB breakout (strongest signal) ---
  if (m.priceVsOrb !== null) {
    if (m.priceVsOrb === "above") { score += 1.5; }
    else if (m.priceVsOrb === "below") { score -= 1.0; }
    // "inside" = no signal, score += 0
    count++;
  }

  // --- Gap quality ---
  if (m.gapType !== null) {
    if (m.gapType === "up" && m.volumeSurge !== null && m.volumeSurge > 1.5) { score += 1.5; }
    else if (m.gapType === "up") { score += 0.7; }
    else if (m.gapType === "down" && m.vwapDistancePct !== null && m.vwapDistancePct > 0) {
      score += 1.0; // gap-down but price recovered above VWAP = pullback buy
    } else if (m.gapType === "down") { score -= 0.5; }
    count++;
  }

  // --- VWAP position ---
  if (m.vwapDistancePct !== null) {
    if (m.vwapDistancePct > 0.3 && m.vwapDistancePct < 3) { score += 1.0; }
    else if (m.vwapDistancePct < -1.0) { score += 0.8; } // deep pullback — mean reversion entry
    else if (m.vwapDistancePct > 3) { score -= 1.0; }    // overextended above VWAP
    count++;
  }

  // --- RSI ---
  if (m.rsi14 !== null) {
    if (m.rsi14 < 30) { score += 0.8; }
    else if (m.rsi14 >= 40 && m.rsi14 <= 55) { score += 0.5; } // healthy momentum zone
    else if (m.rsi14 > 75) { score -= 1.0; }
    else if (m.rsi14 > 60) { score -= 0.3; }
    count++;
  }

  // --- Volume surge ---
  if (m.volumeSurge !== null) {
    if (m.volumeSurge > 2) { score += 1.0; }
    else if (m.volumeSurge > 1.3) { score += 0.3; }
    else if (m.volumeSurge < 0.5) { score -= 0.5; }
    count++;
  }

  // --- Sector momentum ---
  if (m.sectorMomentum !== null) {
    score += clamp(m.sectorMomentum * 0.1, -0.5, 0.5);
    count++;
  }

  // --- News ---
  if (infoSignal?.score !== undefined && infoSignal.score !== 0) {
    score += clamp(infoSignal.score * 0.3, -1.0, 1.0);
    count++;
  }

  return count ? clamp((score / count) * 2, -5, 5) : 0;
}

function intradayConfidence(m: IntradayMetrics, dataPoints: number): number {
  let base = clamp(20 + dataPoints * 1.5, 20, 65);
  if (m.volumeSurge !== null && m.volumeSurge > 1.5) base += 8;
  if (m.priceVsOrb !== null) base += 5;   // ORB data available = more confident
  if (m.vwap !== null) base += 5;
  if (m.rsi14 === null) base -= 8;
  return clamp(Math.round(base), 15, 82);
}

function buildIntradayReasons(
  m: IntradayMetrics,
  score: number,
  infoSignal: AgentInfoOutput["byStock"][string] | undefined,
  _symbol: string,
): string[] {
  const r: string[] = [];

  if (m.gapType && m.gapPct !== null) {
    r.push(`Gap ${m.gapType}: ${m.gapPct.toFixed(1)}%`);
  }
  if (m.priceVsOrb) {
    r.push(`ORB: price ${m.priceVsOrb} opening range${m.orbHigh ? ` (H ${m.orbHigh.toFixed(1)})` : ""}`);
  }
  if (m.vwapDistancePct !== null) {
    r.push(`VWAP: ${m.vwapDistancePct > 0 ? "+" : ""}${m.vwapDistancePct.toFixed(1)}%`);
  }
  if (m.rsi14 !== null) r.push(`RSI(14): ${m.rsi14.toFixed(0)}`);
  if (m.volumeSurge !== null) r.push(`Vol surge: ${m.volumeSurge.toFixed(1)}×`);
  if (m.dynamicRR !== null) r.push(`R:R ${m.dynamicRR.toFixed(1)}:1`);
  if (m.stopLossDistance !== null) r.push(`Stop: ${m.stopLossDistance.toFixed(1)}%`);
  if (m.targetDistance !== null) r.push(`Target: ${m.targetDistance.toFixed(1)}%`);
  if (m.sectorMomentum !== null) r.push(`Sector: ${m.sectorMomentum > 0 ? "+" : ""}${m.sectorMomentum.toFixed(1)}`);
  if (infoSignal?.score !== 0 && infoSignal?.reasons[0]) {
    r.push(`News: ${infoSignal.reasons[0]}`);
  }
  if (m.isNearCircuit) r.push("⚠ Near circuit limit — trade with caution.");
  if (m.source === "universe") r.push("Cap-bucket universe pick.");

  r.push(score >= 1 ? "Intraday setup favours long." : score <= -1 ? "Intraday signals caution." : "Neutral intraday setup.");
  return r;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extracts only today's candles from rawQuotes (UTC-aware). */
function todayQuotes(
  rawQuotes: Array<{ date?: Date | string | null; open?: number | null; high?: number | null; low?: number | null; close?: number | null }>,
): typeof rawQuotes {
  const now = new Date();
  const todayMidnightUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return rawQuotes.filter((q) => {
    if (!q.date) return false;
    return new Date(q.date as string).getTime() >= todayMidnightUTC.getTime();
  });
}

function getMarketOpenTime(now: Date): Date {
  const open = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    NSE_OPEN_UTC_HOUR,
    NSE_OPEN_UTC_MIN,
  ));
  return open;
}

function computeVWAP(
  _allQuotes: unknown[],
  quotes: Array<{ close?: number | null; volume?: number | null; high?: number | null; low?: number | null }>,
): number {
  let tpv = 0;
  let vol = 0;
  for (const q of quotes) {
    const high = q.high ?? q.close ?? 0;
    const low = q.low ?? q.close ?? 0;
    const close = q.close ?? 0;
    const volume = q.volume ?? 0;
    if (close <= 0 || volume <= 0) continue;
    const typicalPrice = (high + low + close) / 3;
    tpv += typicalPrice * volume;
    vol += volume;
  }
  return vol > 0 ? tpv / vol : 0;
}

function computeRSI(prices: number[], period: number): number {
  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) changes.push(prices[i] - prices[i - 1]);
  const recent = changes.slice(-period);
  const gains = recent.filter((c) => c > 0);
  const losses = recent.filter((c) => c < 0);
  const avgGain = gains.length ? gains.reduce((s, v) => s + v, 0) / period : 0;
  const avgLoss = losses.length ? losses.reduce((s, v) => s + Math.abs(v), 0) / period : 0;
  if (avgLoss === 0) return 100;
  return clamp(100 - 100 / (1 + avgGain / avgLoss), 0, 100);
}

function sma(values: number[], period: number): number {
  const slice = values.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / slice.length;
}

function computeATR(prices: number[], period: number): number {
  const ranges: number[] = [];
  for (let i = 1; i < prices.length; i++) ranges.push(Math.abs(prices[i] - prices[i - 1]));
  const recent = ranges.slice(-period);
  return recent.length ? recent.reduce((s, v) => s + v, 0) / recent.length : 0;
}
