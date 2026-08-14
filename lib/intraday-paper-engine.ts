import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const TRADES_FILE = path.join(DATA_DIR, "intraday_paper_trades.json");
const DAILY_HISTORY_FILE = path.join(DATA_DIR, "intraday_daily_history.json");
const RECOMMENDATIONS_LOG_FILE = path.join(DATA_DIR, "recommendations_history.json");

export type IntradayPaperTrade = {
  id: string;
  date: string; // YYYY-MM-DD
  entryTime: string; // HH:MM:SS
  exitTime: string | null;
  symbol: string;
  action: "BUY" | "SELL";
  entryPrice: number;
  quantity: number;
  capitalUsed: number;
  targetPrice: number;
  stopLossPrice: number;
  currentPrice: number;
  exitPrice: number | null;
  targetHit: "YES" | "NO";
  stopLossHit: "YES" | "NO";
  exitReason:
    | "OPEN"
    | "TARGET HIT"
    | "STOP LOSS HIT"
    | "TRAILING STOP"
    | "STRATEGY EXIT"
    | "TIME EXIT"
    | "EOD SQUARE OFF"
    | "DAILY TARGET LOCK"
    | "KILL SWITCH"
    | "MANUAL EXIT";
  pnlRupees: number;
  pnlPercent: number;
  status: "OPEN" | "TARGET HIT" | "STOP LOSS HIT" | "MANUAL/STRATEGY EXIT" | "EOD EXIT" | "REJECTED";
  cumulativeDailyPnl: number;
};

export type DailySummary = {
  date: string;
  trades: number;
  targetsHit: number;
  stopLossesHit: number;
  otherExits: number;
  wins: number;
  losses: number;
  dailyPnl: number;
  target3kAchieved: "YES" | "NO";
};

export type CandidateSignal = {
  symbol: string;
  cmp: number;
  target: number;
  stopLoss: number;
  signal: "BUY" | "SELL";
  score: number;
  remark?: string;
};

export type SystemStatus = {
  tradingMode: "AUTOMATIC" | "USER_DRIVEN";
  isTradingDay: boolean;
  dayName: string;
  startingCapital: number;
  availableCapital: number;
  capitalUsed: number;
  dailyProfitTarget: number;
  currentDailyPnl: number;
  tradingStatus: "ACTIVE" | "TARGET ACHIEVED" | "CAPITAL EXHAUSTED" | "MARKET CLOSED";
  openTradesCount: number;
  completedTradesCount: number;
};

const STARTING_CAPITAL = 30000;
const DAILY_TARGET_CAP = 3000;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function readAllPaperTrades(): IntradayPaperTrade[] {
  ensureDataDir();
  if (!fs.existsSync(TRADES_FILE)) return [];
  try {
    const raw = fs.readFileSync(TRADES_FILE, "utf-8");
    return JSON.parse(raw) as IntradayPaperTrade[];
  } catch {
    return [];
  }
}

export function writeAllPaperTrades(trades: IntradayPaperTrade[]): void {
  ensureDataDir();
  fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2), "utf-8");
}

export function readDailySummaries(): DailySummary[] {
  ensureDataDir();
  if (!fs.existsSync(DAILY_HISTORY_FILE)) return [];
  try {
    const raw = fs.readFileSync(DAILY_HISTORY_FILE, "utf-8");
    return JSON.parse(raw) as DailySummary[];
  } catch {
    return [];
  }
}

export function writeDailySummaries(summaries: DailySummary[]): void {
  ensureDataDir();
  fs.writeFileSync(DAILY_HISTORY_FILE, JSON.stringify(summaries, null, 2), "utf-8");
}

export function logRecommendationHistory(item: Record<string, unknown>): void {
  ensureDataDir();
  let log: Record<string, unknown>[] = [];
  if (fs.existsSync(RECOMMENDATIONS_LOG_FILE)) {
    try {
      log = JSON.parse(fs.readFileSync(RECOMMENDATIONS_LOG_FILE, "utf-8"));
    } catch {}
  }
  log.unshift({ ...item, timestamp: new Date().toISOString() });
  if (log.length > 500) log = log.slice(0, 500);
  fs.writeFileSync(RECOMMENDATIONS_LOG_FILE, JSON.stringify(log, null, 2), "utf-8");
}

export function getTradingScheduleInfo(dateObj = new Date()): { mode: "AUTOMATIC" | "USER_DRIVEN"; isTradingDay: boolean; dayName: string } {
  const dayOfWeek = dateObj.getDay(); // 0: Sun, 1: Mon, 2: Tue, 3: Wed, 4: Thu, 5: Fri, 6: Sat
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayName = dayNames[dayOfWeek];

  // Mon (1), Tue (2), Wed (3) = AUTOMATIC systems-driven
  // Thu (4), Fri (5) = USER_DRIVEN
  if (dayOfWeek >= 1 && dayOfWeek <= 3) {
    return { mode: "AUTOMATIC", isTradingDay: true, dayName };
  }
  if (dayOfWeek === 4 || dayOfWeek === 5) {
    return { mode: "USER_DRIVEN", isTradingDay: true, dayName };
  }
  return { mode: "AUTOMATIC", isTradingDay: false, dayName };
}

