import { readSnapshotFile, writeSnapshotFile } from "@/lib/snapshot-storage";
import type { ExpertActionMatrix, ExpertQuote } from "@/lib/expert-insights";

export type MultibaggerKind = "STOCK" | "ETF" | "UPCOMING_IPO" | "NEW_IPO";
export type MultibaggerRisk = "Low" | "Medium" | "High";
export type MultibaggerAction = "ACCUMULATE" | "WATCH" | "WAIT" | "AVOID";

export type MultibaggerCandidate = {
  id: string;
  symbol: string;
  name: string;
  kind: MultibaggerKind;
  exchange: "NSE" | "BSE" | "NSE/BSE";
  sector: string;
  price: number;
  score: number;
  classification: "Strong Candidate" | "Watch Closely" | "Emerging" | "Avoid/Monitor";
  growthPotential: string;
  horizon: "6–12 months" | "12–24 months" | "18–24+ months";
  risk: MultibaggerRisk;
  keyReason: string;
  action: MultibaggerAction;
  outlook6To12: string;
  outlook12To24: string;
  source: string;
  sourceAsOf: string;
  factors: Record<string, number | string | boolean | null>;
};

export type MultibaggerHistoryRecord = {
  id: string;
  symbol: string;
  name: string;
  kind: MultibaggerKind;
  recommendationDate: string;
  priceAtRecommendation: number;
  score: number;
  action: MultibaggerAction;
  investmentHorizon: string;
  reason: string;
  subsequentPrice: number;
  highestPriceReached: number;
  returnPercent: number;
  performance6Month: number | null;
  performance12Month: number | null;
  status: "ACTIVE" | "MATURED" | "CLOSED";
  updatedAt: string;
};

export type BreezeMultibaggerSnapshot = {
  modelVersion: "breeze-multibagger-v2";
  mode: "RESEARCH_ONLY";
  automaticTrading: false;
  asOf: string;
  priceCeiling: 1000;
  universe: {
    scope: string;
    stocksIncluded: true;
    etfsIncluded: true;
    upcomingIposIncluded: true;
    registered: number;
    evaluated: number;
    registryAsOf: string | null;
  };
  sectorShortlists: SectorShortlist[];
  topCandidates: MultibaggerCandidate[];
  upcomingIpos: MultibaggerCandidate[];
  etfOpportunities: MultibaggerCandidate[];
  historyCount: number;
};

export type SectorShortlist = {
  sector: string;
  outlook: string;
  contextScore: number;
  stocks: MultibaggerCandidate[];
  etfs: MultibaggerCandidate[];
};

type IpoSeed = {
  symbol: string;
  name: string;
  kind: "UPCOMING_IPO" | "NEW_IPO";
  exchange?: "NSE" | "BSE" | "NSE/BSE";
  issuePrice: number;
  score: number;
  risk: MultibaggerRisk;
  keyReason: string;
  outlook6To12: string;
  outlook12To24: string;
  source: string;
  sourceAsOf: string;
  factors: Record<string, number | string | boolean | null>;
};

type UniverseRegistry = {
  asOf: string;
  counts: { uniqueSecurities: number; stocks: number; etfs: number };
};

type LongTermUniverseSeed = {
  sectors: Array<{ slots: Record<string, Array<ExpertQuote & { eligible?: boolean; thematicSectorTitle?: string }>> }>;
};

type SectorContext = {
  sector: string;
  aliases: string[];
  reformScore: number;
  governmentInitiativeScore: number;
  globalImpactScore: number;
  outlook: string;
  evidence: Array<{ title: string; url: string }>;
};

type SectorContextFile = { asOf: string; methodology: string; sectors: SectorContext[] };

const SNAPSHOT_FILE = "breeze_multibagger.json";
const HISTORY_FILE = "breeze_multibagger_history.json";
const IPO_FILE = "ipo-opportunities.json";
const SECTOR_CONTEXT_FILE = "sector-context.json";
const ETF_SYMBOLS = [
  "NIFTYBEES", "JUNIORBEES", "MID150BEES", "MON100", "GOLDBEES", "SILVERBEES",
  "ITBEES", "BANKBEES", "PHARMABEES", "AUTOBEES", "CPSEETF", "MAFANG",
] as const;

