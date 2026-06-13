"use client";

import { BrainCircuit, CircleDot, TrendingDown, TrendingUp } from "lucide-react";
import {
  calculatePortfolioMetrics,
  formatCurrency,
  generateRecommendations,
  type ManagedPortfolio,
  type PortfolioMetrics,
  type Recommendation,
} from "@/lib/portfolio";
import { cn } from "@/lib/utils";

type CoachAction = "BUY" | "HOLD" | "REDUCE" | "EXIT";
type CoachPriority = "HIGH" | "MEDIUM" | "LOW";

type CoachItem = {
  symbol: string;
  company: string;
  action: CoachAction;
  buyHigh: number;
  buyLow: number;
  cmp: number;
  reason: string;
  priority: CoachPriority;
  riskLevel: "Low" | "Medium" | "High";
  score: number;
  stopLoss: number;
  suggestedAllocation: string;
  target: number;
  timeHorizon: "Intraday" | "Short Term" | "Swing Trade" | "Long Term" | "Multibagger Candidate";
};

export function PortfolioCoach({ portfolio }: { portfolio: ManagedPortfolio }) {
  const metrics = calculatePortfolioMetrics(portfolio.positions);
  const recommendations = flattenRecommendations(generateRecommendations(portfolio));
  const coachItems = buildCoachItems(portfolio, metrics, recommendations);

  return (
    <section className="space-y-3 rounded-md border border-sky-400/40 bg-zinc-950 p-3 text-zinc-100 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-sky-300">
            <BrainCircuit className="h-4 w-4" aria-hidden="true" />
            <span>AI Portfolio Coach</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-zinc-400">
            Action view using allocation, recent returns, sector exposure, and
            existing recommendation scores.
          </p>
        </div>
        <div className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold text-zinc-300">
          {coachItems.length} signals
        </div>
      </div>

      <div className="space-y-2">
        {coachItems.map((item) => (
          <CoachSignal key={`${item.action}-${item.symbol}`} item={item} />
        ))}
        {coachItems.length === 0 ? (
          <div className="rounded border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs leading-5 text-amber-100">
            Add or refresh holdings to generate coach actions.
          </div>
        ) : null}
      </div>
    </section>
  );
}

