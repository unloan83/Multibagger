"use client";

import { useEffect, useState } from "react";
import DualEngineTab from "@/features/dual-engine/components/DualEngineTab";

export default function DualEnginePage() {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");

  useEffect(() => {
    setIsUnlocked(sessionStorage.getItem("stock_planner_pin") === "1083");
  }, []);

  function unlock(event: React.FormEvent) {
    event.preventDefault();
    if (pinInput.trim() !== "1083") {
      setPinError("Incorrect PIN. Please enter 1083.");
      return;
    }
    sessionStorage.setItem("stock_planner_pin", "1083");
    setPinError("");
    setIsUnlocked(true);
  }

  if (!isUnlocked) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#060d17] p-4 text-slate-100">
        <div className="w-full max-w-sm space-y-5 rounded-2xl border border-slate-800 bg-[#091322] p-6 text-center shadow-2xl">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-cyan-500/20 bg-cyan-500/10 text-xl text-cyan-400">🔒</div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">Dual-Engine Strategy Portal</h1>
            <p className="mt-1 text-xs text-slate-400">Enter PIN (1083) to view model metrics and output.</p>
          </div>
          <form onSubmit={unlock} className="space-y-3">
            <input
              type="password"
              maxLength={6}
              value={pinInput}
              onChange={(event) => setPinInput(event.target.value)}
              placeholder="Enter PIN"
              autoFocus
              className="w-full rounded-xl border border-slate-800 bg-[#040810] px-4 py-3 text-center font-mono text-lg tracking-widest text-white focus:border-cyan-500 focus:outline-none"
            />
            {pinError ? <p className="text-xs font-medium text-rose-400">{pinError}</p> : null}
            <button type="submit" className="w-full rounded-xl bg-cyan-500 py-3 text-xs font-bold text-slate-950 shadow-lg shadow-cyan-500/20 transition hover:bg-cyan-400">
              Unlock Model
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#060d17] px-3 py-5 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <header className="rounded-2xl border border-slate-800 bg-[#091322] p-5 shadow-xl">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-white">Dual-Engine Strategy Model</h1>
                <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-300">LIVE AGENT GATE</span>
              </div>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
                Price velocity target &amp; ATR range threshold screening model → automated signal dispatch &amp; real-time execution outputs.
              </p>
            </div>
            <a
              href="/?tab=dual-engine"
              className="rounded-xl border border-slate-800 bg-[#050c16] px-4 py-2 text-xs font-bold text-cyan-400 hover:text-cyan-300 transition"
            >
              ← Back to Main Portal
            </a>
          </div>
        </header>

        <DualEngineTab />
      </div>
    </main>
  );
}