export function classifyScore(score: number): MultibaggerCandidate["classification"] {
  if (score >= 85) return "Strong Candidate";
  if (score >= 70) return "Watch Closely";
  if (score >= 55) return "Emerging";
  return "Avoid/Monitor";
}

export function actionForScore(score: number): MultibaggerAction {
  if (score >= 85) return "ACCUMULATE";
  if (score >= 70) return "WATCH";
  if (score >= 55) return "WAIT";
  return "AVOID";
}

export function combineCompanyAndSectorScore(companyScore: number, sectorScore: number) {
  return Math.round(clamp(companyScore, 0, 100) * 0.8 + clamp(sectorScore, 0, 100) * 0.2);
}

export async function buildBreezeMultibaggerSnapshot(options: { refreshEtfs?: boolean } = {}): Promise<BreezeMultibaggerSnapshot> {
  const [wealth, longTerm, ipoSeeds, rawEtfs, registry, contextFile] = await Promise.all([
    readJson<ExpertActionMatrix>("wealth_recommendations.json"),
    readJson<LongTermUniverseSeed>("long_term_universe.json"),
    readJson<IpoSeed[]>(IPO_FILE),
    options.refreshEtfs ? evaluateEtfs() : readExistingEtfs(),
    readJson<UniverseRegistry>("multibagger-universe.json"),
    readJson<SectorContextFile>(SECTOR_CONTEXT_FILE),
  ]);
  const contexts = contextFile?.sectors ?? [];
  const stockPool = dedupeStocks([
    ...(wealth?.categories ?? []).flatMap((category) => category.longTermUpsides),
    ...(longTerm?.sectors ?? []).flatMap((sector) => Object.values(sector.slots).flat()),
  ]);
  const rankedStocks = stockPool
    .filter((quote) => quote.price > 0 && quote.price <= 1000)
    .map((quote) => toStockCandidate(quote, findSectorContext(stockSector(quote), contexts)))
    .sort(rankCandidates);
  const etfs = rawEtfs.map((etf) => {
    const sector = etfSector(etf.symbol);
    return applySectorContext({ ...etf, sector }, findSectorContext(sector, contexts));
  });
  const sectorShortlists = buildSectorShortlists(rankedStocks, etfs, contexts);
  const topCandidates = sectorShortlists.flatMap((group) => group.stocks);
  const upcomingIpos = (ipoSeeds ?? [])
    .filter((ipo) => ipo.issuePrice > 0 && ipo.issuePrice <= 1000)
    .map(toIpoCandidate)
    .sort(rankCandidates);
  const all = [...topCandidates, ...upcomingIpos, ...etfs];
  const history = await recordRecommendationHistory(all);
  return {
    modelVersion: "breeze-multibagger-v2",
    mode: "RESEARCH_ONLY",
    automaticTrading: false,
    asOf: new Date().toISOString(),
    priceCeiling: 1000,
    universe: {
      scope: "All available NSE/BSE equities, relevant ETFs, upcoming IPOs and newly listed IPOs; never restricted to Nifty indices",
      stocksIncluded: true,
      etfsIncluded: true,
      upcomingIposIncluded: true,
      registered: registry?.counts.uniqueSecurities ?? 0,
      evaluated: wealth?.evaluatedSize ?? topCandidates.length,
      registryAsOf: registry?.asOf ?? null,
    },
    sectorShortlists,
    topCandidates,
    upcomingIpos,
    etfOpportunities: etfs.sort(rankCandidates).slice(0, 12),
    historyCount: history.length,
  };
}

export async function getBreezeMultibaggerSnapshot(): Promise<BreezeMultibaggerSnapshot> {
  const existing = await readJson<BreezeMultibaggerSnapshot>(SNAPSHOT_FILE);
  if (existing?.modelVersion === "breeze-multibagger-v2") return existing;
  const snapshot = await buildBreezeMultibaggerSnapshot({ refreshEtfs: true });
  await writeBreezeMultibaggerSnapshot(snapshot);
  return snapshot;
}