function CoachSignal({ item }: { item: CoachItem }) {
  const Icon =
    item.action === "BUY"
      ? TrendingUp
      : item.action === "HOLD"
        ? CircleDot
        : TrendingDown;

  return (
    <div className={cn("rounded-md border bg-black/70 p-2", actionClasses[item.action].shell)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className={cn("flex items-center gap-2 text-xs font-semibold", actionClasses[item.action].text)}>
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{item.priority} PRIORITY</span>
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className={cn("text-sm font-semibold", actionClasses[item.action].text)}>
              {item.action}:
            </span>
            <span className="truncate text-sm font-semibold text-zinc-100">
              {item.symbol}
            </span>
            <span className="truncate text-[11px] text-zinc-400">{item.company}</span>
          </div>
        </div>
          <div className="shrink-0 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[11px] text-zinc-300">
          {item.score}/100
        </div>
      </div>
      <div className="mt-2 grid gap-1 text-[11px] text-zinc-300 sm:grid-cols-2">
        <span>CMP: {formatCurrency(item.cmp)}</span>
        <span>Buy: {formatCurrency(item.buyLow)}-{formatCurrency(item.buyHigh)}</span>
        <span>Stop: {formatCurrency(item.stopLoss)}</span>
        <span>Target: {formatCurrency(item.target)}</span>
        <span>Allocation: {item.suggestedAllocation}</span>
        <span>Horizon: {item.timeHorizon}</span>
        <span>Risk: {item.riskLevel}</span>
      </div>
      <p className="mt-2 text-[11px] leading-5 text-zinc-300">
        <span className="font-semibold text-zinc-100">Reason: </span>
        {item.reason}
      </p>
    </div>
  );
}

function buildCoachItems(
  portfolio: ManagedPortfolio,
  metrics: PortfolioMetrics,
  recommendations: Recommendation[],
): CoachItem[] {
  const recommendationBySymbol = recommendations.reduce<Record<string, Recommendation[]>>(
    (acc, recommendation) => {
      acc[recommendation.symbol] = [...(acc[recommendation.symbol] ?? []), recommendation];
      return acc;
    },
    {},
  );
  const sectorByName = Object.fromEntries(
    metrics.sectorAllocations.map((sector) => [sector.sector, sector.percentage]),
  );
  const holdingItems = metrics.holdings.map((holding) => {
    const stockRecommendations = recommendationBySymbol[holding.symbol] ?? [];
    const bestScore = Math.max(
      0,
      ...stockRecommendations.map(
        (recommendation) => recommendation.metrics?.finalScore ?? recommendation.confidence,
      ),
    );
    const hasSellSignal = stockRecommendations.some(
      (recommendation) => recommendation.action === "Urgent Sell",
    );
    const sectorExposure = sectorByName[holding.sector] ?? 0;

    return coachItemForHolding({
      bestScore,
      hasSellSignal,
      sectorExposure,
      holding,
    });
  });
  const watchlistBuyItems: CoachItem[] = portfolio.positions
    .filter((position) => position.list === "watchlist" && position.currentPrice > 0)
    .flatMap((position) => {
      const stockRecommendations = recommendationBySymbol[position.symbol] ?? [];
      const bestRecommendation = [...stockRecommendations].sort(
        (a, b) =>
          (b.metrics?.finalScore ?? b.confidence) -
          (a.metrics?.finalScore ?? a.confidence),
      )[0];
      const score = bestRecommendation?.metrics?.finalScore ?? bestRecommendation?.confidence ?? 0;

      if (score < 62) {
        return [];
      }

      return [{
        symbol: position.symbol,
        company: position.company,
        action: "BUY" as const,
        ...buildExecutionGuide(position.currentPrice, score, "Swing Trade"),
        priority: score >= 75 ? "HIGH" as const : "MEDIUM" as const,
        score,
        suggestedAllocation: "Add gradually up to 5%.",
        reason: `Watchlist stock has supportive recommendation score of ${score}/100; consider staged buying after price and liquidity validation.`,
      }];
    });

  return [...holdingItems, ...watchlistBuyItems]
    .sort((a, b) => priorityRank[b.priority] - priorityRank[a.priority] || b.score - a.score)
    .slice(0, 8);
}

function coachItemForHolding({
  holding,
  sectorExposure,
  bestScore,
  hasSellSignal,
}: {
  holding: PortfolioMetrics["holdings"][number];
  sectorExposure: number;
  bestScore: number;
  hasSellSignal: boolean;
}): CoachItem {
  if (hasSellSignal && holding.dayChangePercent < -2) {
    return {
      symbol: holding.symbol,
      company: holding.company,
      action: "EXIT",
      ...buildExecutionGuide(holding.currentPrice, bestScore, "Short Term"),
      priority: "HIGH",
      score: Math.max(20, bestScore),
      suggestedAllocation: "Exit or reduce to zero.",
      reason: `Existing recommendation score is weak and recent return is ${holding.dayChangePercent.toFixed(2)}%; exit or set strict stop-loss if recovery signal is absent.`,
    };
  }

  if (holding.portfolioWeight > 30 || sectorExposure > 40) {
    return {
      symbol: holding.symbol,
      company: holding.company,
      action: "REDUCE",
      ...buildExecutionGuide(holding.currentPrice, bestScore || 55, "Short Term"),
      priority: "HIGH",
      score: bestScore || 55,
      suggestedAllocation:
        holding.portfolioWeight > 30 ? "Reduce by 5-10%." : "Trim sector exposure by 5%.",
      reason:
        holding.portfolioWeight > 30
          ? `Portfolio concentration exceeds 30% at ${holding.portfolioWeight.toFixed(1)}%.`
          : `${holding.sector} exposure is high at ${sectorExposure.toFixed(1)}%; reduce concentration risk.`,
    };
  }

  if (holding.portfolioWeight > 22 || (hasSellSignal && holding.dayChangePercent <= 0)) {
    return {
      symbol: holding.symbol,
      company: holding.company,
      action: "REDUCE",
      ...buildExecutionGuide(holding.currentPrice, bestScore || 58, "Short Term"),
      priority: "MEDIUM",
      score: bestScore || 58,
      suggestedAllocation: "Reduce by 3-5% if weakness persists.",
      reason: `Position weight is ${holding.portfolioWeight.toFixed(1)}% with limited recent support; trim gradually and monitor next refresh.`,
    };
  }

  if (bestScore >= 68 && holding.dayChangePercent >= 0 && holding.portfolioWeight < 18) {
    return {
      symbol: holding.symbol,
      company: holding.company,
      action: "BUY",
      ...buildExecutionGuide(holding.currentPrice, bestScore, "Swing Trade"),
      priority: bestScore >= 78 ? "HIGH" : "MEDIUM",
      score: bestScore,
      suggestedAllocation: "Accumulate in 2-3 tranches.",
      reason: `Positive recent return and recommendation score of ${bestScore}/100 support adding in staggered quantities.`,
    };
  }

  return {
    symbol: holding.symbol,
    company: holding.company,
    action: "HOLD",
    ...buildExecutionGuide(holding.currentPrice, bestScore || 60, "Long Term"),
    priority: holding.dayChangePercent < -1 ? "MEDIUM" : "LOW",
    score: bestScore || 60,
    suggestedAllocation: "Maintain current weight.",
    reason: `Allocation is ${holding.portfolioWeight.toFixed(1)}%, sector exposure is ${sectorExposure.toFixed(1)}%, and no urgent action threshold is triggered.`,
  };
}

function buildExecutionGuide(
  cmp: number,
  score: number,
  timeHorizon: CoachItem["timeHorizon"],
) {
  const riskLevel: CoachItem["riskLevel"] =
    score >= 75 ? "Low" : score >= 58 ? "Medium" : "High";
  const buyLow = cmp * 0.96;
  const buyHigh = cmp * 1.01;
  const stopLoss =
    riskLevel === "Low" ? cmp * 0.93 : riskLevel === "Medium" ? cmp * 0.9 : cmp * 0.86;
  const target = cmp * (riskLevel === "Low" ? 1.14 : riskLevel === "Medium" ? 1.18 : 1.24);

  return {
    buyHigh,
    buyLow,
    cmp,
    riskLevel,
    stopLoss,
    target,
    timeHorizon,
  };
}

function flattenRecommendations(
  recommendations: ReturnType<typeof generateRecommendations>,
) {
  return [
    ...recommendations.intraday,
    ...recommendations.longTermPlan,
    ...recommendations.multibaggerCandidates,
    ...recommendations.etfs,
  ];
}

const priorityRank: Record<CoachPriority, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

const actionClasses: Record<
  CoachAction,
  {
    shell: string;
    text: string;
  }
> = {
  BUY: {
    shell: "border-emerald-400/50",
    text: "text-emerald-300",
  },
  HOLD: {
    shell: "border-amber-300/50",
    text: "text-amber-300",
  },
  REDUCE: {
    shell: "border-orange-400/50",
    text: "text-orange-300",
  },
  EXIT: {
    shell: "border-red-400/50",
    text: "text-red-300",
  },
};
