export type PriceBar = {
  close: number;
  high: number;
  low: number;
  volume: number;
};

export type AnalysisProfile = "intraday" | "short-term" | "long-term" | "watchlist";

export type StockSignalMetrics = {
  historyDays: number;
  dayChangePercent: number;
  return5Percent: number;
  return20Percent: number;
  return60Percent: number;
  return120Percent: number;
  drawdownFrom60DayHighPercent: number;
  volumeShock: number;
  ema20: number;
  ema50: number;
  ema200: number;
  vwap: number;
  vwapDistancePercent: number;
  atr: number;
  atrPercent: number;
  trendScore: number;
  momentumScore: number;
  liquidityScore: number;
  riskScore: number;
  finalScore: number;
  intradayPotentialPercent: number;
  longTermPotentialPercent: number;
  persistentDeclineScore: number;
  expectedDownsidePercent: number;
  target: number;
  upsidePercent: number;
  caveats: string[];
};

export type SignalInput = {
  symbol: string;
  price: number;
  previousClose: number;
  volume?: number;
  sector?: string;
  bars?: PriceBar[];
  newsCount?: number;
  portfolioWeight?: number;
  segment?: string;
  profile?: AnalysisProfile;
  historyScore?: number;
};

const defaultCaveat =
  "Model output is a screening signal, not financial advice. Validate fundamentals, news, liquidity, and risk before trading.";

export const MIN_INTRADAY_POTENTIAL_PERCENT = 10;
export const MIN_LONG_TERM_POTENTIAL_PERCENT = 15;

export function analyzeStockSignal(input: SignalInput): StockSignalMetrics {
  const bars = input.bars?.filter((bar) => bar.close > 0) ?? [];
  const price = input.price || bars.at(-1)?.close || 0;
  const previousClose = input.previousClose || bars.at(-2)?.close || 0;
  const dayChangePercent =
    previousClose === 0 ? 0 : ((price - previousClose) / previousClose) * 100;
  const historyDays = bars.length;
  const return5Percent = calculatePeriodReturn(bars, price, 5);
  const return20Percent = calculatePeriodReturn(bars, price, 20);
  const return60Percent = calculatePeriodReturn(bars, price, 60);
  const return120Percent = calculatePeriodReturn(bars, price, 120);
  const drawdownFrom60DayHighPercent = calculateDrawdownFromHigh(
    bars,
    price,
    60,
  );
  const ema20 = calculateEma(bars.map((bar) => bar.close), 20) || price;
  const ema50 = calculateEma(bars.map((bar) => bar.close), 50) || price;
  const ema200 = calculateEma(bars.map((bar) => bar.close), 200) || price;
  const vwap = calculateVwap(bars) || price;
  const atr = calculateAtr(bars, 14);
  const atrPercent = price === 0 ? 0 : (atr / price) * 100;
  const volumeShock = calculateVolumeShock(input.symbol, input.volume ?? 0, bars);
  const vwapDistancePercent = vwap === 0 ? 0 : ((price - vwap) / vwap) * 100;
  const trendScore = scoreTrend(price, ema20, ema50, vwapDistancePercent);
  const momentumScore = clamp(dayChangePercent * 8 + Math.min(volumeShock, 3) * 10, -35, 35);
  const liquidityScore = clamp(Math.log10((input.volume ?? 0) + 1) * 6, 0, 45);
  const riskScore = scoreRisk({
    atrPercent,
    dayChangePercent,
    portfolioWeight: input.portfolioWeight ?? 0,
    segment: input.segment,
  });
  const profileBoost = getProfileBoost(input.profile ?? "short-term", trendScore);
  const finalScore = clamp(
    42 +
      trendScore +
      momentumScore * 0.55 +
      liquidityScore * 0.35 +
      profileBoost +
      (input.newsCount ?? 0) * 1.5 +
      (input.historyScore ?? 0) -
      riskScore,
    0,
    100,
  );
  const profile = input.profile ?? "short-term";
  const intradayPotentialPercent = estimateIntradayPotentialPercent({
    bars,
    dayChangePercent,
    ema20,
    ema50,
    finalScore,
    price,
    volumeShock,
  });
  const longTermPotentialPercent = estimateLongTermPotentialPercent({
    drawdownFrom60DayHighPercent,
    ema20,
    ema50,
    ema200,
    finalScore,
    price,
    return5Percent,
    return20Percent,
    return60Percent,
    return120Percent,
  });
  const persistentDeclineScore = scorePersistentDecline({
    drawdownFrom60DayHighPercent,
    ema20,
    ema50,
    ema200,
    finalScore,
    price,
    return5Percent,
    return20Percent,
    return60Percent,
    return120Percent,
  });
  const expectedDownsidePercent = estimateExpectedDownsidePercent({
    drawdownFrom60DayHighPercent,
    persistentDeclineScore,
    return5Percent,
    return20Percent,
    return60Percent,
    return120Percent,
  });
  const targetMultiplier =
    profile === "intraday"
      ? 1 + intradayPotentialPercent / 100
      : profile === "long-term"
        ? persistentDeclineScore >= 70
          ? 1 - expectedDownsidePercent / 100
          : 1 + longTermPotentialPercent / 100
      : getTargetMultiplier({
          finalScore,
          trendScore,
          volumeShock,
          atrPercent,
          segment: input.segment,
          profile,
        });
  const target = price * targetMultiplier;

  return {
    historyDays,
    dayChangePercent,
    return5Percent,
    return20Percent,
    return60Percent,
    return120Percent,
    drawdownFrom60DayHighPercent,
    volumeShock,
    ema20,
    ema50,
    ema200,
    vwap,
    vwapDistancePercent,
    atr,
    atrPercent,
    trendScore,
    momentumScore,
    liquidityScore,
    riskScore,
    finalScore: Math.round(finalScore),
    intradayPotentialPercent,
    longTermPotentialPercent,
    persistentDeclineScore,
    expectedDownsidePercent,
    target,
    upsidePercent: price === 0 ? 0 : ((target - price) / price) * 100,
    caveats: buildCaveats({
      price,
      ema20,
      ema50,
      vwapDistancePercent,
      atrPercent,
      volumeShock,
      finalScore,
      dayChangePercent,
      portfolioWeight: input.portfolioWeight ?? 0,
    }),
  };
}

