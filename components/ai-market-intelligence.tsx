"use client";

import { AlertCircle, RefreshCw, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type {
  ExistingRecommendationSignal,
  StockIntelligenceReport,
} from "@/lib/stock-intelligence/types";

export function AiMarketIntelligence({
  portfolioId,
  signals,
}: {
  portfolioId: string;
  signals: ExistingRecommendationSignal[];
}) {
  const [report, setReport] = useState<StockIntelligenceReport | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const refresh = useCallback(async () => {
    if (!signals.length) return;
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/stock-intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portfolioId, signals }),
      });
      const payload = (await response.json()) as StockIntelligenceReport & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Market intelligence is temporarily unavailable.");
      setReport(payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Market intelligence is temporarily unavailable.");
    } finally {
      setIsLoading(false);
    }
  }, [portfolioId, signals]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const changed = unique(report?.recommendations.flatMap((item) => item.whatChanged) ?? []).slice(0, 4);
  const positive = report?.recommendations.filter((item) => item.newsImpactScore > 0).slice(0, 4) ?? [];
  const negative = report?.recommendations.filter((item) => item.newsImpactScore < 0).slice(0, 4) ?? [];
  const sectorImpact = report?.recommendations
    .filter((item) => item.sectorMacroImpactScore !== 0)
    .sort((a, b) => Math.abs(b.sectorMacroImpactScore) - Math.abs(a.sectorMacroImpactScore))
    .slice(0, 4) ?? [];

  return (
    <section className="min-w-0 rounded-2xl border border-cyan-300/20 bg-[#101D30] p-4 shadow-xl sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200">Stock Intelligence Agent</p>
            <h2 className="mt-1 text-lg font-semibold text-white">AI Market Intelligence</h2>
            <p className="mt-1 text-sm leading-6 text-slate-400">
              Controlled evidence review layered over existing portfolio and opportunity signals.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={isLoading || !signals.length}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm font-semibold text-slate-200 transition hover:border-cyan-300/40 disabled:cursor-wait disabled:opacity-60"
        >
          <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} aria-hidden="true" />
          {isLoading ? "Checking sources" : "Refresh"}
        </button>
      </div>

      {error ? (
        <div className="mt-4 flex gap-2 rounded-xl border border-amber-300/25 bg-amber-300/10 p-3 text-sm text-amber-100">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {!signals.length && !report && !isLoading ? (
        <div className="mt-4 rounded-xl border border-white/10 bg-[#16263D] p-4 text-sm text-slate-400">
          No portfolio holdings or opportunity signals to analyze. Add positions to your portfolio or wait for market screening to populate opportunities.
        </div>
      ) : null}

      {!report && isLoading ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Loading market intelligence">
          {[0, 1, 2, 3].map((item) => <div key={item} className="h-28 animate-pulse rounded-xl bg-white/[0.05]" />)}
        </div>
      ) : null}

      {report ? (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryBlock title="What changed today" items={changed} empty="No clear fresh change found." />
            <SummaryBlock title="Positively impacted" items={positive.map((item) => `${item.symbol} (${signed(item.newsImpactScore)})`)} empty="No supported positive catalyst." tone="positive" />
            <SummaryBlock title="Negatively impacted" items={negative.map((item) => `${item.symbol} (${signed(item.newsImpactScore)})`)} empty="No supported negative catalyst." tone="negative" />
            <SummaryBlock title="Sector / policy impact" items={sectorImpact.map((item) => `${item.sector}: ${signed(item.sectorMacroImpactScore)}`)} empty="No clear sector or policy direction." />
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {report.recommendations.slice(0, 6).map((item) => (
              <article key={item.symbol} className="rounded-xl border border-white/10 bg-[#16263D] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold text-white">{item.company}</h3>
                    <p className="mt-1 text-xs text-slate-400">{item.symbol} · {item.timeframe}</p>
                  </div>
                  <ActionBadge action={item.action} />
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-300">{item.reason}</p>
                <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
                  <Metric label="Confidence" value={`${item.confidence}%`} />
                  <Metric label="News" value={signed(item.newsImpactScore)} />
                  <Metric label="Final score" value={`${item.finalScore}/100`} />
                  <Metric label="Risk" value={item.riskLevel ?? (item.confidence >= 70 ? "low" : "medium")} />
                </div>
                {item.intradayScore !== undefined || item.longTermScore !== undefined ? (
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                    {item.intradayScore !== undefined ? <Metric label="Intraday" value={`${signed(item.intradayScore)}`} /> : null}
                    {item.swingScore !== undefined ? <Metric label="Swing" value={`${signed(item.swingScore)}`} /> : null}
                    {item.longTermScore !== undefined ? <Metric label="Long-Term" value={`${signed(item.longTermScore)}`} /> : null}
                  </div>
                ) : null}
                {item.expectedCagr != null ? (
                  <div className="mt-3 text-xs text-slate-300">
                    CAGR: <span className="font-semibold text-white">{(item.expectedCagr * 100).toFixed(1)}%</span>
                    {item.expectedMove ? ` · Target move: ${(item.expectedMove * 100).toFixed(1)}%` : null}
                  </div>
                ) : null}
                <details className="mt-3 rounded-lg border border-white/10 bg-black/15">
                  <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-cyan-200">Recommendation explanation</summary>
                  <div className="space-y-3 border-t border-white/10 p-3 text-xs leading-5 text-slate-300">
                    <EvidenceList title="Positive triggers" items={item.positiveTriggers} icon="positive" />
                    <EvidenceList title="Negative concerns" items={item.negativeConcerns} icon="negative" />
                    {item.agentReasons ? (
                      <div>
                        <p className="font-semibold text-white">Agent Reasoning</p>
                        <ul className="mt-1 space-y-1">
                          {item.agentReasons.intraday?.length ? (
                            <li><span className="font-medium text-cyan-200">Intraday:</span> {item.agentReasons.intraday.slice(0, 2).join("; ")}</li>
                          ) : null}
                          {item.agentReasons.swing?.length ? (
                            <li><span className="font-medium text-cyan-200">Swing:</span> {item.agentReasons.swing.slice(0, 2).join("; ")}</li>
                          ) : null}
                          {item.agentReasons.longTerm?.length ? (
                            <li><span className="font-medium text-cyan-200">Long-term:</span> {item.agentReasons.longTerm.slice(0, 2).join("; ")}</li>
                          ) : null}
                        </ul>
                      </div>
                    ) : null}
                    <div>
                      <p className="font-semibold text-white">Sources</p>
                      <ul className="mt-1 space-y-1.5">
                        {item.sourceSummary.map((source) => (
                          <li key={`${item.symbol}-${source.url}`}>
                            <a href={source.url} target="_blank" rel="noreferrer" className="text-cyan-200 underline decoration-cyan-300/30 underline-offset-2 hover:text-cyan-100">
                              {source.source}: {source.title}
                            </a>
                            <span className="ml-1 text-slate-500">({source.credibility})</span>
                          </li>
                        ))}
                        {!item.sourceSummary.length ? <li className="text-slate-500">No reliable source summary available.</li> : null}
                      </ul>
                    </div>
                  </div>
                </details>
              </article>
            ))}
          </div>

          <div className="mt-4 rounded-xl border border-white/10 bg-black/15 p-3 text-xs leading-5 text-slate-400">
            <p><span className="font-semibold text-slate-200">AI confidence note:</span> {report.confidenceNote}</p>
            <p className="mt-1">{report.sourceStatus}</p>
            <p className="mt-2 text-amber-100">{report.disclaimer}</p>
          </div>
        </>
      ) : null}
    </section>
  );
}

