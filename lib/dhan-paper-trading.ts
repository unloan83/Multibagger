import { runCandleScanner } from "@/lib/candle-scanner";
import { readSnapshotFile, writeSnapshotFile } from "@/lib/snapshot-storage";

const STATE_FILE = "dhan_paper_session.json";
const SESSION_DAYS = 7;
const INITIAL_CAPITAL = 100_000;
const MAX_POSITION_VALUE = 10_000;
const MAX_QUOTE_AGE_MS = 20 * 60_000;

export type PaperQuoteSource = "YAHOO_INTRADAY_FREE" | "DHAN";
export type PaperPosition = {
  symbol: string; side: "BUY"; quantity: number; entryPrice: number; target: number; stopLoss: number;
  openedAt: string; openedQuoteAt: string; source: PaperQuoteSource;
};
export type PaperTrade = PaperPosition & {
  id: string; exitPrice: number | null; closedAt: string | null; closedQuoteAt: string | null;
  status: "OPEN" | "TARGET" | "STOP" | "SESSION_END"; pnl: number;
};
export type PaperShortlistAction = {
  symbol: string; signalPrice: number;
  outcome: "BOUGHT" | "ALREADY_TRADED" | "POSITION_LIMIT" | "STALE_QUOTE" | "RISK_INVALID";
};
export type PaperCycle = { runAt: string; quoteProvider: "YAHOO_INTRADAY_FREE"; actions: PaperShortlistAction[] };
export type PaperSession = {
  mode: "PAPER_ONLY"; startedAt: string; endsAt: string; updatedAt: string; status: "ACTIVE" | "COMPLETED";
  initialCapital: number; realizedPnl: number; quoteProvider: "YAHOO_INTRADAY_FREE"; quoteFeedLive: boolean;
  lastError: string | null; trades: PaperTrade[]; cycles: PaperCycle[];
};
type LiveQuote = { price: number; asOf: string; source: "YAHOO_INTRADAY_FREE" };

export async function getPaperSession(): Promise<PaperSession | null> {
  const raw = await readSnapshotFile(STATE_FILE);
  if (!raw) return null;
  try { return normalizeSession(JSON.parse(raw) as Partial<PaperSession> & { trades?: PaperTrade[] }); } catch { return null; }
}

export async function startPaperSession(): Promise<PaperSession> {
  const existing = await getPaperSession();
  if (existing?.status === "ACTIVE") return existing;
  const startedAt = new Date();
  const session: PaperSession = {
    mode: "PAPER_ONLY", startedAt: startedAt.toISOString(), endsAt: new Date(startedAt.getTime() + SESSION_DAYS * 86_400_000).toISOString(),
    updatedAt: startedAt.toISOString(), status: "ACTIVE", initialCapital: INITIAL_CAPITAL, realizedPnl: 0,
    quoteProvider: "YAHOO_INTRADAY_FREE", quoteFeedLive: false, lastError: null, trades: [], cycles: [],
  };
  await save(session);
  return session;
}

export async function runPaperCycle(): Promise<PaperSession> {
  const session = await getPaperSession();
  if (!session) throw new Error("Start the seven-day paper session first.");
  const now = new Date(); const expired = now >= new Date(session.endsAt);
  const open = session.trades.filter((trade) => trade.status === "OPEN");
  const scan = await runCandleScanner("india");
  const symbols = [...new Set([...open.map((trade) => trade.symbol), ...scan.shortlisted.map((result) => result.symbol)])];
  const { quotes, unavailable } = await fetchFreeLiveQuotes(symbols, now);

  for (const trade of open) {
    const quote = quotes.get(trade.symbol);
    if (!quote) continue;
    const targetHit = quote.price >= trade.target; const stopHit = quote.price <= trade.stopLoss;
    if (targetHit || stopHit || expired) closeTrade(trade, quote, targetHit ? "TARGET" : stopHit ? "STOP" : "SESSION_END", now);
  }

  if (!expired) {
    const cycle: PaperCycle = { runAt: now.toISOString(), quoteProvider: "YAHOO_INTRADAY_FREE", actions: [] };
    for (const signal of scan.shortlisted) {
      const action: PaperShortlistAction = { symbol: signal.symbol, signalPrice: signal.currentPrice, outcome: "STALE_QUOTE" };
      cycle.actions.push(action);
      if (session.trades.some((trade) => trade.symbol === signal.symbol && indiaDate(trade.openedAt) === indiaDate(now.toISOString()))) { action.outcome = "ALREADY_TRADED"; continue; }
      if (session.trades.filter((trade) => trade.status === "OPEN").length >= 5) { action.outcome = "POSITION_LIMIT"; continue; }
      const quote = quotes.get(signal.symbol);
      if (!quote || signal.stopLoss == null || signal.signalBias !== "BUY") continue;
      if (!(signal.stopLoss < quote.price)) { action.outcome = "RISK_INVALID"; continue; }
      action.outcome = "BOUGHT";
      const quantity = Math.max(1, Math.floor(MAX_POSITION_VALUE / quote.price));
      session.trades.push({
        id: `${now.getTime()}-${signal.symbol}`, symbol: signal.symbol, side: "BUY", quantity, entryPrice: quote.price,
        target: round(quote.price * 1.03), stopLoss: signal.stopLoss, openedAt: now.toISOString(), openedQuoteAt: quote.asOf,
        source: quote.source, exitPrice: null, closedAt: null, closedQuoteAt: null, status: "OPEN", pnl: 0,
      });
    }
    session.cycles = [...session.cycles, cycle].slice(-50);
  }

  session.realizedPnl = round(session.trades.reduce((sum, trade) => sum + trade.pnl, 0));
  session.status = expired ? "COMPLETED" : "ACTIVE"; session.updatedAt = now.toISOString();
  session.quoteProvider = "YAHOO_INTRADAY_FREE"; session.quoteFeedLive = symbols.length === 0 || quotes.size > 0;
  session.lastError = unavailable.length ? `No fresh free-market quote for: ${unavailable.join(", ")}. No fill was created for those symbols.` : null;
  await save(session);
  return session;
}

