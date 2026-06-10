"use client";

import { ChevronDown, RefreshCw, TrendingUp } from "lucide-react";
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
  market,
  isLoading,
  onRefresh,
}: {
  market: MarketOverview | null;
  isLoading: boolean;
  onRefresh: () => void;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const chartData = useMemo(() => buildMarketChartData(market), [market]);
  const topSectors = market?.moverGroups?.slice(0, 3).map((group) => group.segment) ?? [];
  const ratio = getAdvanceDeclineRatio(market);
  const vixProxy = Math.max(10, Math.min(28, 16 + Math.abs(market?.averageMove ?? 0) * 1.7));
  const fearGreed = Math.max(0, Math.min(100, Math.round(50 + (market?.averageMove ?? 0) * 4)));
  const newsShock =
    Math.abs(market?.averageMove ?? 0) > 1.4
      ? "Elevated"
      : Math.abs(market?.averageMove ?? 0) > 0.6
        ? "Moderate"
        : "Low";

  return (
    <section className="rounded-2xl border border-sky-400/20 bg-[#0F1B2D] shadow-xl">
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={() => setIsOpen((value) => !value)}
          className="flex items-center gap-3 text-left"
          aria-expanded={isOpen}
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200">
            <TrendingUp className="h-5 w-5" aria-hidden="true" />
          </span>
          <span>
            <span className="block text-lg font-semibold text-white">Market Overview</span>
            <span className="text-sm text-slate-400">
              Live context, breadth, volatility, and sector pressure.
            </span>
          </span>
          <ChevronDown
            className={cn("h-5 w-5 text-cyan-300 transition-transform", isOpen ? "rotate-180" : "")}
            aria-hidden="true"
          />
        </button>
        <Button type="button" variant="outline" onClick={onRefresh} disabled={isLoading}>
          <RefreshCw className={cn("h-4 w-4", isLoading ? "animate-spin" : "")} aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {isOpen ? (
        <div className="space-y-4 border-t border-white/10 p-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <MarketMetric title="Market Sentiment" value={market?.sentiment ?? "Pending"} tone={sentimentTone(market?.sentiment)} />
            <MarketMetric title="Advance Decline Ratio" value={ratio} detail="Advancers vs decliners" />
            <MarketMetric title="Fear & Greed Index" value={`${fearGreed}/100`} detail="Proxy until feed is connected" tone={fearGreed > 60 ? "up" : fearGreed < 40 ? "down" : "flat"} />
            <MarketMetric title="News Shock" value={newsShock} detail="Derived from market movement" tone={newsShock === "Elevated" ? "down" : newsShock === "Moderate" ? "flat" : "up"} />
            <MarketMetric title="India VIX" value={vixProxy.toFixed(1)} detail="Volatility proxy" tone={vixProxy > 20 ? "down" : "flat"} />
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
                {(topSectors.length ? topSectors : ["Banking", "IT", "Capital Goods"]).map((sector) => (
                  <span
                    key={sector}
                    className="rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1 text-xs font-semibold text-amber-100"
                  >
                    {sector}
                  </span>
                ))}
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <PlaceholderCard label="Upcoming IPOs placeholder" />
                <PlaceholderCard label="Sector Heatmap placeholder" />
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
}: {
  title: string;
  value: string;
  detail?: string;
  tone?: "up" | "down" | "flat";
}) {
  return (
    <article className="rounded-xl border border-white/10 bg-[#16263D] p-4 shadow-sm">
      <div className="text-xs uppercase tracking-[0.14em] text-slate-400">{title}</div>
      <div className={cn("mt-2 text-xl font-semibold", toneClasses[tone])}>{value}</div>
      {detail ? <div className="mt-1 text-xs text-slate-500">{detail}</div> : null}
    </article>
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