function SummaryBlock({ title, items, empty, tone = "neutral" }: { title: string; items: string[]; empty: string; tone?: "neutral" | "positive" | "negative" }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#16263D] p-3.5">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-300">
        {tone === "positive" ? <TrendingUp className="h-4 w-4 text-emerald-300" /> : tone === "negative" ? <TrendingDown className="h-4 w-4 text-rose-300" /> : null}
        {title}
      </div>
      <ul className="mt-2 space-y-1.5 text-xs leading-5 text-slate-400">
        {(items.length ? items : [empty]).map((item) => <li key={item} className="line-clamp-2">{item}</li>)}
      </ul>
    </div>
  );
}

function ActionBadge({ action }: { action: "Buy" | "Hold" | "Sell" | "Watch" }) {
  return <span className={cn("shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold", action === "Buy" ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : action === "Sell" ? "border-rose-300/30 bg-rose-300/10 text-rose-200" : action === "Hold" ? "border-sky-300/30 bg-sky-300/10 text-sky-200" : "border-amber-300/30 bg-amber-300/10 text-amber-100")}>{action}</span>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-black/20 p-2"><div className="text-slate-500">{label}</div><div className="mt-1 font-semibold text-white">{value}</div></div>;
}

function EvidenceList({ title, items, icon }: { title: string; items: string[]; icon: "positive" | "negative" }) {
  if (!items.length) return null;
  return <div><p className="font-semibold text-white">{title}</p><ul className="mt-1 space-y-1">{items.map((item) => <li key={item} className="flex gap-2">{icon === "positive" ? <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" /> : <TrendingDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-300" />}<span>{item}</span></li>)}</ul></div>;
}

function unique(items: string[]) {
  return [...new Set(items)];
}

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}
