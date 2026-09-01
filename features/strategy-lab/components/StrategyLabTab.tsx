"use client";

import { useCallback, useEffect, useState } from "react";

type StrategyCandidate = {
  candidate_id: string;
  name: string;
  backtest_source: string;
  win_rate: number;
  backtest_pnl: number;
  avg_win: number;
  avg_loss: number;
  avg_win_loss_ratio: number;
  max_drawdown: number;
  trade_count: number;
  stability_score: number;
  rank: number;
  status: string;
  params: {
    adx_threshold: number;
    vwap_mode: string;
    stop_loss_pct: number;
    target_pct: number;
    entry_time: string;
    direction: string;
  };
  in_sample?: { trade_count: number; win_rate: number; net_pnl: number; max_drawdown: number };
  out_of_sample?: { trade_count: number; win_rate: number; net_pnl: number; max_drawdown: number };
  regime_breakdown?: Record<string, { regime: string; trade_count: number; win_rate: number; net_pnl: number }>;
};

type StrategyLabData = {
  active_strategy: StrategyCandidate | null;
  live_status: {
    symbol: string;
    direction: string;
    backtest_source: string;
    indicators: { vwap: number; adx14: number; atr14: number; rvol: number };
    entry_reason: string;
    stop_loss_price: number;
    target_price: number;
    position_state: string;
    exit_reason: string;
  };
  candidates: StrategyCandidate[];
  pipeline_working: { step: number; stage: string; title: string; details: string; status: string }[];
  trade_audit_log: { trade_id: string; symbol: string; side: string; entry_price: number; exit_price: number; net_pnl: number; entry_reason: string; exit_reason: string; opened_at: string }[];
  hard_loss_limit_inr: number;
};