export async function writeBreezeMultibaggerSnapshot(snapshot: BreezeMultibaggerSnapshot) {
  assertResearchOnlySnapshot(snapshot);
  await writeSnapshotFile(SNAPSHOT_FILE, `${JSON.stringify(snapshot, null, 2)}\n`);
}

export function assertResearchOnlySnapshot(snapshot: BreezeMultibaggerSnapshot) {
  if (snapshot.mode !== "RESEARCH_ONLY" || snapshot.automaticTrading !== false) {
    throw new Error("Breeze Multibagger must remain research-only and cannot enable automatic trading.");
  }
  for (const candidate of [...snapshot.topCandidates, ...snapshot.upcomingIpos, ...snapshot.etfOpportunities]) {
    if (candidate.price <= 0 || candidate.price > 1000) throw new Error(`${candidate.symbol} violates the ₹1,000 price ceiling.`);
    if (candidate.score < 0 || candidate.score > 100) throw new Error(`${candidate.symbol} has an invalid score.`);
  }
  for (const group of snapshot.sectorShortlists) {
    if (group.stocks.length > 4 || group.etfs.length > 4) throw new Error(`${group.sector} exceeds the four-security sector limit.`);
  }
}

function toStockCandidate(quote: ExpertQuote & { eligible?: boolean }, context: SectorContext): MultibaggerCandidate {
  const risk = riskFromQuote(quote);
  const companyScore = Math.max(0, Math.min(100, Math.round(quote.score)));
  const contextScore = sectorContextScore(context);
  const score = combineCompanyAndSectorScore(companyScore, contextScore);
  const revenueGrowth = numericFactor(quote, "revenueGrowthPercent");
  const earningsGrowth = numericFactor(quote, "earningsGrowthPercent");
  const reason = quote.reasons?.slice(0, 3).join(" ") || `Growth, quality, valuation, momentum and liquidity combine for a ${score}/100 research score.`;
  const companyGatePassed = quote.eligible === true || (quote.eligible === undefined && quote.action === "Accumulate");
  const action = companyGatePassed ? actionForScore(score) : score >= 70 ? "WATCH" : score >= 55 ? "WAIT" : "AVOID";
  return {
    id: `STOCK:${quote.symbol}`,
    symbol: quote.symbol,
    name: quote.name,
    kind: "STOCK",
    exchange: "NSE",
    sector: context.sector,
    price: round2(quote.price),
    score,
    classification: classifyScore(score),
    growthPotential: score >= 85 ? "High" : score >= 70 ? "Moderate–High" : score >= 55 ? "Developing" : "Limited",
    horizon: score >= 85 ? "12–24 months" : "18–24+ months",
    risk,
    keyReason: `${reason} Sector context: ${context.outlook}`,
    action,
    outlook6To12: quote.metrics?.return120Percent > 15 ? "Positive momentum; monitor valuation and results." : "Needs earnings and price confirmation.",
    outlook12To24: score >= 70 ? "Potential compounding candidate if growth and cash flow persist." : "Monitor for stronger fundamental evidence.",
    source: "Breeze market data when available, with authorised public fundamental and exchange data",
    sourceAsOf: quote.fundamentalAsOf || new Date().toISOString(),
    factors: {
      revenueGrowthPercent: revenueGrowth,
      earningsGrowthPercent: earningsGrowth,
      growth: quote.factorScores?.growth ?? null,
      quality: quote.factorScores?.quality ?? null,
      valuation: quote.factorScores?.valuation ?? null,
      momentum: quote.factorScores?.momentum ?? null,
      liquidity: quote.factorScores?.liquidity ?? null,
      governanceReviewRequired: true,
      catalyst: quote.catalystSummary || null,
      companyScore,
      sectorContextScore: contextScore,
      sectorReformScore: context.reformScore,
      governmentInitiativeScore: context.governmentInitiativeScore,
      globalImpactScore: context.globalImpactScore,
      sectorEvidence: context.evidence.map((item) => item.url).join(" | "),
      companySafetyGatePassed: companyGatePassed,
    },
  };
}

