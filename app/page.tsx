"use client";

import { useEffect, useState } from "react";

type StockPick = {
  symbol: string;
  name: string;
  price: number;
  previousClose: number;
  changePercent: number;
  target: number;
  upside: number;
  score: number;
  action: string;
  remark: string;
  theme: string;
  sector: string;
  marketCapCategory?: string;
};

type Category = {
  key: string;
  title: string;
  longTermUpsides: StockPick[];
  intradayBreakouts: StockPick[];
};

type Snapshot = {
  asOf: string;
  marketRegime: string;
  categories: Category[];
};

export default function HomePage() {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"all" | "longTerm" | "intraday">("all");

  useEffect(() => {
    // Check if previously unlocked in session
    if (typeof window !== "undefined") {
      const storedPin = sessionStorage.getItem("stock_planner_pin");
      if (storedPin === "1083") {
        setIsUnlocked(true);
      }
    }
  }, []);

  useEffect(() => {
    if (!isUnlocked) return;

    fetch("/api/snapshots/wealth")
      .then(async (res) => {
        if (!res.ok) {
          const localRes = await fetch("/data/wealth_recommendations.json").catch(() => null);
          if (localRes?.ok) return localRes.json();
          throw new Error("Could not load recommendations.");
        }
        return res.json();
      })
      .then((data) => {
        setSnapshot(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });

    fetch("/data/wealth_recommendations.json")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setSnapshot((prev) => prev ?? data);
          setLoading(false);
        }
      })
      .catch(() => {});
  }, [isUnlocked]);

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pinInput.trim() === "1083") {
      setIsUnlocked(true);
      setPinError("");
      if (typeof window !== "undefined") {
        sessionStorage.setItem("stock_planner_pin", "1083");
      }
    } else {
      setPinError("Incorrect PIN. Please enter 1083 to unlock Stock Planner.");
    }
  };

  // Lock screen if PIN is not entered
  if (!isUnlocked) {
    return (
      <main className="min-h-screen bg-[#060d17] text-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-[#091322] p-6 text-center space-y-5 shadow-2xl">
          <div className="h-12 w-12 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center mx-auto text-xl font-bold">
            🔒
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">Stock Planner</h1>
            <p className="text-xs text-slate-400 mt-1">Enter PIN (1083) to access recommendations.</p>
          </div>
          <form onSubmit={handlePinSubmit} className="space-y-3">
            <input
              type="password"
              maxLength={6}
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              placeholder="Enter PIN"
              autoFocus
              className="w-full bg-[#040810] border border-slate-800 rounded-xl px-4 py-3 text-center text-lg tracking-widest text-white focus:outline-none focus:border-cyan-500 font-mono"
            />
            {pinError && <p className="text-xs text-rose-400 font-medium">{pinError}</p>}
            <button
              type="submit"
              className="w-full py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold transition-all shadow-lg shadow-cyan-500/20"
            >
              Unlock Dashboard
            </button>
          </form>
        </div>
      </main>
    );
  }

  // Extract all long-term and intraday picks into flat lists
  const longTermPicks: StockPick[] = [];
  const intradayPicks: StockPick[] = [];

  if (snapshot?.categories) {
    for (const cat of snapshot.categories) {
      const capLabel = cat.key === "largeCap" ? "Large Cap" : cat.key === "midCap" ? "Mid Cap" : "Small Cap";
      for (const item of cat.longTermUpsides || []) {
        longTermPicks.push({ ...item, marketCapCategory: capLabel });
      }
      for (const item of cat.intradayBreakouts || []) {
        intradayPicks.push({ ...item, marketCapCategory: capLabel });
      }
    }
  }

  const formattedDate = snapshot?.asOf
    ? new Date(snapshot.asOf).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Kolkata",
      }) + " IST"
    : "Today";

  return (
    <main className="min-h-screen bg-[#060d17] text-slate-100 font-sans pb-12">
      {/* Header */}
      <header className="border-b border-slate-800/80 bg-[#091322]/90 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center font-bold text-white shadow-lg shadow-cyan-500/20">
              M
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                Multibagger
                <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-[11px] font-semibold text-cyan-400 border border-cyan-500/20">
                  Daily Picks
                </span>
              </h1>
            </div>
          </div>

          <div className="text-right text-xs text-slate-400">
            <div className="font-medium text-slate-300">Updated {formattedDate}</div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 space-y-8">
        {/* Navigation Tabs */}
        <div className="flex items-center justify-between border-b border-slate-800/60 pb-4">
          <div className="flex items-center gap-2 bg-[#0d1b2e] p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setActiveTab("all")}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === "all"
                  ? "bg-cyan-500 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              All Recommendations ({longTermPicks.length + intradayPicks.length})
            </button>
            <button
              onClick={() => setActiveTab("longTerm")}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === "longTerm"
                  ? "bg-emerald-500 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Long-Term ({longTermPicks.length})
            </button>
            <button
              onClick={() => setActiveTab("intraday")}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === "intraday"
                  ? "bg-amber-500 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Intraday ({intradayPicks.length})
            </button>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
            <span className="ml-3 text-sm text-slate-400">Fetching daily stock recommendations…</span>
          </div>
        )}

        {!loading && longTermPicks.length === 0 && intradayPicks.length === 0 && (
          <div className="rounded-2xl border border-slate-800 bg-[#0b1626] p-8 text-center text-slate-400">
            <p className="text-base font-semibold text-slate-200">No active daily picks found.</p>
            <p className="mt-1 text-xs text-slate-400">
              Run <code className="rounded bg-slate-800 px-2 py-0.5 text-cyan-300">npm run wealth:snapshot</code> to generate daily picks.
            </p>
          </div>
        )}

        {/* Section 1: Long-Term Recommendations */}
        {(activeTab === "all" || activeTab === "longTerm") && longTermPicks.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
                Long-Term Recommendations
              </h2>
              <span className="text-xs text-slate-400 font-medium">Accumulation Targets</span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {longTermPicks.map((stock) => (
                <SimpleStockCard key={`lt-${stock.symbol}`} stock={stock} type="longTerm" />
              ))}
            </div>
          </section>
        )}

        {/* Section 2: Intraday Breakouts */}
        {(activeTab === "all" || activeTab === "intraday") && intradayPicks.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400 animate-pulse" />
                Intraday Breakout Picks
              </h2>
              <span className="text-xs text-slate-400 font-medium">Same-Day Momentum</span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {intradayPicks.map((stock) => (
                <SimpleStockCard key={`id-${stock.symbol}`} stock={stock} type="intraday" />
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function SimpleStockCard({
  stock,
  type,
}: {
  stock: StockPick;
  type: "longTerm" | "intraday";
}) {
  const isPositive = stock.changePercent >= 0;
  const isLongTerm = type === "longTerm";

  return (
    <div className="group rounded-xl border border-slate-800/90 bg-[#0b1626] p-4 transition-all duration-200 hover:border-slate-700 hover:bg-[#0e1c30]">
      {/* Header Row */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base font-bold tracking-tight text-white group-hover:text-cyan-300 transition">
              {stock.symbol}
            </span>
            {stock.marketCapCategory && (
              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                {stock.marketCapCategory}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-400 max-w-[200px]">{stock.name}</p>
        </div>

        <span
          className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-bold tracking-wide uppercase ${
            isLongTerm
              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
              : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
          }`}
        >
          {stock.action === "Accumulate" ? "BUY" : stock.action}
        </span>
      </div>

      {/* Metrics Row */}
      <div className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-[#070e1a] p-2.5 text-xs">
        <div>
          <span className="text-[10px] text-slate-400 block uppercase font-medium">CMP</span>
          <span className="font-bold text-white">
            ₹{stock.price ? stock.price.toLocaleString("en-IN", { maximumFractionDigits: 1 }) : "—"}
          </span>
        </div>

        <div>
          <span className="text-[10px] text-slate-400 block uppercase font-medium">Target</span>
          <span className="font-bold text-cyan-300">
            ₹{stock.target ? stock.target.toLocaleString("en-IN", { maximumFractionDigits: 1 }) : "—"}
          </span>
        </div>

        <div>
          <span className="text-[10px] text-slate-400 block uppercase font-medium">Change</span>
          <span className={`font-bold ${isPositive ? "text-emerald-400" : "text-rose-400"}`}>
            {isPositive ? "+" : ""}
            {stock.changePercent ? stock.changePercent.toFixed(1) : "0.0"}%
          </span>
        </div>
      </div>

      {/* Footer Info */}
      <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
        <div>
          Sector: <span className="text-slate-300 font-medium">{stock.sector || stock.theme || "General"}</span>
        </div>
        <div>
          Upside: <span className="font-bold text-cyan-400">+{stock.upside ? stock.upside.toFixed(1) : "0"}%</span>
        </div>
      </div>
    </div>
  );
}
