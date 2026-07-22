import YahooFinance from "yahoo-finance2";
import { computeATR, computeMACD, computeRSI } from "@/lib/agents/indicators";
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
      // Filter once so prices, highs and lows are bar-aligned (required by ATR)
      const validBars = historical.filter(
        (h) => h.close !== null && (h.close as number) > 0,
      );
      const prices = validBars.map((h) => h.close as number);
      const highs = validBars.map((h) => (h.high ?? h.close) as number);
      const lows = validBars.map((h) => (h.low ?? h.close) as number);
      const volumes = historical
        .map((h) => h.volume)
        .filter((v): v is number => v !== null);
      if (prices.length < 30) return null;

      const metrics = computeSwingMetrics(prices, highs, lows, volumes);
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

function computeSwingMetrics(
  prices: number[],
  highs: number[],
  lows: number[],
  volumes: number[],
): SwingMetrics {
  const lastPrice = prices[prices.length - 1];

  const sma20 = prices.length >= 20 ? sma(prices, 20) : null;
  const sma50 = prices.length >= 50 ? sma(prices, 50) : null;
  // Wilder-smoothed RSI — replaces simple-average approximation
  const rsi14 = computeRSI(prices, 14);
  // Proper EMA-continuation MACD — replaces O(n²) re-seeded implementation
  const { macdLine, signalLine } = computeMACD(prices);
  // True-range ATR (H/L/prevClose) — replaces close-to-close-only approximation
  const atr14 = computeATR(highs, lows, prices, 14);

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
