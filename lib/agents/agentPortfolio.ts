import { calculatePortfolioMetrics, type ManagedPortfolio } from "@/lib/portfolio";
import type {
  AgentInfoOutput,
  AgentMacroPolicyOutput,
  AgentPortfolioOutput,
  AgentSentimentOutput,
} from "@/lib/agents/types";
import { clamp, normalizeSymbol } from "@/lib/agents/utils";

export function agentPortfolio({
  portfolio,
  info,
  macroPolicy,
  sentiment,
  now = new Date(),
}: {
  portfolio: ManagedPortfolio;
  info: AgentInfoOutput;
  macroPolicy: AgentMacroPolicyOutput;
  sentiment: AgentSentimentOutput;
  now?: Date;
}): AgentPortfolioOutput {
  const metrics = calculatePortfolioMetrics(portfolio.positions);
  const sectorConcentration = Object.fromEntries(
    metrics.sectorAllocations.map((sector) => [sector.sector, Math.round(sector.percentage * 10) / 10]),
  );
  const concentrationRisk = Math.round(clamp(
    Math.max(0, ...metrics.holdings.map((holding) => holding.portfolioWeight)) +
      Math.max(0, ...metrics.sectorAllocations.map((sector) => sector.percentage)) * 0.5,
    0,
    100,
  ));
  const stocks = metrics.holdings.map((holding) => {
    const symbol = normalizeSymbol(holding.symbol);
    const infoScore = info.byStock[symbol]?.score ?? 0;
    const sentimentScore = sentiment.byStock[symbol]?.score ?? 0;
    const sectorScore = macroPolicy.sectors.find((item) => item.sector === holding.sector)?.score ?? macroPolicy.marketScore * 0.4;
    const concentrationPenalty = holding.portfolioWeight > 25 ? -2 : holding.portfolioWeight > 15 ? -0.8 : 0.4;
    const score = clamp(infoScore * 0.35 + sentimentScore * 0.2 + sectorScore * 0.25 + concentrationPenalty, -5, 5);
    const input = portfolio.inputs.find((row) => normalizeSymbol(row.stockCode) === symbol);
    const profitLossPercent = input?.buyPrice && input.buyPrice > 0
      ? ((holding.currentPrice - input.buyPrice) / input.buyPrice) * 100
      : null;
    const overlap = [
      ...(info.byStock[symbol] ? ["company/news event"] : []),
      ...(macroPolicy.sectors.some((item) => item.sector === holding.sector) ? ["macro/sector event"] : []),
      ...(holding.portfolioWeight > 20 ? ["concentration risk"] : []),
    ];
    const action = score >= 2 && holding.portfolioWeight <= 20
      ? "Buy" as const
      : score <= -2
        ? "Sell" as const
        : Math.abs(score) < 0.75
          ? "Hold" as const
          : "Watch" as const;

    return {
      symbol,
      action,
      score: Math.round(score * 10) / 10,
      confidence: Math.round(clamp(45 + overlap.length * 12, 25, 85)),
      currentWeight: Math.round(holding.portfolioWeight * 10) / 10,
      profitLossPercent: profitLossPercent === null ? null : Math.round(profitLossPercent * 10) / 10,
      overlap,
      reasons: [
        `Current portfolio weight is ${holding.portfolioWeight.toFixed(1)}%.`,
        overlap.length ? `Overlap: ${overlap.join(", ")}.` : "No direct event overlap detected.",
      ],
    };
  });

  return {
    agent: "Portfolio",
    generatedAt: now.toISOString(),
    portfolioId: portfolio.id,
    concentrationRisk,
    sectorConcentration,
    stocks,
    reasons: [
      `Largest holding is ${Math.max(0, ...metrics.holdings.map((item) => item.portfolioWeight)).toFixed(1)}%.`,
      `Largest sector is ${Math.max(0, ...metrics.sectorAllocations.map((item) => item.percentage)).toFixed(1)}%.`,
    ],
  };
}
