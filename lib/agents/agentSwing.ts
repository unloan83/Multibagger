import YahooFinance from "yahoo-finance2";
import type { AgentInfoOutput, AgentMacroPolicyOutput, AgentSwingOutput, SwingMetrics } from "@/lib/agents/types";
import { clamp, normalizeSymbol } from "@/lib/agents/utils";
import type { ManagedPortfolio } from "@/lib/portfolio";

const yf = new YahooFinance();

export async function agentSwing(
  portfolio: ManagedPortfolio,
  info: AgentInfoOutput,
  macroPolicy: AgentMacroPolicyOutput,
  now = new Date(),
): Promise<AgentSwingOutput> {
  const symbols = portfolio.positions.map((p) => p.symbol).filter(Boolean).slice(0, 30);

  const results = await Promise.allSettled(
    symbols.map(async (symbol) => {
      const historical = await yf.historical(symbol, {
        period1: new Date(now.getTime() - 180 * 86_400_000),
        period2: now,
        interval: "1d",
      });
      const prices = historical.map((h) => h.close).filter((p): p is number => p !== null && p > 0);
      const volumes = historical.map((h) => h.volume).filter((v): v is number => v !== null);
      if (prices.length < 30) return null;

      const metrics = computeSwingMetrics(prices, volumes);
      const sectorSignal = macroPolicy.sectors.find(
        (s) => s.sector === portfolio.positions.find((pos) => normalizeSymbol(pos.symbol) === normalizeSymbol(symbol))?.sector,
      );
      const score = scoreSwing(metrics, info, symbol, sectorSignal?.score ?? 0);
      const confidence = swingConfidence(metrics);
      const reasons = buildSwingReasons(metrics, score, sectorSignal);

      return { symbol: normalizeSymbol(symbol), metrics, score, confidence, reasons };
    }),
  );

  const byStock: AgentSwingOutput["byStock"] = {};
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
    agent: "Swing",
    generatedAt: now.toISOString(),
    byStock,
    summary: scored.length
      ? `${scored.length} stocks scored for swing; average score ${avgScore.toFixed(1)}/5.`
      : "No swing data available.",
  };
}

function computeSwingMetrics(prices: number[], volumes: number[]): SwingMetrics {
  const lastPrice = prices[prices.length - 1];

  const sma20 = prices.length >= 20 ? sma(prices, 20) : null;
  const sma50 = prices.length >= 50 ? sma(prices, 50) : null;
  const rsi14 = prices.length >= 16 ? computeRSI(prices, 14) : null;
  const macdLine = prices.length >= 26 ? computeEMA(prices, 12) - computeEMA(prices, 26) : null;
  const signalLine = macdLine !== null && prices.length >= 35
    ? computeMACDSignal(prices, 12, 26, 9)
    : null;
  const atr14 = prices.length >= 15 ? computeATR(prices, 14) : null;

  const volumeAvg20 = volumes.length >= 20 ? volumes.slice(-20).reduce((s, v) => s + v, 0) / 20 : null;
  const volumeToday = volumes[volumes.length - 1] ?? null;
  const volumeRatio = volumeAvg20 && volumeAvg20 > 0 && volumeToday ? volumeToday / volumeAvg20 : null;

  const weekAgo = prices.length >= 6 ? prices[prices.length - 6] : null;
  const monthAgo = prices.length >= 22 ? prices[prices.length - 22] : null;
  const priceChange1w = weekAgo && lastPrice ? ((lastPrice - weekAgo) / weekAgo) * 100 : null;
  const priceChange1m = monthAgo && lastPrice ? ((lastPrice - monthAgo) / monthAgo) * 100 : null;

  const atrPercent = atr14 !== null && lastPrice > 0 ? (atr14 / lastPrice) * 100 : null;
  const stopLossPct = atrPercent !== null ? clamp(atrPercent * 2, 1, 8) : 3;

  return {
    sma20, sma50, rsi14, macdLine, signalLine, atr14, volumeRatio,
    priceChange1w, priceChange1m, atrPercent, stopLossPct, lastPrice,
  };
}