export function getTodayDateString(dateObj = new Date()): string {
  return dateObj.toISOString().split("T")[0];
}

export function updateAndGetPaperState(candidates: CandidateSignal[] = []): {
  systemStatus: SystemStatus;
  todayTrades: IntradayPaperTrade[];
  allTrades: IntradayPaperTrade[];
  dailySummaries: DailySummary[];
} {
  const now = new Date();
  const todayStr = getTodayDateString(now);
  const timeStr = now.toTimeString().split(" ")[0];
  const sched = getTradingScheduleInfo(now);

  const allTrades = readAllPaperTrades();
  const todayTrades = allTrades.filter((t) => t.date === todayStr);


  // 1. Monitor open trades against current candidate prices
  let modified = false;

  for (const trade of todayTrades) {
    if (trade.status === "OPEN") {
      const match = candidates.find((c) => c.symbol === trade.symbol);
      const livePrice = match ? match.cmp : trade.currentPrice;
      trade.currentPrice = livePrice;

      let isExit = false;

      // Check Target Hit
      if (trade.action === "BUY" && livePrice >= trade.targetPrice) {
        trade.targetHit = "YES";
        trade.stopLossHit = "NO";
        trade.status = "TARGET HIT";
        trade.exitReason = "TARGET HIT";
        trade.exitPrice = trade.targetPrice;
        isExit = true;
      } else if (trade.action === "BUY" && livePrice <= trade.stopLossPrice) {
        trade.targetHit = "NO";
        trade.stopLossHit = "YES";
        trade.status = "STOP LOSS HIT";
        trade.exitReason = "STOP LOSS HIT";
        trade.exitPrice = trade.stopLossPrice;
        isExit = true;
      }

      if (isExit) {
        trade.exitTime = timeStr;
        const diff = (trade.exitPrice! - trade.entryPrice) * (trade.action === "BUY" ? 1 : -1);
        trade.pnlRupees = Math.round(diff * trade.quantity);
        trade.pnlPercent = Number(((diff / trade.entryPrice) * 100).toFixed(2));
        modified = true;
      }
    }
  }

  // 2. Calculate PnL totals for today
  let closedPnlToday = 0;
  let openCapitalUsed = 0;

  for (const t of todayTrades) {
    if (t.status === "OPEN") {
      openCapitalUsed += t.capitalUsed;
    } else {
      closedPnlToday += t.pnlRupees;
    }
  }

  const availableCapital = Math.max(0, STARTING_CAPITAL - openCapitalUsed + closedPnlToday);
  const currentDailyPnl = closedPnlToday;

  let tradingStatus: SystemStatus["tradingStatus"] = "ACTIVE";
  if (currentDailyPnl >= DAILY_TARGET_CAP) {
    tradingStatus = "TARGET ACHIEVED";
  } else if (availableCapital < 1000) {
    tradingStatus = "CAPITAL EXHAUSTED";
  }

  // 3. Automatically execute new candidates if mode is AUTOMATIC and tradingStatus === ACTIVE
  if (sched.mode === "AUTOMATIC" && tradingStatus === "ACTIVE" && candidates.length > 0) {
    for (const cand of candidates) {
      if (cand.cmp < 150) continue; // CMP Gate >= 150

      // Check if already open today
      const existing = todayTrades.find((t) => t.symbol === cand.symbol && (t.status === "OPEN" || t.status === "TARGET HIT"));
      if (existing) continue;

      // Allocate capital (up to 10k per trade out of 30k total)
      const perTradeCap = Math.min(availableCapital, 10000);
      const qty = Math.floor(perTradeCap / cand.cmp);

      if (qty >= 1 && perTradeCap >= cand.cmp) {
        const tradeId = `PT-${todayStr.replace(/-/g, "")}-${String(todayTrades.length + 1).padStart(3, "0")}`;
        const capitalUsed = Math.round(qty * cand.cmp);

        const newTrade: IntradayPaperTrade = {
          id: tradeId,
          date: todayStr,
          entryTime: timeStr,
          exitTime: null,
          symbol: cand.symbol,
          action: cand.signal || "BUY",
          entryPrice: cand.cmp,
          quantity: qty,
          capitalUsed,
          targetPrice: cand.target,
          stopLossPrice: cand.stopLoss,
          currentPrice: cand.cmp,
          exitPrice: null,
          targetHit: "NO",
          stopLossHit: "NO",
          exitReason: "OPEN",
          pnlRupees: 0,
          pnlPercent: 0,
          status: "OPEN",
          cumulativeDailyPnl: currentDailyPnl,
        };

        allTrades.unshift(newTrade);
        todayTrades.unshift(newTrade);
        modified = true;

        logRecommendationHistory({
          symbol: cand.symbol,
          action: "EXECUTED",
          price: cand.cmp,
          qty,
          tradeId,
        });

        // Update capital used for subsequent candidates in same tick
        openCapitalUsed += capitalUsed;
      } else {
        logRecommendationHistory({
          symbol: cand.symbol,
          action: "CAPITAL REJECTED",
          price: cand.cmp,
          reason: "Insufficient available capital",
        });
      }
    }
  }

  // 4. Recalculate cumulative daily PnL across today's trades
  let runningPnl = 0;
  for (let i = todayTrades.length - 1; i >= 0; i--) {
    if (todayTrades[i].status !== "OPEN") {
      runningPnl += todayTrades[i].pnlRupees;
    }
    todayTrades[i].cumulativeDailyPnl = runningPnl;
  }

  if (modified) {
    writeAllPaperTrades(allTrades);
  }

  // 5. Update EOD Daily Summary
  const summaries = readDailySummaries();

  const summaryIdx = summaries.findIndex((s) => s.date === todayStr);

  const targetsHitCount = todayTrades.filter((t) => t.targetHit === "YES").length;
  const stopLossesHitCount = todayTrades.filter((t) => t.stopLossHit === "YES").length;
  const otherExitsCount = todayTrades.filter((t) => t.status !== "OPEN" && t.targetHit === "NO" && t.stopLossHit === "NO").length;
  const winsCount = todayTrades.filter((t) => t.pnlRupees > 0).length;
  const lossesCount = todayTrades.filter((t) => t.pnlRupees < 0).length;

  const todaySummary: DailySummary = {
    date: todayStr,
    trades: todayTrades.length,
    targetsHit: targetsHitCount,
    stopLossesHit: stopLossesHitCount,
    otherExits: otherExitsCount,
    wins: winsCount,
    losses: lossesCount,
    dailyPnl: currentDailyPnl,
    target3kAchieved: currentDailyPnl >= DAILY_TARGET_CAP ? "YES" : "NO",
  };

  if (summaryIdx >= 0) {
    summaries[summaryIdx] = todaySummary;
  } else if (todayTrades.length > 0) {
    summaries.unshift(todaySummary);
  }
  writeDailySummaries(summaries);

  const systemStatus: SystemStatus = {
    tradingMode: sched.mode,
    isTradingDay: sched.isTradingDay,
    dayName: sched.dayName,
    startingCapital: STARTING_CAPITAL,
    availableCapital,
    capitalUsed: openCapitalUsed,
    dailyProfitTarget: DAILY_TARGET_CAP,
    currentDailyPnl,
    tradingStatus,
    openTradesCount: todayTrades.filter((t) => t.status === "OPEN").length,
    completedTradesCount: todayTrades.filter((t) => t.status !== "OPEN").length,
  };

  return {
    systemStatus,
    todayTrades,
    allTrades,
    dailySummaries: summaries,
  };
}

