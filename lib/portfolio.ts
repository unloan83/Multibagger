import {
  analyzeStockSignal,
  buildSignalRemark,
  getSignalAction,
  type AnalysisProfile,
  type StockSignalMetrics,
} from "@/lib/analysis";

export type PortfolioList = "current" | "watchlist";

export type PortfolioInputRow = {
  list: PortfolioList;
  stockCode: string;
  company: string;
  stock: string;
  quantity: number;
  buyPrice?: number;
};

export type InvestmentAppetite = "safe" | "moderate" | "aggressive";

export type PortfolioPosition = {
  list: PortfolioList;
  stock: string;
  symbol: string;
  company: string;
  sector: string;
  quantity: number;
  currentPrice: number;
  previousClose: number;
  volume?: number;
  bars?: Array<{
    close: number;
    high: number;
    low: number;
    volume: number;
  }>;
  newsHeadlines?: string[];
  currency: "INR";
};

export type SectorAllocation = {
  sector: string;
  value: number;
  percentage: number;
};

export type GrowthPoint = {
  month: string;
  value: number;
};

export type HoldingWithMetrics = PortfolioPosition & {
  marketValue: number;
  dayChange: number;
  dayChangePercent: number;
  portfolioWeight: number;
};

export type PortfolioMetrics = {
  holdings: HoldingWithMetrics[];
  totalValue: number;
  dayChange: number;
  dayChangePercent: number;
  sectorAllocations: SectorAllocation[];
  growth: GrowthPoint[];
};

export type StockProfile = {
  symbol: string;
  company: string;
  sector: string;
};

export type ManagedPortfolio = {
  id: string;
  name: string;
  appetite: InvestmentAppetite;
  isMarketPortfolio?: boolean;
  inputs: PortfolioInputRow[];
  positions: PortfolioPosition[];
  refreshedAt?: string;
};

export type RecommendationSection =
  | "Intraday"
  | "1-3 Yr Plan"
  | "Multibagger"
  | "ETF"
  | "Sector Allocation";

export type RecommendationStatus = "Hit" | "Miss" | "NA";

export type Recommendation = {
  id: string;
  portfolioId: string;
  portfolioName: string;
  section: RecommendationSection;
  symbol: string;
  company: string;
  action: "Accumulate" | "Urgent Sell";
  horizon: string;
  rationale: string;
  caveats?: string[];
  metrics?: StockSignalMetrics;
  confidence: number;
  createdAt: string;
  status: RecommendationStatus;
};

const appetiteProfiles: Record<
  InvestmentAppetite,
  {
    confidenceShift: number;
    maxIntraday: number;
    riskLabel: string;
  }
> = {
  safe: {
    confidenceShift: 6,
    maxIntraday: 3,
    riskLabel: "capital protection and lower churn",
  },
  moderate: {
    confidenceShift: 0,
    maxIntraday: 4,
    riskLabel: "balanced compounding and controlled risk",
  },
  aggressive: {
    confidenceShift: -4,
    maxIntraday: 5,
    riskLabel: "higher growth appetite and wider drawdown tolerance",
  },
};

const numberFormatter = new Intl.NumberFormat("en-IN", {
  currency: "INR",
  style: "currency",
  maximumFractionDigits: 0,
});

const compactInrFormatter = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 1,
});