function toIpoCandidate(ipo: IpoSeed): MultibaggerCandidate {
  const score = Math.max(0, Math.min(100, Math.round(ipo.score)));
  return {
    id: `${ipo.kind}:${ipo.symbol}`,
    symbol: ipo.symbol,
    name: ipo.name,
    kind: ipo.kind,
    exchange: ipo.exchange ?? "NSE/BSE",
    sector: typeof ipo.factors.sector === "string" ? ipo.factors.sector : "IPO Opportunities",
    price: round2(ipo.issuePrice),
    score,
    classification: classifyScore(score),
    growthPotential: score >= 85 ? "High" : score >= 70 ? "Moderate–High" : score >= 55 ? "Developing" : "Limited",
    horizon: "18–24+ months",
    risk: ipo.risk,
    keyReason: ipo.keyReason,
    action: actionForScore(score),
    outlook6To12: ipo.outlook6To12,
    outlook12To24: ipo.outlook12To24,
    source: ipo.source,
    sourceAsOf: ipo.sourceAsOf,
    factors: ipo.factors,
  };
}

async function readExistingEtfs(): Promise<MultibaggerCandidate[]> {
  const existing = await readJson<BreezeMultibaggerSnapshot>(SNAPSHOT_FILE);
  return existing?.etfOpportunities ?? [];
}

async function evaluateEtfs(): Promise<MultibaggerCandidate[]> {
  const values = await mapWithConcurrency(ETF_SYMBOLS, 4, evaluateEtf);
  return values.filter((value): value is MultibaggerCandidate => Boolean(value));
}

