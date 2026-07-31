"use client";

import { useEffect, useState } from "react";
import type { TermRecommendation, TermDuration } from "@/lib/term-agent-analysis";

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
  isMultibagger?: boolean;
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

type WatchlistRecommendation = {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  intradayAction: string;
  intradayTarget: number;
  intradayUpside: number;
  longTermAction: string;
  longTermTarget: number;
  longTermUpside: number;
  isMultibagger: boolean;
  notes: string;
};

type HistoryRecord = {
  date: string;
  stockName: string;
  symbol: string;
  termType: string;
  cmp: number;
  target: number;
  hitOrMiss: "HIT" | "MISS" | "IN PROGRESS";
  hitTimeDetails: string;
};

export default function HomePage() {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"term" | "intraday" | "watchlist" | "history">("term");

  // Term Recommendations State (20 total stocks, 5 per duration)
  const [termPicks, setTermPicks] = useState<TermRecommendation[]>([]);
  const [termFilter, setTermFilter] = useState<TermDuration | "all">("all");
  const [loadingTerm, setLoadingTerm] = useState(false);

  // Watchlist State
  const [watchlistItems, setWatchlistItems] = useState<WatchlistRecommendation[]>([]);
  const [newSymbolInput, setNewSymbolInput] = useState("");
  const [loadingWatchlist, setLoadingWatchlist] = useState(false);
  const [watchlistMsg, setWatchlistMsg] = useState("");

  // History State
  const [historyRecords, setHistoryRecords] = useState<HistoryRecord[]>([]);
  const [historyMonths, setHistoryMonths] = useState<Array<{ value: string; label: string }>>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>("all");
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const storedPin = sessionStorage.getItem("stock_planner_pin");
      if (storedPin === "1083") {
        setIsUnlocked(true);
      }
    }
  }, []);

  // Fetch Term Recommendations (Agent Analysis)
  const fetchTermPicks = () => {
    setLoadingTerm(true);
    fetch("/api/term-recommendations")
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && Array.isArray(data.picks)) {
          setTermPicks(data.picks);
        }
        setLoadingTerm(false);
      })
      .catch(() => setLoadingTerm(false));
  };

  // Fetch Recommendations Snapshot
  useEffect(() => {
    if (!isUnlocked) return;

    fetchTermPicks();

    fetch("/api/recommendations")
      .then(async (res) => {
        if (!res.ok) {
          throw new Error("Could not load recommendations.");
        }
        return res.json();
      })
      .then((data) => {
        setSnapshot(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Failed to load recommendations.");
        setLoading(false);
      });
  }, [isUnlocked]);

  // Fetch Watchlist Data when Watchlist Tab is selected
  const fetchWatchlist = () => {
    setLoadingWatchlist(true);
    fetch("/api/watchlist")
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && Array.isArray(data.holdings)) {
          setWatchlistItems(data.holdings);
        }
        setLoadingWatchlist(false);
      })
      .catch(() => setLoadingWatchlist(false));
  };

  useEffect(() => {
    if (isUnlocked && activeTab === "watchlist") {
      fetchWatchlist();
    }
  }, [isUnlocked, activeTab]);

  // Fetch History Data when History Tab is selected or month changes
  const fetchHistory = (month: string) => {
    setLoadingHistory(true);
    fetch(`/api/history?month=${encodeURIComponent(month)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          setHistoryRecords(data.records || []);
          if (data.months && data.months.length > 0) {
            setHistoryMonths(data.months);
          }
        }
        setLoadingHistory(false);
      })
      .catch(() => setLoadingHistory(false));
  };

  useEffect(() => {
    if (isUnlocked && activeTab === "history") {
      fetchHistory(selectedMonth);
    }
  }, [isUnlocked, activeTab, selectedMonth]);

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

  const handleAddWatchlist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSymbolInput.trim()) return;

    setLoadingWatchlist(true);
    setWatchlistMsg("");
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: newSymbolInput.trim() }),
      });
      const data = await res.json();
      if (data.ok && Array.isArray(data.holdings)) {
        setWatchlistItems(data.holdings);
        setNewSymbolInput("");
        setWatchlistMsg(`Added ${newSymbolInput.toUpperCase()} to Watchlist.`);
      } else {
        setWatchlistMsg(data.error || "Failed to add symbol.");
      }
    } catch (err: unknown) {
      setWatchlistMsg(err instanceof Error ? err.message : "Failed to add symbol.");
    } finally {
      setLoadingWatchlist(false);
    }
  };

  const handleRemoveWatchlist = async (symbol: string) => {
    setLoadingWatchlist(true);
    try {
      const res = await fetch("/api/watchlist", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      const data = await res.json();
      if (data.ok && Array.isArray(data.holdings)) {
        setWatchlistItems(data.holdings);
      }
    } catch {
      // handle error
    } finally {
      setLoadingWatchlist(false);
    }
  };

  const handleDownloadCsv = () => {
    window.open(`/api/history?month=${encodeURIComponent(selectedMonth)}&download=true`, "_blank");
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
            <h1 className="text-xl font-bold text-white tracking-tight">Multibagger Stock Planner</h1>
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

  // Extract intraday picks from snapshot
  const intradayPicks: StockPick[] = [];
  if (snapshot?.categories) {
    for (const cat of snapshot.categories) {
      const capLabel = cat.key === "largeCap" ? "Large Cap" : cat.key === "midCap" ? "Mid Cap" : "Small Cap";
      for (const item of cat.intradayBreakouts || []) {
        const isMb = (item.upside && item.upside >= 100) || (item.target >= 2 * item.price && item.price > 0);
        intradayPicks.push({ ...item, marketCapCategory: capLabel, isMultibagger: isMb });
      }
    }
  }

  // Filter Term Picks by Selected Duration
  const filteredTermPicks = termFilter === "all"
    ? termPicks
    : termPicks.filter((p) => p.termDuration === termFilter);

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
      <header className="border-b border-slate-800/80 bg-[#091322]/90 backdrop-blur sticky top-0 z-20">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-cyan-500 via-blue-600 to-indigo-600 flex items-center justify-center font-bold text-white shadow-lg shadow-cyan-500/20">
              🚀
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                Multibagger
                <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-[11px] font-semibold text-cyan-400 border border-cyan-500/20">
                  Stock Intelligence Agent
                </span>
              </h1>
            </div>
          </div>

          <div className="text-right text-xs text-slate-400">
            <div className="font-medium text-slate-300">Updated {formattedDate}</div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 space-y-6">
        {/* Run Time & Strategy Confirmation Banner */}
        <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-r from-[#0a192f] via-[#091526] to-[#0d1e38] p-4 text-xs shadow-lg">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="space-y-1">
              <span className="font-bold text-cyan-300 flex items-center gap-1.5 text-sm">
                <span>🤖</span> End-of-Day Term Analysis Agent Schedule & Rules
              </span>
              <p className="text-slate-300 leading-relaxed">
                <strong className="text-indigo-400">Term Recommendations (20 Stocks):</strong> Evaluated daily by the Stock Analysis Agent post-market at <span className="text-white font-mono font-semibold">3:45 PM – 5:00 PM IST</span> (5 picks each for 1W, 1M, 3M, 6M).
              </p>
              <p className="text-slate-300 leading-relaxed">
                <strong className="text-amber-400">Intraday Breakout Picks:</strong> Calculated pre-market at <span className="text-white font-mono font-semibold">8:45 AM – 9:00 AM IST</span> (or <span className="text-white font-mono font-semibold">9:30 AM IST</span>) for morning momentum.
              </p>
            </div>
            <div className="shrink-0 bg-[#060e1a] border border-slate-800 rounded-xl p-2.5 text-slate-400 text-[11px] space-y-1">
              <div><strong className="text-cyan-400">Term Durations:</strong> 1 Week | 1 Month | 3 Months | 6 Months</div>
              <div><strong className="text-purple-400">Multibagger Rule:</strong> Flagged if Upside &ge; 100%</div>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
          <div className="flex items-center gap-2 bg-[#0d1b2e] p-1.5 rounded-xl border border-slate-800">
            <button
              onClick={() => setActiveTab("term")}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
                activeTab === "term"
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <span>🎯</span> Term Recommendations ({termPicks.length})
              <span className="text-[10px] opacity-75 font-normal">(1W, 1M, 3M, 6M)</span>
            </button>
            <button
              onClick={() => setActiveTab("intraday")}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
                activeTab === "intraday"
                  ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <span>⚡</span> Intraday ({intradayPicks.length})
              <span className="text-[10px] opacity-75 font-normal">(Same Day)</span>
            </button>
            <button
              onClick={() => setActiveTab("watchlist")}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
                activeTab === "watchlist"
                  ? "bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <span>⭐</span> Watchlist
            </button>
            <button
              onClick={() => setActiveTab("history")}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
                activeTab === "history"
                  ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/20"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <span>📜</span> History & CSV
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-800 bg-rose-950/40 p-3.5 text-xs text-rose-300 flex items-center justify-between">
            <span>⚠️ {error}</span>
            <button onClick={() => setError("")} className="text-slate-400 hover:text-white text-xs">Dismiss</button>
          </div>
        )}

        {/* TAB 1: Term Recommendations (20 stocks curated into 4 durations) */}
        {activeTab === "term" && (
          <section className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#0b1626] p-4 rounded-xl border border-slate-800">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-indigo-400 animate-pulse" />
                  Term Profit Recommendations (20 Curated Stocks)
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  End-of-Day Agent Analysis • 5 Stocks per duration bucket (1W, 1M, 3M, 6M)
                </p>
              </div>

              {/* Term Duration Sub-Filters */}
              <div className="flex items-center gap-1.5 bg-[#060e1a] p-1 rounded-lg border border-slate-800 text-xs font-semibold">
                <button
                  onClick={() => setTermFilter("all")}
                  className={`px-3 py-1 rounded transition ${
                    termFilter === "all" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  All (20)
                </button>
                <button
                  onClick={() => setTermFilter("1week")}
                  className={`px-3 py-1 rounded transition ${
                    termFilter === "1week" ? "bg-amber-500 text-slate-950" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  1 Week (5)
                </button>
                <button
                  onClick={() => setTermFilter("1month")}
                  className={`px-3 py-1 rounded transition ${
                    termFilter === "1month" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  1 Month (5)
                </button>
                <button
                  onClick={() => setTermFilter("3months")}
                  className={`px-3 py-1 rounded transition ${
                    termFilter === "3months" ? "bg-emerald-600 text-white" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  3 Months (5)
                </button>
                <button
                  onClick={() => setTermFilter("6months")}
                  className={`px-3 py-1 rounded transition ${
                    termFilter === "6months" ? "bg-purple-600 text-white" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  6 Months (5)
                </button>
              </div>
            </div>

            {loadingTerm ? (
              <div className="flex items-center justify-center py-16">
                <div className="h-7 w-7 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
                <span className="ml-3 text-xs text-slate-400">Agent evaluating term duration recommendations…</span>
              </div>
            ) : filteredTermPicks.length === 0 ? (
              <div className="rounded-xl border border-slate-800 bg-[#0b1626] p-8 text-center text-slate-400">
                No term recommendations found for selected duration filter.
              </div>
            ) : (
              <TermSingleRowTable picks={filteredTermPicks} />
            )}
          </section>
        )}

        {/* TAB 2: Intraday Breakouts */}
        {!loading && activeTab === "intraday" && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400 animate-pulse" />
                  Intraday Breakout Picks
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">Holding Period: 1 Day • Pre-market & Volume Shock Strategy</p>
              </div>
              <span className="text-xs text-slate-400 font-medium bg-[#091424] px-3 py-1 rounded-lg border border-slate-800">
                Total: <strong className="text-amber-400">{intradayPicks.length}</strong>
              </span>
            </div>

            {intradayPicks.length === 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-[#0b1626] p-8 text-center text-slate-400">
                No intraday breakout picks currently active.
              </div>
            ) : (
              <SimpleSingleRowTable picks={intradayPicks} type="intraday" />
            )}
          </section>
        )}

        {/* TAB 3: Watchlist */}
        {activeTab === "watchlist" && (
          <section className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#0b1626] p-4 rounded-xl border border-slate-800">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <span>⭐</span> My Stock Watchlist
                </h2>
                <p className="text-xs text-slate-400">Add stocks to track daily Intraday & 3–6 Month Term recommendations.</p>
              </div>

              {/* Add Stock Form */}
              <form onSubmit={handleAddWatchlist} className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Enter Ticker (e.g. TATAMOTORS, RELIANCE)"
                  value={newSymbolInput}
                  onChange={(e) => setNewSymbolInput(e.target.value)}
                  className="bg-[#040810] border border-slate-700 rounded-lg px-3 py-2 text-xs text-white uppercase focus:outline-none focus:border-cyan-500 font-mono w-64"
                />
                <button
                  type="submit"
                  disabled={loadingWatchlist}
                  className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 px-4 py-2 rounded-lg text-xs font-bold transition disabled:opacity-50 shrink-0"
                >
                  + Add Stock
                </button>
              </form>
            </div>

            {watchlistMsg && (
              <div className="text-xs text-cyan-300 bg-cyan-950/40 border border-cyan-800/50 px-3 py-1.5 rounded-lg">
                {watchlistMsg}
              </div>
            )}

            {loadingWatchlist ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
                <span className="ml-2 text-xs text-slate-400">Updating watchlist recommendations…</span>
              </div>
            ) : watchlistItems.length === 0 ? (
              <div className="rounded-xl border border-slate-800 bg-[#0b1626] p-8 text-center text-slate-400">
                Your watchlist is empty. Add a stock ticker symbol above to start tracking.
              </div>
            ) : (
              <WatchlistSingleRowTable holdings={watchlistItems} onRemove={handleRemoveWatchlist} />
            )}
          </section>
        )}

        {/* TAB 4: History & CSV Download */}
        {activeTab === "history" && (
          <section className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#0b1626] p-4 rounded-xl border border-slate-800">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <span>📜</span> Historical Recommendations Log
                </h2>
                <p className="text-xs text-slate-400">Daily recommendations captured month-wise with full CSV download option.</p>
              </div>

              <div className="flex items-center gap-3">
                {/* Month Dropdown */}
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="bg-[#040810] border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="all">All Months</option>
                  {historyMonths.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>

                {/* CSV Download Button */}
                <button
                  onClick={handleDownloadCsv}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-md shadow-emerald-600/20 shrink-0"
                >
                  <span>📥</span> Download CSV
                </button>
              </div>
            </div>

            {loadingHistory ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
                <span className="ml-2 text-xs text-slate-400">Loading historical log…</span>
              </div>
            ) : historyRecords.length === 0 ? (
              <div className="rounded-xl border border-slate-800 bg-[#0b1626] p-8 text-center text-slate-400">
                No historical recommendations found for the selected filter.
              </div>
            ) : (
              <HistorySingleRowTable records={historyRecords} />
            )}
          </section>
        )}
      </div>
    </main>
  );
}

// Single-Row Table Component for Term Recommendations
function TermSingleRowTable({ picks }: { picks: TermRecommendation[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800/90 bg-[#0b1626] shadow-xl">
      <table className="w-full text-left text-xs text-slate-300 border-collapse">
        <thead className="bg-[#070e1a] text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
          <tr>
            <th className="py-3.5 px-4">Symbol & Name</th>
            <th className="py-3.5 px-3">Term Duration</th>
            <th className="py-3.5 px-3">Category</th>
            <th className="py-3.5 px-3">Sector</th>
            <th className="py-3.5 px-3 text-center">Action</th>
            <th className="py-3.5 px-3 text-right">CMP (₹)</th>
            <th className="py-3.5 px-3 text-right">Target (₹)</th>
            <th className="py-3.5 px-3 text-right">Change</th>
            <th className="py-3.5 px-3 text-right">Upside</th>
            <th className="py-3.5 px-3 text-center">Flag</th>
            <th className="py-3.5 px-4 min-w-[260px]">Agent Analysis Rationale</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60 font-sans">
          {picks.map((stock, idx) => {
            const isPos = stock.changePercent >= 0;
            const badgeStyle =
              stock.termDuration === "1week"
                ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
                : stock.termDuration === "1month"
                ? "bg-blue-500/20 text-blue-300 border-blue-500/30"
                : stock.termDuration === "3months"
                ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                : "bg-purple-500/20 text-purple-300 border-purple-500/30";

            return (
              <tr key={`term-${stock.symbol}-${idx}`} className="hover:bg-[#0e1c30] transition-colors duration-150">
                {/* Symbol & Name */}
                <td className="py-3 px-4">
                  <div className="font-bold text-white text-sm tracking-wide">{stock.symbol}</div>
                  <div className="text-[11px] text-slate-400 truncate max-w-[170px]">{stock.name}</div>
                </td>

                {/* Term Duration */}
                <td className="py-3 px-3">
                  <span className={`inline-block px-2.5 py-1 rounded-md text-[11px] font-bold border ${badgeStyle}`}>
                    ⏱️ {stock.durationLabel}
                  </span>
                </td>

                {/* Category */}
                <td className="py-3 px-3 text-slate-300 font-medium">
                  {stock.marketCapCategory || "NIFTY 500"}
                </td>

                {/* Sector */}
                <td className="py-3 px-3 text-slate-400">
                  {stock.sector || stock.theme || "General"}
                </td>

                {/* Action */}
                <td className="py-3 px-3 text-center">
                  <span className="inline-block px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    {stock.action}
                  </span>
                </td>

                {/* CMP */}
                <td className="py-3 px-3 text-right font-bold text-white font-mono">
                  ₹{stock.price ? stock.price.toLocaleString("en-IN", { maximumFractionDigits: 1 }) : "—"}
                </td>

                {/* Target */}
                <td className="py-3 px-3 text-right font-bold text-cyan-300 font-mono">
                  ₹{stock.target ? stock.target.toLocaleString("en-IN", { maximumFractionDigits: 1 }) : "—"}
                </td>

                {/* Day Change */}
                <td className={`py-3 px-3 text-right font-semibold font-mono ${isPos ? "text-emerald-400" : "text-rose-400"}`}>
                  {isPos ? "+" : ""}
                  {stock.changePercent ? stock.changePercent.toFixed(1) : "0.0"}%
                </td>

                {/* Upside */}
                <td className="py-3 px-3 text-right font-bold text-cyan-400 font-mono">
                  +{stock.upside ? stock.upside.toFixed(1) : "0"}%
                </td>

                {/* Multibagger Flag */}
                <td className="py-3 px-3 text-center">
                  {stock.isMultibagger ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/20 px-2.5 py-0.5 text-[10px] font-bold text-purple-300 border border-purple-500/40 shadow-sm animate-pulse">
                      🚀 MULTIBAGGER
                    </span>
                  ) : (
                    <span className="text-slate-600 text-[10px]">—</span>
                  )}
                </td>

                {/* Agent Analysis Rationale */}
                <td className="py-3 px-4 text-[11px] text-slate-300 leading-snug">
                  {stock.agentRationale}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Single-Row Table Component for Intraday Recommendations
function SimpleSingleRowTable({
  picks,
  type,
}: {
  picks: StockPick[];
  type: "intraday";
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800/90 bg-[#0b1626] shadow-xl">
      <table className="w-full text-left text-xs text-slate-300 border-collapse">
        <thead className="bg-[#070e1a] text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
          <tr>
            <th className="py-3.5 px-4">Symbol & Name</th>
            <th className="py-3.5 px-3">Horizon</th>
            <th className="py-3.5 px-3">Category</th>
            <th className="py-3.5 px-3">Sector</th>
            <th className="py-3.5 px-3 text-center">Action</th>
            <th className="py-3.5 px-3 text-right">CMP (₹)</th>
            <th className="py-3.5 px-3 text-right">Target (₹)</th>
            <th className="py-3.5 px-3 text-right">Change</th>
            <th className="py-3.5 px-3 text-right">Upside</th>
            <th className="py-3.5 px-3 text-center">Flag</th>
            <th className="py-3.5 px-4 min-w-[220px]">Rationale / Remark</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60 font-sans">
          {picks.map((stock, idx) => {
            const isPos = stock.changePercent >= 0;
            return (
              <tr
                key={`${type}-${stock.symbol}-${idx}`}
                className="hover:bg-[#0e1c30] transition-colors duration-150"
              >
                <td className="py-3 px-4">
                  <div className="font-bold text-white text-sm tracking-wide">{stock.symbol}</div>
                  <div className="text-[11px] text-slate-400 truncate max-w-[170px]">{stock.name}</div>
                </td>

                <td className="py-3 px-3 shrink-0">
                  <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    Intraday (1D)
                  </span>
                </td>

                <td className="py-3 px-3 text-slate-300 font-medium">
                  {stock.marketCapCategory || "NIFTY 500"}
                </td>

                <td className="py-3 px-3 text-slate-400">
                  {stock.sector || stock.theme || "General"}
                </td>

                <td className="py-3 px-3 text-center">
                  <span className="inline-block px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    {stock.action === "Accumulate" ? "BUY" : stock.action}
                  </span>
                </td>

                <td className="py-3 px-3 text-right font-bold text-white font-mono">
                  ₹{stock.price ? stock.price.toLocaleString("en-IN", { maximumFractionDigits: 1 }) : "—"}
                </td>

                <td className="py-3 px-3 text-right font-bold text-cyan-300 font-mono">
                  ₹{stock.target ? stock.target.toLocaleString("en-IN", { maximumFractionDigits: 1 }) : "—"}
                </td>

                <td className={`py-3 px-3 text-right font-semibold font-mono ${isPos ? "text-emerald-400" : "text-rose-400"}`}>
                  {isPos ? "+" : ""}
                  {stock.changePercent ? stock.changePercent.toFixed(1) : "0.0"}%
                </td>

                <td className="py-3 px-3 text-right font-bold text-cyan-400 font-mono">
                  +{stock.upside ? stock.upside.toFixed(1) : "0"}%
                </td>

                <td className="py-3 px-3 text-center">
                  {stock.isMultibagger ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/20 px-2.5 py-0.5 text-[10px] font-bold text-purple-300 border border-purple-500/40 shadow-sm animate-pulse">
                      🚀 MULTIBAGGER
                    </span>
                  ) : (
                    <span className="text-slate-600 text-[10px]">—</span>
                  )}
                </td>

                <td className="py-3 px-4 text-[11px] text-slate-400 leading-tight">
                  {stock.remark || "High factor score & trend alignment"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Single-Row Table Component for Watchlist
function WatchlistSingleRowTable({
  holdings,
  onRemove,
}: {
  holdings: WatchlistRecommendation[];
  onRemove: (symbol: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800/90 bg-[#0b1626] shadow-xl">
      <table className="w-full text-left text-xs text-slate-300 border-collapse">
        <thead className="bg-[#070e1a] text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
          <tr>
            <th className="py-3.5 px-4">Symbol & Name</th>
            <th className="py-3.5 px-3 text-right">CMP (₹)</th>
            <th className="py-3.5 px-3 text-right">Day Change</th>
            <th className="py-3.5 px-3 text-center bg-amber-950/20 border-x border-slate-800">Intraday Rec (1D)</th>
            <th className="py-3.5 px-3 text-right bg-amber-950/20 border-r border-slate-800">Intraday Target</th>
            <th className="py-3.5 px-3 text-center bg-emerald-950/20 border-r border-slate-800">Term Rec (3–6M)</th>
            <th className="py-3.5 px-3 text-right bg-emerald-950/20 border-r border-slate-800">Term Target</th>
            <th className="py-3.5 px-3 text-right bg-emerald-950/20 border-r border-slate-800">Term Upside</th>
            <th className="py-3.5 px-3 text-center">Flag</th>
            <th className="py-3.5 px-4 text-center">Remove</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60 font-sans">
          {holdings.map((item) => {
            const isPos = item.changePercent >= 0;
            return (
              <tr key={`wl-${item.symbol}`} className="hover:bg-[#0e1c30] transition-colors duration-150">
                <td className="py-3 px-4">
                  <div className="font-bold text-white text-sm tracking-wide">{item.symbol}</div>
                  <div className="text-[11px] text-slate-400 truncate max-w-[180px]">{item.name}</div>
                </td>

                <td className="py-3 px-3 text-right font-bold text-white font-mono">
                  ₹{item.price ? item.price.toLocaleString("en-IN", { maximumFractionDigits: 1 }) : "—"}
                </td>

                <td className={`py-3 px-3 text-right font-semibold font-mono ${isPos ? "text-emerald-400" : "text-rose-400"}`}>
                  {isPos ? "+" : ""}
                  {item.changePercent ? item.changePercent.toFixed(1) : "0.0"}%
                </td>

                <td className="py-3 px-3 text-center bg-amber-950/10 border-x border-slate-800">
                  <span className="inline-block px-2.5 py-0.5 rounded text-[11px] font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    {item.intradayAction}
                  </span>
                </td>

                <td className="py-3 px-3 text-right font-bold text-amber-300 font-mono bg-amber-950/10 border-r border-slate-800">
                  ₹{item.intradayTarget ? item.intradayTarget.toLocaleString("en-IN", { maximumFractionDigits: 1 }) : "—"}
                </td>

                <td className="py-3 px-3 text-center bg-emerald-950/10 border-r border-slate-800">
                  <span className="inline-block px-2.5 py-0.5 rounded text-[11px] font-bold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    {item.longTermAction}
                  </span>
                </td>

                <td className="py-3 px-3 text-right font-bold text-cyan-300 font-mono bg-emerald-950/10 border-r border-slate-800">
                  ₹{item.longTermTarget ? item.longTermTarget.toLocaleString("en-IN", { maximumFractionDigits: 1 }) : "—"}
                </td>

                <td className="py-3 px-3 text-right font-bold text-cyan-400 font-mono bg-emerald-950/10 border-r border-slate-800">
                  +{item.longTermUpside ? item.longTermUpside.toFixed(1) : "0"}%
                </td>

                <td className="py-3 px-3 text-center">
                  {item.isMultibagger ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/20 px-2.5 py-0.5 text-[10px] font-bold text-purple-300 border border-purple-500/40 animate-pulse">
                      🚀 MULTIBAGGER
                    </span>
                  ) : (
                    <span className="text-slate-600 text-[10px]">—</span>
                  )}
                </td>

                <td className="py-3 px-4 text-center">
                  <button
                    onClick={() => onRemove(item.symbol)}
                    className="text-slate-500 hover:text-rose-400 p-1 transition rounded hover:bg-rose-500/10"
                    title="Remove stock"
                  >
                    🗑️
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Single-Row Table Component for History
function HistorySingleRowTable({ records }: { records: HistoryRecord[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800/90 bg-[#0b1626] shadow-xl">
      <table className="w-full text-left text-xs text-slate-300 border-collapse">
        <thead className="bg-[#070e1a] text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
          <tr>
            <th className="py-3.5 px-4">Date</th>
            <th className="py-3.5 px-4">Recommended Stock Name</th>
            <th className="py-3.5 px-3 text-center">Term Type</th>
            <th className="py-3.5 px-3 text-right">Recommended CMP (₹)</th>
            <th className="py-3.5 px-3 text-right">Target (₹)</th>
            <th className="py-3.5 px-3 text-center">Hit or Miss</th>
            <th className="py-3.5 px-4">Hit Time Details</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60 font-sans">
          {records.map((r, idx) => {
            const isHit = r.hitOrMiss === "HIT";
            const isMiss = r.hitOrMiss === "MISS";
            return (
              <tr key={`hist-${idx}`} className="hover:bg-[#0e1c30] transition-colors duration-150">
                <td className="py-3 px-4 font-mono text-[11px] text-slate-400">
                  {r.date}
                </td>

                <td className="py-3 px-4">
                  <div className="font-bold text-white text-sm tracking-wide">{r.stockName}</div>
                  <div className="text-[11px] text-cyan-400 font-mono font-semibold">{r.symbol}</div>
                </td>

                <td className="py-3 px-3 text-center">
                  <span
                    className={`inline-block px-2.5 py-0.5 rounded text-[11px] font-bold uppercase ${
                      r.termType.toLowerCase().includes("intraday")
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                        : "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                    }`}
                  >
                    {r.termType}
                  </span>
                </td>

                <td className="py-3 px-3 text-right font-bold text-white font-mono">
                  ₹{r.cmp ? r.cmp.toLocaleString("en-IN", { maximumFractionDigits: 1 }) : "—"}
                </td>

                <td className="py-3 px-3 text-right font-bold text-cyan-300 font-mono">
                  ₹{r.target ? r.target.toLocaleString("en-IN", { maximumFractionDigits: 1 }) : "—"}
                </td>

                <td className="py-3 px-3 text-center">
                  {isHit ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-3 py-0.5 text-[11px] font-bold text-emerald-300 border border-emerald-500/40 shadow-sm animate-pulse">
                      🎯 HIT
                    </span>
                  ) : isMiss ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/20 px-3 py-0.5 text-[11px] font-bold text-rose-300 border border-rose-500/40">
                      ❌ MISS
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-3 py-0.5 text-[11px] font-bold text-amber-300 border border-amber-500/40">
                      ⏳ IN PROGRESS
                    </span>
                  )}
                </td>

                <td className="py-3 px-4 text-[11px] font-mono text-slate-300 leading-tight">
                  {r.hitTimeDetails || "Evaluating hit status"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

