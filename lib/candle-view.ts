export type CandleMarket = "india" | "us";
export type CandleSignal = "BUY" | "SELL" | "NO TRADE";

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
  passed: {
    price: boolean;
    liquidity: boolean;
    volume: boolean;
    wick: boolean;
    pattern: boolean;
  };
  rejectionReasons: string[];
  guardrailNote: string;
};

export type CandleBar = { timestamp: number; open: number; high: number; low: number; close: number; volume: number };

export function evaluateOpeningCandle(input: {
  symbol: string;
  name?: string;
  market: CandleMarket;
  bars15m: CandleBar[];
  dailyVolumes: number[];
  now?: Date;
}): CandleViewResult {
  const config = input.market === "india"
    ? { zone: "Asia/Kolkata", hour: 9, minute: 15, window: "9:15–9:30 AM IST", currency: "INR" as const }
    : { zone: "America/New_York", hour: 9, minute: 30, window: "9:30–9:45 AM ET", currency: "USD" as const };
  const candidates = input.bars15m.filter((bar) => {
    const parts = localParts(bar.timestamp, config.zone);
    return parts.hour === config.hour && parts.minute === config.minute;
  });
  const first = candidates.at(-1);
  if (!first) throw new Error(`No completed ${config.window} candle is available yet.`);

  const firstDate = localParts(first.timestamp, config.zone).date;
  const earlierSamePeriod = candidates.filter((bar) => localParts(bar.timestamp, config.zone).date !== firstDate).slice(-10);
  const samePeriodAverageVolume10d = average(earlierSamePeriod.map((bar) => bar.volume));
  const averageDailyVolume = average(input.dailyVolumes.filter((value) => value > 0).slice(-10));
  const volumeMultiple = samePeriodAverageVolume10d > 0 ? first.volume / samePeriodAverageVolume10d : 0;
  const range = first.high - first.low;
  const wickPercent = range > 0 ? ((range - Math.abs(first.close - first.open)) / range) * 100 : 100;
  const tolerance = 0.0051;
  const openLow = Math.abs(first.open - first.low) <= tolerance;
  const openHigh = Math.abs(first.open - first.high) <= tolerance;
  const direction: CandleSignal = openLow && !openHigh ? "BUY" : openHigh && !openLow ? "SELL" : "NO TRADE";
  const passed = {
    price: first.open > 50 && first.open < 500,
    liquidity: averageDailyVolume > 1_000_000,
    volume: earlierSamePeriod.length >= 10 && volumeMultiple >= 2,
    wick: wickPercent <= 40,
    pattern: direction !== "NO TRADE",
  };
  const rejectionReasons: string[] = [];
  if (!passed.price) rejectionReasons.push(`Opening price must be strictly between ${config.currency === "INR" ? "₹" : "$"}50 and ${config.currency === "INR" ? "₹" : "$"}500.`);
  if (!passed.liquidity) rejectionReasons.push("10-session average daily volume does not exceed 1,000,000 shares.");
  if (!passed.volume) rejectionReasons.push(earlierSamePeriod.length < 10 ? "Ten prior same-period candles are not available." : "First-candle volume is below 2× its 10-day same-period average.");
  if (!passed.wick) rejectionReasons.push("Combined candle shadows exceed 40% of the full candle range.");
  if (!passed.pattern) rejectionReasons.push("The opening candle is neither Open=Low nor Open=High.");

  const signalBias = rejectionReasons.length === 0 ? direction : "NO TRADE";
  const sessionBars = input.bars15m.filter((bar) => localParts(bar.timestamp, config.zone).date === firstDate && bar.timestamp <= first.timestamp);
  const atr15m = calculateAtr(sessionBars.length >= 14 ? sessionBars : input.bars15m.filter((bar) => bar.timestamp <= first.timestamp).slice(-14));
  const entryTrigger = signalBias === "BUY" ? first.high + 0.05 : signalBias === "SELL" ? first.low - 0.05 : null;
  const target = entryTrigger == null || atr15m == null ? null : signalBias === "BUY" ? entryTrigger + atr15m : entryTrigger - atr15m;
  const stopLoss = signalBias === "BUY" ? first.low : signalBias === "SELL" ? first.high : null;
  const patternMatch = direction === "BUY"
    ? `Open=Low confirmed with ${formatMultiple(volumeMultiple)} volume spike`
    : direction === "SELL"
      ? `Open=High confirmed with ${formatMultiple(volumeMultiple)} volume spike`
      : "No valid Open=Low or Open=High configuration";

  return {
    symbol: input.symbol,
    name: input.name || input.symbol,
    market: input.market,
    currency: config.currency,
    sessionDate: firstDate,
    candleWindow: config.window,
    evaluatedAt: (input.now || new Date()).toISOString(),
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
    passed,
    rejectionReasons,
    guardrailNote: signalBias === "NO TRADE"
      ? "No entry: every price, liquidity, pattern, volume and wick gate must pass. Position size—not nominal share price—governs absolute financial risk."
      : "If the target is not hit by 10:30 AM local exchange time, trail the stop to break-even (entry). Position size—not nominal share price—governs absolute financial risk.",
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

function localParts(timestamp: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(timestamp * 1000));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "0";
  return { date: `${value("year")}-${value("month")}-${value("day")}`, hour: Number(value("hour")), minute: Number(value("minute")) };
}

function average(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function round(value: number | null) { return value == null || !Number.isFinite(value) ? null : Math.round(value * 100) / 100; }
function formatMultiple(value: number) { return `${Number.isFinite(value) ? value.toFixed(2) : "0.00"}×`; }