const stockProfiles: Record<string, StockProfile> = {
  ASIANPAINT: {
    symbol: "ASIANPAINT",
    company: "Asian Paints",
    sector: "Consumer Discretionary",
  },
  AXISBANK: {
    symbol: "AXISBANK",
    company: "Axis Bank",
    sector: "Financial Services",
  },
  BAJFINANCE: {
    symbol: "BAJFINANCE",
    company: "Bajaj Finance",
    sector: "Financial Services",
  },
  BHARTIARTL: {
    symbol: "BHARTIARTL",
    company: "Bharti Airtel",
    sector: "Telecommunication",
  },
  HCLTECH: {
    symbol: "HCLTECH",
    company: "HCL Technologies",
    sector: "Information Technology",
  },
  HDFCBANK: {
    symbol: "HDFCBANK",
    company: "HDFC Bank",
    sector: "Financial Services",
  },
  HINDUNILVR: {
    symbol: "HINDUNILVR",
    company: "Hindustan Unilever",
    sector: "Fast Moving Consumer Goods",
  },
  ICICIBANK: {
    symbol: "ICICIBANK",
    company: "ICICI Bank",
    sector: "Financial Services",
  },
  INFY: {
    symbol: "INFY",
    company: "Infosys",
    sector: "Information Technology",
  },
  ITC: {
    symbol: "ITC",
    company: "ITC",
    sector: "Fast Moving Consumer Goods",
  },
  KOTAKBANK: {
    symbol: "KOTAKBANK",
    company: "Kotak Mahindra Bank",
    sector: "Financial Services",
  },
  LT: {
    symbol: "LT",
    company: "Larsen & Toubro",
    sector: "Construction",
  },
  MARUTI: {
    symbol: "MARUTI",
    company: "Maruti Suzuki India",
    sector: "Automobile and Auto Components",
  },
  NESTLEIND: {
    symbol: "NESTLEIND",
    company: "Nestle India",
    sector: "Fast Moving Consumer Goods",
  },
  NTPC: {
    symbol: "NTPC",
    company: "NTPC",
    sector: "Power",
  },
  RELIANCE: {
    symbol: "RELIANCE",
    company: "Reliance Industries",
    sector: "Oil Gas and Consumable Fuels",
  },
  SBIN: {
    symbol: "SBIN",
    company: "State Bank of India",
    sector: "Financial Services",
  },
  SUNPHARMA: {
    symbol: "SUNPHARMA",
    company: "Sun Pharmaceutical Industries",
    sector: "Healthcare",
  },
  TCS: {
    symbol: "TCS",
    company: "Tata Consultancy Services",
    sector: "Information Technology",
  },
  TATAMOTORS: {
    symbol: "TATAMOTORS",
    company: "Tata Motors",
    sector: "Automobile and Auto Components",
  },
  TATASTEEL: {
    symbol: "TATASTEEL",
    company: "Tata Steel",
    sector: "Metals and Mining",
  },
  TITAN: {
    symbol: "TITAN",
    company: "Titan Company",
    sector: "Consumer Durables",
  },
  ULTRACEMCO: {
    symbol: "ULTRACEMCO",
    company: "UltraTech Cement",
    sector: "Construction Materials",
  },
  WIPRO: {
    symbol: "WIPRO",
    company: "Wipro",
    sector: "Information Technology",
  },
};

