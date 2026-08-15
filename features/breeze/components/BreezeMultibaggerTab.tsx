"use client";

import { useEffect, useState } from "react";
import type { BreezeMultibaggerSnapshot, MultibaggerCandidate } from "@/features/breeze/lib/breeze-multibagger";

export default function BreezeMultibaggerTab() {
  const [snapshot, setSnapshot] = useState<BreezeMultibaggerSnapshot | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/breeze-multibagger", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || !body.ok) throw new Error(body.error || "Could not load Breeze Multibagger.");
        return body.snapshot as BreezeMultibaggerSnapshot;
      })
      .then(setSnapshot)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load Breeze Multibagger."));
  }, []);

  if (error) return <div className="rounded-xl border border-rose-800 bg-rose-950/30 p-6 text-sm text-rose-200">{error}</div>;
  if (!snapshot) return <div className="rounded-xl border border-slate-800 bg-[#0b1626] p-8 text-center text-sm text-slate-400">Loading long-horizon research…</div>;

  return (
    <section className="space-y-6">
      <div className="rounded-xl border border-cyan-500/20 bg-[#0b1626] p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-white">Breeze Multibagger</h2>
            <p className="mt-1 text-xs text-slate-400">Market Intelligence Triage • Top 20 watchlist → deep validation → Top 5–10 candidates • price below ₹1,000</p>
          </div>
          <span className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-300">RESEARCH ONLY</span>
        </div>
        <p className="mt-3 text-[11px] text-slate-500">Updated {new Date(snapshot.asOf).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST • {snapshot.universe.registered.toLocaleString("en-IN")} NSE/BSE securities registered • {snapshot.historyCount.toLocaleString("en-IN")} recommendations permanently tracked • no automatic trade placement</p>
      </div>

      <div>
        <h3 className="text-sm font-bold text-white">Ranked multibagger candidates</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">The existing fundamental safety gates run first. Analyst and smart-money evidence can improve priority but cannot independently produce a BUY.</p>
      </div>
      <CandidateTable rows={snapshot.rankedCandidates} empty="No stock, ETF or IPO is currently available for triage." />
    </section>
  );
}

function CandidateTable({ rows, empty }: { rows: MultibaggerCandidate[]; empty: string }) {
  return (
    <div>
      {rows.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-[#0b1626] p-6 text-center text-xs text-slate-400">{empty}</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-[#0b1626]">
          <table className="min-w-[1080px] w-full text-left text-xs">
            <thead className="border-b border-slate-800 bg-[#08111e] text-[10px] uppercase tracking-wide text-slate-400">
              <tr>{["Stock", "Multibagger Score", "Institutional Interest", "Expert Consensus", "Fundamental Strength", "Growth Potential", "Risk Level", "Suggested Horizon", "Action"].map((header) => <th key={header} className="px-3 py-3">{header}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {rows.map((row, index) => (
                <tr key={row.id} className="align-top hover:bg-slate-800/20">
                  <td className="px-3 py-3"><div className="font-bold text-white"><span className="mr-2 text-slate-500">#{index + 1}</span>{row.symbol}</div><div className="mt-0.5 max-w-44 text-[10px] text-slate-500">{row.name}</div></td>
                  <td className="px-3 py-3 font-bold text-cyan-300">{row.triage.score}/100</td>
                  <td className="px-3 py-3"><SignalValue label={row.triage.institutionalInterest} score={row.triage.components.institutionalSmartMoney} /></td>
                  <td className="px-3 py-3"><SignalValue label={row.triage.expertConsensus} score={row.triage.components.expertConsensus} /></td>
                  <td className="px-3 py-3"><SignalValue label={row.triage.fundamentalStrength} score={row.triage.components.fundamentals} /></td>
                  <td className="px-3 py-3"><SignalValue label={row.triage.growthPotential} score={row.triage.components.growthMomentum} /></td>
                  <td className="px-3 py-3"><span className={riskClass(row.triage.riskLevel)}>{row.triage.riskLevel}</span></td>
                  <td className="px-3 py-3 text-slate-300">{row.triage.suggestedHorizon}</td>
                  <td className="px-3 py-3"><span className={actionClass(row.action)}>{row.action}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SignalValue({ label, score }: { label: string; score: number }) {
  return <div><div className="font-semibold text-slate-200">{label}</div><div className="mt-0.5 text-[10px] text-slate-500">{score}/100</div></div>;
}
function riskClass(risk: MultibaggerCandidate["risk"]) { return `rounded px-2 py-1 text-[10px] font-bold ${risk === "Low" ? "bg-emerald-500/10 text-emerald-300" : risk === "Medium" ? "bg-amber-500/10 text-amber-300" : "bg-rose-500/10 text-rose-300"}`; }
function actionClass(action: MultibaggerCandidate["action"]) { return `rounded px-2 py-1 text-[10px] font-bold ${action === "BUY" ? "bg-emerald-500/10 text-emerald-300" : action === "WATCH" ? "bg-cyan-500/10 text-cyan-300" : "bg-rose-500/10 text-rose-300"}`; }
