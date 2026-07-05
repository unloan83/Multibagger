import YahooFinance from "yahoo-finance2";
import type {
  AgentTechnicalOutput,
  TechnicalMetrics,
} from "@/lib/agents/types";
import { clamp, normalizeSymbol } from "@/lib/agents/utils";
import type { ManagedPortfolio } from "@/lib/portfolio";

const yf = new YahooFinance();

export async function agentTechnical(
  portfolio: ManagedPortfolio,
  now = new Date(),
): Promise<AgentTechnicalOutput> {
  const symbols = portfolio.positions
    .map((p) => p.symbol)
    .filter(Boolean)
    .slice(0, 30);

  const results = await Promise.allSettled(
    symbols.map(async (symbol) => {
      const historical = await yf.historical(symbol, {
        period1: new Date(now.getTime() - 90 * 86_400_000),
        period2: now,
        interval: "1d",
      });
      const prices = historical
        .filter((h: { close?: number | null }) => h.close !== null && h.close! > 0)
        .map((h: { close: number }) => h.close);
      const volumes = historical
        .filter((h: { volume?: number | null }) => h.volume !== null)
        .map((h: { volume: number }) => h.volume);
      const quote = await yf.quote(symbol);
      const metrics = computeTechnicalMetrics(prices, volumes, quote);
      const score = scoreTechnical(metrics);
      const confidence = confidenceFromTechnical(metrics);
      const reasons = buildTechReasons(metrics, score);
      return { symbol: normalizeSymbol(symbol), metrics, score, confidence, reasons };
    }),
  );

  const byStock: AgentTechnicalOutput["byStock"] = {};
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

  return {
    agent: "Technical",
    generatedAt: now.toISOString(),
    byStock,
    summary: scored.length
      ? `${scored.length} stocks scored; average technical score ${avgScore.toFixed(1)}/5.`
      : "No technical data available.",
  };
}

function computeTechnicalMetrics(
  prices: number[],
  volumes: number[],
  quote: Awaited<ReturnType<typeof yf.quote>>,
): TechnicalMetrics {
  const rsi14 = prices.length >= 15 ? computeRSI(prices, 14) : null;
  const sma20 = prices.length >= 20 ? sma(prices, 20) : null;
  const sma50 = prices.length >= 50 ? sma(prices, 50) : null;
  const volumeAvg20 = volumes.length >= 20
    ? volumes.slice(-20).reduce((s, v) => s + v, 0) / 20
    : null;
  const volumeToday = quote.regularMarketVolume ?? null;
  const lastClose = prices[prices.length - 1];
  const prevClose = prices.length >= 2 ? prices[prices.length - 2] : null;
  const weekAgo = prices.length >= 6 ? prices[prices.length - 6] : null;
  const monthAgo = prices.length >= 22 ? prices[prices.length - 22] : null;
  const atr14 = prices.length >= 15 ? computeATR(prices, 14) : null;

  return {
    rsi14,
    sma20: sma20 ?? null,
    sma50: sma50 ?? null,
    volumeAvg20,
    volumeToday,
    priceChange1d: prevClose && lastClose ? ((lastClose - prevClose) / prevClose) * 100 : null,
    priceChange1w: weekAgo && lastClose ? ((lastClose - weekAgo) / weekAgo) * 100 : null,
    priceChange1m: monthAgo && lastClose ? ((lastClose - monthAgo) / monthAgo) * 100 : null,
    atr14,
  };
}

function scoreTechnical(m: TechnicalMetrics): number {
  let score = 0;
  let count = 0;

  if (m.rsi14 !== null) {
    if (m.rsi14 < 35) score += 1.5;
    else if (m.rsi14 < 45) score += 0.5;
    else if (m.rsi14 > 70) score -= 1;
    else if (m.rsi14 > 60) score -= 0.3;
    count++;
  }
  if (m.sma20 !== null && m.sma50 !== null) {
    const lastPrice = inferLastPrice(m);
    if (lastPrice !== null) {
      if (lastPrice > m.sma20 && m.sma20 > m.sma50) score += 1.5;
      else if (lastPrice > m.sma20) score += 0.5;
      else if (lastPrice < m.sma20 && m.sma20 < m.sma50) score -= 1;
      else if (lastPrice < m.sma20) score -= 0.3;
    }
    count++;
  }
  if (m.volumeAvg20 !== null && m.volumeToday !== null) {
    if (m.volumeToday > m.volumeAvg20 * 1.5) score += 0.5;
    else if (m.volumeToday < m.volumeAvg20 * 0.5) score -= 0.3;
    count++;
  }
  if (m.priceChange1m !== null) {
    if (m.priceChange1m > 10) score -= 0.3;
    else if (m.priceChange1m > 5) score += 0.3;
    else if (m.priceChange1m < -10) score += 0.5;
    else if (m.priceChange1m < -5) score += 0.3;
    count++;
  }

  return count ? clamp(score / count * 2.5, -5, 5) : 0;
}

function confidenceFromTechnical(m: TechnicalMetrics): number {
  const available = [m.rsi14, m.sma20, m.sma50, m.volumeAvg20, m.atr14]
    .filter((v) => v !== null).length;
  return clamp(25 + available * 12, 20, 90);
}

function buildTechReasons(m: TechnicalMetrics, score: number): string[] {
  const reasons: string[] = [];
  if (m.rsi14 !== null) reasons.push(`RSI(14): ${m.rsi14.toFixed(0)}`);
  if (m.sma20 !== null && m.sma50 !== null) {
    reasons.push(`SMA50: ${m.sma50.toFixed(1)}`);
  }
  if (m.priceChange1w !== null) reasons.push(`1w: ${m.priceChange1w.toFixed(1)}%`);
  if (m.volumeAvg20 !== null && m.volumeToday !== null) {
    const ratio = (m.volumeToday / m.volumeAvg20).toFixed(1);
    reasons.push(`Vol: ${ratio}x avg`);
  }
  reasons.push(score >= 0 ? "Technicals favour entry." : "Technical signals caution.");
  return reasons;
}

function inferLastPrice(m: TechnicalMetrics): number | null {
  return m.sma20 ?? m.sma50 ?? null;
}

function computeRSI(prices: number[], period: number): number {
  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }
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
  const trueranges: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    trueranges.push(Math.abs(prices[i] - prices[i - 1]));
  }
  const recent = trueranges.slice(-period);
  return recent.length ? recent.reduce((s, v) => s + v, 0) / recent.length : 0;
}