export function qualifiesForLongTermAccumulation(
  metrics: StockSignalMetrics,
) {
  return (
    metrics.longTermPotentialPercent >= MIN_LONG_TERM_POTENTIAL_PERCENT &&
    metrics.historyDays >= 180 &&
    metrics.finalScore >= 65 &&
    metrics.return20Percent > 0 &&
    metrics.return60Percent >= 5 &&
    metrics.return120Percent >= 10 &&
    metrics.ema20 >= metrics.ema50 &&
    metrics.ema50 >= metrics.ema200 &&
    metrics.persistentDeclineScore < 25 &&
    metrics.riskScore <= 18
  );
}

export function qualifiesForPersistentDeclineSell(
  metrics: StockSignalMetrics,
) {
  return (
    metrics.persistentDeclineScore >= 70 &&
    metrics.historyDays >= 180 &&
    metrics.expectedDownsidePercent >= 10 &&
    metrics.return5Percent < 0 &&
    metrics.return20Percent <= -8 &&
    metrics.return60Percent <= -12 &&
    metrics.return120Percent <= -18 &&
    metrics.ema20 < metrics.ema50 &&
    metrics.ema50 < metrics.ema200 &&
    metrics.finalScore <= 40
  );
}

export function qualifiesForHighPotentialIntraday(
  metrics: StockSignalMetrics,
) {
  return (
    metrics.intradayPotentialPercent >= MIN_INTRADAY_POTENTIAL_PERCENT &&
    metrics.finalScore >= 65 &&
    metrics.dayChangePercent > 0 &&
    metrics.dayChangePercent <= 8 &&
    metrics.volumeShock >= 1.5 &&
    metrics.ema20 >= metrics.ema50 &&
    metrics.riskScore <= 18
  );
}

