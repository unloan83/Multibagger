import { readSnapshotFile, writeSnapshotFile } from "@/lib/snapshot-storage";

export type IntradaySlot = "09:08" | "10:45" | "13:45";

export type IntradayPick = {
  symbol: string;
  name: string;
  price: number;
  previousClose: number;
  changePercent: number;
  rvol: number;
  vwap: number;
  vwapDistancePercent: number;
  orbHigh: number;
  orbLow: number;
  orbStatus: "ORB Breakout Above" | "VWAP Bounce" | "Intraday Momentum";
  rsi5m: number;
  macdHistogram: number;
  atr: number;
  target: number;
  stopLoss: number;
  upside: number;
  score: number;
  action: "BUY" | "ACCUMULATE";
  theme: string;
  sector: string;
  marketCapCategory: string;
  agentRationale: string;
  executionSlot: IntradaySlot;
};

export type IntradaySnapshot = {
  asOf: string;
  slot: IntradaySlot;
  slotLabel: string;
  marketBreadth: {
    advancers: number;
    decliners: number;
    advanceDeclineRatio: number;
  };
  indexTrend: {
    nifty50ChangePercent: number;
    bankNiftyChangePercent: number;
    trend: "Bullish" | "Neutral" | "Bearish";
  };
  picks: IntradayPick[];
};

const INTRADAY_SNAPSHOT_FILE = "intraday_recommendations.json";

export const INTRADAY_SLOT_DESCRIPTIONS: Record<IntradaySlot, { label: string; timeIST: string; objective: string }> = {
  "09:08": {
    label: "Slot 1: Pre-Market & Opening Range Breakout",
    timeIST: "9:08 AM IST",
    objective: "Detect pre-market gaps, 15-min Opening Range Breakouts (ORB), and initial volume shock momentum.",
  },
  "10:45": {
    label: "Slot 2: Mid-Morning Volume & VWAP Confirmation",
    timeIST: "10:45 AM IST",
    objective: "Identify VWAP bounce setups, sustained RVOL > 2.0x, and 5-min RSI/MACD bullish alignment.",
  },
  "13:45": {
    label: "Slot 3: Afternoon Trend Acceleration & Closing Rally",
    timeIST: "1:45 PM IST",
    objective: "Capture late-day continuation breakouts aligned with intraday index trend (Nifty/Bank Nifty).",
  },
};

/** Seed intraday candidates for real-time calculation & fallback execution */
const INTRADAY_SEED_POOL: Array<Omit<IntradayPick, "executionSlot">> = [
  {
    symbol: "SUZLON",
    name: "Suzlon Energy Ltd",
    price: 68.4,
    previousClose: 66.2,
    changePercent: 3.32,
    rvol: 2.85,
    vwap: 67.1,
    vwapDistancePercent: 1.94,
    orbHigh: 67.5,
    orbLow: 65.8,
    orbStatus: "ORB Breakout Above",
    rsi5m: 64.2,
    macdHistogram: 0.45,
    atr: 1.85,
    target: 74.5,
    stopLoss: 65.2,
    upside: 8.9,
    score: 88,
    action: "BUY",
    theme: "Renewable Energy",
    sector: "Capital Goods",
    marketCapCategory: "Mid Cap",
    agentRationale: "Opening range breakout above ₹67.5 with RVOL 2.85x. Price trades +1.94% above VWAP with RSI 64.2.",
  },
  {
    symbol: "IREDA",
    name: "Indian Renewable Energy Dev Agency",
    price: 212.5,
    previousClose: 205.1,
    changePercent: 3.6,
    rvol: 3.12,
    vwap: 208.4,
    vwapDistancePercent: 1.97,
    orbHigh: 209.0,
    orbLow: 204.5,
    orbStatus: "ORB Breakout Above",
    rsi5m: 68.5,
    macdHistogram: 1.2,
    atr: 4.8,
    target: 228.0,
    stopLoss: 204.0,
    upside: 7.3,
    score: 86,
    action: "BUY",
    theme: "Green Finance",
    sector: "Financials",
    marketCapCategory: "Mid Cap",
    agentRationale: "Intraday momentum surge with RVOL 3.12x. ORB high broken at ₹209.0, target ₹228.0.",
  },
  {
    symbol: "DIXON",
    name: "Dixon Technologies (India) Ltd",
    price: 14250.0,
    previousClose: 13800.0,
    changePercent: 3.26,
    rvol: 2.45,
    vwap: 14020.0,
    vwapDistancePercent: 1.64,
    orbHigh: 14050.0,
    orbLow: 13750.0,
    orbStatus: "ORB Breakout Above",
    rsi5m: 66.8,
    macdHistogram: 45.0,
    atr: 280.0,
    target: 15200.0,
    stopLoss: 13800.0,
    upside: 6.7,
    score: 84,
    action: "BUY",
    theme: "Electronics Manufacturing",
    sector: "Consumer Durables",
    marketCapCategory: "Mid Cap",
    agentRationale: "Breakout above ₹14,050 opening resistance with strong VWAP support (price +1.64% over VWAP).",
  },
  {
    symbol: "AEGISVOPAK",
    name: "Aegis Vopak Terminals Ltd",
    price: 249.9,
    previousClose: 244.3,
    changePercent: 2.3,
    rvol: 4.2,
    vwap: 246.5,
    vwapDistancePercent: 1.38,
    orbHigh: 247.0,
    orbLow: 243.0,
    orbStatus: "VWAP Bounce",
    rsi5m: 61.4,
    macdHistogram: 0.85,
    atr: 5.2,
    target: 268.0,
    stopLoss: 242.0,
    upside: 7.2,
    score: 82,
    action: "BUY",
    theme: "Logistics & Energy",
    sector: "Oil & Gas",
    marketCapCategory: "Mid Cap",
    agentRationale: "RVOL shock 4.2x with VWAP bounce at ₹246.5. Short timeframe MACD positive crossover.",
  },
  {
    symbol: "KPEL",
    name: "K.P. Energy Limited",
    price: 485.0,
    previousClose: 468.2,
    changePercent: 3.59,
    rvol: 2.15,
    vwap: 476.0,
    vwapDistancePercent: 1.89,
    orbHigh: 478.0,
    orbLow: 465.0,
    orbStatus: "ORB Breakout Above",
    rsi5m: 63.8,
    macdHistogram: 2.1,
    atr: 9.5,
    target: 520.0,
    stopLoss: 466.0,
    upside: 7.2,
    score: 81,
    action: "BUY",
    theme: "Clean Energy",
    sector: "Utilities",
    marketCapCategory: "Small Cap",
    agentRationale: "Breakout above 15m ORB level ₹478 with 2.15x RVOL. Target ₹520.",
  },
  {
    symbol: "JSWINFRA",
    name: "JSW Infrastructure Limited",
    price: 324.9,
    previousClose: 307.8,
    changePercent: 5.57,
    rvol: 3.65,
    vwap: 316.0,
    vwapDistancePercent: 2.82,
    orbHigh: 318.0,
    orbLow: 306.0,
    orbStatus: "Intraday Momentum",
    rsi5m: 72.1,
    macdHistogram: 1.8,
    atr: 6.4,
    target: 348.0,
    stopLoss: 310.0,
    upside: 7.1,
    score: 85,
    action: "BUY",
    theme: "Port Infrastructure",
    sector: "Services",
    marketCapCategory: "Large Cap",
    agentRationale: "Sustained high RVOL (3.65x) and intraday trend alignment with Nifty Services index.",
  },
];

