"use client";

import { ChevronRight, RefreshCw, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type MarketQuote = {
  symbol: string;
  name: string;
  segment?: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
};

type MarketMoverGroup = {
  segment: string;
  gainers: MarketQuote[];
  losers: MarketQuote[];
};

type MarketOverview = {
  sentiment: "Positive" | "Negative" | "Neutral";
  averageMove: number;
  indices: MarketQuote[];
  moverGroups?: MarketMoverGroup[];
  gainers: MarketQuote[];
  losers: MarketQuote[];
  refreshedAt: string;
};

export function MarketOverviewCollapsible({
  defaultOpen = true,
  market,
  isLoading,
  onRefresh,
}: {
  defaultOpen?: boolean;
  market: MarketOverview | null;
  isLoading: boolean;
  onRefresh: () => void;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const chartData = useMemo(() => buildMarketChartData(market), [market]);
  const topSectors = useMemo(() => getTopFocusSectors(market), [market]);
  const ratio = getAdvanceDeclineRatio(market);
  const vixProxy = Math.max(10, Math.min(28, 16 + Math.abs(market?.averageMove ?? 0) * 1.7));
  const previousVixProxy = Math.max(10, Math.min(28, vixProxy - (market?.averageMove ?? 0) * 0.35));
  const vixChange = vixProxy - previousVixProxy;
  const fearGreed = Math.max(0, Math.min(100, Math.round(50 + (market?.averageMove ?? 0) * 4)));
  const marketRegime = getMarketRegime({
    averageMove: market?.averageMove ?? 0,
    breadthRatio: ratio,
    fearGreed,
    sentiment: market?.sentiment,
    vixProxy,
  });
  const newsShock =
    Math.abs(market?.averageMove ?? 0) > 1.4
      ? "Elevated"
      : Math.abs(market?.averageMove ?? 0) > 0.6
        ? "Moderate"
        : "Low";

  return (
    <section className="rounded-2xl border border-sky-400/20 bg-[#0F1B2D] shadow-xl">
      <div className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3 text-left">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200">
            <TrendingUp className="h-5 w-5" aria-hidden="true" />
          </span>
          <span>
            <span className="flex flex-wrap items-center gap-2">
              <span className="block text-lg font-semibold text-white">Market Overview</span>
              <SourceBadge label="LIVE" tone="blue" />
            </span>
            <span className="text-sm text-slate-400">
              Live context, breadth, volatility, and sector pressure.
            </span>
          </span>
        </div>
        <div className="flex items-center justify-end gap-3">
          <Button type="button" variant="outline" onClick={onRefresh} disabled={isLoading}>
            <RefreshCw className={cn("h-4 w-4", isLoading ? "animate-spin" : "")} aria-hidden="true" />
            Refresh
          </Button>
          <button
            type="button"
            onClick={() => setIsOpen((value) => !value)}
            className="flex h-12 w-12 items-center justify-center rounded-xl border border-cyan-300/30 bg-cyan-300/10 text-cyan-200 shadow-sm transition hover:border-cyan-200/60 hover:bg-cyan-300/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
            aria-expanded={isOpen}
            aria-label={isOpen ? "Collapse Market Overview" : "Expand Market Overview"}
          >
            <ChevronRight
              className={cn("h-8 w-8 transition-transform", isOpen ? "rotate-90" : "")}
              aria-hidden="true"
            />
          </button>
        </div>
      </div>

      {isOpen ? (
        <div className="space-y-4 border-t border-white/10 p-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <MarketMetric title="Market Sentiment" value={market?.sentiment ?? "Pending"} tone={sentimentTone(market?.sentiment)} badge="CALCULATED" />
            <MarketMetric title="Market Regime" value={marketRegime.label} detail={`${marketRegime.bias} | Confidence ${marketRegime.confidence}%`} tone={marketRegime.tone} badge="CALCULATED" />
            <MarketMetric title="Advance Decline Ratio" value={ratio} detail="Advancers vs decliners" badge="LIVE" />
            <MarketMetric title="Fear & Greed Index" value={`${fearGreed}/100`} detail={`${getFearGreedClass(fearGreed)}: ${getFearGreedInterpretation(fearGreed)}`} tone={fearGreed > 60 ? "up" : fearGreed < 40 ? "down" : "flat"} badge="CALCULATED" />
            <MarketMetric title="News Shock" value={newsShock} detail="Derived from market movement" tone={newsShock === "Elevated" ? "down" : newsShock === "Moderate" ? "flat" : "up"} badge="CALCULATED" />
            <MarketMetric title="India VIX" value={vixProxy.toFixed(1)} detail={`Prev ${previousVixProxy.toFixed(1)} | ${vixChange >= 0 ? "+" : ""}${vixChange.toFixed(1)} | ${getVixStatus(vixProxy)}`} tone={vixProxy > 20 ? "down" : "flat"} badge="CALCULATED" />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <section className="rounded-xl border border-white/10 bg-[#16263D] p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-white">Key Indices Today</h3>
                <span className="text-xs text-slate-400">
                  {market?.refreshedAt ? formatTimestamp(market.refreshedAt) : "Waiting for feed"}
                </span>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                {(market?.indices ?? []).slice(0, 3).map((quote) => (
                  <QuoteTile key={quote.symbol} quote={quote} />
                ))}
                {!market?.indices?.length ? <PlaceholderCard label="Index feed unavailable" /> : null}
              </div>
            </section>

            <section className="rounded-xl border border-white/10 bg-[#16263D] p-4">
              <h3 className="text-sm font-semibold text-white">Top 3 Focus Sectors</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {topSectors.map((sector) => (
                  <span
                    key={sector}
                    className="rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1 text-xs font-semibold text-amber-100"
                  >
                    {sector}
                  </span>
                ))}
                {topSectors.length === 0 ? (
                  <span className="rounded-full border border-white/15 bg-white/[0.03] px-3 py-1 text-xs font-semibold text-slate-400">
                    Waiting for relative strength data
                  </span>
                ) : null}
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <PlaceholderCard label="Upcoming IPOs placeholder" />
                <PlaceholderCard label={`Last Updated: ${market?.refreshedAt ? formatTimestamp(market.refreshedAt) : "Pending"}`} />
              </div>
            </section>
          </div>

          <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <section className="rounded-xl border border-white/10 bg-[#16263D] p-4">
              <h3 className="text-sm font-semibold text-white">Top Movers Today</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <MoverList title="Gainers" quotes={market?.gainers ?? []} tone="up" />
                <MoverList title="Losers" quotes={market?.losers ?? []} tone="down" />
              </div>
            </section>

            <section className="rounded-xl border border-white/10 bg-[#16263D] p-4">
              <h3 className="text-sm font-semibold text-white">Market Performance Chart</h3>
              <div className="mt-3 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="marketPerformance" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="5%" stopColor="#22D3EE" stopOpacity={0.5} />
                        <stop offset="95%" stopColor="#22D3EE" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                    <XAxis dataKey="name" stroke="#94A3B8" fontSize={11} />
                    <YAxis stroke="#94A3B8" fontSize={11} />
                    <Tooltip
                      contentStyle={{
                        background: "#08121F",
                        border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 8,
                        color: "#E2E8F0",
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="move"
                      stroke="#22D3EE"
                      fill="url(#marketPerformance)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function MarketMetric({
  title,
  value,
  detail,
  tone = "flat",
  badge,
}: {
  title: string;
  value: string;
  detail?: string;
  tone?: "up" | "down" | "flat";
  badge?: "LIVE" | "CALCULATED";
}) {
  return (
    <article className="rounded-xl border border-white/10 bg-[#16263D] p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-[0.14em] text-slate-400">{title}</div>
        {badge ? <SourceBadge label={badge} tone={badge === "LIVE" ? "blue" : "gold"} /> : null}
      </div>
      <div className={cn("mt-2 text-xl font-semibold", toneClasses[tone])}>{value}</div>
      {detail ? <div className="mt-1 text-xs text-slate-500">{detail}</div> : null}
    </article>
  );
}

function SourceBadge({ label, tone }: { label: "LIVE" | "CALCULATED"; tone: "blue" | "gold" }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-[0.12em]",
        tone === "blue"
          ? "border-sky-300/30 bg-sky-300/10 text-sky-200"
          : "border-amber-300/30 bg-amber-300/10 text-amber-200",
      )}
    >
      {label}
    </span>
  );
}

function QuoteTile({ quote }: { quote: MarketQuote }) {
  const tone = quote.changePercent >= 0 ? "up" : "down";

  return (
    <article className="rounded-lg border border-white/10 bg-[#08121F] p-3">
      <div className="truncate text-sm font-semibold text-white">{quote.symbol}</div>
      <div className="mt-1 text-xs text-slate-400">{quote.price.toLocaleString("en-IN")}</div>
      <div className={cn("mt-2 text-sm font-semibold", toneClasses[tone])}>
        {quote.changePercent >= 0 ? "+" : ""}
        {quote.changePercent.toFixed(2)}%
      </div>
    </article>
  );
}

function MoverList({
  title,
  quotes,
  tone,
}: {
  title: string;
  quotes: MarketQuote[];
  tone: "up" | "down";
}) {
  return (
    <div>
      <h4 className={cn("text-xs font-semibold", toneClasses[tone])}>{title}</h4>
      <div className="mt-2 space-y-1.5">
        {quotes.slice(0, 6).map((quote) => (
          <div
            key={`${title}-${quote.symbol}`}
            className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-[#08121F] px-2.5 py-2 text-xs"
          >
            <span className="truncate font-semibold text-slate-100">{quote.symbol}</span>
            <span className={toneClasses[tone]}>
              {quote.changePercent >= 0 ? "+" : ""}
              {quote.changePercent.toFixed(2)}%
            </span>
          </div>
        ))}
        {quotes.length === 0 ? <PlaceholderCard label={`${title} feed unavailable`} /> : null}
      </div>
    </div>
  );
}

function PlaceholderCard({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-white/15 bg-white/[0.03] px-3 py-3 text-xs text-slate-500">
      {label}
    </div>
  );
}

function buildMarketChartData(market: MarketOverview | null) {
  const quotes = market?.indices?.length ? market.indices : market?.gainers ?? [];

  if (!quotes?.length) {
    return [
      { name: "Open", move: 0 },
      { name: "Mid", move: 0.2 },
      { name: "Close", move: 0.1 },
    ];
  }

  return quotes.slice(0, 8).map((quote) => ({
    name: quote.symbol,
    move: Number(quote.changePercent.toFixed(2)),
  }));
}

function getAdvanceDeclineRatio(market: MarketOverview | null) {
  const gainers = market?.gainers?.length ?? 0;
  const losers = market?.losers?.length ?? 0;

  if (gainers === 0 && losers === 0) {
    return "Pending";
  }

  return `${gainers}:${Math.max(losers, 1)}`;
}

function getTopFocusSectors(market: MarketOverview | null) {
  const quotes = [
    ...(market?.gainers ?? []),
    ...(market?.losers ?? []),
    ...(market?.indices ?? []),
    ...(market?.moverGroups ?? []).flatMap((group) => [...group.gainers, ...group.losers]),
  ];
  const counts = quotes.reduce<Record<string, number>>((acc, quote) => {
    const sector = inferSector(quote);
    acc[sector] = (acc[sector] ?? 0) + Math.abs(quote.changePercent || 0) + 1;
    return acc;
  }, {});

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([sector]) => sector)
    .filter((sector) => sector !== "Market")
    .slice(0, 3);
}

function getMarketRegime({
  averageMove,
  breadthRatio,
  fearGreed,
  sentiment,
  vixProxy,
}: {
  averageMove: number;
  breadthRatio: string;
  fearGreed: number;
  sentiment?: MarketOverview["sentiment"];
  vixProxy: number;
}) {
  const [advancers, decliners] = breadthRatio
    .split(":")
    .map((value) => Number(value));
  const breadthScore =
    Number.isFinite(advancers) && Number.isFinite(decliners)
      ? advancers / Math.max(decliners, 1)
      : 1;
  const isPositive = sentiment === "Positive" || averageMove > 0.35 || breadthScore > 1.15;
  const isNegative = sentiment === "Negative" || averageMove < -0.35 || breadthScore < 0.85;
  const isVolatile = vixProxy >= 20;

  if (isPositive && !isVolatile && fearGreed >= 55) {
    return {
      bias: "Bullish",
      confidence: Math.min(92, Math.round(64 + Math.abs(averageMove) * 5 + Math.max(0, breadthScore - 1) * 8)),
      label: "Risk-On",
      tone: "up" as const,
    };
  }

  if (isNegative && isVolatile) {
    return {
      bias: "Defensive",
      confidence: Math.min(90, Math.round(66 + Math.abs(averageMove) * 6 + Math.max(0, 1 - breadthScore) * 10)),
      label: "Risk-Off",
      tone: "down" as const,
    };
  }

  if (isNegative) {
    return {
      bias: "Bearish",
      confidence: Math.min(86, Math.round(60 + Math.abs(averageMove) * 5)),
      label: "Correction",
      tone: "down" as const,
    };
  }

  if (Math.abs(averageMove) < 0.35 && breadthScore > 0.9 && breadthScore < 1.1) {
    return {
      bias: "Neutral",
      confidence: 72,
      label: "Consolidation",
      tone: "flat" as const,
    };
  }

  return {
    bias: isPositive ? "Bullish" : "Neutral",
    confidence: 68,
    label: "Transition",
    tone: "flat" as const,
  };
}

function inferSector(quote: MarketQuote) {
  const text = `${quote.symbol} ${quote.name} ${quote.segment ?? ""}`.toLowerCase();

  if (/bank|finance|nbfc|nifty bank/.test(text)) return "Banking";
  if (/pharma|health|hospital|lab/.test(text)) return "Pharma";
  if (/it|tech|software|tcs|infosys|wipro|hcl/.test(text)) return "IT";
  if (/power|energy|renew|green|solar|wind|ireda|ntpc|powergrid/.test(text)) return "Power";
  if (/defence|defense|hal|bel|bhel|mazagon|cochin/.test(text)) return "Defense";
  if (/capital|infra|larsen|abb|siemens|bhel/.test(text)) return "Capital Goods";
  if (/rail|irfc|rvnl|irctc|texrail/.test(text)) return "Railways";
  if (/ems|electronic|kaynes|dixon/.test(text)) return "EMS";
  if (/auto|motor|maruti|tata motors|m&m|eicher/.test(text)) return "Auto";
  if (/fmcg|consumer|hindustan|itc|nestle/.test(text)) return "FMCG";

  return "Market";
}

function getVixStatus(vix: number) {
  if (vix < 14) return "Calm";
  if (vix < 20) return "Normal";
  return "High Fear";
}

function getFearGreedClass(value: number) {
  if (value >= 70) return "Greed";
  if (value <= 30) return "Fear";
  return "Neutral";
}

function getFearGreedInterpretation(value: number) {
  if (value >= 70) return "risk appetite elevated";
  if (value <= 30) return "capital protection preferred";
  return "selective participation";
}

function sentimentTone(sentiment?: MarketOverview["sentiment"]) {
  if (sentiment === "Positive") return "up";
  if (sentiment === "Negative") return "down";
  return "flat";
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const toneClasses = {
  up: "text-emerald-300",
  down: "text-rose-300",
  flat: "text-amber-300",
} as const;
