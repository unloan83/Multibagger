"use client";

import { BookOpen, Map, Shield, TrendingUp } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MarketOverviewCollapsible } from "@/components/market-overview-collapsible";
import { Button } from "@/components/ui/button";
import type { MarketOverview } from "@/lib/decision-intelligence";
import { cn } from "@/lib/utils";

type ExpertMatrixQuote = {
  symbol: string;
  name: string;
  score: number;
  action: "Accumulate" | "Urgent Sell";
};

type ExpertActionMatrix = {
  asOf: string;
  categories: Array<{
    title: string;
    longTermUpsides: ExpertMatrixQuote[];
    intradayBreakouts: ExpertMatrixQuote[];
  }>;
};

const roadmapItems = [
  "Portfolio Doctor",
  "Decision Journal",
  "Risk Engine",
  "Opportunity Cost Analyzer",
  "Drawdown Simulator",
  "Stress Testing",
  "Intraday Command Center",
  "Trade Journal",
  "Multibagger Discovery Engine",
  "Adaptive Learning Engine",
  "Recommendation Reliability Score",
];

const glossaryItems = [
  ["Fear & Greed", "A calculated sentiment gauge for market participation and risk appetite."],
  ["India VIX", "A volatility proxy; higher readings favor tighter risk management."],
  ["News Shock", "A calculated signal that highlights unusual market movement pressure."],
  ["Market Breadth", "Advancers versus decliners; shows whether the market move is broad."],
  ["Top Focus Sectors", "Sectors inferred from leading movers and index context."],
  ["Stocks Analyzed", "Aggregated expert/market signals without exposing portfolio ownership."],
];

export function PublicMarketPortal() {
  const [market, setMarket] = useState<MarketOverview | null>(null);
  const [expertMatrix, setExpertMatrix] = useState<ExpertActionMatrix | null>(null);
  const [isMarketLoading, setIsMarketLoading] = useState(false);

  async function refreshMarket() {
    setIsMarketLoading(true);
    try {
      const response = await fetch("/api/market");
      if (response.ok) {
        setMarket((await response.json()) as MarketOverview);
      }
    } finally {
      setIsMarketLoading(false);
    }
  }

  useEffect(() => {
    refreshMarket();
    fetch("/api/expert-action-matrix")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => setExpertMatrix(payload as ExpertActionMatrix | null))
      .catch(() => setExpertMatrix(null));
  }, []);

  return (
    <main className="min-h-screen bg-background">
      <section className="mx-auto flex w-full max-w-[1680px] flex-col gap-7 px-4 py-6 sm:px-6 lg:px-8">
        <header className="terminal-panel flex flex-col gap-5 rounded-2xl border border-sky-400/20 px-5 py-5 shadow-[0_24px_80px_rgba(0,0,0,0.34)] lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <Image src="/unloan-logo.svg" alt="Unloan" width={48} height={48} className="rounded-lg shadow-sm" priority />
            <div className="space-y-2">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">Unloan</p>
              <h1 className="text-3xl font-semibold tracking-normal text-white sm:text-4xl">
                UNLOAN MARKET INTELLIGENCE PORTAL
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-slate-300">
                Market Intelligence. Portfolio Insights. Smarter Decisions.
              </p>
            </div>
          </div>
          <nav className="flex flex-wrap items-center gap-2">
            <HeaderLink href="/">Home</HeaderLink>
            <HeaderLink href="#roadmap">Roadmap</HeaderLink>
            <HeaderLink href="#glossary">Glossary</HeaderLink>
            <Button asChild variant="outline">
              <Link href="/admin">
                <Shield className="h-4 w-4" aria-hidden="true" />
                Admin
              </Link>
            </Button>
          </nav>
        </header>

        <MarketOverviewCollapsible
          market={market}
          isLoading={isMarketLoading}
          onRefresh={refreshMarket}
        />

        <StocksAnalyzedSection matrix={expertMatrix} market={market} />

        <RoadmapSection />

        <GlossarySection />
      </section>
    </main>
  );
}

function HeaderLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-cyan-300/40 hover:text-cyan-200"
    >
      {children}
    </Link>
  );
}