export function getSignalAction(
  metrics: StockSignalMetrics,
  profile: AnalysisProfile,
): "Accumulate" | "Urgent Sell" {
  if (profile === "long-term") {
    return qualifiesForPersistentDeclineSell(metrics)
      ? "Urgent Sell"
      : "Accumulate";
  }

  const riskLimit = profile === "intraday" ? 9 : 10;

  if (metrics.finalScore < 42 || metrics.riskScore > riskLimit || metrics.ema20 < metrics.ema50) {
    return "Urgent Sell";
  }

  return "Accumulate";
}

export function buildSignalRemark(metrics: StockSignalMetrics, profile: AnalysisProfile) {
  const horizon =
    profile === "intraday"
      ? "5-15 min refresh"
      : profile === "watchlist"
        ? "15 min watchlist refresh"
        : profile === "long-term"
          ? "daily review"
          : "15 min refresh";

  return `Score ${metrics.finalScore}/100 | EMA20 ${formatNumber(metrics.ema20)} vs EMA50 ${formatNumber(metrics.ema50)} | VWAP gap ${formatPercent(metrics.vwapDistancePercent)} | ATR risk ${formatPercent(metrics.atrPercent)} | Volume shock ${metrics.volumeShock.toFixed(2)}x | ${horizon}.`;
}

export function calculateEma(values: number[], period: number) {
  const cleanValues = values.filter((value) => Number.isFinite(value) && value > 0);

  if (cleanValues.length === 0) {
    return 0;
  }

  const multiplier = 2 / (period + 1);
  const seed =
    cleanValues.slice(0, period).reduce((sum, value) => sum + value, 0) /
    Math.min(period, cleanValues.length);

  return cleanValues.slice(period).reduce((ema, value) => {
    return (value - ema) * multiplier + ema;
  }, seed);
}

export function calculateVwap(bars: PriceBar[]) {
  const totals = bars.reduce(
    (acc, bar) => {
      const typicalPrice = (bar.high + bar.low + bar.close) / 3;
      return {
        priceVolume: acc.priceVolume + typicalPrice * bar.volume,
        volume: acc.volume + bar.volume,
      };
    },
    { priceVolume: 0, volume: 0 },
  );

  return totals.volume === 0 ? 0 : totals.priceVolume / totals.volume;
}

export function calculateAtr(bars: PriceBar[], period: number) {
  if (bars.length < 2) {
    return 0;
  }

  const trueRanges = bars.slice(1).map((bar, index) => {
    const previousClose = bars[index].close;
    return Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - previousClose),
      Math.abs(bar.low - previousClose),
    );
  });
  const sample = trueRanges.slice(-period);

  return sample.reduce((sum, value) => sum + value, 0) / Math.max(sample.length, 1);
}

function estimateIntradayPotentialPercent({
  bars,
  dayChangePercent,
  ema20,
  ema50,
  finalScore,
  price,
  volumeShock,
}: {
  bars: PriceBar[];
  dayChangePercent: number;
  ema20: number;
  ema50: number;
  finalScore: number;
  price: number;
  volumeShock: number;
}) {
  if (price <= 0 || bars.length < 20 || dayChangePercent <= 0) {
    return 0;
  }

  const recentBars = bars.slice(-61);
  const upsideExcursions = recentBars
    .slice(1)
    .map((bar, index) => {
      const previousClose = recentBars[index]?.close ?? 0;
      return previousClose > 0
        ? Math.max(0, ((bar.high - previousClose) / previousClose) * 100)
        : 0;
    })
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const highExcursion = percentile(upsideExcursions, 0.9);
  const volumeMultiplier = clamp(0.8 + Math.max(0, volumeShock - 1) * 0.25, 0.8, 1.35);
  const trendMultiplier = ema20 >= ema50 && price >= ema20 ? 1 : 0.65;
  const scoreMultiplier = clamp(0.8 + Math.max(0, finalScore - 50) / 100, 0.8, 1.25);
  const continuation = Math.min(dayChangePercent, 6) * 0.25;

  return Number(
    clamp(
      (highExcursion + continuation) *
        volumeMultiplier *
        trendMultiplier *
        scoreMultiplier,
      0,
      25,
    ).toFixed(2),
  );
}