const formatMoney = (val: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(val);

export default function StrategyLabTab() {
  const [data, setData] = useState<StrategyLabData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/strategy-lab", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Failed to fetch Strategy Lab data");
      setData(json.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Strategy Lab service unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(interval);
  }, [refresh]);

  async function handleApprove(candidateId: string) {
    try {
      setActionMessage(`Approving candidate ${candidateId}...`);
      const res = await fetch("/api/strategy-lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", candidate_id: candidateId, source: "WEB_PORTAL" }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Approval failed");
      setActionMessage(`Strategy ${candidateId} activated successfully!`);
      await refresh();
    } catch (err) {
      setActionMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function handleDeactivate() {
    try {
      setActionMessage("Switching execution to NO_TRADE...");
      const res = await fetch("/api/strategy-lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", candidate_id: "NOTRADE", source: "WEB_PORTAL" }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Deactivation failed");
      setActionMessage("Trading switched to NO_TRADE mode.");
      await refresh();
    } catch (err) {
      setActionMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (loading) return <div className="rounded-xl border border-slate-800 bg-[#0b1626] p-8 text-center text-xs text-slate-400">Loading Strategy Lab engine data...</div>;
  if (error) return <div className="rounded-xl border border-rose-800 bg-rose-950/30 p-5 text-xs text-rose-300"><strong className="block font-bold">ENGINE OUTAGE (503)</strong><span className="mt-1 block">{error}</span></div>;
  if (!data) return null;

  const active = data.active_strategy;
  const live = data.live_status;

  return (
    <section className="space-y-5" aria-label="Strategy Lab Portal">
      {/* Active Strategy Header Card */}
      <div className="rounded-2xl border border-cyan-500/25 bg-[#091424] p-5 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-0.5 text-[10px] font-bold text-cyan-300">
                ACTIVE STRATEGY GATE
              </span>
              <span className="text-xs font-bold text-slate-400">Source: {active ? active.backtest_source : "NONE"}</span>
            </div>
            <h2 className="mt-1 text-lg font-bold text-white">
              {active ? active.name : "NO_TRADE (Waiting for Telegram / Web Approval)"}
            </h2>
            <p className="mt-1 max-w-2xl text-xs text-slate-400">
              Interactive approval gate enforced. Automated pipeline generates candidates and dispatches Telegram proposals requiring human confirmation.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {active ? (
              <button
                type="button"
                onClick={handleDeactivate}
                className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs font-bold text-rose-300 transition hover:bg-rose-500/20"
              >
                Set NO_TRADE
              </button>
            ) : (
              <span className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs font-bold text-amber-300">
                NO ACTIVE TRADE
              </span>
            )}
          </div>
        </div>

        {actionMessage ? (
          <div className="mt-3 rounded-lg border border-cyan-500/30 bg-cyan-950/40 p-2.5 text-xs text-cyan-200">{actionMessage}</div>
        ) : null}

        {/* Live Metrics Grid */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-800 bg-[#050c17] p-3">
            <span className="text-[10px] text-slate-500">Live Symbol</span>
            <strong className="mt-1 block text-sm text-white">{live.symbol} ({live.direction})</strong>
          </div>
          <div className="rounded-xl border border-slate-800 bg-[#050c17] p-3">
            <span className="text-[10px] text-slate-500">Indicators (VWAP / ADX / RVOL)</span>
            <strong className="mt-1 block text-sm text-cyan-300">
              ₹{live.indicators.vwap} | ADX {live.indicators.adx14} | RVOL {live.indicators.rvol}x
            </strong>
          </div>
          <div className="rounded-xl border border-slate-800 bg-[#050c17] p-3">
            <span className="text-[10px] text-slate-500">Stop Loss / Target</span>
            <strong className="mt-1 block text-sm text-emerald-300">
              Stop ₹{live.stop_loss_price} | Target ₹{live.target_price}
            </strong>
          </div>
          <div className="rounded-xl border border-slate-800 bg-[#050c17] p-3">
            <span className="text-[10px] text-slate-500">Daily Hard Loss Limit</span>
            <strong className="mt-1 block text-sm text-amber-300">{formatMoney(data.hard_loss_limit_inr)} Lock Active</strong>
          </div>
        </div>
      </div>

      {/* Candidate Strategies Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">Strategy Candidates ({data.candidates.length})</h3>
          <span className="text-xs text-slate-400">Ranked by In-House Engine Stability Score</span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-[#0b1626]">
          <table className="w-full min-w-[950px] text-left text-xs">
            <thead className="border-b border-slate-800 bg-[#08111e] text-[10px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-3 py-3">Rank</th>
                <th className="px-3 py-3">Candidate ID</th>
                <th className="px-3 py-3">Name</th>
                <th className="px-3 py-3">Source</th>
                <th className="px-3 py-3">Win Rate</th>
                <th className="px-3 py-3">Backtest P&amp;L</th>
                <th className="px-3 py-3">Max DD</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.candidates.map((cand) => {
                const isActive = active?.candidate_id === cand.candidate_id;
                return (
                  <tr key={cand.candidate_id} className={`border-b border-slate-800/70 text-slate-200 last:border-0 ${isActive ? "bg-cyan-950/20" : ""}`}>
                    <td className="px-3 py-3 font-bold text-cyan-300">#{cand.rank}</td>
                    <td className="px-3 py-3 font-mono text-[11px] text-slate-300">{cand.candidate_id}</td>
                    <td className="px-3 py-3 font-medium text-white">{cand.name}</td>
                    <td className="px-3 py-3">
                      <span className="rounded border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-bold text-indigo-300">
                        {cand.backtest_source}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-emerald-400 font-bold">{cand.win_rate}%</td>
                    <td className="px-3 py-3 font-mono">{formatMoney(cand.backtest_pnl)}</td>
                    <td className="px-3 py-3 text-rose-400">{formatMoney(cand.max_drawdown)}</td>
                    <td className="px-3 py-3">
                      <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${cand.status === "ACCEPTED" ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20" : "bg-slate-800 text-slate-400"}`}>
                        {cand.status}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {isActive ? (
                        <span className="text-[11px] font-bold text-emerald-400">ACTIVE</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleApprove(cand.candidate_id)}
                          className="rounded-lg bg-cyan-500/20 border border-cyan-500/40 px-3 py-1 text-[11px] font-bold text-cyan-200 transition hover:bg-cyan-500/30"
                        >
                          Approve
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pipeline Working Stages */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-white">Pipeline Execution Stages</h3>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {data.pipeline_working.map((stage) => (
            <div key={stage.step} className="rounded-xl border border-slate-800 bg-[#07111f] p-3.5 space-y-1.5">
              <div className="flex items-center justify-between text-[10px]">
                <span className="font-bold text-slate-500">STEP 0{stage.step} · {stage.stage}</span>
                <span className={`font-bold px-1.5 py-0.5 rounded text-[9px] ${stage.status === "QUALIFIED" || stage.status === "EXECUTED" || stage.status === "APPROVED" || stage.status === "COMPLETED" || stage.status === "LOCKED" ? "bg-emerald-500/10 text-emerald-300" : "bg-amber-500/10 text-amber-300"}`}>
                  {stage.status}
                </span>
              </div>
              <div className="text-xs font-bold text-white">{stage.title}</div>
              <p className="text-[11px] leading-relaxed text-slate-400">{stage.details}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