function StocksAnalyzedSection({
  matrix,
  market,
}: {
  matrix: ExpertActionMatrix | null;
  market: MarketOverview | null;
}) {
  const picks = useMemo(() => {
    const rows =
      matrix?.categories.flatMap((category) => [
        ...category.longTermUpsides,
        ...category.intradayBreakouts,
      ]) ?? [];
    const grouped = rows.reduce<Record<string, { symbol: string; score: number; count: number; action: string }>>(
      (acc, item) => {
        const existing = acc[item.symbol] ?? {
          symbol: item.symbol,
          score: 0,
          count: 0,
          action: "BUY",
        };
        existing.score += item.score;
        existing.count += 1;
        existing.action = item.action === "Accumulate" ? "BUY" : "REDUCE";
        acc[item.symbol] = existing;
        return acc;
      },
      {},
    );

    return Object.values(grouped)
      .map((item) => ({
        ...item,
        confidence: Math.round(item.score / item.count),
      }))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 8);
  }, [matrix]);
  const totalRecommendations = picks.reduce((sum, item) => sum + item.count, 0);
  const buyCount = picks.filter((item) => item.action === "BUY").length;
  const reduceCount = picks.filter((item) => item.action === "REDUCE").length;

  return (
    <section className="space-y-4 rounded-2xl border border-cyan-300/20 bg-[#0F1B2D] p-5 shadow-xl">
      <SectionTitle
        icon={<TrendingUp className="h-5 w-5" aria-hidden="true" />}
        title="Stocks Analyzed"
        subtitle="Aggregated market intelligence without exposing portfolio ownership."
        badge="CALCULATED"
      />
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="Total Stocks" value={String(picks.length || (market?.gainers.length ?? 0) + (market?.losers.length ?? 0))} />
        <Metric label="Recommendations" value={String(totalRecommendations)} />
        <Metric label="Buy" value={String(buyCount)} tone="up" />
        <Metric label="Hold" value="0" />
        <Metric label="Reduce" value={String(reduceCount)} tone="down" />
        <Metric label="Do Nothing" value={picks.length ? "0" : "1"} />
      </div>
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/[0.03] text-xs uppercase tracking-[0.14em] text-slate-500">
            <tr>
              <th className="px-3 py-3">Symbol</th>
              <th className="px-3 py-3">Recommendation</th>
              <th className="px-3 py-3">Confidence</th>
              <th className="px-3 py-3">Portfolio Count</th>
              <th className="px-3 py-3">Last Updated</th>
            </tr>
          </thead>
          <tbody>
            {picks.map((pick) => (
              <tr key={pick.symbol} className="border-t border-white/10">
                <td className="px-3 py-3 font-semibold text-white">{pick.symbol}</td>
                <td className={cn("px-3 py-3 font-semibold", pick.action === "BUY" ? "text-emerald-300" : "text-rose-300")}>{pick.action}</td>
                <td className="px-3 py-3 text-slate-300">{pick.confidence}%</td>
                <td className="px-3 py-3 text-slate-300">{pick.count} Signals</td>
                <td className="px-3 py-3 text-slate-400">{matrix?.asOf ? "Today" : "Pending"}</td>
              </tr>
            ))}
            {picks.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-slate-400">
                  Market recommendations are loading.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RoadmapSection() {
  return (
    <section id="roadmap" className="space-y-4 rounded-2xl border border-violet-300/20 bg-[#0F1B2D] p-5 shadow-xl">
      <SectionTitle icon={<Map className="h-5 w-5" aria-hidden="true" />} title="Roadmap" subtitle="Planned intelligence modules." badge="CALCULATED" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {roadmapItems.map((item) => (
          <article key={item} className="rounded-xl border border-white/10 bg-[#16263D] p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">Coming Soon</div>
            <h3 className="mt-2 text-sm font-semibold text-white">{item}</h3>
          </article>
        ))}
      </div>
    </section>
  );
}

function GlossarySection() {
  return (
    <section id="glossary" className="space-y-4 rounded-2xl border border-amber-300/20 bg-[#0F1B2D] p-5 shadow-xl">
      <SectionTitle icon={<BookOpen className="h-5 w-5" aria-hidden="true" />} title="Glossary" subtitle="Plain-English market intelligence terms." badge="CALCULATED" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {glossaryItems.map(([term, definition]) => (
          <article key={term} className="rounded-xl border border-white/10 bg-[#16263D] p-4">
            <h3 className="text-sm font-semibold text-amber-200">{term}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-400">{definition}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function SectionTitle({
  icon,
  title,
  subtitle,
  badge,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  badge: "LIVE" | "CALCULATED";
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="rounded-xl border border-cyan-300/25 bg-cyan-300/10 p-2 text-cyan-200">{icon}</span>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold text-white">{title}</h2>
          <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-[10px] font-semibold tracking-[0.12em] text-cyan-200">
            {badge}
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
      </div>
    </div>
  );
}

function Metric({ label, value, tone = "flat" }: { label: string; value: string; tone?: "up" | "down" | "flat" }) {
  return (
    <article className="rounded-xl border border-white/10 bg-[#16263D] p-3">
      <div className="text-xs uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className={cn("mt-2 text-xl font-semibold", tone === "up" ? "text-emerald-300" : tone === "down" ? "text-rose-300" : "text-amber-300")}>{value}</div>
    </article>
  );
}