const stockAliases: Record<string, string> = {
  ASHLEY: "ASHOKLEY",
  BHAELE: "BEL",
  DRREDD: "DRREDDY",
  ENGIND: "ENGINERSIN",
  FEDBAN: "FEDERALBNK",
  GUJGA: "GUJGASLTD",
  GUJPPL: "GPPL",
  HDF250: "HDFCSML250",
  HDFBAN: "HDFCBANK",
  HINPET: "HINDPETRO",
  ICIGOL: "GOLDETF",
  ICINIF: "ICICINIFTY",
  ICIPSE: "SILVERIETF",
  IDECEL: "IDEA",
  JSWENE: "JSWENERGY",
  LGELEC: "LGEL",
  LIC: "LICI",
  MIR150: "MIDCAPETF",
  NIPNIT: "ITBEES",
  NTPGRE: "NTPCGREEN",
  PETLNG: "PETRONET",
  RELIND: "RELIANCE",
  SEQSCI: "VIYASH",
  SJVLIM: "SJVN",
  TATCAP: "TATACAP",
  TATGLO: "TATACONSUM",
  TATPOW: "TATAPOWER",
  "ASIAN PAINTS": "ASIANPAINT",
  "ASHOK LEYLAND": "ASHOKLEY",
  "ASHOK LEYLAND LTD": "ASHOKLEY",
  "ASHOK LEYLAND LIMITED": "ASHOKLEY",
  "AXIS BANK": "AXISBANK",
  "BAJAJ FINANCE": "BAJFINANCE",
  "BHARAT ELECTRONICS": "BEL",
  "BHARAT ELECTRONICS LTD": "BEL",
  "BHARAT ELECTRONICS LIMITED": "BEL",
  "BHARTI AIRTEL": "BHARTIARTL",
  "DR REDDYS LABORATORIES": "DRREDDY",
  "DR REDDYS LABORATORIES LTD": "DRREDDY",
  "ENGINEERS INDIA": "ENGINERSIN",
  "ENGINEERS INDIA LTD": "ENGINERSIN",
  "FEDERAL BANK": "FEDERALBNK",
  "FEDERAL BANK LTD": "FEDERALBNK",
  "GAIL INDIA": "GAIL",
  "GAIL INDIA LIMITED": "GAIL",
  "GUJARAT GAS": "GUJGASLTD",
  "GUJARAT GAS LIMITED": "GUJGASLTD",
  "GUJARAT PIPAVAV PORT": "GPPL",
  "GUJARAT PIPAVAV PORT LIMITED": "GPPL",
  "HCL TECHNOLOGIES": "HCLTECH",
  "HDFC BANK": "HDFCBANK",
  "HDFC BANK LIMITED": "HDFCBANK",
  "HDFC NIFTY SMALLCAP 250 ETF": "HDFCSML250",
  "HINDUSTAN UNILEVER": "HINDUNILVR",
  "HINDUSTAN PETROLEUM": "HINDPETRO",
  "HINDUSTAN PETROLEUM CORP": "HINDPETRO",
  "ICICI BANK": "ICICIBANK",
  "ICICI PRUDENTIAL GOLD ETF": "GOLDETF",
  "ICICI PRUDENTIAL NIFTY 50 ETF": "ICICINIFTY",
  "ICICI PRUDENTIAL SILVER ETF": "SILVERIETF",
  INFOSYS: "INFY",
  "JIO FINANCIAL SERVICES": "JIOFIN",
  "JIO FINANCIAL SERVICES LIMITED": "JIOFIN",
  "JSW ENERGY": "JSWENERGY",
  "JSW ENERGY LIMITED": "JSWENERGY",
  "KOTAK MAHINDRA BANK": "KOTAKBANK",
  "LG ELECTRONICS INDIA": "LGEL",
  "LG ELECTRONICS INDIA LTD": "LGEL",
  "LIFE INSURANCE CORP OF IND LIC": "LICI",
  "LIFE INSURANCE CORPORATION OF INDIA": "LICI",
  "LARSEN & TOUBRO": "LT",
  "LARSEN AND TOUBRO": "LT",
  "MARUTI SUZUKI": "MARUTI",
  "MARUTI SUZUKI INDIA": "MARUTI",
  "MIRAE ASSET NIF MIDCAP 150 ETF": "MIDCAPETF",
  "NESTLE INDIA": "NESTLEIND",
  "NIPPON INDIA ETF NIFTY IT": "ITBEES",
  "NTPC GREEN ENERGY": "NTPCGREEN",
  "NTPC GREEN ENERGY LIMITED": "NTPCGREEN",
  "OIL AND NATURAL GAS CORPORATIO": "ONGC",
  "PETRONET LNG": "PETRONET",
  "PETRONET LNG LIMITED": "PETRONET",
  "RELIANCE INDUSTRIES": "RELIANCE",
  "SATLUJ JAL VIDYUT NIGAM": "SJVN",
  "SATLUJ JAL VIDYUT NIGAM LTD": "SJVN",
  "STATE BANK OF INDIA": "SBIN",
  SBI: "SBIN",
  "SUN PHARMA": "SUNPHARMA",
  "SUN PHARMACEUTICAL": "SUNPHARMA",
  "SUN PHARMACEUTICAL INDUSTRIES": "SUNPHARMA",
  "TATA CAPITAL": "TATACAP",
  "TATA CAPITAL LIMITED": "TATACAP",
  "TATA CONSUMER PRODUCTS": "TATACONSUM",
  "TATA CONSUMER PRODUCTS LIMITED": "TATACONSUM",
  "TATA CONSULTANCY SERVICES": "TCS",
  "TATA MOTORS": "TATAMOTORS",
  "TATA POWER": "TATAPOWER",
  "TATA POWER CO": "TATAPOWER",
  "TATA POWER CO LTD": "TATAPOWER",
  "TATA STEEL": "TATASTEEL",
  "TITAN COMPANY": "TITAN",
  "ULTRATECH CEMENT": "ULTRACEMCO",
  "VIYASH SCIENTIFIC": "VIYASH",
  "VIYASH SCIENTIFIC LIMITED": "VIYASH",
  "VODAFONE IDEA": "IDEA",
  "VODAFONE IDEA LIMITED": "IDEA",
};