function scoreSwing(m: SwingMetrics, info: AgentInfoOutput, symbol: string, sectorScore: number): number {
  let score = 0;
  let count = 0;
  const norm = normalizeSymbol(symbol);

  if (m.rsi14 !== null) {
    if (m.rsi14 < 35) score += 1.5;
    else if (m.rsi14 < 45) score += 0.5;
    else if (m.rsi14 > 70) score -= 1;
    else if (m.rsi14 > 60) score -= 0.3;
    count++;
  }
  if (m.sma20 !== null && m.sma50 !== null && m.lastPrice !== null) {
    const smaBullish = m.lastPrice > m.sma20 && m.sma20 > m.sma50;
    const smaBearish = m.lastPrice < m.sma20 && m.sma20 < m.sma50;
    if (smaBullish) score += 1.5;
    else if (smaBearish) score -= 1;
    else if (m.lastPrice > m.sma20) score += 0.3;
    count++;
  }
  if (m.macdLine !== null && m.signalLine !== null) {
    if (m.macdLine > m.signalLine) score += 1;
    else score -= 0.5;
    count++;
  }
  if (m.volumeRatio !== null) {
    if (m.volumeRatio > 1.5) score += 0.5;
    else if (m.volumeRatio < 0.5) score -= 0.3;
    count++;
  }
  if (m.priceChange1w !== null) {
    if (m.priceChange1w > 8) score -= 0.3;
    else if (m.priceChange1w > 2) score += 0.3;
    else if (m.priceChange1w < -8) score += 0.5;
    else if (m.priceChange1w < -3) score += 0.3;
    count++;
  }
  if (sectorScore !== 0) {
    score += clamp(sectorScore * 0.3, -1, 1);
    count++;
  }
  const infoSignal = info.byStock[norm];
  if (infoSignal && infoSignal.score !== 0) {
    score += clamp(infoSignal.score * 0.25, -1, 1);
    count++;
  }

  return count ? clamp((score / count) * 2, -5, 5) : 0;
}

function swingConfidence(m: SwingMetrics): number {
  const available = [m.rsi14, m.sma20, m.macdLine, m.volumeRatio, m.atr14].filter((v) => v !== null).length;
  return clamp(30 + available * 10, 20, 85);
}

function buildSwingReasons(m: SwingMetrics, score: number, sectorSignal?: { sector: string; reasons: string[] } | null): string[] {
  const reasons: string[] = [];
  if (m.rsi14 !== null) reasons.push(`RSI(14): ${m.rsi14.toFixed(0)}`);
  if (m.sma20 !== null && m.sma50 !== null) reasons.push(`SMA20/SMA50: ${m.sma20.toFixed(1)}/${m.sma50.toFixed(1)}`);
  if (m.macdLine !== null && m.signalLine !== null) reasons.push(`MACD: ${m.macdLine.toFixed(2)}/${m.signalLine.toFixed(2)}`);
  if (m.volumeRatio !== null) reasons.push(`Vol: ${m.volumeRatio.toFixed(1)}x avg`);
  if (m.priceChange1w !== null) reasons.push(`1w: ${m.priceChange1w.toFixed(1)}%`);
  if (m.stopLossPct !== null) reasons.push(`Stop: ${m.stopLossPct.toFixed(1)}%`);
  if (sectorSignal?.reasons.length) reasons.push(`Sector: ${sectorSignal.reasons.slice(0, 1).join(" ")}`);
  reasons.push(score >= 0 ? "Swing setup favours long." : "Swing signals caution.");
  return reasons;
}

function sma(values: number[], period: number): number {
  return values.slice(-period).reduce((s, v) => s + v, 0) / period;
}

function computeEMA(values: number[], period: number): number {
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < values.length; i++) ema = values[i] * k + ema * (1 - k);
  return ema;
}

function computeMACDSignal(prices: number[], fast: number, slow: number, signal: number): number {
  const macdValues: number[] = [];
  for (let i = slow; i < prices.length; i++) {
    const emaFast = computeEMA(prices.slice(0, i + 1), fast);
    const emaSlow = computeEMA(prices.slice(0, i + 1), slow);
    macdValues.push(emaFast - emaSlow);
  }
  return computeEMA(macdValues, signal);
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

function computeATR(prices: number[], period: number): number {
  const ranges: number[] = [];
  for (let i = 1; i < prices.length; i++) ranges.push(Math.abs(prices[i] - prices[i - 1]));
  return ranges.slice(-period).reduce((s, v) => s + v, 0) / period;
}
