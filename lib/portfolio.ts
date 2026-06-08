export type PortfolioList = "current" | "watchlist";

export type PortfolioInputRow = {
  list: PortfolioList;
  stockCode: string;
  company: string;
  stock: string;
  quantity: number;
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
  "ASIAN PAINTS": "ASIANPAINT",
  "AXIS BANK": "AXISBANK",
  "BAJAJ FINANCE": "BAJFINANCE",
  "BHARTI AIRTEL": "BHARTIARTL",
  "HCL TECHNOLOGIES": "HCLTECH",
  "HDFC BANK": "HDFCBANK",
  "HINDUSTAN UNILEVER": "HINDUNILVR",
  "ICICI BANK": "ICICIBANK",
  INFOSYS: "INFY",
  "KOTAK MAHINDRA BANK": "KOTAKBANK",
  "LARSEN & TOUBRO": "LT",
  "LARSEN AND TOUBRO": "LT",
  "MARUTI SUZUKI": "MARUTI",
  "MARUTI SUZUKI INDIA": "MARUTI",
  "NESTLE INDIA": "NESTLEIND",
  "RELIANCE INDUSTRIES": "RELIANCE",
  "STATE BANK OF INDIA": "SBIN",
  SBI: "SBIN",
  "SUN PHARMA": "SUNPHARMA",
  "SUN PHARMACEUTICAL": "SUNPHARMA",
  "SUN PHARMACEUTICAL INDUSTRIES": "SUNPHARMA",
  "TATA CONSULTANCY SERVICES": "TCS",
  "TATA MOTORS": "TATAMOTORS",
  "TATA STEEL": "TATASTEEL",
  "TITAN COMPANY": "TITAN",
  "ULTRATECH CEMENT": "ULTRACEMCO",
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
  const currentPositions = positions.filter(
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

export function resolveStockProfile(stock: string): StockProfile {
  const normalizedStock = normalizeStockKey(stock);
  const symbol = stockAliases[normalizedStock] ?? normalizedStock;
  const cleanSymbol = symbol.replace(/\.NS$|\.BO$/u, "");

  if (stockProfiles[cleanSymbol]) {
    return stockProfiles[cleanSymbol];
  }

  return {
    symbol: cleanSymbol,
    company: stock.trim(),
    sector: identifySector(cleanSymbol, stock),
  };
}

export function buildPortfolioInputRow({
  stockCode,
  company,
  quantity,
}: {
  stockCode?: string;
  company?: string;
  quantity?: number;
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
  inputs: [
    buildPortfolioInputRow({ stockCode: "TCS", company: "Tata Consultancy Services" }),
    buildPortfolioInputRow({ stockCode: "RELIANCE", company: "Reliance Industries" }),
    buildPortfolioInputRow({ stockCode: "MARUTI", company: "Maruti Suzuki India" }),
    buildPortfolioInputRow({ stockCode: "SUNPHARMA", company: "Sun Pharmaceutical Industries" }),
    buildPortfolioInputRow({ stockCode: "TITAN", company: "Titan Company" }),
  ],
  positions: samplePositions.map((position) => ({
    ...position,
    list: "watchlist",
    quantity: 0,
  })),
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
    .map((position) => ({
      position,
      score:
        getDayChangePercent(position) * 4 +
        Math.log10((position.volume ?? 1) + 1) +
        (position.newsHeadlines?.length ?? 0) * 0.5 +
        (historyScores[position.symbol] ?? 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, appetite.maxIntraday)
    .map(({ position, score }) =>
      buildRecommendation({
        portfolio,
        createdAt,
        section: "Intraday",
        position,
        action: score >= 0 || portfolio.appetite === "aggressive" ? "Accumulate" : "Urgent Sell",
        horizon: "Today",
        confidence: confidenceFromScore(score + appetite.confidenceShift, 4),
        rationale: `${formatPercent(getDayChangePercent(position))} day move with ${formatVolume(position.volume)} volume signal. ${formatNewsSignal(position.newsHeadlines)} Appetite mode: ${appetite.riskLabel}.`,
      }),
    );

  const longTermPlan = current
    .map((position) => {
      const sectorWeight =
        metrics.sectorAllocations.find((sector) => sector.sector === position.sector)
          ?.percentage ?? 0;
      const score =
        getDayChangePercent(position) +
        (sectorWeight > 35 ? -2 : 1) +
        appetiteScoreBoost(portfolio.appetite, position.sector) +
        (historyScores[position.symbol] ?? 0);

      return {
        position,
        score,
        sectorWeight,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ position, score, sectorWeight }) =>
      buildRecommendation({
        portfolio,
        createdAt,
        section: "1-3 Yr Plan",
        position,
        action: getLongTermAction(score, sectorWeight, portfolio.appetite),
        horizon: "1-3 years",
        confidence: confidenceFromScore(score + appetite.confidenceShift, 3),
        rationale: `${position.sector} is ${sectorWeight.toFixed(1)}% of portfolio; ${appetite.riskLabel} mode shapes the buy/sell threshold.`,
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
    .map((position) => ({
      position,
      score:
        Math.max(getDayChangePercent(position), 0) * 2 +
        (position.list === "watchlist" ? 1.5 : 0.5) +
        (portfolio.appetite === "aggressive" ? 2 : portfolio.appetite === "safe" ? -1 : 0) +
        (position.newsHeadlines?.length ?? 0) * 0.5 +
        (historyScores[position.symbol] ?? 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ position, score }) =>
      buildRecommendation({
        portfolio,
        createdAt,
        section: "Multibagger",
        position,
        action: score > 1 ? "Accumulate" : "Urgent Sell",
        horizon: "6-12 months",
        confidence: confidenceFromScore(score + appetite.confidenceShift, 4),
        rationale: `${position.sector} exposure with momentum; ${portfolio.appetite} appetite allows ${portfolio.appetite === "aggressive" ? "higher growth optionality" : portfolio.appetite === "safe" ? "only selective tracking" : "balanced tracking"}. Validate earnings growth, debt, and valuation before entry.`,
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
}: {
  portfolio: ManagedPortfolio;
  createdAt: string;
  section: RecommendationSection;
  position: Pick<PortfolioPosition, "symbol" | "company">;
  action: Recommendation["action"];
  horizon: string;
  confidence: number;
  rationale: string;
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
    confidence,
    createdAt,
    status: "NA",
  };
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

function getDayChangePercent(position: PortfolioPosition) {
  if (position.previousClose === 0) {
    return 0;
  }

  return ((position.currentPrice - position.previousClose) / position.previousClose) * 100;
}

function confidenceFromScore(score: number, divisor: number) {
  return Math.max(45, Math.min(88, Math.round(60 + score / divisor)));
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

function getLongTermAction(
  score: number,
  sectorWeight: number,
  appetite: InvestmentAppetite,
): Recommendation["action"] {
  if (sectorWeight > 40 && appetite !== "aggressive") {
    return "Urgent Sell";
  }

  if (score > (appetite === "aggressive" ? 1.5 : appetite === "safe" ? 3 : 2)) {
    return "Accumulate";
  }

  if (score < -1.5) {
    return appetite === "aggressive" ? "Accumulate" : "Urgent Sell";
  }

  return score >= 0 ? "Accumulate" : "Urgent Sell";
}

function formatVolume(volume?: number) {
  if (!volume) {
    return "limited";
  }

  if (volume >= 10000000) {
    return `${(volume / 10000000).toFixed(1)}Cr`;
  }

  if (volume >= 100000) {
    return `${(volume / 100000).toFixed(1)}L`;
  }

  return volume.toLocaleString("en-IN");
}

function formatNewsSignal(headlines?: string[]) {
  if (!headlines?.length) {
    return "No fresh headline signal available.";
  }

  return `Headline signal: ${headlines[0]}`;
}
