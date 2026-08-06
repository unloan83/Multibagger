export type CandleMarket = "india" | "us";
export type CandleSignal = "BUY" | "NO TRADE";

export type CandleViewResult = {
  symbol: string;
  name: string;
  market: CandleMarket;
  currency: "INR" | "USD";
  sessionDate: string;
  candleWindow: string;
  evaluatedAt: string;
  signalBias: CandleSignal;
  patternMatch: string;
  entryTrigger: number | null;
  target: number | null;
  stopLoss: number | null;
  atr15m: number | null;
  open: number;
  high: number;
  low: number;
  close: number;
  currentPrice: number;
  firstCandleVolume: number;
  samePeriodAverageVolume10d: number;
  volumeMultiple: number;
  averageDailyVolume: number;
  wickPercent: number;
  vwap: number | null;
  ema9: number | null;
  ema20: number | null;
  passed: {
    price: boolean;
    liquidity: boolean;
    volume: boolean;
    wick: boolean;
    pattern: boolean;
    breakout: boolean;
    vwap: boolean;
    trend: boolean;
    freshness: boolean;
  };
  rejectionReasons: string[];
  guardrailNote: string;
};

export type CandleBar = { timestamp: number; open: number; high: number; low: number; close: number; volume: number };

const MIN_SCANNER_PRICE = 150;
const MAX_SCANNER_PRICE = 3_000;
const MIN_AVERAGE_DAILY_VOLUME = 100_000;
const EXPECTED_BUY_GAIN_PERCENT = 10;

export function evaluateCandleSignal(input: {
  symbol: string;
  name?: string;
  market: CandleMarket;
  bars15m: CandleBar[];
  dailyVolumes: number[];
  now?: Date;
}): CandleViewResult {
  const config = input.market === "india"
    ? { zone: "Asia/Kolkata", openMinute: 9 * 60 + 15, closeMinute: 15 * 60 + 30, suffix: "IST", currency: "INR" as const }
    : { zone: "America/New_York", openMinute: 9 * 60 + 30, closeMinute: 16 * 60, suffix: "ET", currency: "USD" as const };
  const now = input.now || new Date();
  const candidates = input.bars15m.filter((bar) => {
    const parts = localParts(bar.timestamp, config.zone);
    const minuteOfDay = parts.hour * 60 + parts.minute;
    return minuteOfDay >= config.openMinute && minuteOfDay < config.closeMinute && (bar.timestamp + 15 * 60) * 1000 <= now.getTime();
  });
  const first = candidates.at(-1);
  if (!first) throw new Error("No completed regular-session 15-minute candle is available yet.");

  const firstDate = localParts(first.timestamp, config.zone).date;
  const firstParts = localParts(first.timestamp, config.zone);
  const earlierSamePeriod = candidates.filter((bar) => {
    const parts = localParts(bar.timestamp, config.zone);
    return parts.date !== firstDate && parts.hour === firstParts.hour && parts.minute === firstParts.minute;
  }).slice(-10);
  const samePeriodAverageVolume10d = average(earlierSamePeriod.map((bar) => bar.volume));
  const averageDailyVolume = average(input.dailyVolumes.filter((value) => value > 0).slice(-10));
  const volumeMultiple = samePeriodAverageVolume10d > 0 ? first.volume / samePeriodAverageVolume10d : 0;
  const range = first.high - first.low;
  const wickPercent = range > 0 ? ((range - Math.abs(first.close - first.open)) / range) * 100 : 100;
  const tolerance = 0.0051;
  const bullishCandle = first.close > first.open && Math.abs(first.open - first.low) <= tolerance;
  const sessionBars = candidates.filter((bar) => localParts(bar.timestamp, config.zone).date === firstDate && bar.timestamp <= first.timestamp);
  const previousBars = sessionBars.slice(-4, -1);
  const breakoutHigh = previousBars.length === 3 ? Math.max(...previousBars.map((bar) => bar.high)) : Number.POSITIVE_INFINITY;
  const vwap = calculateVwap(sessionBars);
  const closes = candidates.filter((bar) => bar.timestamp <= first.timestamp).map((bar) => bar.close);
  const ema9 = calculateEma(closes, 9);
  const ema20 = calculateEma(closes, 20);
  const buySetup = bullishCandle && first.close > breakoutHigh && vwap != null && first.close > vwap && ema9 != null && ema20 != null && ema9 > ema20;
  const direction: CandleSignal = buySetup ? "BUY" : "NO TRADE";
  const freshnessMinutes = (now.getTime() / 1000 - (first.timestamp + 15 * 60)) / 60;
  const passed = {
    price: first.open >= MIN_SCANNER_PRICE && first.open <= MAX_SCANNER_PRICE,
    liquidity: averageDailyVolume >= MIN_AVERAGE_DAILY_VOLUME,
    volume: earlierSamePeriod.length >= 10 && volumeMultiple >= 2,
    wick: wickPercent <= 40,
    pattern: bullishCandle,
    breakout: bullishCandle && first.close > breakoutHigh,
    vwap: bullishCandle && vwap != null && first.close > vwap,
    trend: bullishCandle && ema9 != null && ema20 != null && ema9 > ema20,
    freshness: freshnessMinutes >= 0 && freshnessMinutes <= 30,
  };
  const rejectionReasons: string[] = [];
  if (!passed.price) rejectionReasons.push(`Opening price must be between ${config.currency === "INR" ? "₹" : "$"}${MIN_SCANNER_PRICE.toLocaleString("en-IN")} and ${config.currency === "INR" ? "₹" : "$"}${MAX_SCANNER_PRICE.toLocaleString("en-IN")}, inclusive.`);
  if (!passed.liquidity) rejectionReasons.push(`10-session average daily volume is below ${MIN_AVERAGE_DAILY_VOLUME.toLocaleString("en-IN")} shares.`);
  if (!passed.volume) rejectionReasons.push(earlierSamePeriod.length < 10 ? "Ten prior same-period candles are not available." : "First-candle volume is below 2× its 10-day same-period average.");
  if (!passed.wick) rejectionReasons.push("Combined candle shadows exceed 40% of the full candle range.");
  if (!passed.pattern) rejectionReasons.push("The latest 15-minute candle is not a bullish Open=Low candle.");
  if (!passed.breakout) rejectionReasons.push("The candle did not close above the preceding three-candle range.");
  if (!passed.vwap) rejectionReasons.push("The candle did not close above session VWAP.");
  if (!passed.trend) rejectionReasons.push("EMA 9 is not above EMA 20.");
  if (!passed.freshness) rejectionReasons.push("The latest completed signal candle is more than 30 minutes old.");

  const signalBias = rejectionReasons.length === 0 ? direction : "NO TRADE";
  const atr15m = calculateAtr(sessionBars.length >= 14 ? sessionBars : input.bars15m.filter((bar) => bar.timestamp <= first.timestamp).slice(-14));
  const entryTrigger = signalBias === "BUY" ? first.high + 0.05 : null;
  const target = entryTrigger == null
    ? null
    : entryTrigger * (1 + EXPECTED_BUY_GAIN_PERCENT / 100);
  const stopLoss = signalBias === "BUY" ? first.low : null;
  const patternMatch = direction === "BUY"
    ? `15-minute breakout above VWAP with EMA 9/20 alignment and ${formatMultiple(volumeMultiple)} relative volume`
    : "No fully confirmed rolling 15-minute BUY setup";

  return {
    symbol: input.symbol,
    name: input.name || input.symbol,
    market: input.market,
    currency: config.currency,
    sessionDate: firstDate,
    candleWindow: `${formatTime(firstParts.hour, firstParts.minute)}–${formatTime(firstParts.hour, firstParts.minute + 15)} ${config.suffix}`,
    evaluatedAt: now.toISOString(),
    signalBias,
    patternMatch,
    entryTrigger: round(entryTrigger), target: round(target), stopLoss: round(stopLoss), atr15m: round(atr15m),
    open: first.open, high: first.high, low: first.low, close: first.close,
    currentPrice: input.bars15m.filter((bar) => bar.timestamp >= first.timestamp).at(-1)?.close || first.close,
    firstCandleVolume: first.volume,
    samePeriodAverageVolume10d: Math.round(samePeriodAverageVolume10d),
    volumeMultiple: round(volumeMultiple) || 0,
    averageDailyVolume: Math.round(averageDailyVolume),
    wickPercent: round(wickPercent) || 0,
    vwap: round(vwap), ema9: round(ema9), ema20: round(ema20),
    passed,
    rejectionReasons,
    guardrailNote: signalBias === "NO TRADE"
      ? "No entry: every price, liquidity, breakout, VWAP, EMA, volume, wick and freshness gate must pass. Position size—not nominal share price—governs absolute financial risk."
      : "Use only while this completed 15-minute signal remains fresh; trail the stop to break-even after favorable continuation. Position size—not nominal share price—governs absolute financial risk.",
  };
}