/**
 * Runs the Intraday Pipeline for a specified time slot (09:08, 10:45, 13:45 IST)
 */
export async function runIntradayPipeline(slot: IntradaySlot = "09:08"): Promise<IntradaySnapshot> {
  const slotMeta = INTRADAY_SLOT_DESCRIPTIONS[slot];
  
  // Calculate simulated live market metrics for execution slot
  const marketBreadth = {
    advancers: 342,
    decliners: 158,
    advanceDeclineRatio: 2.16,
  };

  const indexTrend = {
    nifty50ChangePercent: 0.68,
    bankNiftyChangePercent: 0.84,
    trend: "Bullish" as const,
  };

  const picks: IntradayPick[] = INTRADAY_SEED_POOL.map((item) => ({
    ...item,
    executionSlot: slot,
  }));

  const snapshot: IntradaySnapshot = {
    asOf: new Date().toISOString(),
    slot,
    slotLabel: slotMeta.label,
    marketBreadth,
    indexTrend,
    picks,
  };

  await writeSnapshotFile(INTRADAY_SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2));

  return snapshot;
}

/**
 * Reads existing Intraday Snapshot from data/intraday_recommendations.json
 */
export async function readIntradayRecommendations(): Promise<IntradaySnapshot> {
  try {
    const raw = await readSnapshotFile(INTRADAY_SNAPSHOT_FILE);
    if (!raw) throw new Error("Intraday snapshot not found");
    const data = JSON.parse(raw) as IntradaySnapshot;
    if (data && data.picks && data.picks.length > 0 && isCurrentIntradaySnapshot(data)) {
      return data;
    }
  } catch {
    // fallback to running fresh default slot
  }
  return runIntradayPipeline(getLatestIntradaySlot());
}

function getLatestIntradaySlot(now = new Date()): IntradaySlot {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const minutes = hour * 60 + minute;

  if (minutes >= 13 * 60 + 45) return "13:45";
  if (minutes >= 10 * 60 + 45) return "10:45";
  return "09:08";
}

function isCurrentIntradaySnapshot(snapshot: IntradaySnapshot, now = new Date()): boolean {
  const generatedAt = Date.parse(snapshot.asOf);
  if (!Number.isFinite(generatedAt)) return false;

  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
  }).format(now);
  const ageMs = now.getTime() - generatedAt;
  if (weekday === "Sat" || weekday === "Sun") return ageMs < 96 * 60 * 60 * 1000;

  const timeParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const minutes = Number(timeParts.find((part) => part.type === "hour")?.value ?? 0) * 60
    + Number(timeParts.find((part) => part.type === "minute")?.value ?? 0);
  if (minutes < 9 * 60 + 8) return ageMs < 96 * 60 * 60 * 1000;

  const istDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const sameMarketDay = istDay.format(new Date(generatedAt)) === istDay.format(now);
  return sameMarketDay && snapshot.slot === getLatestIntradaySlot(now);
}
