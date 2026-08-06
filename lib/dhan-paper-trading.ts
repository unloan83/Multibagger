import { runCandleScanner } from "@/lib/candle-scanner";
import { readSnapshotFile, writeSnapshotFile } from "@/lib/snapshot-storage";

const STATE_FILE = "dhan_paper_session.json";
const SESSION_DAYS = 7;
const INITIAL_CAPITAL = 100_000;
const MAX_POSITION_VALUE = 10_000;

export type PaperPosition = {
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  entryPrice: number;
  target: number;
  stopLoss: number;
  openedAt: string;
  source: "DHAN" | "SCANNER_FALLBACK";
};

export type PaperTrade = PaperPosition & {
  id: string;
  exitPrice: number | null;
  closedAt: string | null;
  status: "OPEN" | "TARGET" | "STOP" | "SESSION_END";
  pnl: number;
};

export type PaperSession = {
  mode: "PAPER_ONLY";
  startedAt: string;
  endsAt: string;
  updatedAt: string;
  status: "ACTIVE" | "COMPLETED";
  initialCapital: number;
  realizedPnl: number;
  dhanConnected: boolean;
  lastError: string | null;
  trades: PaperTrade[];
};

export async function getPaperSession(): Promise<PaperSession | null> {
  const raw = await readSnapshotFile(STATE_FILE);
  if (!raw) return null;
  try { return normalizeSession(JSON.parse(raw) as PaperSession); } catch { return null; }
}

