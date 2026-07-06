import YahooFinance from "yahoo-finance2";
import type { AgentInfoOutput, AgentIntradayOutput, IntradayMetrics } from "@/lib/agents/types";
import { clamp, normalizeSymbol } from "@/lib/agents/utils";
import type { ManagedPortfolio } from "@/lib/portfolio";

const yf = new YahooFinance();

export async function agentIntraday(
  portfolio: ManagedPortfolio,
  info: AgentInfoOutput,
  now = new Date(),
): Promise<AgentIntradayOutput> {
  const symbols = portfolio.positions.map((p) => p.symbol).filter(Boolean).slice(0, 30);

  const results = await Promise.allSettled(
    symbols.map(async (symbol) => {
      const chart = await yf.chart(symbol, {
        period1: new Date(now.getTime() - 3 * 86_400_000),
        period2: now,
        interval: "15m",
      });
      const quotes = chart?.quotes ?? [];
      if (quotes.length < 10) return null;

      const prices = quotes.map((q) => q.close).filter((p): p is number => p !== null && p > 0);
      const volumes = quotes.map((q) => q.volume).filter((v): v is number => v !== null);
      if (prices.length < 10) return null;

      const metrics = computeIntradayMetrics(prices, volumes);
      const score = scoreIntraday(metrics, info, symbol);
      const confidence = intradayConfidence(metrics, prices.length);
      const reasons = buildIntradayReasons(metrics, score, info, symbol);

      return { symbol: normalizeSymbol(symbol), metrics, score, confidence, reasons };
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
  const avgScore = scored.length ? scored.reduce((s, item) => s + item.score, 0) / scored.length : 0;

  return {
    agent: "Intraday",
    generatedAt: now.toISOString(),
    byStock,
    summary: scored.length
      ? `${scored.length} stocks scored for intraday; average score ${avgScore.toFixed(1)}/5.`
      : "No intraday data available.",
  };
}

function computeIntradayMetrics(prices: number[], volumes: number[]): IntradayMetrics {
  const lastPrice = prices[prices.length - 1];
  const prevPrice = prices.length >= 2 ? prices[prices.length - 2] : null;
  const openPrice = prices[0];

  const rsi14 = prices.length >= 16 ? computeRSI(prices, 14) : null;
  const shortSMA = prices.length >= 10 ? sma(prices, 10) : null;
  const atr14 = prices.length >= 15 ? computeATR(prices, 14) : null;

  const volRecent = volumes.slice(-5).reduce((s, v) => s + v, 0) / 5;
  const volPrior = volumes.length >= 10
    ? volumes.slice(-15, -5).reduce((s, v) => s + v, 0) / 10
    : volRecent;
  const volumeSurge = volPrior > 0 ? volRecent / volPrior : 1;

  const priceChange1h = prevPrice && lastPrice ? ((lastPrice - prevPrice) / prevPrice) * 100 : null;
  const priceChangeOpen = openPrice > 0 ? ((lastPrice - openPrice) / openPrice) * 100 : null;
  const intradayVolatility = atr14 !== null && lastPrice > 0 ? (atr14 / lastPrice) * 100 : null;
  const stopLossDistance = intradayVolatility !== null ? clamp(intradayVolatility * 1.5, 0.5, 5) : 2;
  const targetDistance = stopLossDistance * 1.8;

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
  };
}

function scoreIntraday(m: IntradayMetrics, info: AgentInfoOutput, symbol: string): number {
  let score = 0;
  let count = 0;

  const infoSignal = info.byStock[normalizeSymbol(symbol)];

  if (m.rsi14 !== null) {
    if (m.rsi14 < 30) score += 2;
    else if (m.rsi14 < 40) score += 1;
    else if (m.rsi14 > 75) score -= 1.5;
    else if (m.rsi14 > 60) score -= 0.5;
    count++;
  }
  if (m.volumeSurge !== null) {
    if (m.volumeSurge > 2) score += 1.5;
    else if (m.volumeSurge > 1.3) score += 0.5;
    else if (m.volumeSurge < 0.5) score -= 0.5;
    count++;
  }
  if (m.priceChange1h !== null) {
    if (m.priceChange1h > 1.5) score -= 0.5;
    else if (m.priceChange1h > 0.3) score += 0.5;
    else if (m.priceChange1h < -1.5) score += 1;
    else if (m.priceChange1h < -0.5) score += 0.3;
    count++;
  }
  if (m.shortSMA !== null && m.lastPrice !== null) {
    const diff = ((m.lastPrice - m.shortSMA) / m.shortSMA) * 100;
    if (diff > 0.5) score += 0.5;
    else if (diff < -0.5) score -= 0.3;
    count++;
  }
  if (infoSignal?.score !== undefined && infoSignal.score !== 0) {
    score += clamp(infoSignal.score * 0.4, -1.5, 1.5);
    count++;
  }

  return count ? clamp((score / count) * 2, -5, 5) : 0;
}

function intradayConfidence(m: IntradayMetrics, dataPoints: number): number {
  const base = clamp(25 + dataPoints * 2, 20, 70);
  if (m.volumeSurge !== null && m.volumeSurge > 1.5) return clamp(base + 10, 20, 80);
  if (m.rsi14 === null) return clamp(base - 10, 15, 60);
  return base;
}

function buildIntradayReasons(m: IntradayMetrics, score: number, info: AgentInfoOutput, symbol: string): string[] {
  const reasons: string[] = [];
  if (m.rsi14 !== null) reasons.push(`RSI(14): ${m.rsi14.toFixed(0)}`);
  if (m.volumeSurge !== null) reasons.push(`Vol surge: ${m.volumeSurge.toFixed(1)}x`);
  if (m.priceChange1h !== null) reasons.push(`1h: ${m.priceChange1h.toFixed(2)}%`);
  if (m.intradayVolatility !== null) reasons.push(`ATR: ${m.intradayVolatility.toFixed(2)}%`);
  if (m.stopLossDistance !== null) reasons.push(`Stop: ${m.stopLossDistance.toFixed(1)}%`);
  if (m.targetDistance !== null) reasons.push(`Target: ${m.targetDistance.toFixed(1)}%`);
  const infoSignal = info.byStock[normalizeSymbol(symbol)];
  if (infoSignal && infoSignal.score !== 0) reasons.push(`News: ${infoSignal.reasons[0] ?? "neutral"}`);
  reasons.push(score >= 0 ? "Intraday setup favours long." : "Intraday signals caution.");
  return reasons;
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
  const rs = avgGain / avgLoss;
  return clamp(100 - 100 / (1 + rs), 0, 100);
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