async function evaluateEtf(symbol: string): Promise<MultibaggerCandidate | null> {
  try {
    const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.NS?range=1y&interval=1d`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return null;
    const body = await response.json() as { chart?: { result?: Array<{ meta?: { regularMarketPrice?: number; longName?: string; shortName?: string }; indicators?: { quote?: Array<{ close?: Array<number | null>; volume?: Array<number | null> }> } }> } };
    const result = body.chart?.result?.[0];
    const closes = (result?.indicators?.quote?.[0]?.close ?? []).filter((value): value is number => typeof value === "number" && value > 0);
    const volumes = (result?.indicators?.quote?.[0]?.volume ?? []).filter((value): value is number => typeof value === "number" && value >= 0);
    const price = result?.meta?.regularMarketPrice ?? closes.at(-1) ?? 0;
    if (price <= 0 || price > 1000 || closes.length < 120) return null;
    const return6m = periodReturn(closes, 126);
    const return12m = periodReturn(closes, Math.min(251, closes.length - 1));
    const volatility = annualisedVolatility(closes.slice(-61));
    const averageTurnoverCr = average(volumes.slice(-60)) * price / 10_000_000;
    const score = Math.round(clamp(52 + return6m * 0.45 + return12m * 0.25 + Math.min(averageTurnoverCr, 20) * 0.35 - Math.max(0, volatility - 18) * 0.35, 0, 100));
    const risk: MultibaggerRisk = volatility < 16 ? "Low" : volatility < 28 ? "Medium" : "High";
    return {
      id: `ETF:${symbol}`,
      symbol,
      name: result?.meta?.longName ?? result?.meta?.shortName ?? symbol,
      kind: "ETF",
      exchange: "NSE",
      sector: etfSector(symbol),
      price: round2(price),
      score,
      classification: classifyScore(score),
      growthPotential: score >= 70 ? "Moderate–High" : score >= 55 ? "Developing" : "Limited",
      horizon: "12–24 months",
      risk,
      keyReason: `Six-month trend ${signed(return6m)}; one-year trend ${signed(return12m)}; annualised volatility ${volatility.toFixed(1)}%.`,
      action: actionForScore(score),
      outlook6To12: return6m > 0 ? "Positive trend, subject to underlying index conditions." : "Wait for trend improvement.",
      outlook12To24: "Diversified exposure; review tracking error, liquidity, costs and underlying index valuation.",
      source: "NSE-listed ETF; authorised public end-of-day market data",
      sourceAsOf: new Date().toISOString(),
      factors: { return6MonthPercent: round2(return6m), return12MonthPercent: round2(return12m), annualisedVolatilityPercent: round2(volatility), averageDailyTurnoverCr: round2(averageTurnoverCr) },
    };
  } catch {
    return null;
  }
}

function buildSectorShortlists(stocks: MultibaggerCandidate[], etfs: MultibaggerCandidate[], contexts: SectorContext[]): SectorShortlist[] {
  const sectors = [...new Set([...stocks.map((stock) => stock.sector), ...etfs.map((etf) => etf.sector)])];
  return sectors.map((sector) => {
    const context = findSectorContext(sector, contexts);
    return {
      sector,
      outlook: context.outlook,
      contextScore: sectorContextScore(context),
      stocks: stocks.filter((stock) => stock.sector === sector).sort(rankCandidates).slice(0, 4),
      etfs: etfs.filter((etf) => etf.sector === sector).sort(rankCandidates).slice(0, 4),
    };
  }).filter((group) => group.stocks.length > 0 || group.etfs.length > 0)
    .sort((a, b) => b.contextScore - a.contextScore || a.sector.localeCompare(b.sector));
}

function applySectorContext(candidate: MultibaggerCandidate, context: SectorContext): MultibaggerCandidate {
  const marketScore = candidate.score;
  const contextScore = sectorContextScore(context);
  const score = combineCompanyAndSectorScore(marketScore, contextScore);
  return {
    ...candidate,
    sector: context.sector,
    score,
    classification: classifyScore(score),
    action: actionForScore(score),
    keyReason: `${candidate.keyReason} Sector context: ${context.outlook}`,
    factors: {
      ...candidate.factors,
      marketScore,
      sectorContextScore: contextScore,
      sectorReformScore: context.reformScore,
      governmentInitiativeScore: context.governmentInitiativeScore,
      globalImpactScore: context.globalImpactScore,
      sectorEvidence: context.evidence.map((item) => item.url).join(" | "),
    },
  };
}

function findSectorContext(rawSector: string | undefined, contexts: SectorContext[]): SectorContext {
  const normalized = (rawSector || "").toLowerCase();
  const exact = contexts.find((context) => context.sector.toLowerCase() === normalized);
  return exact ?? contexts.find((context) => context.aliases.some((alias) => normalized.includes(alias))) ?? {
    sector: rawSector || "Other Sectors",
    aliases: [], reformScore: 50, governmentInitiativeScore: 50, globalImpactScore: 50,
    outlook: "No verified sector-specific policy advantage is applied; company fundamentals and risk controls dominate.", evidence: [],
  };
}

function stockSector(stock: ExpertQuote) {
  const symbolMap: Record<string, string> = {
    INDHOTEL: "Consumer & Diversified", JSWINFRA: "Capital Goods, Infrastructure & Defence",
    SAGILITY: "Technology, Electronics & Digital Services", LATENTVIEW: "Technology, Electronics & Digital Services", RATEGAIN: "Technology, Electronics & Digital Services",
    SKIPPER: "Capital Goods, Infrastructure & Defence", PREMIERENE: "Capital Goods, Infrastructure & Defence",
    THYROCARE: "Healthcare & Pharmaceuticals", SHILPAMED: "Healthcare & Pharmaceuticals",
    MINDACORP: "Automobile, EV & Components", ASKAUTOLTD: "Automobile, EV & Components", SONACOMS: "Automobile, EV & Components",
    ASHAPURMIN: "Metals, Mining & Materials", INOXGREEN: "Power, Renewables & Utilities",
  };
  return symbolMap[stock.symbol] || stock.sector || stock.theme || "Other Sectors";
}

function sectorContextScore(context: SectorContext) {
  return Math.round(context.reformScore * 0.3 + context.governmentInitiativeScore * 0.4 + context.globalImpactScore * 0.3);
}

function dedupeStocks<T extends ExpertQuote & { eligible?: boolean }>(stocks: T[]): T[] {
  const bySymbol = new Map<string, T>();
  for (const stock of stocks) {
    const current = bySymbol.get(stock.symbol);
    if (!current || Number(Boolean(stock.eligible)) > Number(Boolean(current.eligible)) || stock.score > current.score) bySymbol.set(stock.symbol, stock);
  }
  return [...bySymbol.values()];
}

function etfSector(symbol: string) {
  const sectors: Record<string, string> = {
    ITBEES: "Technology, Electronics & Digital Services", MAFANG: "Technology, Electronics & Digital Services", MON100: "Technology, Electronics & Digital Services",
    BANKBEES: "Financial Services", PHARMABEES: "Healthcare & Pharmaceuticals", AUTOBEES: "Automobile, EV & Components",
    CPSEETF: "Capital Goods, Infrastructure & Defence", GOLDBEES: "Metals, Mining & Materials", SILVERBEES: "Metals, Mining & Materials",
    NIFTYBEES: "Consumer & Diversified", JUNIORBEES: "Consumer & Diversified", MID150BEES: "Consumer & Diversified",
  };
  return sectors[symbol] || "Consumer & Diversified";
}

async function recordRecommendationHistory(candidates: MultibaggerCandidate[]): Promise<MultibaggerHistoryRecord[]> {
  const history = (await readJson<MultibaggerHistoryRecord[]>(HISTORY_FILE)) ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  for (const candidate of candidates) {
    for (const record of history.filter((item) => item.symbol === candidate.symbol && item.kind === candidate.kind)) {
      record.subsequentPrice = candidate.price;
      record.highestPriceReached = Math.max(record.highestPriceReached, candidate.price);
      record.returnPercent = percentChange(record.priceAtRecommendation, candidate.price);
      const ageDays = (Date.now() - Date.parse(record.recommendationDate)) / 86_400_000;
      if (ageDays >= 180 && record.performance6Month === null) record.performance6Month = record.returnPercent;
      if (ageDays >= 365 && record.performance12Month === null) record.performance12Month = record.returnPercent;
      if (ageDays >= 730) record.status = "MATURED";
      record.updatedAt = now;
    }
    const id = `${today}:${candidate.id}:${candidate.action}`;
    if (!history.some((item) => item.id === id)) {
      history.push({
        id,
        symbol: candidate.symbol,
        name: candidate.name,
        kind: candidate.kind,
        recommendationDate: today,
        priceAtRecommendation: candidate.price,
        score: candidate.score,
        action: candidate.action,
        investmentHorizon: candidate.horizon,
        reason: candidate.keyReason,
        subsequentPrice: candidate.price,
        highestPriceReached: candidate.price,
        returnPercent: 0,
        performance6Month: null,
        performance12Month: null,
        status: "ACTIVE",
        updatedAt: now,
      });
    }
  }
  await writeSnapshotFile(HISTORY_FILE, `${JSON.stringify(history, null, 2)}\n`);
  return history;
}

async function readJson<T>(filename: string): Promise<T | null> {
  const content = await readSnapshotFile(filename);
  if (!content) return null;
  try { return JSON.parse(content) as T; } catch { return null; }
}

function riskFromQuote(quote: ExpertQuote): MultibaggerRisk {
  const score = quote.factorScores?.risk ?? 0;
  if (score >= 9 && quote.dataQuality >= 70) return "Low";
  if (score >= 6) return "Medium";
  return "High";
}

function numericFactor(quote: ExpertQuote, key: string): number | null {
  const value = (quote as unknown as Record<string, unknown>)[key];
  return typeof value === "number" ? round2(value) : null;
}

function rankCandidates(a: MultibaggerCandidate, b: MultibaggerCandidate) { return b.score - a.score || a.risk.localeCompare(b.risk); }
function round2(value: number) { return Math.round(value * 100) / 100; }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
function average(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function periodReturn(values: number[], days: number) { const earlier = values[Math.max(0, values.length - 1 - days)]; return earlier ? ((values.at(-1)! - earlier) / earlier) * 100 : 0; }
function percentChange(from: number, to: number) { return from > 0 ? round2(((to - from) / from) * 100) : 0; }
function signed(value: number) { return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`; }
function annualisedVolatility(values: number[]) {
  const returns = values.slice(1).map((value, index) => Math.log(value / values[index])).filter(Number.isFinite);
  if (returns.length < 2) return 100;
  const mean = average(returns);
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  }));
  return results;
}