const companySectorKeywords: Array<[string, string]> = [
  ["bank", "Financial Services"],
  ["finance", "Financial Services"],
  ["financial", "Financial Services"],
  ["insurance", "Financial Services"],
  ["technologies", "Information Technology"],
  ["technology", "Information Technology"],
  ["software", "Information Technology"],
  ["pharma", "Healthcare"],
  ["hospital", "Healthcare"],
  ["motors", "Automobile and Auto Components"],
  ["auto", "Automobile and Auto Components"],
  ["steel", "Metals and Mining"],
  ["cement", "Construction Materials"],
  ["power", "Power"],
  ["energy", "Oil Gas and Consumable Fuels"],
  ["oil", "Oil Gas and Consumable Fuels"],
  ["gas", "Oil Gas and Consumable Fuels"],
  ["telecom", "Telecommunication"],
  ["consumer", "Fast Moving Consumer Goods"],
  ["foods", "Fast Moving Consumer Goods"],
];

export function formatCurrency(value: number) {
  return numberFormatter.format(value);
}

export function formatCompactInr(value: number) {
  if (Math.abs(value) >= 10000000) {
    return `INR ${compactInrFormatter.format(value / 10000000)}Cr`;
  }

  if (Math.abs(value) >= 100000) {
    return `INR ${compactInrFormatter.format(value / 100000)}L`;
  }

  return `INR ${compactInrFormatter.format(value / 1000)}k`;
}

export function formatPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function calculatePortfolioMetrics(
  positions: PortfolioPosition[],
): PortfolioMetrics {
  const currentPositions = mergePortfolioPositions(positions).filter(
    (position) => position.list === "current" && position.quantity > 0,
  );
  const baseHoldings = currentPositions.map((holding) => {
    const marketValue = holding.quantity * holding.currentPrice;
    const dayChange = holding.quantity * (holding.currentPrice - holding.previousClose);
    const dayChangePercent =
      holding.previousClose === 0
        ? 0
        : ((holding.currentPrice - holding.previousClose) / holding.previousClose) *
          100;

    return {
      ...holding,
      marketValue,
      dayChange,
      dayChangePercent,
      portfolioWeight: 0,
    };
  });

  const totalValue = baseHoldings.reduce(
    (sum, holding) => sum + holding.marketValue,
    0,
  );
  const dayChange = baseHoldings.reduce(
    (sum, holding) => sum + holding.dayChange,
    0,
  );
  const dayChangePercent =
    totalValue - dayChange === 0
      ? 0
      : (dayChange / (totalValue - dayChange)) * 100;

  const holdingsWithWeights = baseHoldings
    .map((holding) => ({
      ...holding,
      portfolioWeight:
        totalValue === 0 ? 0 : (holding.marketValue / totalValue) * 100,
    }))
    .sort((a, b) => b.marketValue - a.marketValue);

  const sectorMap = holdingsWithWeights.reduce<Record<string, number>>(
    (acc, holding) => {
      acc[holding.sector] = (acc[holding.sector] ?? 0) + holding.marketValue;
      return acc;
    },
    {},
  );

  const sectorAllocations = Object.entries(sectorMap)
    .map(([sector, value]) => ({
      sector,
      value,
      percentage: totalValue === 0 ? 0 : (value / totalValue) * 100,
    }))
    .sort((a, b) => b.value - a.value);

  return {
    holdings: holdingsWithWeights,
    totalValue,
    dayChange,
    dayChangePercent,
    sectorAllocations,
    growth: buildGrowthSeries(totalValue - dayChange, totalValue),
  };
}

