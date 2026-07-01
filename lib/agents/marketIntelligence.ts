import type { RawIntelligenceEvent } from "@/lib/agents/types";
import type { ManagedPortfolio } from "@/lib/portfolio";

type NewsArticle = {
  title: string;
  description?: string;
  url?: string;
  publishedAt?: string;
  publisher?: string;
  hintedKind?: RawIntelligenceEvent["source"]["kind"];
};

type NewsApiResponse = {
  articles?: Array<{
    source?: { name?: string };
    title?: string;
    description?: string;
    url?: string;
    publishedAt?: string;
  }>;
};

type YahooSearchResponse = {
  news?: Array<{
    title?: string;
    link?: string;
    publisher?: string;
    providerPublishTime?: number;
  }>;
};

const sectorTerms: Array<[string, string[]]> = [
  ["Banking & Financial Services", ["bank", "banking", "nbfc", "insurance", "fintech"]],
  ["Information Technology", ["information technology", "software", "technology", "it services"]],
  ["Pharmaceuticals & Healthcare", ["pharma", "pharmaceutical", "healthcare", "hospital"]],
  ["Automobiles", ["automobile", "automotive", "vehicle", "ev ", "electric vehicle"]],
  ["Energy", ["energy", "oil", "gas", "power", "renewable"]],
  ["Metals & Mining", ["metal", "steel", "mining", "aluminium", "copper"]],
  ["Consumer", ["consumer", "fmcg", "retail"]],
  ["Infrastructure", ["infrastructure", "construction", "railway", "capital goods"]],
];

const officialHosts = ["rbi.org.in", "sebi.gov.in", "nseindia.com", "bseindia.com", "pib.gov.in", ".gov.in"];
const highCredibilityPublishers = ["reuters", "associated press", "bloomberg", "reserve bank of india", "sebi", "nse", "bse", "pib"];

export async function collectAttributedMarketIntelligence(
  portfolio: ManagedPortfolio,
): Promise<RawIntelligenceEvent[]> {
  const [newsApi, yahoo] = await Promise.all([
    fetchNewsApiEvents(portfolio),
    fetchYahooMarketEvents(portfolio),
  ]);
  const unique = new Map<string, RawIntelligenceEvent>();
  [...newsApi, ...yahoo].forEach((event) => {
    const key = event.source.url?.trim().toLowerCase() || event.summary.trim().toLowerCase();
    if (key) unique.set(key, event);
  });
  return [...unique.values()]
    .sort((a, b) => Date.parse(b.source.publishedAt ?? "") - Date.parse(a.source.publishedAt ?? ""))
    .slice(0, 200);
}

async function fetchNewsApiEvents(portfolio: ManagedPortfolio) {
  const apiKey = process.env.NEWS_API_KEY?.trim();
  if (!apiKey) return [];
  const portfolioQueries = chunk(
    portfolio.positions.map((position) => position.symbol).filter(Boolean),
    8,
  ).map((symbols) => `(${symbols.join(" OR ")}) AND (results OR order OR dividend OR earnings OR shares)`);
  const queries: Array<[string, NewsArticle["hintedKind"]]> = [
    ["(RBI OR SEBI OR Indian government OR budget OR regulation) AND (market OR stocks OR economy)", "government_policy"],
    ["(India inflation OR rupee OR crude oil OR interest rates OR global markets)", "macro"],
    ["(India banking OR IT sector OR pharma OR auto OR energy) AND stocks", "sector_news"],
    ["India stocks AND (analyst OR brokerage OR rating OR target price)", "analyst"],
    ...portfolioQueries.map((query) => [query, "company_news"] as [string, NewsArticle["hintedKind"]]),
  ];
  const responses = await Promise.all(queries.map(async ([query, hintedKind]) => {
    try {
      const url = new URL("https://newsapi.org/v2/everything");
      url.searchParams.set("q", query);
      url.searchParams.set("language", "en");
      url.searchParams.set("sortBy", "publishedAt");
      url.searchParams.set("pageSize", "20");
      const response = await fetch(url, {
        headers: { "X-Api-Key": apiKey },
        next: { revalidate: 900 },
      });
      if (!response.ok) return [];
      const payload = await response.json() as NewsApiResponse;
      return (payload.articles ?? []).flatMap((article) => {
        if (!article.title) return [];
        return [toEvent({
          title: article.title,
          description: article.description,
          url: article.url,
          publishedAt: article.publishedAt,
          publisher: article.source?.name,
          hintedKind,
        }, portfolio)];
      });
    } catch {
      return [];
    }
  }));
  return responses.flat();
}

