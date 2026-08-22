import type { MarketCandle, OptionContract, OptionsBroker } from "@/features/options-quant/brokers/types";
import type { DirectionEvidence, MarketDirection } from "@/features/options-quant/lib/types";

const NIFTY_KEY = "NSE_INDEX|Nifty 50";
const BANK_NIFTY_KEY = "NSE_INDEX|Nifty Bank";
const MODEL_VERSION = "upstox-nifty-direction-v1";

export async function buildLiveDirectionEvidence(
  broker: OptionsBroker,
  now = new Date(),
): Promise<DirectionEvidence> {
  const [niftyCandles, bankCandles, contracts] = await Promise.all([
    broker.getIntradayCandles(NIFTY_KEY, 1),
    broker.getIntradayCandles(BANK_NIFTY_KEY, 1),
    broker.getOptionContracts(NIFTY_KEY),
  ]);
  assertFreshCandles("NIFTY 50", niftyCandles, now);
  assertFreshCandles("NIFTY BANK", bankCandles, now);

  const expiry = nearestEligibleExpiry(contracts, now);
  if (!expiry) throw new Error("No NIFTY option expiry is available within the 2–10 DTE direction window.");
  const chain = await broker.getOptionChain(NIFTY_KEY, expiry);
  const callOi = chain.reduce((sum, row) => sum + (row.call?.oi || 0), 0);
  const putOi = chain.reduce((sum, row) => sum + (row.put?.oi || 0), 0);
  if (!(callOi > 0 && putOi > 0)) throw new Error("Upstox option-chain OI is incomplete; direction remains NO TRADE.");

  const nifty = momentum(niftyCandles);
  const bank = momentum(bankCandles);
  const putCallOiRatio = round(putOi / callOi, 3);
  const alignedTrend = Math.sign(nifty.returnFromOpenBps) === Math.sign(nifty.fastSlowGapBps)
    && Math.abs(nifty.returnFromOpenBps) >= 10
    && Math.abs(nifty.fastSlowGapBps) >= 1
    && nifty.openingRangeDirection !== "RANGE";
  const candidate: MarketDirection = !alignedTrend
    ? "RANGE"
    : nifty.returnFromOpenBps > 0 && nifty.openingRangeDirection === "BULLISH" ? "BULLISH"
      : nifty.returnFromOpenBps < 0 && nifty.openingRangeDirection === "BEARISH" ? "BEARISH" : "RANGE";

  const directionSign = candidate === "BEARISH" ? -1 : 1;
  const trendStrength = candidate === "RANGE"
    ? clamp(50 + Math.abs(nifty.returnFromOpenBps) * 0.2)
    : clamp(50 + Math.abs(nifty.returnFromOpenBps) * 0.7 + Math.abs(nifty.fastSlowGapBps) * 2);
  const bankNiftyConfirmation = candidate === "RANGE"
    ? 50
    : clamp(50 + directionSign * bank.returnFromOpenBps * 0.6 + directionSign * bank.fastSlowGapBps * 2);
  const optionChainConfirmation = candidate === "RANGE"
    ? 50
    : candidate === "BULLISH"
      ? clamp(50 + (putCallOiRatio - 1) * 100)
      : clamp(50 + (1 - putCallOiRatio) * 100);
  const confidence = Math.round(trendStrength * 0.55 + bankNiftyConfirmation * 0.25 + optionChainConfirmation * 0.2);
  const direction = candidate !== "RANGE"
      && trendStrength >= 65
      && bankNiftyConfirmation >= 60
      && optionChainConfirmation >= 45
      && confidence >= 75
    ? candidate
    : "RANGE";
  const latestMarketTimestamp = niftyCandles.at(-1)!.timestamp;

  return {
    asOf: latestMarketTimestamp,
    direction,
    confidence,
    marketRegime: direction === "BULLISH" ? "INTRADAY_TREND_UP" : direction === "BEARISH" ? "INTRADAY_TREND_DOWN" : "TRANSITION",
    trendStrength: round(trendStrength),
    bankNiftyConfirmation: round(bankNiftyConfirmation),
    optionChainConfirmation: round(optionChainConfirmation),
    observations: {
      niftyReturnFromOpenBps: round(nifty.returnFromOpenBps),
      niftyFastSlowGapBps: round(nifty.fastSlowGapBps),
      niftyOpeningRangeDirection: nifty.openingRangeDirection,
      bankNiftyReturnFromOpenBps: round(bank.returnFromOpenBps),
      bankNiftyFastSlowGapBps: round(bank.fastSlowGapBps),
      putCallOiRatio,
      optionExpiry: expiry,
      latestMarketTimestamp,
    },
    sourceIds: [
      "upstox-v3-intraday:NSE_INDEX|Nifty 50:1m",
      "upstox-v3-intraday:NSE_INDEX|Nifty Bank:1m",
      `upstox-v2-option-chain:NSE_INDEX|Nifty 50:${expiry}`,
    ],
    modelVersion: MODEL_VERSION,
  };
}

function assertFreshCandles(name: string, candles: MarketCandle[], now: Date) {
  if (candles.length < 16) throw new Error(`${name} has fewer than sixteen valid one-minute candles; opening-range direction remains NO TRADE.`);
  const latest = Date.parse(candles.at(-1)!.timestamp);
  const ageMinutes = (now.getTime() - latest) / 60_000;
  if (!Number.isFinite(latest) || ageMinutes < -2 || ageMinutes > 10) {
    throw new Error(`${name} candles are stale or future-dated; direction remains NO TRADE.`);
  }
}

function nearestEligibleExpiry(contracts: OptionContract[], now: Date): string | null {
  const expiries = [...new Set(contracts.map((contract) => contract.expiry))]
    .map((expiry) => ({ expiry, days: daysBetween(now, new Date(`${expiry}T15:30:00+05:30`)) }))
    .filter(({ days }) => days >= 2 && days <= 10)
    .sort((left, right) => left.expiry.localeCompare(right.expiry));
  return expiries[0]?.expiry || null;
}

function momentum(candles: MarketCandle[]) {
  const closes = candles.map((candle) => candle.close);
  const sessionOpen = candles[0].open;
  const latest = closes.at(-1)!;
  const fast = ema(closes, 5);
  const slow = ema(closes, 13);
  const opening = candles.slice(0, 15);
  const openingHigh = Math.max(...opening.map((candle) => candle.high));
  const openingLow = Math.min(...opening.map((candle) => candle.low));
  const openingRangeDirection: MarketDirection = latest > openingHigh
    ? "BULLISH" : latest < openingLow ? "BEARISH" : "RANGE";
  return {
    returnFromOpenBps: ((latest - sessionOpen) / sessionOpen) * 10_000,
    fastSlowGapBps: ((fast - slow) / slow) * 10_000,
    openingRangeDirection,
  };
}

function ema(values: number[], period: number): number {
  const alpha = 2 / (period + 1);
  return values.slice(1).reduce((value, next) => next * alpha + value * (1 - alpha), values[0]);
}

function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / 86_400_000);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}
