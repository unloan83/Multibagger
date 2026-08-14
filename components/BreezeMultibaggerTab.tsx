"use client";

import { useEffect, useState } from "react";
import type { BreezeMultibaggerSnapshot, MultibaggerCandidate } from "@/lib/breeze-multibagger";

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
            <p className="mt-1 text-xs text-slate-400">6–24+ month investment discovery • NSE/BSE equities, ETFs and IPOs • CMP/issue price up to ₹1,000</p>
          </div>
          <span className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-300">RESEARCH ONLY</span>
        </div>
        <p className="mt-3 text-[11px] text-slate-500">Updated {new Date(snapshot.asOf).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST • {snapshot.universe.registered.toLocaleString("en-IN")} NSE/BSE securities registered • {snapshot.historyCount.toLocaleString("en-IN")} recommendations permanently tracked • no automatic trade placement</p>
      </div>

      <CandidateSection title="Top Multibagger Candidates" rows={snapshot.topCandidates} empty="No equity currently meets the display criteria." />
      <CandidateSection title="Upcoming IPO Opportunities" rows={snapshot.upcomingIpos} empty="No upcoming or newly listed IPO has enough verified official information to publish yet." />
      <CandidateSection title="ETF Opportunities" rows={snapshot.etfOpportunities} empty="ETF market data is awaiting the next scheduled refresh." />
    </section>
  );
}

function CandidateSection({ title, rows, empty }: { title: string; rows: MultibaggerCandidate[]; empty: string }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-bold text-white">{title}</h3>
      {rows.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-[#0b1626] p-6 text-center text-xs text-slate-400">{empty}</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-[#0b1626]">
          <table className="min-w-[1050px] w-full text-left text-xs">
            <thead className="border-b border-slate-800 bg-[#08111e] text-[10px] uppercase tracking-wide text-slate-400">
              <tr>{["Rank", "Stock/IPO/ETF", "CMP/Issue Price", "Multibagger Score", "Growth Potential", "Horizon", "Risk", "Key Reason", "Action"].map((header) => <th key={header} className="px-3 py-3">{header}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {rows.map((row, index) => (
                <tr key={row.id} className="align-top hover:bg-slate-800/20">
                  <td className="px-3 py-3 font-bold text-slate-300">{index + 1}</td>
                  <td className="px-3 py-3"><div className="font-bold text-white">{row.symbol}</div><div className="mt-0.5 max-w-48 text-[10px] text-slate-500">{row.name} • {labelKind(row.kind)}</div></td>
                  <td className="px-3 py-3 font-semibold text-white">₹{row.price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</td>
                  <td className="px-3 py-3"><span className="font-bold text-cyan-300">{row.score}/100</span><div className="mt-0.5 text-[10px] text-slate-500">{row.classification}</div></td>
                  <td className="px-3 py-3 text-slate-300">{row.growthPotential}</td>
                  <td className="px-3 py-3 text-slate-300">{row.horizon}</td>
                  <td className="px-3 py-3"><span className={riskClass(row.risk)}>{row.risk}</span></td>
                  <td className="max-w-sm px-3 py-3 leading-relaxed text-slate-300">{row.keyReason}</td>
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

function labelKind(kind: MultibaggerCandidate["kind"]) { return kind === "UPCOMING_IPO" ? "Upcoming IPO" : kind === "NEW_IPO" ? "New IPO" : kind; }
function riskClass(risk: MultibaggerCandidate["risk"]) { return `rounded px-2 py-1 text-[10px] font-bold ${risk === "Low" ? "bg-emerald-500/10 text-emerald-300" : risk === "Medium" ? "bg-amber-500/10 text-amber-300" : "bg-rose-500/10 text-rose-300"}`; }
function actionClass(action: MultibaggerCandidate["action"]) { return `rounded px-2 py-1 text-[10px] font-bold ${action === "ACCUMULATE" ? "bg-emerald-500/10 text-emerald-300" : action === "WATCH" ? "bg-cyan-500/10 text-cyan-300" : action === "WAIT" ? "bg-amber-500/10 text-amber-300" : "bg-rose-500/10 text-rose-300"}`; }
