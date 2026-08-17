"use client";

import { useCallback, useEffect, useState } from "react";
import type { OptionsOpportunity, OptionsPosition, OptionsQuantState } from "@/features/options-quant/lib/types";

export default function OptionsQuantTab() {
  const [state, setState] = useState<OptionsQuantState | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/options-quant", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Options Quant state is unavailable.");
      setState(body.state);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Options Quant state is unavailable.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  if (!state) return <div className="rounded-xl border border-slate-800 bg-[#0b1626] p-8 text-center text-sm text-slate-400">{error || "Loading Options Quant evidence…"}</div>;

  const openPositions = state.positions.filter((position) => position.status === "OPEN");
  const metrics = state.metrics;
  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-cyan-500/25 bg-[#0b1626] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-white">Options Quant</h2>
              <StatusBadge value={state.stage} />
              <StatusBadge value={state.executionCapability === "SHADOW_AND_SANDBOX_ONLY" ? "SHADOW / SANDBOX" : state.executionCapability} />
            </div>
            <p className="mt-1 text-xs text-slate-400">NIFTY defined-risk debit spreads using live Upstox chain data. No live-money order capability is enabled.</p>
          </div>
          <div className="text-right text-xs text-slate-400">
            <div>Evaluation: <strong className={state.evaluation.decision === "STOP" ? "text-rose-300" : "text-cyan-300"}>{state.evaluation.decision}</strong></div>
            <div>Updated {formatTime(state.asOf)}</div>
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <Evidence label="Market data" value={state.configuration.marketDataConfigured ? "Configured" : "Missing"} good={state.configuration.marketDataConfigured} />
          <Evidence label="Risk capital" value={state.configuration.portfolioCapitalConfigured ? "Configured" : "Missing"} good={state.configuration.portfolioCapitalConfigured} />
          <Evidence label="Sandbox" value={state.configuration.sandboxConfigured ? "Connected" : "Not connected"} good={state.configuration.sandboxConfigured} />
          <Evidence label="Direction" value={state.direction ? `${state.direction.direction} · ${state.direction.confidence}%` : "Unavailable"} good={Boolean(state.direction && state.direction.direction !== "UNCLEAR")} />
        </div>
        <div className="mt-3 text-xs text-slate-300">Options net-profit targets: <strong className="text-emerald-300">{money(state.configuration.profitTargetRupees)} per trade</strong> · <strong className="text-emerald-300">{money(state.configuration.dailyProfitTargetRupees)} daily lock</strong></div>
      </div>

      {error && <div className="rounded-xl border border-rose-800 bg-rose-950/30 p-3 text-xs text-rose-300">{error}</div>}
      {state.noTradeReasons.length > 0 && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
          <div className="text-sm font-bold text-amber-200">NO TRADE</div>
          <ul className="mt-2 space-y-1 text-xs text-slate-300">{state.noTradeReasons.map((reason) => <li key={reason}>• {reason}</li>)}</ul>
        </div>
      )}

      <Panel title="Live opportunity">
        {state.liveOpportunity ? <OpportunityTable opportunity={state.liveOpportunity} /> : <Empty text="No spread currently passes every direction, liquidity, cost, and portfolio-risk gate." />}
      </Panel>

      <Panel title="Active positions">
        {openPositions.length ? <PositionTable positions={openPositions} /> : <Empty text="No active shadow or sandbox position." />}
      </Panel>

      <Panel title="Performance evidence">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <Metric label="Gross P&L" value={money(metrics.grossPnl)} />
          <Metric label="Net P&L" value={money(metrics.netPnl)} />
          <Metric label="Win Rate" value={`${metrics.winRate}%`} />
          <Metric label="Profit Factor" value={metrics.profitFactor === null ? "N/A" : String(metrics.profitFactor)} />
          <Metric label="Expectancy" value={money(metrics.expectancyPerTrade)} />
          <Metric label="Max Drawdown" value={money(metrics.maximumDrawdown)} />
          <Metric label="Average Win" value={money(metrics.averageWin)} />
          <Metric label="Average Loss" value={money(metrics.averageLoss)} />
          <Metric label="Costs" value={money(metrics.costs)} />
          <Metric label="Slippage" value={money(metrics.slippage)} />
          <Metric label="Signal Accuracy" value={`${metrics.signalAccuracy}%`} />
          <Metric label="Capital Utilisation" value={`${metrics.capitalUtilisation}%`} />
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <StrategyMetric label="Bull Call Spread" performance={metrics.strategyPerformance.BULL_CALL_SPREAD} />
          <StrategyMetric label="Bear Put Spread" performance={metrics.strategyPerformance.BEAR_PUT_SPREAD} />
        </div>
        <div className="mt-3 rounded-lg border border-slate-800 bg-[#07111f] p-3 text-xs text-slate-300">
          <strong className="text-white">{state.evaluation.decision}:</strong> {state.evaluation.reasons.join(" ")}
        </div>
      </Panel>
    </section>
  );
}

