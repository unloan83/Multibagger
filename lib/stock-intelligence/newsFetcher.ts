import { createHash } from "node:crypto";
import type { EvidenceCategory, IntelligenceEvidence, SourceCredibility } from "./types";

type FetchRequest = {
  query: string;
  scope: IntelligenceEvidence["queryScope"];
  matchTerms?: string[];
};

const highCredibilityHosts = [
  "nseindia.com", "bseindia.com", "sebi.gov.in", "rbi.org.in", "pib.gov.in",
  "gov.in", "reuters.com", "bloomberg.com",
];
const mediumCredibilityHosts = [
  "business-standard.com", "economictimes.indiatimes.com", "financialexpress.com",
  "livemint.com", "moneycontrol.com", "thehindubusinessline.com",
];

export async function fetchStockContext(
  signals: Array<{ symbol: string; company: string; sector?: string }>,
) {
  const stockRequests = signals.map((signal) => ({
    query: `${signal.symbol}.NS ${signal.company || signal.symbol}`,
    scope: "stock" as const,
    matchTerms: [signal.symbol, ...signal.company.split(/[^a-z0-9]+/iu).filter((term) => term.length >= 5)],
  }));
  const sectorRequests = [...new Set(signals.map((signal) => signal.sector).filter(Boolean))]
    .slice(0, 4)
    .map((sector) => ({
      query: `${sector} sector India policy outlook`,
      scope: "sector" as const,
      matchTerms: ["India", "policy", ...String(sector).split(/[^a-z0-9]+/iu).filter((term) => term.length >= 4)],
    }));
  const requests: FetchRequest[] = [
    ...stockRequests,
    ...sectorRequests,
    { query: "India stock market RBI SEBI government policy economy", scope: "macro", matchTerms: ["India", "RBI", "SEBI", "Nifty", "Sensex", "government", "policy"] },
    { query: "India government policy political economic market impact", scope: "macro", matchTerms: ["India", "government", "policy", "economy", "political", "market"] },
  ];

  const [batches, nseAnnouncements] = await Promise.all([
    Promise.all(requests.map((request) => fetchQuery(request))),
    Promise.all(signals.map((signal) => fetchNseAnnouncements(signal.symbol))),
  ]);
  return deduplicate([...batches.flat(), ...nseAnnouncements.flat()]).sort(
    (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
  );
}

async function fetchQuery(request: FetchRequest) {
  const results = await Promise.all([
    fetchYahoo(request),
    fetchGdelt(request),
    process.env.NEWS_API_KEY ? fetchNewsApi(request, process.env.NEWS_API_KEY) : Promise.resolve([]),
  ]);
  return results.flat();
}

async function fetchYahoo(request: FetchRequest): Promise<IntelligenceEvidence[]> {
  try {
    const response = await fetchWithTimeout(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(request.query)}&quotesCount=0&newsCount=8`,
    );
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      news?: Array<{ title?: string; link?: string; publisher?: string; providerPublishTime?: number }>;
    };
    return (payload.news ?? []).flatMap((item) => {
      if (!item.title || !item.link) return [];
      if (request.matchTerms && !matchesTerms(item.title, request.matchTerms)) return [];
      return [toEvidence({
        title: item.title,
        url: item.link,
        source: item.publisher || "Yahoo Finance",
        publishedAt: item.providerPublishTime
          ? new Date(item.providerPublishTime * 1_000).toISOString()
          : new Date().toISOString(),
        scope: request.scope,
      })];
    });
  } catch {
    return [];
  }
}

async function fetchNseAnnouncements(symbol: string): Promise<IntelligenceEvidence[]> {
  try {
    const normalizedSymbol = symbol.trim().toUpperCase().replace(/\.(NS|BO)$/u, "");
    const response = await fetchWithTimeout(
      `https://www.nseindia.com/api/corporate-announcements?index=equities&symbol=${encodeURIComponent(normalizedSymbol)}`,
      "https://www.nseindia.com/companies-listing/corporate-filings-announcements",
    );
    if (!response.ok) return [];
    const payload = (await response.json()) as Array<{
      an_dt?: string;
      sort_date?: string;
      attchmntFile?: string;
      attchmntText?: string;
      desc?: string;
      sm_name?: string;
    }>;
    return payload.slice(0, 8).flatMap((item) => {
      if (!item.desc || !item.attchmntFile) return [];
      const detail = item.attchmntText?.replace(/\s+/gu, " ").trim() ?? "";
      return [{
        ...toEvidence({
          title: `${item.desc}${detail ? `: ${detail}` : ""}`.slice(0, 260),
          url: item.attchmntFile,
          source: "NSE India",
          publishedAt: parseNseDate(item.sort_date || item.an_dt),
          scope: "stock",
        }),
        credibility: "high" as const,
        relatedSymbols: [normalizedSymbol],
      }];
    });
  } catch {
    return [];
  }
}