async function fetchFreeLiveQuotes(symbols: string[], now: Date): Promise<{ quotes: Map<string, LiveQuote>; unavailable: string[] }> {
  const results = await Promise.all(symbols.map(async (symbol) => {
    try { return [symbol, await fetchYahooIntradayQuote(symbol, now)] as const; } catch { return [symbol, null] as const; }
  }));
  const quotes = new Map<string, LiveQuote>(); const unavailable: string[] = [];
  for (const [symbol, quote] of results) { if (quote) quotes.set(symbol, quote); else unavailable.push(symbol); }
  return { quotes, unavailable };
}

async function fetchYahooIntradayQuote(symbol: string, now: Date): Promise<LiveQuote> {
  const ticker = symbol.endsWith(".NS") ? symbol : `${symbol}.NS`;
  const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1m&includePrePost=false`, {
    headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store", signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Quote returned ${response.status}`);
  const payload = await response.json() as { chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> } };
  const result = payload.chart?.result?.[0]; const timestamps = result?.timestamp || []; const closes = result?.indicators?.quote?.[0]?.close || [];
  let index = Math.min(timestamps.length, closes.length) - 1;
  while (index >= 0 && !(typeof closes[index] === "number" && closes[index]! > 0)) index--;
  if (index < 0) throw new Error("No intraday quote");
  const quoteTime = new Date(timestamps[index] * 1000); const age = now.getTime() - quoteTime.getTime();
  if (age < -60_000 || age > MAX_QUOTE_AGE_MS || indiaDate(quoteTime.toISOString()) !== indiaDate(now.toISOString())) throw new Error("Quote is stale");
  return { price: round(closes[index]!), asOf: quoteTime.toISOString(), source: "YAHOO_INTRADAY_FREE" };
}

function closeTrade(trade: PaperTrade, quote: LiveQuote, status: "TARGET" | "STOP" | "SESSION_END", now: Date) {
  trade.exitPrice = quote.price; trade.closedAt = now.toISOString(); trade.closedQuoteAt = quote.asOf; trade.status = status;
  trade.pnl = round((quote.price - trade.entryPrice) * trade.quantity);
}

function normalizeSession(value: Partial<PaperSession> & { trades?: PaperTrade[] }): PaperSession {
  const now = new Date();
  const session = value as PaperSession;
  session.mode = "PAPER_ONLY"; session.quoteProvider = "YAHOO_INTRADAY_FREE"; session.quoteFeedLive = false; session.lastError = null;
  session.cycles = (session.cycles || []).map((cycle) => ({ ...cycle, quoteProvider: "YAHOO_INTRADAY_FREE" }));
  session.trades = (session.trades || []).map((trade) => ({ ...trade, openedQuoteAt: trade.openedQuoteAt || trade.openedAt, closedQuoteAt: trade.closedQuoteAt || trade.closedAt || null }));
  if (session.status === "ACTIVE" && now.getTime() >= Date.parse(session.endsAt)) session.status = "COMPLETED";
  return session;
}
function indiaDate(value: string) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)); }
async function save(session: PaperSession) { await writeSnapshotFile(STATE_FILE, JSON.stringify(session, null, 2)); }
function round(value: number) { return Math.round(value * 100) / 100; }