function estimateLongTermPotentialPercent({
  drawdownFrom60DayHighPercent,
  ema20,
  ema50,
  ema200,
  finalScore,
  price,
  return5Percent,
  return20Percent,
  return60Percent,
  return120Percent,
}: {
  drawdownFrom60DayHighPercent: number;
  ema20: number;
  ema50: number;
  ema200: number;
  finalScore: number;
  price: number;
  return5Percent: number;
  return20Percent: number;
  return60Percent: number;
  return120Percent: number;
}) {
  if (
    price <= 0 ||
    return120Percent <= 0 ||
    ema20 < ema50 ||
    ema50 < ema200
  ) {
    return 0;
  }

  const trendEvidence =
    Math.max(0, return120Percent) * 0.25 +
    Math.max(0, return60Percent) * 0.3 +
    Math.max(0, return20Percent) * 0.3 +
    Math.max(0, return5Percent) * 0.15;
  const qualityLift = Math.max(0, finalScore - 55) * 0.25;
  const alignmentLift =
    price >= ema20 && ema20 >= ema50 && ema50 >= ema200 ? 8 : 0;
  const extensionHaircut =
    Math.abs(Math.min(0, drawdownFrom60DayHighPercent)) * 0.1;

  return Number(
    clamp(
      trendEvidence + qualityLift + alignmentLift - extensionHaircut,
      0,
      60,
    ).toFixed(2),
  );
}

function scorePersistentDecline({
  drawdownFrom60DayHighPercent,
  ema20,
  ema50,
  ema200,
  finalScore,
  price,
  return5Percent,
  return20Percent,
  return60Percent,
  return120Percent,
}: {
  drawdownFrom60DayHighPercent: number;
  ema20: number;
  ema50: number;
  ema200: number;
  finalScore: number;
  price: number;
  return5Percent: number;
  return20Percent: number;
  return60Percent: number;
  return120Percent: number;
}) {
  let score = 0;
  if (price < ema20) score += 18;
  if (ema20 < ema50) score += 20;
  if (ema50 < ema200) score += 15;
  if (return5Percent <= -2) score += 12;
  if (return20Percent <= -8) score += 18;
  if (return60Percent <= -12) score += 18;
  if (return120Percent <= -18) score += 15;
  if (drawdownFrom60DayHighPercent <= -20) score += 12;
  if (finalScore <= 35) score += 10;
  return clamp(score, 0, 100);
}

function estimateExpectedDownsidePercent({
  drawdownFrom60DayHighPercent,
  persistentDeclineScore,
  return5Percent,
  return20Percent,
  return60Percent,
  return120Percent,
}: {
  drawdownFrom60DayHighPercent: number;
  persistentDeclineScore: number;
  return5Percent: number;
  return20Percent: number;
  return60Percent: number;
  return120Percent: number;
}) {
  if (persistentDeclineScore < 50) return 0;

  return Number(
    clamp(
      Math.max(0, -return5Percent) * 0.3 +
        Math.max(0, -return20Percent) * 0.35 +
        Math.max(0, -return60Percent) * 0.15 +
        Math.max(0, -return120Percent) * 0.1 +
        Math.max(0, -drawdownFrom60DayHighPercent) * 0.2,
      0,
      35,
    ).toFixed(2),
  );
}

function calculatePeriodReturn(
  bars: PriceBar[],
  price: number,
  periods: number,
) {
  const base = bars.at(-(periods + 1))?.close ?? 0;
  return base > 0 && price > 0 ? ((price - base) / base) * 100 : 0;
}

function calculateDrawdownFromHigh(
  bars: PriceBar[],
  price: number,
  periods: number,
) {
  const high = Math.max(
    0,
    ...bars.slice(-periods).map((bar) => bar.high || bar.close),
  );
  return high > 0 && price > 0 ? ((price - high) / high) * 100 : 0;
}

function percentile(values: number[], quantile: number) {
  if (values.length === 0) return 0;
  const index = Math.min(
    values.length - 1,
    Math.max(0, Math.ceil(values.length * quantile) - 1),
  );
  return values[index];
}