async function fetchGdelt(request: FetchRequest): Promise<IntelligenceEvidence[]> {
  try {
    const response = await fetchWithTimeout(
      `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(request.query)}&mode=artlist&maxrecords=8&timespan=7d&format=json`,
    );
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      articles?: Array<{ title?: string; url?: string; domain?: string; seendate?: string }>;
    };
    return (payload.articles ?? []).flatMap((item) => {
      if (!item.title || !item.url) return [];
      if (request.matchTerms && !matchesTerms(item.title, request.matchTerms)) return [];
      return [toEvidence({
        title: item.title,
        url: item.url,
        source: item.domain || "GDELT",
        publishedAt: parseGdeltDate(item.seendate),
        scope: request.scope,
      })];
    });
  } catch {
    return [];
  }
}

async function fetchNewsApi(request: FetchRequest, apiKey: string): Promise<IntelligenceEvidence[]> {
  try {
    const response = await fetchWithTimeout(
      `https://newsapi.org/v2/everything?q=${encodeURIComponent(request.query)}&language=en&sortBy=publishedAt&pageSize=8&apiKey=${encodeURIComponent(apiKey)}`,
    );
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      articles?: Array<{ title?: string; url?: string; publishedAt?: string; source?: { name?: string } }>;
    };
    return (payload.articles ?? []).flatMap((item) => {
      if (!item.title || !item.url) return [];
      if (request.matchTerms && !matchesTerms(item.title, request.matchTerms)) return [];
      return [toEvidence({
        title: item.title,
        url: item.url,
        source: item.source?.name || "NewsAPI",
        publishedAt: item.publishedAt || new Date().toISOString(),
        scope: request.scope,
      })];
    });
  } catch {
    return [];
  }
}

function toEvidence(input: {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  scope: IntelligenceEvidence["queryScope"];
}): IntelligenceEvidence {
  return {
    id: createHash("sha256").update(`${input.title}|${input.url}`).digest("hex").slice(0, 20),
    title: input.title.trim(),
    url: input.url,
    source: input.source.trim(),
    publishedAt: validDate(input.publishedAt),
    category: classifyCategory(input.title, input.scope),
    credibility: credibilityFor(input.url, input.source),
    queryScope: input.scope,
  };
}

function classifyCategory(title: string, scope: IntelligenceEvidence["queryScope"]): EvidenceCategory {
  const value = title.toLowerCase();
  if (/sebi|rbi|regulat|penalty|probe|investigation/u.test(value)) return "regulatory";
  if (/quarter|results|earnings|revenue|profit|margin/u.test(value)) return "quarterly-results";
  if (/management|ceo|cfo|guidance|commentary|conference call/u.test(value)) return "management-commentary";
  if (/dividend|split|bonus|buyback|merger|acquisition|board meeting/u.test(value)) return "corporate-action";
  if (/government|cabinet|ministry|policy|budget|tax|subsidy|scheme|pli/u.test(value)) return "policy";
  if (/election|politic|geopolit|war|trade deal|gdp|inflation|interest rate/u.test(value)) return "political-economic";
  if (/analyst|brokerage|blog|opinion|target price/u.test(value)) return "analyst-blog";
  return scope === "stock" ? "company" : scope === "sector" ? "sector" : "market";
}

function credibilityFor(url: string, source: string): SourceCredibility {
  const value = `${url} ${source}`.toLowerCase();
  if (highCredibilityHosts.some((host) => value.includes(host))) return "high";
  if (mediumCredibilityHosts.some((host) => value.includes(host))) return "medium";
  return "low";
}

function matchesTerms(title: string, terms: string[]) {
  const normalized = title.toLowerCase();
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

function deduplicate(items: IntelligenceEvidence[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchWithTimeout(url: string, referer?: string) {
  return fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; UNLOAN-Stock-Intelligence/1.0)",
      ...(referer ? { Referer: referer } : {}),
    },
    signal: AbortSignal.timeout(4_500),
    next: { revalidate: 900 },
  });
}

function parseNseDate(value?: string) {
  if (!value) return new Date().toISOString();
  const normalized = value.match(/^\d{4}-\d{2}-\d{2}/u) ? `${value.replace(" ", "T")}+05:30` : value;
  return validDate(normalized);
}

function parseGdeltDate(value?: string) {
  if (!value) return new Date().toISOString();
  const matched = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/u);
  return matched
    ? `${matched[1]}-${matched[2]}-${matched[3]}T${matched[4]}:${matched[5]}:${matched[6]}Z`
    : validDate(value);
}

function validDate(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString();
}