export function executeManualTradeAction(tradeId: string, action: "CLOSE_TARGET" | "CLOSE_STOP" | "CLOSE_MANUAL") {
  const allTrades = readAllPaperTrades();
  const trade = allTrades.find((t) => t.id === tradeId);
  if (!trade || trade.status !== "OPEN") return false;

  const now = new Date();
  trade.exitTime = now.toTimeString().split(" ")[0];

  if (action === "CLOSE_TARGET") {
    trade.targetHit = "YES";
    trade.stopLossHit = "NO";
    trade.status = "TARGET HIT";
    trade.exitReason = "TARGET HIT";
    trade.exitPrice = trade.targetPrice;
  } else if (action === "CLOSE_STOP") {
    trade.targetHit = "NO";
    trade.stopLossHit = "YES";
    trade.status = "STOP LOSS HIT";
    trade.exitReason = "STOP LOSS HIT";
    trade.exitPrice = trade.stopLossPrice;
  } else {
    trade.targetHit = "NO";
    trade.stopLossHit = "NO";
    trade.status = "MANUAL/STRATEGY EXIT";
    trade.exitReason = "MANUAL EXIT";
    trade.exitPrice = trade.currentPrice;
  }

  const diff = (trade.exitPrice! - trade.entryPrice) * (trade.action === "BUY" ? 1 : -1);
  trade.pnlRupees = Math.round(diff * trade.quantity);
  trade.pnlPercent = Number(((diff / trade.entryPrice) * 100).toFixed(2));

  writeAllPaperTrades(allTrades);
  return true;
}