function calculateVolumeShock(symbol: string, volume: number, bars: PriceBar[]) {
  const recentVolumes = bars.map((bar) => bar.volume).filter((value) => value > 0);
  const averageVolume =
    recentVolumes.slice(-20).reduce((sum, value) => sum + value, 0) /
    Math.max(recentVolumes.slice(-20).length, 1);
  const rawShock = averageVolume === 0 ? Math.log10(volume + 1) / 7 : volume / averageVolume;
  const symbolSeed = [...symbol].reduce((sum, char) => sum + char.charCodeAt(0), 0);

  return Number(Math.max(0.1, rawShock + (symbolSeed % 7) / 100).toFixed(2));
}

function scoreTrend(price: number, ema20: number, ema50: number, vwapDistancePercent: number) {
  return (
    (price >= ema20 ? 10 : -10) +
    (ema20 >= ema50 ? 12 : -12) +
    clamp(vwapDistancePercent * 1.5, -8, 8)
  );
}

function scoreRisk({
  atrPercent,
  dayChangePercent,
  portfolioWeight,
  segment,
}: {
  atrPercent: number;
  dayChangePercent: number;
  portfolioWeight: number;
  segment?: string;
}) {
  return (
    Math.max(0, atrPercent - 3) * 1.7 +
    Math.max(0, Math.abs(dayChangePercent) - 4) * 1.2 +
    Math.max(0, portfolioWeight - 25) * 0.4 +
    (segment?.toLowerCase().includes("small") ? 3 : 0)
  );
}

function getProfileBoost(profile: AnalysisProfile, trendScore: number) {
  if (profile === "intraday") {
    return trendScore > 0 ? 5 : -5;
  }

  if (profile === "long-term") {
    return trendScore > 8 ? 7 : -2;
  }

  if (profile === "watchlist") {
    return 2;
  }

  return 0;
}

function getTargetMultiplier({
  finalScore,
  trendScore,
  volumeShock,
  atrPercent,
  segment,
  profile,
}: {
  finalScore: number;
  trendScore: number;
  volumeShock: number;
  atrPercent: number;
  segment?: string;
  profile: AnalysisProfile;
}) {
  const base =
    segment?.toLowerCase().includes("small")
      ? 1.12
      : segment?.toLowerCase().includes("mid")
        ? 1.09
        : profile === "intraday"
          ? 1.025
          : 1.06;
  const scoreLift = Math.max(0, finalScore - 55) / 350;
  const trendLift = Math.max(0, trendScore) / 500;
  const volumeLift = Math.min(volumeShock, 3) / 100;
  const riskHaircut = Math.max(0, atrPercent - 5) / 120;

  return Math.max(0.88, base + scoreLift + trendLift + volumeLift - riskHaircut);
}

function buildCaveats({
  price,
  ema20,
  ema50,
  vwapDistancePercent,
  atrPercent,
  volumeShock,
  finalScore,
  dayChangePercent,
  portfolioWeight,
}: {
  price: number;
  ema20: number;
  ema50: number;
  vwapDistancePercent: number;
  atrPercent: number;
  volumeShock: number;
  finalScore: number;
  dayChangePercent: number;
  portfolioWeight: number;
}) {
  const caveats = [defaultCaveat];

  if (price < ema20 || ema20 < ema50) {
    caveats.push("Trend is weak because price/EMA20/EMA50 alignment is not supportive.");
  }

  if (Math.abs(vwapDistancePercent) > 4) {
    caveats.push("Price is extended from VWAP; avoid chasing without confirmation.");
  }

  if (atrPercent > 6) {
    caveats.push("ATR is elevated; position sizing and stop-loss discipline are important.");
  }

  if (volumeShock < 0.8) {
    caveats.push("Volume confirmation is weak, so breakout reliability is lower.");
  }

  if (Math.abs(dayChangePercent) > 5) {
    caveats.push("Large daily move may reverse quickly; wait for consolidation if entering fresh.");
  }

  if (portfolioWeight > 25) {
    caveats.push("Portfolio concentration risk is high for this holding.");
  }

  if (finalScore < 50) {
    caveats.push("Low final score: treat as avoid/reduce unless independent research contradicts it.");
  }

  return caveats.slice(0, 4);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatNumber(value: number) {
  return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function formatPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}