export async function startPaperSession(): Promise<PaperSession> {
  const existing = await getPaperSession();
  if (existing?.status === "ACTIVE") return existing;
  const startedAt = new Date();
  const session: PaperSession = {
    mode: "PAPER_ONLY",
    startedAt: startedAt.toISOString(),
    endsAt: new Date(startedAt.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: startedAt.toISOString(),
    status: "ACTIVE",
    initialCapital: INITIAL_CAPITAL,
    realizedPnl: 0,
    dhanConnected: false,
    lastError: null,
    trades: [],
  };
  await save(session);
  return session;
}

export async function runPaperCycle(): Promise<PaperSession> {
  const session = await getPaperSession();
  if (!session) throw new Error("Start the seven-day paper session first.");
  const now = new Date();
  const expired = now >= new Date(session.endsAt);
  const open = session.trades.filter((trade) => trade.status === "OPEN");
  const scan = await runCandleScanner("india");
  const symbols = [...new Set([...open.map((trade) => trade.symbol), ...scan.shortlisted.map((result) => result.symbol)])];
  let quotes = new Map<string, number>();
  let dhanConnected = false;
  let lastError: string | null = null;
  try {
    quotes = await fetchDhanLtp(symbols);
    dhanConnected = true;
  } catch (error) {
    lastError = error instanceof Error ? error.message : "Dhan quote lookup failed.";
  }

  for (const trade of open) {
    const price = quotes.get(trade.symbol);
    if (price == null) continue;
    const targetHit = trade.side === "BUY" ? price >= trade.target : price <= trade.target;
    const stopHit = trade.side === "BUY" ? price <= trade.stopLoss : price >= trade.stopLoss;
    if (targetHit || stopHit || expired) closeTrade(trade, price, targetHit ? "TARGET" : stopHit ? "STOP" : "SESSION_END", now);
  }

  if (!expired) {
    for (const signal of scan.shortlisted) {
      if (session.trades.some((trade) => trade.symbol === signal.symbol && trade.openedAt.slice(0, 10) === now.toISOString().slice(0, 10))) continue;
      if (session.trades.filter((trade) => trade.status === "OPEN").length >= 5) break;
      const entryPrice = quotes.get(signal.symbol) ?? signal.currentPrice;
      if (!entryPrice || signal.target == null || signal.stopLoss == null || signal.signalBias !== "BUY") continue;
      const quantity = Math.max(1, Math.floor(MAX_POSITION_VALUE / entryPrice));
      session.trades.push({
        id: `${now.getTime()}-${signal.symbol}`,
        symbol: signal.symbol,
        side: signal.signalBias,
        quantity,
        entryPrice,
        target: entryPrice * 1.1,
        stopLoss: signal.stopLoss,
        openedAt: now.toISOString(),
        source: quotes.has(signal.symbol) ? "DHAN" : "SCANNER_FALLBACK",
        exitPrice: null,
        closedAt: null,
        status: "OPEN",
        pnl: 0,
      });
    }
  }

  session.realizedPnl = round(session.trades.reduce((sum, trade) => sum + trade.pnl, 0));
  session.status = expired ? "COMPLETED" : "ACTIVE";
  session.updatedAt = now.toISOString();
  session.dhanConnected = dhanConnected;
  session.lastError = lastError;
  await save(session);
  return session;
}

function closeTrade(trade: PaperTrade, price: number, status: "TARGET" | "STOP" | "SESSION_END", now: Date) {
  trade.exitPrice = price;
  trade.closedAt = now.toISOString();
  trade.status = status;
  trade.pnl = round((trade.side === "BUY" ? price - trade.entryPrice : trade.entryPrice - price) * trade.quantity);
}

async function fetchDhanLtp(symbols: string[]): Promise<Map<string, number>> {
  const clientId = process.env.DHAN_CLIENT_ID;
  const token = process.env.DHAN_ACCESS_TOKEN;
  if (!clientId || !token) throw new Error("Dhan credentials are not configured; fills use scanner prices.");
  if (symbols.length === 0) return new Map();
  const instruments = await resolveNseInstruments(symbols);
  const response = await fetch("https://api.dhan.co/v2/marketfeed/ltp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "access-token": token, "client-id": clientId },
    body: JSON.stringify({ NSE_EQ: [...instruments.values()].map(Number) }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Dhan quote API returned ${response.status}.`);
  const payload = await response.json() as { data?: { NSE_EQ?: Record<string, { last_price?: number }> }; status?: string };
  const prices = new Map<string, number>();
  for (const [symbol, securityId] of instruments) {
    const price = payload.data?.NSE_EQ?.[securityId]?.last_price;
    if (typeof price === "number" && price > 0) prices.set(symbol, price);
  }
  return prices;
}

async function resolveNseInstruments(symbols: string[]): Promise<Map<string, string>> {
  const response = await fetch("https://images.dhan.co/api-data/api-scrip-master.csv", { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error("Dhan instrument master is unavailable.");
  const wanted = new Set(symbols.map((symbol) => symbol.toUpperCase()));
  const result = new Map<string, string>();
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Dhan instrument master response cannot be streamed.");
  const decoder = new TextDecoder();
  let buffer = "";
  let indexes: { security: number; symbol: number; exchange: number; segment: number } | null = null;
  let done = false;
  while (!done && result.size < wanted.size) {
    const chunk = await reader.read();
    done = chunk.done;
    buffer += decoder.decode(chunk.value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line) continue;
      const row = parseCsvLine(line);
      if (!indexes) {
        row[0] = row[0]?.replace(/^\uFEFF/, "");
        indexes = {
          security: row.indexOf("SEM_SMST_SECURITY_ID"),
          symbol: row.indexOf("SEM_TRADING_SYMBOL"),
          exchange: row.indexOf("SEM_EXM_EXCH_ID"),
          segment: row.indexOf("SEM_SEGMENT"),
        };
        if (Object.values(indexes).some((value) => value < 0)) throw new Error("Dhan instrument master format changed.");
        continue;
      }
      const symbol = row[indexes.symbol]?.toUpperCase();
      if (wanted.has(symbol) && row[indexes.exchange] === "NSE" && row[indexes.segment] === "E") result.set(symbol, row[indexes.security]);
    }
  }
  await reader.cancel().catch(() => undefined);
  return result;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "", quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') { field += '"'; index++; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { fields.push(field); field = ""; }
    else field += character;
  }
  fields.push(field);
  return fields;
}

function normalizeSession(session: PaperSession): PaperSession {
  if (session.status === "ACTIVE" && Date.now() >= Date.parse(session.endsAt)) session.status = "COMPLETED";
  return session;
}
async function save(session: PaperSession) { await writeSnapshotFile(STATE_FILE, JSON.stringify(session, null, 2)); }
function round(value: number) { return Math.round(value * 100) / 100; }