function mergePortfolioPositions(positions: PortfolioPosition[]) {
  return Object.values(
    positions.reduce<Record<string, PortfolioPosition>>((acc, position) => {
      const key = `${position.symbol}-${position.list}`;
      const existing = acc[key];

      if (!existing) {
        acc[key] = {
          ...position,
          quantity: parseQuantity(position.quantity),
        };
        return acc;
      }

      acc[key] = {
        ...existing,
        quantity: existing.quantity + parseQuantity(position.quantity),
        currentPrice: position.currentPrice || existing.currentPrice,
        previousClose: position.previousClose || existing.previousClose,
        volume: position.volume || existing.volume,
        bars: position.bars?.length ? position.bars : existing.bars,
        newsHeadlines: position.newsHeadlines?.length
          ? position.newsHeadlines
          : existing.newsHeadlines,
      };

      return acc;
    }, {}),
  );
}

function buildGrowthSeries(previousValue: number, totalValue: number): GrowthPoint[] {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug"];
  const start = previousValue * 0.94;
  const end = totalValue;

  return months.map((month, index) => {
    const progress = index / (months.length - 1);
    const wave = Math.sin(index * 1.4) * totalValue * 0.01;
    return {
      month,
      value: Math.round(start + (end - start) * progress + wave),
    };
  });
}

export function resolveStockProfile(stock: string, company = ""): StockProfile {
  const normalizedStock = normalizeStockKey(stock);
  const symbol = stockAliases[normalizedStock] ?? normalizedStock;
  const cleanSymbol = symbol.replace(/\.NS$|\.BO$/u, "");

  if (stockProfiles[cleanSymbol]) {
    return stockProfiles[cleanSymbol];
  }

  return {
    symbol: cleanSymbol,
    company: company.trim() || stock.trim(),
    sector: identifySector(cleanSymbol, company || stock),
  };
}

export function buildPortfolioInputRow({
  stockCode,
  company,
  quantity,
  buyPrice,
}: {
  stockCode?: string;
  company?: string;
  quantity?: number;
  buyPrice?: number;
}): PortfolioInputRow {
  const cleanStockCode = stockCode?.trim().toUpperCase() ?? "";
  const cleanCompany = company?.trim() ?? "";
  const cleanQuantity = parseQuantity(quantity);

  return {
    list: cleanQuantity > 0 ? "current" : "watchlist",
    stockCode: cleanStockCode,
    company: cleanCompany,
    stock: cleanStockCode || cleanCompany,
    quantity: cleanQuantity > 0 ? cleanQuantity : 0,
    buyPrice: Number.isFinite(buyPrice) && Number(buyPrice) > 0 ? Number(buyPrice) : undefined,
  };
}

export function parseQuantity(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  return Number(String(value ?? "").replace(/,/g, "").trim()) || 0;
}

export function identifySector(symbol: string, company = "", fallback = "Unclassified") {
  const normalizedSymbol = symbol
    .trim()
    .toUpperCase()
    .replace(/\.NS$|\.BO$/u, "");

  if (stockProfiles[normalizedSymbol]) {
    return stockProfiles[normalizedSymbol].sector;
  }

  const normalizedCompany = company.trim().toLowerCase();
  const match = companySectorKeywords.find(([keyword]) =>
    normalizedCompany.includes(keyword),
  );

  return match?.[1] ?? fallback;
}

function normalizeStockKey(stock: string) {
  return stock
    .trim()
    .toUpperCase()
    .replace(/\.NS$|\.BO$/u, "")
    .replace(/[^A-Z0-9& ]/gu, "")
    .replace(/\s+/gu, " ");
}

