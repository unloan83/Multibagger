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

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

export function formatCurrency(value: number) {
  return `$${numberFormatter.format(value)}`;
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

export const sampleHoldings: PortfolioHolding[] = [
  {
    symbol: "AAPL",
    company: "Apple Inc.",
    sector: "Technology",
    quantity: 48,
    averagePrice: 164.2,
    currentPrice: 193.48,
    previousClose: 190.88,
  },
  {
    symbol: "MSFT",
    company: "Microsoft Corp.",
    sector: "Technology",
    quantity: 26,
    averagePrice: 328.8,
    currentPrice: 421.9,
    previousClose: 419.12,
  },
  {
    symbol: "V",
    company: "Visa Inc.",
    sector: "Financials",
    quantity: 32,
    averagePrice: 226.4,
    currentPrice: 274.1,
    previousClose: 276.6,
  },
  {
    symbol: "LLY",
    company: "Eli Lilly",
    sector: "Healthcare",
    quantity: 9,
    averagePrice: 512.5,
    currentPrice: 796.3,
    previousClose: 787.4,
  },
  {
    symbol: "XOM",
    company: "Exxon Mobil",
    sector: "Energy",
    quantity: 58,
    averagePrice: 98.6,
    currentPrice: 112.2,
    previousClose: 113.7,
  },
  {
    symbol: "COST",
    company: "Costco Wholesale",
    sector: "Consumer Staples",
    quantity: 8,
    averagePrice: 574.8,
    currentPrice: 842.1,
    previousClose: 836.4,
  },
  {
    symbol: "NVDA",
    company: "NVIDIA Corp.",
    sector: "Technology",
    quantity: 38,
    averagePrice: 86.5,
    currentPrice: 121.9,
    previousClose: 118.7,
  },
  {
    symbol: "NEE",
    company: "NextEra Energy",
    sector: "Utilities",
    quantity: 72,
    averagePrice: 66.4,
    currentPrice: 74.8,
    previousClose: 73.9,
  },
];