async function fetchYahooMarketEvents(portfolio: ManagedPortfolio) {
  const symbols = portfolio.positions.slice(0, 12).map((position) => position.symbol);
  const queries: Array<[string, NewsArticle["hintedKind"]]> = [
    ["India RBI SEBI stock market policy", "government_policy"],
    ["India inflation rupee crude oil global markets", "macro"],
    ["India banking IT pharma auto energy stocks", "sector_news"],
    ["India stocks analyst brokerage ratings", "analyst"],
    ...symbols.map((symbol) => [symbol, "company_news"] as [string, NewsArticle["hintedKind"]]),
  ];
  const responses = await Promise.all(queries.map(async ([query, hintedKind]) => {
    try {
      const response = await fetch(
        `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=0&newsCount=8`,
        {
          headers: { "User-Agent": "Mozilla/5.0" },
          next: { revalidate: 900 },
        },
      );
      if (!response.ok) return [];
      const payload = await response.json() as YahooSearchResponse;
      return (payload.news ?? []).flatMap((article) => {
        if (!article.title) return [];
        return [toEvent({
          title: article.title,
          url: article.link,
          publishedAt: article.providerPublishTime
            ? new Date(article.providerPublishTime * 1_000).toISOString()
            : undefined,
          publisher: article.publisher,
          hintedKind,
        }, portfolio)];
      });
    } catch {
      return [];
    }
  }));
  return responses.flat();
}

export function toEvent(
  article: NewsArticle,
  portfolio: ManagedPortfolio,
): RawIntelligenceEvent {
  const summary = [article.title, article.description].filter(Boolean).join(" — ").slice(0, 800);
  const text = summary.toLowerCase();
  const affectedStocks = portfolio.positions
    .filter((position) => articleMatchesPosition(text, position.symbol, position.company))
    .map((position) => position.symbol);
  const affectedSectors = sectorTerms
    .filter(([, terms]) => terms.some((term) => text.includes(term)))
    .map(([sector]) => sector);
  const kind = classifyKind(article, text, affectedStocks.length > 0);
  const publisher = article.publisher?.trim() || hostname(article.url) || "Attributed financial news";

  return {
    summary,
    affectedStocks,
    affectedSectors,
    source: {
      name: publisher,
      credibility: sourceCredibility(publisher, article.url),
      url: article.url,
      publishedAt: article.publishedAt,
      kind,
    },
  };
}

function classifyKind(
  article: NewsArticle,
  text: string,
  stockSpecific: boolean,
): RawIntelligenceEvent["source"]["kind"] {
  const host = hostname(article.url);
  if (host.includes("nseindia.com") || host.includes("bseindia.com")) return "exchange_filing";
  if (host.includes("rbi.org.in") || host.includes("sebi.gov.in")) return "regulator";
  if (host.includes("pib.gov.in") || host.endsWith(".gov.in")) return "government_policy";
  if (/quarter|earnings|financial results|profit|revenue/iu.test(text) && stockSpecific) return "quarterly_result";
  if (/dividend|buyback|bonus issue|stock split|rights issue|merger|acquisition/iu.test(text) && stockSpecific) return "corporate_action";
  if (/analyst|brokerage|rating|target price|upgrade|downgrade/iu.test(text)) return "analyst";
  if (/election|parliament|political|geopolitical|war|sanction/iu.test(text)) return "politics";
  if (/rbi|sebi|government|budget|tax|regulation|policy/iu.test(text)) return "government_policy";
  if (/global market|wall street|asia market|fed |federal reserve|china|europe/iu.test(text)) return "global_market";
  if (/inflation|interest rate|crude oil|currency|rupee|gdp|bond yield/iu.test(text)) return "macro";
  if (stockSpecific) return article.hintedKind === "company_news" ? "company_news" : "company_update";
  return article.hintedKind ?? "sector_news";
}

function sourceCredibility(
  publisher: string,
  url?: string,
): "high" | "medium" | "low" {
  const value = `${publisher} ${hostname(url)}`.toLowerCase();
  if (
    officialHosts.some((host) => value.includes(host)) ||
    highCredibilityPublishers.some((name) => value.includes(name))
  ) return "high";
  if (/blog|medium\.com|substack|wordpress/iu.test(value)) return "low";
  return "medium";
}

function articleMatchesPosition(text: string, symbol: string, company: string) {
  const normalizedSymbol = symbol.trim().toLowerCase();
  if (normalizedSymbol && new RegExp(`\\b${escapeRegExp(normalizedSymbol)}\\b`, "iu").test(text)) return true;
  const companyAlias = company
    .toLowerCase()
    .replace(/\b(limited|ltd|corporation|corp|company|co|india)\b/gu, " ")
    .replace(/[^a-z0-9 ]/gu, " ")
    .split(/\s+/u)
    .filter((part) => part.length >= 3)
    .slice(0, 2)
    .join(" ");
  return companyAlias.length >= 3 && text.includes(companyAlias);
}

function hostname(url?: string) {
  try {
    return url ? new URL(url).hostname.replace(/^www\./u, "") : "";
  } catch {
    return "";
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function chunk<T>(values: T[], size: number) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  );
}
