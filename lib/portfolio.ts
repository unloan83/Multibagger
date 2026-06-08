export type PortfolioHolding = {
  symbol: string;
  company: string;
  sector: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  previousClose: number;
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

export type HoldingWithMetrics = PortfolioHolding & {
  marketValue: number;
  costBasis: number;
  gainLoss: number;
  gainLossPercent: number;
  dayChange: number;
  dayChangePercent: number;
  portfolioWeight: number;
};

export type PortfolioMetrics = {
  holdings: HoldingWithMetrics[];
  totalValue: number;
  totalCost: number;
  totalGainLoss: number;
  totalGainLossPercent: number;
  dayChange: number;
  dayChangePercent: number;
  sectorAllocations: SectorAllocation[];
  growth: GrowthPoint[];
};

const numberFormatter = new Intl.NumberFormat("en-IN", {
  currency: "INR",
  style: "currency",
  maximumFractionDigits: 0,
});

export function formatCurrency(value: number) {
  return numberFormatter.format(value);
}

export function formatPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function calculatePortfolioMetrics(
  holdings: PortfolioHolding[],
): PortfolioMetrics {
  const baseHoldings = holdings.map((holding) => {
    const marketValue = holding.quantity * holding.currentPrice;
    const costBasis = holding.quantity * holding.averagePrice;
    const gainLoss = marketValue - costBasis;
    const gainLossPercent = costBasis === 0 ? 0 : (gainLoss / costBasis) * 100;
    const dayChange = holding.quantity * (holding.currentPrice - holding.previousClose);
    const dayChangePercent =
      holding.previousClose === 0
        ? 0
        : ((holding.currentPrice - holding.previousClose) / holding.previousClose) *
          100;

    return {
      ...holding,
      marketValue,
      costBasis,
      gainLoss,
      gainLossPercent,
      dayChange,
      dayChangePercent,
      portfolioWeight: 0,
    };
  });

  const totalValue = baseHoldings.reduce(
    (sum, holding) => sum + holding.marketValue,
    0,
  );
  const totalCost = baseHoldings.reduce(
    (sum, holding) => sum + holding.costBasis,
    0,
  );
  const dayChange = baseHoldings.reduce(
    (sum, holding) => sum + holding.dayChange,
    0,
  );
  const totalGainLoss = totalValue - totalCost;
  const totalGainLossPercent =
    totalCost === 0 ? 0 : (totalGainLoss / totalCost) * 100;
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
    totalCost,
    totalGainLoss,
    totalGainLossPercent,
    dayChange,
    dayChangePercent,
    sectorAllocations,
    growth: buildGrowthSeries(totalCost, totalValue),
  };
}

function buildGrowthSeries(totalCost: number, totalValue: number): GrowthPoint[] {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug"];
  const start = totalCost * 0.86;
  const end = totalValue;

  return months.map((month, index) => {
    const progress = index / (months.length - 1);
    const wave = Math.sin(index * 1.4) * totalValue * 0.015;
    return {
      month,
      value: Math.round(start + (end - start) * progress + wave),
    };
  });
}

const sectorBySymbol: Record<string, string> = {
  ASIANPAINT: "Consumer Discretionary",
  AXISBANK: "Financial Services",
  BAJFINANCE: "Financial Services",
  BHARTIARTL: "Telecommunication",
  HCLTECH: "Information Technology",
  HDFCBANK: "Financial Services",
  HINDUNILVR: "Fast Moving Consumer Goods",
  ICICIBANK: "Financial Services",
  INFY: "Information Technology",
  ITC: "Fast Moving Consumer Goods",
  KOTAKBANK: "Financial Services",
  LT: "Construction",
  MARUTI: "Automobile and Auto Components",
  NESTLEIND: "Fast Moving Consumer Goods",
  NTPC: "Power",
  RELIANCE: "Oil Gas and Consumable Fuels",
  SBIN: "Financial Services",
  SUNPHARMA: "Healthcare",
  TCS: "Information Technology",
  TATAMOTORS: "Automobile and Auto Components",
  TATASTEEL: "Metals and Mining",
  TITAN: "Consumer Durables",
  ULTRACEMCO: "Construction Materials",
  WIPRO: "Information Technology",
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

export function identifySector(symbol: string, company = "", fallback = "Unclassified") {
  const normalizedSymbol = symbol
    .trim()
    .toUpperCase()
    .replace(/\.NS$|\.BO$/u, "");

  if (sectorBySymbol[normalizedSymbol]) {
    return sectorBySymbol[normalizedSymbol];
  }

  const normalizedCompany = company.trim().toLowerCase();
  const match = companySectorKeywords.find(([keyword]) =>
    normalizedCompany.includes(keyword),
  );

  return match?.[1] ?? fallback;
}

export const sampleHoldings: PortfolioHolding[] = [
  {
    symbol: "RELIANCE",
    company: "Reliance Industries",
    sector: "Oil Gas and Consumable Fuels",
    quantity: 42,
    averagePrice: 2380,
    currentPrice: 2864,
    previousClose: 2838,
  },
  {
    symbol: "TCS",
    company: "Tata Consultancy Services",
    sector: "Information Technology",
    quantity: 28,
    averagePrice: 3310,
    currentPrice: 3925,
    previousClose: 3898,
  },
  {
    symbol: "HDFCBANK",
    company: "HDFC Bank",
    sector: "Financial Services",
    quantity: 68,
    averagePrice: 1425,
    currentPrice: 1668,
    previousClose: 1656,
  },
  {
    symbol: "INFY",
    company: "Infosys",
    sector: "Information Technology",
    quantity: 54,
    averagePrice: 1288,
    currentPrice: 1516,
    previousClose: 1502,
  },
  {
    symbol: "ICICIBANK",
    company: "ICICI Bank",
    sector: "Financial Services",
    quantity: 82,
    averagePrice: 905,
    currentPrice: 1118,
    previousClose: 1106,
  },
  {
    symbol: "SUNPHARMA",
    company: "Sun Pharmaceutical Industries",
    sector: "Healthcare",
    quantity: 36,
    averagePrice: 1025,
    currentPrice: 1512,
    previousClose: 1496,
  },
  {
    symbol: "MARUTI",
    company: "Maruti Suzuki India",
    sector: "Automobile and Auto Components",
    quantity: 9,
    averagePrice: 8420,
    currentPrice: 12680,
    previousClose: 12592,
  },
  {
    symbol: "ITC",
    company: "ITC",
    sector: "Fast Moving Consumer Goods",
    quantity: 190,
    averagePrice: 344,
    currentPrice: 438,
    previousClose: 435,
  },
];