export const sampleInputs: PortfolioInputRow[] = [
  buildPortfolioInputRow({ stockCode: "RELIANCE", company: "Reliance Industries", quantity: 42 }),
  buildPortfolioInputRow({ stockCode: "TCS", company: "Tata Consultancy Services", quantity: 28 }),
  buildPortfolioInputRow({ stockCode: "HDFCBANK", company: "HDFC Bank", quantity: 68 }),
  buildPortfolioInputRow({ stockCode: "INFY", company: "Infosys", quantity: 54 }),
  buildPortfolioInputRow({ stockCode: "ICICIBANK", company: "ICICI Bank", quantity: 82 }),
  buildPortfolioInputRow({ stockCode: "MARUTI", company: "Maruti Suzuki India" }),
  buildPortfolioInputRow({ stockCode: "SUNPHARMA", company: "Sun Pharmaceutical Industries" }),
  buildPortfolioInputRow({ stockCode: "TITAN", company: "Titan Company" }),
];

export const samplePositions: PortfolioPosition[] = [
  {
    list: "current",
    stock: "Reliance Industries",
    symbol: "RELIANCE",
    company: "Reliance Industries",
    sector: "Oil Gas and Consumable Fuels",
    quantity: 42,
    currentPrice: 2864,
    previousClose: 2838,
    volume: 5100000,
    currency: "INR",
  },
  {
    list: "current",
    stock: "TCS",
    symbol: "TCS",
    company: "Tata Consultancy Services",
    sector: "Information Technology",
    quantity: 28,
    currentPrice: 3925,
    previousClose: 3898,
    volume: 1800000,
    currency: "INR",
  },
  {
    list: "current",
    stock: "HDFC Bank",
    symbol: "HDFCBANK",
    company: "HDFC Bank",
    sector: "Financial Services",
    quantity: 68,
    currentPrice: 1668,
    previousClose: 1656,
    volume: 7400000,
    currency: "INR",
  },
  {
    list: "current",
    stock: "Infosys",
    symbol: "INFY",
    company: "Infosys",
    sector: "Information Technology",
    quantity: 54,
    currentPrice: 1516,
    previousClose: 1502,
    volume: 4200000,
    currency: "INR",
  },
  {
    list: "current",
    stock: "ICICI Bank",
    symbol: "ICICIBANK",
    company: "ICICI Bank",
    sector: "Financial Services",
    quantity: 82,
    currentPrice: 1118,
    previousClose: 1106,
    volume: 9800000,
    currency: "INR",
  },
  {
    list: "watchlist",
    stock: "Maruti Suzuki India",
    symbol: "MARUTI",
    company: "Maruti Suzuki India",
    sector: "Automobile and Auto Components",
    quantity: 0,
    currentPrice: 12680,
    previousClose: 12592,
    volume: 640000,
    currency: "INR",
  },
  {
    list: "watchlist",
    stock: "Sun Pharma",
    symbol: "SUNPHARMA",
    company: "Sun Pharmaceutical Industries",
    sector: "Healthcare",
    quantity: 0,
    currentPrice: 1512,
    previousClose: 1496,
    volume: 2100000,
    currency: "INR",
  },
  {
    list: "watchlist",
    stock: "Titan Company",
    symbol: "TITAN",
    company: "Titan Company",
    sector: "Consumer Durables",
    quantity: 0,
    currentPrice: 3538,
    previousClose: 3508,
    volume: 890000,
    currency: "INR",
  },
];

export const samplePortfolio: ManagedPortfolio = {
  id: "core-sample",
  name: "Core Portfolio",
  appetite: "moderate",
  inputs: sampleInputs,
  positions: samplePositions,
  refreshedAt: new Date("2026-06-08T06:00:00.000Z").toISOString(),
};

export const marketRecommendationPortfolio: ManagedPortfolio = {
  id: "market-recommendations",
  name: "Market Recommendation",
  appetite: "moderate",
  isMarketPortfolio: true,
  inputs: [],
  positions: [],
  refreshedAt: new Date("2026-06-08T06:00:00.000Z").toISOString(),
};

