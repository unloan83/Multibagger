"use client";

import {
  AlertTriangle,
  CheckCircle2,
  HeartPulse,
  Lightbulb,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  calculatePortfolioMetrics,
  formatPercent,
  type ManagedPortfolio,
  type PortfolioMetrics,
} from "@/lib/portfolio";
import { cn } from "@/lib/utils";

type HealthComponent = {
  label: string;
  score: number;
  weight: number;
};

type PortfolioHealthResult = {
  score: number;
  components: HealthComponent[];
  strengths: string[];
  weaknesses: string[];
  actions: string[];
};

export function PortfolioHealth({ portfolio }: { portfolio: ManagedPortfolio }) {
  const metrics = calculatePortfolioMetrics(portfolio.positions);
  const health = analyzePortfolioHealth(portfolio, metrics);
  const scoreTone =
    health.score >= 75 ? "up" : health.score >= 55 ? "flat" : "down";

  return (
    <section
      className={cn(
        "space-y-3 rounded-md border bg-zinc-950 p-3 text-zinc-100 shadow-sm",
        healthClasses[scoreTone].shell,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <HeartPulse className="h-4 w-4" aria-hidden="true" />
            <span>Portfolio Health Score</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-zinc-400">
            Weighted doctor check across diversification, concentration, momentum,
            quality, and cash discipline.
          </p>
        </div>
        <div className={cn("shrink-0 text-right", healthClasses[scoreTone].text)}>
          <div className="text-3xl font-semibold leading-none">{health.score}</div>
          <div className="text-[11px] font-medium text-zinc-400">/100</div>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-5">
        {health.components.map((component) => (
          <div
            key={component.label}
            className="rounded border border-white/10 bg-white/5 p-2"
          >
            <div className="text-[10px] uppercase tracking-normal text-zinc-400">
              {component.label}
            </div>
            <div className="mt-1 flex items-end justify-between gap-2">
              <span className="text-sm font-semibold">{component.score}</span>
              <span className="text-[10px] text-zinc-500">
                {(component.weight * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <HealthList
          title="Strengths"
          icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
          items={health.strengths}
          tone="up"
        />
        <HealthList
          title="Weaknesses"
          icon={<AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}
          items={health.weaknesses}
          tone="flat"
        />
        <HealthList
          title="Suggested Actions"
          icon={<Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />}
          items={health.actions}
          tone="down"
        />
      </div>
    </section>
  );
}

function HealthList({
  title,
  icon,
  items,
  tone,
}: {
  title: string;
  icon: ReactNode;
  items: string[];
  tone: keyof typeof healthClasses;
}) {
  return (
    <div className="space-y-2 rounded border border-white/10 bg-white/5 p-2">
      <div className={cn("flex items-center gap-1.5 text-xs font-semibold", healthClasses[tone].text)}>
        {icon}
        {title}
      </div>
      <ul className="space-y-1.5 text-[11px] leading-4 text-zinc-300">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function analyzePortfolioHealth(
  portfolio: ManagedPortfolio,
  metrics: PortfolioMetrics,
): PortfolioHealthResult {
  const holdings = metrics.holdings;
  const totalHoldings = holdings.length;
  const topHolding = holdings[0];
  const topSector = metrics.sectorAllocations[0];
  const watchlistCount = portfolio.positions.filter(
    (position) => position.list === "watchlist",
  ).length;
  const positiveMomentum = holdings.filter(
    (holding) => holding.dayChangePercent > 0,
  ).length;
  const strongTechnicalCount = holdings.filter((holding) => {
    const closes = holding.bars?.map((bar) => bar.close).filter(Boolean) ?? [];
    const recent = closes.at(-1) ?? holding.currentPrice;
    const mid = closes.at(-20) ?? holding.previousClose;

    return recent >= mid && holding.currentPrice >= holding.previousClose;
  }).length;
  const quoteQualitySignals = holdings.reduce((score, holding) => {
    return (
      score +
      Number(holding.currentPrice > 0) +
      Number(holding.previousClose > 0) +
      Number((holding.volume ?? 0) > 0) +
      Number((holding.bars?.length ?? 0) >= 20)
    );
  }, 0);
  const cashProxyPercent =
    portfolio.inputs.length === 0
      ? 0
      : (watchlistCount / Math.max(portfolio.inputs.length, 1)) * 100;

  const diversificationScore = clamp(
    totalHoldings >= 12
      ? 100
      : totalHoldings >= 8
        ? 84
        : totalHoldings >= 5
          ? 68
          : totalHoldings >= 3
            ? 48
            : totalHoldings > 0
              ? 28
              : 0,
  );
  const concentrationScore = clamp(
    100 -
      Math.max(0, (topSector?.percentage ?? 0) - 30) * 1.8 -
      Math.max(0, (topHolding?.portfolioWeight ?? 0) - 20) * 2.2,
  );
  const momentumScore = clamp(
    totalHoldings === 0
      ? 0
      : (positiveMomentum / totalHoldings) * 45 +
          (strongTechnicalCount / totalHoldings) * 45 +
          Math.max(0, metrics.dayChangePercent) * 2,
  );
  const qualityScore = clamp(
    totalHoldings === 0 ? 0 : (quoteQualitySignals / (totalHoldings * 4)) * 100,
  );
  const cashAllocationScore = clamp(
    cashProxyPercent >= 8 && cashProxyPercent <= 20
      ? 92
      : cashProxyPercent > 20
        ? 78 - Math.min(30, cashProxyPercent - 20)
        : 62 + cashProxyPercent * 2,
  );
  const components = [
    { label: "Diversification", score: Math.round(diversificationScore), weight: 0.25 },
    { label: "Sector Risk", score: Math.round(concentrationScore), weight: 0.2 },
    { label: "Momentum", score: Math.round(momentumScore), weight: 0.2 },
    { label: "Quality", score: Math.round(qualityScore), weight: 0.2 },
    { label: "Cash", score: Math.round(cashAllocationScore), weight: 0.15 },
  ];
  const score = Math.round(
    components.reduce((sum, component) => sum + component.score * component.weight, 0),
  );

  return {
    score,
    components,
    strengths: buildStrengths({
      totalHoldings,
      topSector,
      topHolding,
      momentumScore,
      qualityScore,
      cashProxyPercent,
    }),
    weaknesses: buildWeaknesses({
      totalHoldings,
      topSector,
      topHolding,
      momentumScore,
      qualityScore,
      cashProxyPercent,
    }),
    actions: buildActions({
      holdings,
      topSector,
      topHolding,
      momentumScore,
      cashProxyPercent,
    }),
  };
}

function buildStrengths({
  totalHoldings,
  topSector,
  topHolding,
  momentumScore,
  qualityScore,
  cashProxyPercent,
}: {
  totalHoldings: number;
  topSector?: { sector: string; percentage: number };
  topHolding?: { symbol: string; portfolioWeight: number };
  momentumScore: number;
  qualityScore: number;
  cashProxyPercent: number;
}) {
  const strengths: string[] = [];

  if (totalHoldings >= 8) {
    strengths.push("Diversified holdings across multiple stocks.");
  }

  if ((topSector?.percentage ?? 100) <= 30) {
    strengths.push("Sector mix is controlled without one dominant pocket.");
  }

  if ((topHolding?.portfolioWeight ?? 100) <= 20) {
    strengths.push("No single holding is dominating portfolio value.");
  }

  if (momentumScore >= 65) {
    strengths.push("Most holdings show supportive price momentum.");
  }

  if (qualityScore >= 80) {
    strengths.push("Live quote and technical data quality is strong.");
  }

  if (cashProxyPercent >= 8 && cashProxyPercent <= 20) {
    strengths.push("Watchlist/cash buffer supports staged deployment.");
  }

  return strengths.length ? strengths.slice(0, 4) : ["Enough data is available to begin portfolio diagnosis."];
}

function buildWeaknesses({
  totalHoldings,
  topSector,
  topHolding,
  momentumScore,
  qualityScore,
  cashProxyPercent,
}: {
  totalHoldings: number;
  topSector?: { sector: string; percentage: number };
  topHolding?: { symbol: string; portfolioWeight: number };
  momentumScore: number;
  qualityScore: number;
  cashProxyPercent: number;
}) {
  const weaknesses: string[] = [];

  if (totalHoldings < 5) {
    weaknesses.push("Portfolio has limited diversification.");
  }

  if ((topSector?.percentage ?? 0) > 35) {
    weaknesses.push(`${topSector?.sector} exposure is high at ${formatPercent(topSector?.percentage ?? 0)}.`);
  }

  if ((topHolding?.portfolioWeight ?? 0) > 25) {
    weaknesses.push(`${topHolding?.symbol} exceeds 25% position weight.`);
  }

  if (momentumScore < 50) {
    weaknesses.push("Momentum is weak across several holdings.");
  }

  if (qualityScore < 70) {
    weaknesses.push("Some holdings are missing strong quote or technical confirmation.");
  }

  if (cashProxyPercent < 5) {
    weaknesses.push("Low watchlist/cash buffer reduces flexibility for fresh opportunities.");
  }

  return weaknesses.length ? weaknesses.slice(0, 4) : ["No major structural weakness detected from current data."];
}

function buildActions({
  holdings,
  topSector,
  topHolding,
  momentumScore,
  cashProxyPercent,
}: {
  holdings: PortfolioMetrics["holdings"];
  topSector?: { sector: string; percentage: number };
  topHolding?: { symbol: string; portfolioWeight: number };
  momentumScore: number;
  cashProxyPercent: number;
}) {
  const actions: string[] = [];
  const weakHolding = [...holdings].sort(
    (a, b) => a.dayChangePercent - b.dayChangePercent,
  )[0];

  if ((topHolding?.portfolioWeight ?? 0) > 25) {
    actions.push(`Reduce ${topHolding?.symbol} by 5-10% to lower single-stock risk.`);
  }

  if ((topSector?.percentage ?? 0) > 35) {
    actions.push(`Trim ${topSector?.sector} exposure and add an underweight sector.`);
  }

  if (momentumScore < 50 && weakHolding) {
    actions.push(`Review ${weakHolding.symbol}; weak price action may need risk control.`);
  }

  if (cashProxyPercent < 5) {
    actions.push("Keep 8-15% deployable buffer or watchlist for staggered buying.");
  }

  if (!holdings.some((holding) => holding.sector.includes("Construction"))) {
    actions.push("Consider Capital Goods or Infrastructure exposure after validation.");
  }

  return actions.length ? actions.slice(0, 4) : ["Maintain allocation discipline and refresh signals daily."];
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

const healthClasses = {
  up: {
    shell: "border-emerald-400/50",
    text: "text-emerald-300",
  },
  flat: {
    shell: "border-amber-300/50",
    text: "text-amber-300",
  },
  down: {
    shell: "border-red-400/50",
    text: "text-red-300",
  },
} as const;