function OpportunityTable({ opportunity }: { opportunity: OptionsOpportunity }) {
  const rows = [
    ["Underlying", `${opportunity.underlying} @ ${money(opportunity.underlyingSpot)}`],
    ["Direction / Strategy", `${opportunity.direction} · ${labelStrategy(opportunity.strategy)}`],
    ["Strikes / Expiry", `${opportunity.longLeg.strike} / ${opportunity.shortLeg.strike} · ${opportunity.expiry}`],
    ["Entry Debit", `${money(opportunity.entryDebitPerUnit)} per unit`],
    ["Max Profit / Loss", `${money(opportunity.maxProfit)} / ${money(opportunity.maxLoss)}`],
    ["Net Profit Target", money(opportunity.profitTargetRupees)],
    ["Breakeven / R:R", `${opportunity.breakeven} / ${opportunity.riskReward}`],
    ["IV / Net Delta", `${opportunity.averageIv}% / ${opportunity.netDelta}`],
    ["OI / Volume", `${opportunity.totalOi.toLocaleString("en-IN")} / ${opportunity.totalVolume.toLocaleString("en-IN")}`],
    ["Worst Bid-Ask", `${opportunity.worstBidAskSpreadPercent}%`],
    ["Charges / Slippage", `${money(opportunity.estimatedCharges)} / ${money(opportunity.estimatedSlippage)}`],
    ["Evidence confidence", `${opportunity.confidence}%`],
    ["Exit rules", opportunity.exitRules.join(" ")],
  ];
  return <KeyValueTable rows={rows} />;
}

function PositionTable({ positions }: { positions: OptionsPosition[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[850px] text-left text-xs">
        <thead className="text-slate-500"><tr>{["Opened", "Strategy", "Strikes", "Expiry", "Debit / Mark", "Unrealized Net", "Max Loss", "Mode", "Exit Plan"].map((item) => <th key={item} className="border-b border-slate-800 px-3 py-2">{item}</th>)}</tr></thead>
        <tbody>{positions.map((position) => <tr key={position.id} className="text-slate-200"><td className="px-3 py-3">{formatTime(position.openedAt)}</td><td className="px-3 py-3">{labelStrategy(position.strategy)}</td><td className="px-3 py-3">{position.longLeg.strike}/{position.shortLeg.strike}</td><td className="px-3 py-3">{position.expiry}</td><td className="px-3 py-3">{money(position.entryDebitPerUnit)} / {money(position.currentExitCreditPerUnit)}</td><td className={`px-3 py-3 font-semibold ${position.unrealizedNetPnl >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{money(position.unrealizedNetPnl)}</td><td className="px-3 py-3">{money(position.maxLoss)}</td><td className="px-3 py-3">{position.mode}</td><td className="max-w-sm px-3 py-3 text-slate-400">{position.exitRules[0]}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-xl border border-slate-800 bg-[#0b1626] p-4"><h3 className="mb-3 text-sm font-bold text-white">{title}</h3>{children}</div>;
}

function KeyValueTable({ rows }: { rows: string[][] }) {
  return <div className="grid gap-px overflow-hidden rounded-lg border border-slate-800 bg-slate-800 md:grid-cols-2">{rows.map(([label, value]) => <div key={label} className="bg-[#07111f] p-3"><div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-xs text-slate-200">{value}</div></div>)}</div>;
}

function Evidence({ label, value, good }: { label: string; value: string; good: boolean }) {
  return <div className="rounded-lg border border-slate-800 bg-[#07111f] p-3"><div className="text-[10px] text-slate-500">{label}</div><div className={`mt-1 text-xs font-semibold ${good ? "text-emerald-300" : "text-amber-300"}`}>{value}</div></div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-slate-800 bg-[#07111f] p-3"><div className="text-[10px] text-slate-500">{label}</div><div className="mt-1 text-sm font-bold text-white">{value}</div></div>;
}

function StrategyMetric({ label, performance }: { label: string; performance: { trades: number; netPnl: number; winRate: number } }) {
  return <div className="rounded-lg border border-slate-800 bg-[#07111f] p-3 text-xs text-slate-300"><strong className="text-white">{label}</strong><span className="ml-3">Trades {performance.trades} · Net {money(performance.netPnl)} · Win rate {performance.winRate}%</span></div>;
}

function StatusBadge({ value }: { value: string }) {
  return <span className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-bold text-cyan-200">{value}</span>;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-slate-700 p-6 text-center text-xs text-slate-500">{text}</div>;
}

function money(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
}

function labelStrategy(value: string): string {
  return value === "BULL_CALL_SPREAD" ? "Bull Call Spread" : "Bear Put Spread";
}