function calculateAtr(bars: CandleBar[]): number | null {
  if (bars.length < 2) return null;
  const ranges = bars.slice(1).map((bar, index) => Math.max(
    bar.high - bar.low,
    Math.abs(bar.high - bars[index].close),
    Math.abs(bar.low - bars[index].close),
  ));
  return average(ranges.slice(-14));
}

function calculateVwap(bars: CandleBar[]): number | null {
  const totals = bars.reduce((acc, bar) => ({
    priceVolume: acc.priceVolume + ((bar.high + bar.low + bar.close) / 3) * bar.volume,
    volume: acc.volume + bar.volume,
  }), { priceVolume: 0, volume: 0 });
  return totals.volume > 0 ? totals.priceVolume / totals.volume : null;
}

function calculateEma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const multiplier = 2 / (period + 1);
  let value = average(values.slice(0, period));
  for (const next of values.slice(period)) value = next * multiplier + value * (1 - multiplier);
  return value;
}

function localParts(timestamp: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(timestamp * 1000));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "0";
  return { date: `${value("year")}-${value("month")}-${value("day")}`, hour: Number(value("hour")), minute: Number(value("minute")) };
}

function average(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function round(value: number | null) { return value == null || !Number.isFinite(value) ? null : Math.round(value * 100) / 100; }
function formatMultiple(value: number) { return `${Number.isFinite(value) ? value.toFixed(2) : "0.00"}×`; }
function formatTime(hour: number, minute: number) {
  const normalizedHour = hour + Math.floor(minute / 60);
  const normalizedMinute = minute % 60;
  return `${String(normalizedHour).padStart(2, "0")}:${String(normalizedMinute).padStart(2, "0")}`;
}
