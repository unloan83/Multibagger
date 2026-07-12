"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { IpoAnalysis } from "@/lib/agents/ipoAgent";

type IpoResponse = {
  generatedAt: string;
  warning?: string;
  disclaimer: string;
  recommendations: IpoAnalysis[];
};

export default function IpoIntelligencePage() {
  const [report, setReport] = useState<IpoResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/ipos")
      .then(async (response) => {
        if (!response.ok) throw new Error("IPO intelligence is temporarily unavailable.");
        return response.json() as Promise<IpoResponse>;
      })
      .then(setReport)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load IPOs."));
  }, []);

  return (
    <main className="min-h-screen bg-[#08121f] px-4 py-8 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="space-y-2">
          <Link href="/" className="text-sm text-cyan-300 hover:text-cyan-200">← Portfolio dashboard</Link>
          <h1 className="text-3xl font-semibold">Upcoming IPO Intelligence</h1>
          <p className="max-w-3xl text-sm leading-6 text-slate-400">
            Fundamentals-first IPO screening with subscription demand, valuation, issue structure and a capped unofficial GMP trend signal.
          </p>
        </header>

        {report?.warning ? <Notice>{report.warning}</Notice> : null}
        {error ? <Notice>{error}</Notice> : null}

        <details open className="group rounded-2xl border border-white/10 bg-[#0f1b2d]">
          <summary className="cursor-pointer list-none px-5 py-4 font-semibold text-white">
            <span className="inline-flex w-full items-center justify-between">
              IPO recommendations ({report?.recommendations.length ?? 0})
              <span className="text-cyan-300 transition-transform group-open:rotate-180">⌄</span>
            </span>
          </summary>
          <div className="overflow-x-auto border-t border-white/10">
          <table className="min-w-[1100px] w-full text-left text-sm">
            <thead className="bg-white/[0.04] text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-3">IPO</th><th className="px-4 py-3">Dates</th>
                <th className="px-4 py-3">Price / Lot</th><th className="px-4 py-3">Recommendation</th>
                <th className="px-4 py-3">Score</th><th className="px-4 py-3">Subscription</th>
                <th className="px-4 py-3">GMP indication</th><th className="px-4 py-3">GMP trend</th>
                <th className="px-4 py-3">Key concern</th>
              </tr>
            </thead>
            <tbody>
              {report?.recommendations.map((ipo) => (
                <tr key={ipo.id} className="border-t border-white/10 align-top">
                  <td className="px-4 py-4"><div className="font-semibold text-white">{ipo.company}</div><div className="mt-1 text-xs text-slate-400">{ipo.exchange} · {ipo.status}</div></td>
                  <td className="px-4 py-4 text-slate-300">{formatDate(ipo.openDate)}<br />to {formatDate(ipo.closeDate)}</td>
                  <td className="px-4 py-4 text-slate-300">₹{ipo.priceBandLow}–₹{ipo.priceBandHigh}<br /><span className="text-xs text-slate-500">Lot {ipo.lotSize}</span></td>
                  <td className={`px-4 py-4 font-semibold ${recommendationTone(ipo.recommendation)}`}>{ipo.recommendation}<div className="mt-1 text-xs font-normal text-slate-500">{ipo.confidence}% confidence</div></td>
                  <td className="px-4 py-4 font-semibold">{ipo.score}/100</td>
                  <td className="px-4 py-4">{ipo.subscription?.total == null ? "Pending" : `${ipo.subscription.total.toFixed(2)}×`}<div className="mt-1 text-xs text-slate-500">QIB {ipo.subscription?.qib?.toFixed(2) ?? "–"}×</div></td>
                  <td className="px-4 py-4">{ipo.gmp.latest == null ? "Unavailable" : `₹${ipo.gmp.latest.toFixed(0)} (${ipo.gmp.indicationPercent?.toFixed(1)}%)`}<div className="mt-1 text-xs text-slate-500">Est. ₹{ipo.gmp.estimatedListingPrice?.toFixed(0) ?? "–"}</div></td>
                  <td className="px-4 py-4 capitalize">{ipo.gmp.trend}</td>
                  <td className="max-w-xs px-4 py-4 text-xs leading-5 text-slate-400">{ipo.concerns[0] ?? "No material supplied risk flag."}</td>
                </tr>
              ))}
              {report && report.recommendations.length === 0 ? <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">No upcoming IPO records are available from the configured feed.</td></tr> : null}
            </tbody>
          </table>
          </div>
        </details>

        <details className="group rounded-2xl border border-white/10 bg-[#0f1b2d]">
          <summary className="cursor-pointer list-none px-5 py-4 font-semibold text-white">
            <span className="inline-flex w-full items-center justify-between">
              How the IPO agent decides
              <span className="text-cyan-300 transition-transform group-open:rotate-180">⌄</span>
            </span>
          </summary>
          <div className="space-y-2 border-t border-white/10 px-5 py-4 text-sm leading-6 text-slate-400">
            <p>Fundamentals 30% · valuation 20% · subscription demand 20% · issue structure 10% · GMP 10% · disclosed-risk quality 10%.</p>
            <p>A BUY needs fresh data, a score of at least 70, adequate fundamentals and reasonable valuation. Serious governance or audit risks force AVOID.</p>
          </div>
        </details>
        <p className="text-xs leading-5 text-slate-500">{report?.disclaimer ?? "Loading IPO intelligence…"}</p>
      </div>
    </main>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-amber-300/25 bg-amber-300/10 p-4 text-sm text-amber-100">{children}</div>;
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : value;
}

function recommendationTone(value: IpoAnalysis["recommendation"]) {
  return value === "BUY" ? "text-emerald-300" : value === "AVOID" ? "text-rose-300" : "text-amber-300";
}
