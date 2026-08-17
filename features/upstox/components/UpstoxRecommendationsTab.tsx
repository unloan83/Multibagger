"use client";

import { useCallback, useEffect, useState } from "react";
import type { PaperTrade, PaperTradingState } from "@/lib/intraday-engine";

type PaperSignal = {
  symbol: string;
  price: number;
  target: number;
  stopLoss: number;
  rank_score: number;
  strategy: string;
  timestamp: string;
  expiry: string;
};

type BrokerFeedSnapshot = {
  status: "SIGNALS" | "NO_TRADE";
  asOf: string;
  publication?: {
    status?: string;
    reason?: string;
  };
  intradayPipeline?: {
    source?: string;
    isLive?: boolean;
    reason?: string | null;
    picks?: PaperSignal[];
  };
  paperTrading?: PaperTradingState | null;
};

const formatMoney = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);

const formatTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("en-IN");
};

export default function UpstoxRecommendationsTab() {
  const [snapshot, setSnapshot] = useState<BrokerFeedSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/recommendations", { cache: "no-store" });
      if (!response.ok) throw new Error(`Broker-feed request failed (${response.status})`);
      setSnapshot((await response.json()) as BrokerFeedSnapshot);
      setError(null);
    } catch (cause) {
      setSnapshot(null);
      setError(cause instanceof Error ? cause.message : "Broker-feed request failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const picks = snapshot?.intradayPipeline?.picks ?? [];
  const paper = snapshot?.paperTrading ?? null;
  const hasLiveSignals =
    snapshot?.status === "SIGNALS" &&
    snapshot.intradayPipeline?.isLive === true &&
    picks.length > 0;

  return (
    <section className="space-y-4" aria-labelledby="upstox-title">
      <div className="rounded-2xl border border-cyan-500/25 bg-[#0b1626] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold tracking-wide text-cyan-300">REAL BROKER FEED · SHADOW VALIDATION</p>
          <h2 id="upstox-title" className="mt-1 text-lg font-bold text-white">Upstox Intraday</h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
            Live broker-feed signals with automatic simulated entries and exits. Real-money orders,
            synthetic picks, forced quota trades and recovery trades remain disabled.
          </p>
        </div>
        <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[10px] font-bold text-emerald-200">AUTOMATIC PAPER EXECUTION</span>
        </div>
      </div>

      {paper ? <PaperExecutionPanel paper={paper} /> : (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-xs text-amber-200">Automatic paper execution has not published its first lifecycle snapshot yet.</div>
      )}

      <div className="grid gap-2 sm:grid-cols-3">
        <article className="rounded-lg border border-slate-800 bg-[#07111f] p-3">
          <span className="text-[10px] text-slate-500">Feed source</span>
          <strong className="mt-1 block text-xs text-white">{snapshot?.intradayPipeline?.source ?? "Unavailable"}</strong>
        </article>
        <article className="rounded-lg border border-slate-800 bg-[#07111f] p-3">
          <span className="text-[10px] text-slate-500">Publication</span>
          <strong className="mt-1 block text-xs text-white">{snapshot?.publication?.status ?? snapshot?.status ?? "Pending"}</strong>
        </article>
        <article className="rounded-lg border border-slate-800 bg-[#07111f] p-3">
          <span className="text-[10px] text-slate-500">Snapshot</span>
          <strong className="mt-1 block text-xs text-white">{snapshot?.asOf ? formatTime(snapshot.asOf) : "—"}</strong>
        </article>
      </div>

      {loading ? <p className="rounded-xl border border-slate-800 bg-[#0b1626] p-6 text-center text-xs text-slate-400">Loading broker-feed evidence…</p> : null}
      {error ? (
        <div className="rounded-xl border border-rose-800 bg-rose-950/30 p-4 text-xs text-rose-300">
          <strong className="block">NO TRADE</strong>
          <span className="mt-1 block">{error}</span>
        </div>
      ) : null}
      {!loading && !error && !hasLiveSignals ? (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-xs text-slate-300">
          <strong className="block text-amber-200">NO TRADE</strong>
          <span className="mt-1 block">
            {snapshot?.intradayPipeline?.reason ??
              snapshot?.publication?.reason ??
              "No fresh, executable-quality signal passed the risk gate."}
          </span>
        </div>
      ) : null}

      {hasLiveSignals ? (
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-[#0b1626]">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="border-b border-slate-800 bg-[#08111e] text-[10px] uppercase tracking-wide text-slate-400">
              <tr>
                {['Symbol', 'Strategy', 'Entry', 'Target', 'Stop', 'Rank', 'Observed', 'Expires'].map((heading) => <th key={heading} className="px-3 py-3">{heading}</th>)}
              </tr>
            </thead>
            <tbody>
              {picks.map((pick) => (
                <tr key={`${pick.symbol}-${pick.timestamp}`} className="border-b border-slate-800/70 text-slate-200 last:border-0">
                  <td className="px-3 py-3"><strong className="text-white">{pick.symbol}</strong></td>
                  <td className="px-3 py-3">{pick.strategy}</td>
                  <td className="px-3 py-3">{formatMoney(pick.price)}</td>
                  <td className="px-3 py-3">{formatMoney(pick.target)}</td>
                  <td className="px-3 py-3">{formatMoney(pick.stopLoss)}</td>
                  <td className="px-3 py-3 text-cyan-300">{pick.rank_score.toFixed(1)}</td>
                  <td className="px-3 py-3">{formatTime(pick.timestamp)}</td>
                  <td className="px-3 py-3">{formatTime(pick.expiry)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="text-[11px] leading-relaxed text-slate-500">
        Promotion beyond shadow mode requires recorded net P&amp;L, costs, slippage,
        win rate, profit factor, expectancy, drawdown and capital utilisation.
      </p>
    </section>
  );
}

function PaperExecutionPanel({ paper }: { paper: PaperTradingState }) {
  return (
    <section className="space-y-3 rounded-xl border border-emerald-500/20 bg-[#0b1626] p-4" aria-label="Automatic paper trading">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h3 className="text-sm font-bold text-white">Automatic paper trading</h3><p className="mt-1 text-[11px] text-slate-400">Entries and exits use executable bid/ask quotes with modeled costs and slippage.</p></div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${paper.newEntriesEnabled ? "border-emerald-500/30 text-emerald-300" : "border-amber-500/30 text-amber-300"}`}>{paper.newEntriesEnabled ? "ENTRIES ENABLED" : "ENTRIES LOCKED"}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <PaperMetric label="Daily target" value={formatMoney(paper.dailyProfitTarget)} />
        <PaperMetric label="Daily net P&L" value={formatMoney(paper.dailyMetrics.netPnl)} />
        <PaperMetric label="Closed trades" value={String(paper.dailyMetrics.closedTrades)} />
        <PaperMetric label="Win rate" value={`${paper.dailyMetrics.winRate}%`} />
        <PaperMetric label="Profit factor" value={paper.dailyMetrics.profitFactor === null ? "N/A" : String(paper.dailyMetrics.profitFactor)} />
        <PaperMetric label="Max drawdown" value={formatMoney(paper.overallMetrics.maximumDrawdown)} />
        <PaperMetric label="Expectancy" value={formatMoney(paper.overallMetrics.expectancyPerTrade)} />
        <PaperMetric label="Brokerage" value={formatMoney(paper.overallMetrics.brokerage)} />
        <PaperMetric label="Fees / taxes" value={formatMoney(paper.overallMetrics.feesTaxes)} />
        <PaperMetric label="Slippage" value={formatMoney(paper.overallMetrics.slippage)} />
        <PaperMetric label="Capital use" value={`${paper.overallMetrics.capitalUtilisation}%`} />
        <PaperMetric label="Open positions" value={String(paper.openPositions.length)} />
      </div>
      {paper.noEntryReasons.length ? <p className="text-xs text-amber-300">{paper.noEntryReasons.join(" ")}</p> : null}
      {paper.openPositions.length ? <PaperTrades trades={paper.openPositions} /> : <p className="text-xs text-slate-500">No open paper positions.</p>}
    </section>
  );
}

function PaperTrades({ trades }: { trades: PaperTrade[] }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-xs"><thead className="text-slate-500"><tr>{["Symbol", "Strategy", "Qty", "Entry / Mark", "Stop / Target", "Net P&L", "Execution", "Opened"].map((heading) => <th key={heading} className="border-b border-slate-800 px-3 py-2">{heading}</th>)}</tr></thead><tbody>{trades.map((trade) => <tr key={trade.trade_id} className="text-slate-200"><td className="px-3 py-3 font-bold text-white">{trade.symbol}</td><td className="px-3 py-3">{trade.strategy}</td><td className="px-3 py-3">{trade.quantity}</td><td className="px-3 py-3">{formatMoney(trade.entry_fill)} / {formatMoney(trade.current_quote)}</td><td className="px-3 py-3">{formatMoney(trade.stop_price)} / {formatMoney(trade.target_price)}</td><td className={`px-3 py-3 font-semibold ${trade.net_pnl >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{formatMoney(trade.net_pnl)}</td><td className="px-3 py-3">{trade.execution_mode}</td><td className="px-3 py-3">{formatTime(trade.opened_at)}</td></tr>)}</tbody></table></div>;
}

function PaperMetric({ label, value }: { label: string; value: string }) {
  return <article className="rounded-lg border border-slate-800 bg-[#07111f] p-3"><span className="text-[10px] text-slate-500">{label}</span><strong className="mt-1 block text-xs text-white">{value}</strong></article>;
}
