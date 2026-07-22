/**
 * Shared technical indicator utilities for the agent pipeline.
 *
 * This module replaces the per-agent hand-rolled approximations with
 * numerically correct implementations from the `technicalindicators` library:
 *
 *   - RSI  — now uses Wilder's EMA-based smoothing (the market-standard method).
 *             The old code used a simple average of the last N changes, which
 *             over-smooths transitions and misreads overbought/oversold levels.
 *
 *   - ATR  — now uses the full True Range: max(H−L, |H−prevC|, |L−prevC|).
 *             The old code used |close − prevClose| only, which ignores overnight
 *             gaps captured by the high/low bars and understates volatility.
 *
 *   - MACD — now uses proper EMA continuation for both the MACD and signal lines.
 *             The old agentSwing implementation re-seeded computeEMA() from scratch
 *             on each bar (O(n²), numerically drifts from the correct value).
 *
 * All three arrays passed to computeATR() must be the same length and
 * bar-aligned (highs[i], lows[i], closes[i] refer to the same candle).
 */
import { ATR, MACD, RSI } from "technicalindicators";

/**
 * RSI(period) using Wilder's smoothed moving average.
 * Returns null when there are fewer than period+1 data points.
 */
export function computeRSI(prices: number[], period = 14): number | null {
  if (prices.length < period + 1) return null;
  const result = RSI.calculate({ values: prices, period });
  const last = result[result.length - 1];
  return last !== undefined ? last : null;
}

/**
 * ATR(period) using the True Range formula.
 * All three arrays must be aligned by bar index.
 * Returns null when there are fewer than period+1 bars.
 */
export function computeATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): number | null {
  if (closes.length < period + 1) return null;
  const result = ATR.calculate({ high: highs, low: lows, close: closes, period });
  const last = result[result.length - 1];
  return last !== undefined ? last : null;
}

/**
 * MACD(fastPeriod, slowPeriod, signalPeriod) using EMA continuation.
 * Returns { macdLine: null, signalLine: null } when data is insufficient.
 */
export function computeMACD(
  prices: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): { macdLine: number | null; signalLine: number | null } {
  if (prices.length < slowPeriod + signalPeriod) {
    return { macdLine: null, signalLine: null };
  }
  const result = MACD.calculate({
    values: prices,
    fastPeriod,
    slowPeriod,
    signalPeriod,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  const last = result[result.length - 1];
  return {
    macdLine: last?.MACD ?? null,
    signalLine: last?.signal ?? null,
  };
}