export function generateRecommendations(
  portfolio: ManagedPortfolio,
  history: Recommendation[] = [],
) {
  const createdAt = new Date().toISOString();
  const metrics = calculatePortfolioMetrics(portfolio.positions);
  const appetite = appetiteProfiles[portfolio.appetite ?? "moderate"];
  const current = metrics.holdings;
  const watchlist = portfolio.positions.filter(
    (position) => position.list === "watchlist",
  );
  const universe = [...current, ...watchlist].filter(
    (position) => position.currentPrice > 0,
  );
  const historyScores = buildHistoryScores(history);

  const intraday = universe
    .map((position) => {
      const metrics = analyzePosition({
        position,
        profile: "intraday",
        historyScore: historyScores[position.symbol] ?? 0,
      });

      return { position, metrics };
    })
    .sort((a, b) => b.metrics.finalScore - a.metrics.finalScore)
    .slice(0, appetite.maxIntraday)
    .map(({ position, metrics }) =>
      buildRecommendation({
        portfolio,
        createdAt,
        section: "Intraday",
        position,
        action: getSignalAction(metrics, "intraday"),
        horizon: "Today | refresh 5-15 min",
        confidence: confidenceFromSignal(metrics, appetite.confidenceShift),
        rationale: `${buildSignalRemark(metrics, "intraday")} ${formatNewsSignal(position.newsHeadlines)} Appetite mode: ${appetite.riskLabel}.`,
        caveats: metrics.caveats,
        metrics,
      }),
    );

  const longTermPlan = current
    .map((position) => {
      const sectorWeight =
        metrics.sectorAllocations.find((sector) => sector.sector === position.sector)
          ?.percentage ?? 0;
      const signalMetrics = analyzePosition({
        position,
        profile: "long-term",
        portfolioWeight: position.portfolioWeight,
        historyScore:
          (historyScores[position.symbol] ?? 0) +
          appetiteScoreBoost(portfolio.appetite, position.sector) -
          (sectorWeight > 35 ? 4 : 0),
      });

      return {
        position,
        metrics: signalMetrics,
        sectorWeight,
      };
    })
    .sort((a, b) => b.metrics.finalScore - a.metrics.finalScore)
    .slice(0, 5)
    .map(({ position, metrics, sectorWeight }) =>
      buildRecommendation({
        portfolio,
        createdAt,
        section: "1-3 Yr Plan",
        position,
        action:
          sectorWeight > 40 && portfolio.appetite !== "aggressive"
            ? "Urgent Sell"
            : getSignalAction(metrics, "long-term"),
        horizon: "1-3 years",
        confidence: confidenceFromSignal(metrics, appetite.confidenceShift),
        rationale: `${buildSignalRemark(metrics, "long-term")} ${position.sector} is ${sectorWeight.toFixed(1)}% of portfolio; ${appetite.riskLabel} mode shapes the buy/sell threshold.`,
        caveats: metrics.caveats,
        metrics,
      }),
    );

  const multibaggerCandidates = universe
    .filter((position) =>
      [
        "Information Technology",
        "Healthcare",
        "Automobile and Auto Components",
        "Power",
        "Consumer Durables",
      ].includes(position.sector),
    )
    .map((position) => {
      const metrics = analyzePosition({
        position,
        profile: position.list === "watchlist" ? "watchlist" : "short-term",
        historyScore:
          (historyScores[position.symbol] ?? 0) +
          (position.list === "watchlist" ? 4 : 1) +
          (portfolio.appetite === "aggressive" ? 4 : portfolio.appetite === "safe" ? -3 : 0),
      });

      return { position, metrics };
    })
    .sort((a, b) => b.metrics.finalScore - a.metrics.finalScore)
    .slice(0, 3)
    .map(({ position, metrics }) =>
      buildRecommendation({
        portfolio,
        createdAt,
        section: "Multibagger",
        position,
        action: getSignalAction(metrics, "watchlist"),
        horizon: "6-12 months",
        confidence: confidenceFromSignal(metrics, appetite.confidenceShift),
        rationale: `${buildSignalRemark(metrics, "watchlist")} ${position.sector} exposure with momentum; validate earnings growth, debt, valuation, and news before entry.`,
        caveats: metrics.caveats,
        metrics,
      }),
    );

  const etfs = [
    {
      symbol: "NIFTYBEES",
      company: "Nippon India ETF Nifty 50 BeES",
      sector: "Broad Market ETF",
      rationale: "Core large-cap diversification for portfolio ballast.",
    },
    {
      symbol: "JUNIORBEES",
      company: "Nippon India ETF Junior BeES",
      sector: "Mid/Large ETF",
      rationale: "Adds next-50 exposure for 6-12 month growth participation.",
    },
    {
      symbol: "BANKBEES",
      company: "Nippon India ETF Bank BeES",
      sector: "Banking ETF",
      rationale: "Balances stock-specific bank exposure with basket exposure.",
    },
  ].map((etf, index) =>
    buildRecommendation({
      portfolio,
      createdAt,
      section: "ETF",
      position: {
        symbol: etf.symbol,
        company: etf.company,
      },
      action: "Accumulate",
      horizon: "6-12 months",
      confidence: 68 - index * 4 + appetite.confidenceShift,
      rationale: `${etf.rationale} Appetite mode: ${appetite.riskLabel}.`,
    }),
  );

  return {
    intraday,
    longTermPlan,
    multibaggerCandidates,
    etfs,
  };
}

