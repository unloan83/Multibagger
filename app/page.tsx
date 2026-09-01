"use client";

import { useEffect, useState } from "react";
import BreezeMultibaggerTab from "@/features/breeze/components/BreezeMultibaggerTab";
import OptionsQuantTab from "@/features/options-quant/components/OptionsQuantTab";
import UpstoxRecommendationsTab from "@/features/upstox/components/UpstoxRecommendationsTab";
import StrategyLabTab from "@/features/strategy-lab/components/StrategyLabTab";

type Market = "india" | "us";
type IndiaModel = "breeze-multibagger" | "upstox-intraday" | "strategy-lab" | "options-quant";

const modelLogic: Record<IndiaModel, { title: string; flow: string; purpose: string }> = {
  "breeze-multibagger": {
    title: "Breeze Multibagger",
    flow: "Eligible securities below ₹1,000 → fundamental quality → growth and sector → expert plus institutional triage → deep validation → BUY / WATCH / REJECT",
    purpose: "Long-horizon prioritisation. Expert recommendations corroborate evidence but never trigger BUY by themselves.",
  },
  "upstox-intraday": {
    title: "Upstox Intraday",
    flow: "Real broker feed → NIFTY 500 universe → ORB / VWAP setup → freshness, liquidity and spread gates → ATR sizing → automatic paper fill → stop / target / daily lock → measured outcomes",
    purpose: "Automatic simulated execution from executable quotes, with a ₹3,000 daily target that locks new entries rather than forcing quota trades.",
  },
  "strategy-lab": {
    title: "Strategy Lab & Interactive Approval Gate",
    flow: "Continuous scanning → parameter set evaluation → in-house stability ranking → interactive Telegram proposal → explicit user approval → live execution → automated exit gates",
    purpose: "Interactive human-in-the-loop strategy selection with OCI state persistence over secure tunnel proxy.",
  },
  "options-quant": {
    title: "Options Quant",
    flow: "Market regime → breadth and sector → institutional plus expert direction → Upstox NIFTY chain → OI, IV, Greeks and liquidity → defined-risk debit spread → SHADOW / NO TRADE",
    purpose: "Bull Call or Bear Put spreads only. Upstox sandbox validates order payloads; real-money execution remains unavailable.",
  },
};

export default function HomePage() {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [market, setMarket] = useState<Market>("india");
  const [activeModel, setActiveModel] = useState<IndiaModel>("strategy-lab");

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (requested === "breeze-multibagger" || requested === "upstox-intraday" || requested === "strategy-lab" || requested === "options-quant") {
      setActiveModel(requested as IndiaModel);
    }
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
          <div><h1 className="text-xl font-bold tracking-tight text-white">Trading Model Portal</h1><p className="mt-1 text-xs text-slate-400">Enter PIN (1083) to view model evidence.</p></div>
          <form onSubmit={unlock} className="space-y-3">
            <input type="password" maxLength={6} value={pinInput} onChange={(event) => setPinInput(event.target.value)} placeholder="Enter PIN" autoFocus className="w-full rounded-xl border border-slate-800 bg-[#040810] px-4 py-3 text-center font-mono text-lg tracking-widest text-white focus:border-cyan-500 focus:outline-none" />
            {pinError ? <p className="text-xs font-medium text-rose-400">{pinError}</p> : null}
            <button type="submit" className="w-full rounded-xl bg-cyan-500 py-3 text-xs font-bold text-slate-950 shadow-lg shadow-cyan-500/20 transition hover:bg-cyan-400">Unlock Models</button>
          </form>
        </div>
      </main>
    );
  }

  const logic = modelLogic[activeModel];
  return (
    <main className="min-h-screen bg-[#060d17] px-3 py-5 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <header className="rounded-2xl border border-slate-800 bg-[#091322] p-5 shadow-xl">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div>
              <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-bold tracking-tight text-white">Production Trading Models</h1><span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-300">LIVE OCI ENGINE GATE</span></div>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">Real data → signal → live/shadow validation → small real-money test → performance measurement → scale or kill. NO TRADE is preferred whenever evidence is incomplete.</p>
            </div>
            <div className="flex rounded-xl border border-slate-800 bg-[#050c16] p-1"><MarketButton active={market === "india"} onClick={() => setMarket("india")}>India</MarketButton><MarketButton active={market === "us"} onClick={() => setMarket("us")}>US</MarketButton></div>
          </div>
        </header>

        {market === "india" ? (
          <>
            <nav className="flex max-w-full gap-2 overflow-x-auto rounded-xl border border-slate-800 bg-[#0d1b2e] p-1.5" aria-label="Indian trading models">
              <ModelButton active={activeModel === "strategy-lab"} onClick={() => setActiveModel("strategy-lab")} title="Strategy Lab" detail="Live Interactive Engine" />
              <ModelButton active={activeModel === "breeze-multibagger"} onClick={() => setActiveModel("breeze-multibagger")} title="Breeze Multibagger" detail="6–24+ months" />
              <ModelButton active={activeModel === "upstox-intraday"} onClick={() => setActiveModel("upstox-intraday")} title="Upstox Intraday" detail="Broker-feed paper" />
              <ModelButton active={activeModel === "options-quant"} onClick={() => setActiveModel("options-quant")} title="Options Quant" detail="NIFTY spreads" />
            </nav>
            <section className="rounded-xl border border-slate-800 bg-[#0b1626] p-4"><h2 className="text-sm font-bold text-white">{logic.title} recommendation logic</h2><p className="mt-2 text-xs leading-relaxed text-cyan-200">{logic.flow}</p><p className="mt-2 text-xs leading-relaxed text-slate-400">{logic.purpose}</p></section>
            {activeModel === "strategy-lab" ? <StrategyLabTab /> : null}
            {activeModel === "breeze-multibagger" ? <BreezeMultibaggerTab /> : null}
            {activeModel === "upstox-intraday" ? <UpstoxRecommendationsTab /> : null}
            {activeModel === "options-quant" ? <OptionsQuantTab /> : null}
          </>
        ) : (
          <section className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-8 text-center"><div className="text-sm font-bold text-amber-200">US MODELS — NO TRADE</div><p className="mx-auto mt-2 max-w-2xl text-xs leading-relaxed text-slate-400">Term recommendations, candle calls, and watchlists have been removed. No US model is published until reliable broker data, an executable order path, live shadow validation, cost-adjusted performance, and portfolio risk controls are available.</p></section>
        )}
        <ModelGlossary />
      </div>
    </main>
  );
}

function MarketButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={`rounded-lg px-4 py-2 text-xs font-bold transition ${active ? "bg-cyan-500 text-slate-950" : "text-slate-400 hover:text-white"}`}>{children}</button>;
}

function ModelButton({ active, onClick, title, detail }: { active: boolean; onClick: () => void; title: string; detail: string }) {
  return <button type="button" onClick={onClick} className={`flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition ${active ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20" : "text-slate-400 hover:text-slate-200"}`}><span>{title}</span><span className="text-[10px] font-normal opacity-70">({detail})</span></button>;
}

function ModelGlossary() {
  const items = [
    ["NO TRADE", "Mandatory outcome when data is stale, confidence is insufficient, liquidity is weak, risk exceeds limits, or no validated edge exists."],
    ["Multibagger Score", "Breeze prioritisation score combining fundamentals, growth, institutional interest, sector theme, expert consensus, valuation and catalysts. It is not a probability."],
    ["Broker-feed Rank", "Deterministic relative rank for a qualifying live paper signal. It does not override freshness, spread, liquidity, ATR, or publication gates."],
    ["Defined-risk Spread", "Options position whose maximum loss is known before entry. Only Bull Call and Bear Put debit spreads are permitted."],
    ["Net P&L", "Gross trading result minus brokerage, taxes, exchange charges, fees and slippage."],
    ["Profit Factor", "Gross profit divided by gross loss. It is meaningful only with a sufficient sample and complete costs."],
    ["Expectancy", "Average net amount earned or lost per trade across the evaluation sample."],
    ["Maximum Drawdown", "Largest peak-to-trough decline in measured strategy equity."],
    ["Capital Utilisation", "Maximum strategy capital or defined risk divided by configured portfolio capital."],
    ["GO / CONTINUE / STOP / SCALE", "Lifecycle decision based on sample size, net expectancy, profit factor, drawdown and execution evidence. Sandbox performance never qualifies as real-money evidence."],
  ];
  return <details className="group rounded-xl border border-slate-800 bg-[#0b1626]"><summary className="flex cursor-pointer list-none items-center justify-between px-4 py-4 text-sm font-bold text-white [&::-webkit-details-marker]:hidden"><span>Recommendation Logic &amp; Performance Glossary</span><span className="text-xs text-cyan-300 transition-transform group-open:rotate-180">▼</span></summary><div className="grid gap-px border-t border-slate-800 bg-slate-800 md:grid-cols-2 xl:grid-cols-3">{items.map(([term, description]) => <div key={term} className="bg-[#07111f] p-4"><div className="text-xs font-bold text-white">{term}</div><p className="mt-1 text-[11px] leading-relaxed text-slate-400">{description}</p></div>)}</div></details>;
}