function buildRecommendation({
  portfolio,
  createdAt,
  section,
  position,
  action,
  horizon,
  confidence,
  rationale,
  caveats,
  metrics,
}: {
  portfolio: ManagedPortfolio;
  createdAt: string;
  section: RecommendationSection;
  position: Pick<PortfolioPosition, "symbol" | "company">;
  action: Recommendation["action"];
  horizon: string;
  confidence: number;
  rationale: string;
  caveats?: string[];
  metrics?: StockSignalMetrics;
}): Recommendation {
  return {
    id: `${portfolio.id}-${section}-${position.symbol}-${createdAt}`,
    portfolioId: portfolio.id,
    portfolioName: portfolio.name,
    section,
    symbol: position.symbol,
    company: position.company,
    action,
    horizon,
    rationale,
    caveats,
    metrics,
    confidence,
    createdAt,
    status: "NA",
  };
}

function analyzePosition({
  position,
  profile,
  historyScore = 0,
  portfolioWeight = 0,
}: {
  position: PortfolioPosition;
  profile: AnalysisProfile;
  historyScore?: number;
  portfolioWeight?: number;
}) {
  return analyzeStockSignal({
    symbol: position.symbol,
    price: position.currentPrice,
    previousClose: position.previousClose,
    volume: position.volume,
    sector: position.sector,
    bars: position.bars,
    newsCount: position.newsHeadlines?.length ?? 0,
    portfolioWeight,
    profile,
    historyScore,
  });
}

function buildHistoryScores(history: Recommendation[]) {
  return history.reduce<Record<string, number>>((acc, item) => {
    const current = acc[item.symbol] ?? 0;
    if (item.status === "Hit") {
      acc[item.symbol] = current + 1.25;
    } else if (item.status === "Miss") {
      acc[item.symbol] = current - 1.25;
    } else {
      acc[item.symbol] = current;
    }

    return acc;
  }, {});
}

function confidenceFromSignal(metrics: StockSignalMetrics, shift: number) {
  return Math.max(
    42,
    Math.min(92, Math.round(metrics.finalScore * 0.72 + 18 + shift - metrics.riskScore * 0.4)),
  );
}

function appetiteScoreBoost(appetite: InvestmentAppetite, sector: string) {
  if (appetite === "aggressive") {
    return ["Information Technology", "Healthcare", "Automobile and Auto Components", "Consumer Durables"].includes(sector)
      ? 2
      : 0;
  }

  if (appetite === "safe") {
    return ["Financial Services", "Fast Moving Consumer Goods", "Broad Market ETF", "Power"].includes(sector)
      ? 1.5
      : -0.5;
  }

  return 0.5;
}

function formatNewsSignal(headlines?: string[]) {
  if (!headlines?.length) {
    return "No fresh headline signal available.";
  }

  return `Headline signal: ${headlines[0]}`;
}
