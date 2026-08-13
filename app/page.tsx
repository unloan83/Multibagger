"use client";

import { useCallback, useEffect, useState } from "react";
import type { TermRecommendation, TermDuration } from "@/lib/term-agent-analysis";
import type { CandleViewResult } from "@/lib/candle-view";
import type { CandleScanSnapshot } from "@/lib/candle-scanner";

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
  publication?: { enabled: boolean; status: string; reason: string; allowedOutput: string; requirements: string[] };
  categories: Category[];
  intradayPipeline?: {
    asOf: string;
    slot?: string;
    slotLabel?: string;
    source?: string;
    isLive?: boolean;
    reason?: string | null;
    screened?: Array<{ symbol: string; price: number; changePercent: number; volume: number; status: string; reasons: string[] }>;
    picks: StockPick[];
  };
};

type WatchlistRecommendation = {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
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

type Market = "india" | "us";
type PaperSession = {
  paperModelVersion: "free-quotes-v1";
  mode: "PAPER_ONLY";
  startedAt: string;
  endsAt: string;
  updatedAt: string;
  status: "ACTIVE" | "COMPLETED";
  initialCapital: number;
  realizedPnl: number;
  quoteProvider: "YAHOO_INTRADAY_FREE";
  quoteFeedLive: boolean;
  lastError: string | null;
  trades: Array<{ id: string; symbol: string; side: "BUY" | "SELL"; quantity: number; entryPrice: number; exitPrice: number | null; openedAt: string; closedAt: string | null; status: string; pnl: number; source: string }>;
  cycles: Array<{ runAt: string; universeSize: number; evaluated: number; unavailable: number; qualified: number; outcome: "TRADES_OPENED" | "NO_TRADE"; actions: Array<{ symbol: string; signalPrice: number; outcome: string }> }>;
};
type UsMarketData = {
  asOf: string;
  termPicks: TermRecommendation[];
  intradayPicks: StockPick[];
};

export default function HomePage() {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"term" | "intraday" | "candle" | "watchlist" | "history">("term");
  const [market, setMarket] = useState<Market>("india");
  const [usMarketData, setUsMarketData] = useState<UsMarketData | null>(null);
  const [loadingUsMarket, setLoadingUsMarket] = useState(false);
  const [candleSymbol, setCandleSymbol] = useState("");
  const [candleResult, setCandleResult] = useState<CandleViewResult | null>(null);
  const [candleError, setCandleError] = useState("");
  const [loadingCandle, setLoadingCandle] = useState(false);
  const [candleScan, setCandleScan] = useState<CandleScanSnapshot | null>(null);
  const [loadingCandleScan, setLoadingCandleScan] = useState(false);
  const [candleScanError, setCandleScanError] = useState("");
  const [paperSession, setPaperSession] = useState<PaperSession | null>(null);
  const [paperConfigured, setPaperConfigured] = useState(false);
  const [paperLoading, setPaperLoading] = useState(false);
  const [paperError, setPaperError] = useState("");

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
  const [historyMarket, setHistoryMarket] = useState<Market>("india");
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
    fetch("/api/term-recommendations", { cache: "no-store" })
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

    fetch("/api/recommendations", { cache: "no-store" })
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

  useEffect(() => {
    if (!isUnlocked || market !== "us" || usMarketData) return;
    setLoadingUsMarket(true);
    fetch("/api/us-recommendations")
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load US recommendations.");
        return res.json();
      })
      .then((data) => {
        if (data.ok) {
          setUsMarketData({ asOf: data.asOf, termPicks: data.termPicks || [], intradayPicks: data.intradayPicks || [] });
        }
      })
      .catch((err) => setError(err.message || "Failed to load US recommendations."))
      .finally(() => setLoadingUsMarket(false));
  }, [isUnlocked, market, usMarketData]);

  // Fetch Watchlist Data when Watchlist Tab is selected
  const fetchWatchlist = useCallback(() => {
    setLoadingWatchlist(true);
    fetch(`/api/watchlist?market=${market}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && Array.isArray(data.holdings)) {
          setWatchlistItems(data.holdings);
        }
        setLoadingWatchlist(false);
      })
      .catch(() => setLoadingWatchlist(false));
  }, [market]);

  useEffect(() => {
    if (isUnlocked && activeTab === "watchlist") {
      fetchWatchlist();
    }
  }, [isUnlocked, activeTab, fetchWatchlist]);

  // Fetch History Data when History Tab is selected or month changes
  const fetchHistory = (month: string, selectedMarket: Market) => {
    setLoadingHistory(true);
    fetch(`/api/history?market=${selectedMarket}&month=${encodeURIComponent(month)}`)
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
    if (isUnlocked) fetchHistory(selectedMonth, historyMarket);
  }, [isUnlocked, selectedMonth, historyMarket]);

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

  const handleCandleEvaluation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!candleSymbol.trim()) return;
    setLoadingCandle(true);
    setCandleError("");
    setCandleResult(null);
    try {
      const response = await fetch(`/api/candle-view?market=${market}&symbol=${encodeURIComponent(candleSymbol.trim())}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Candle evaluation failed.");
      setCandleResult(data.result);
    } catch (err) {
      setCandleError(err instanceof Error ? err.message : "Candle evaluation failed.");
    } finally {
      setLoadingCandle(false);
    }
  };

  const fetchCandleScan = useCallback(async (refresh = false) => {
    setLoadingCandleScan(true);
    setCandleScanError("");
    try {
      const response = await fetch(`/api/candle-view/scan?market=${market}`, { method: refresh ? "POST" : "GET", cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Market scan failed.");
      setCandleScan(data.snapshot || null);
    } catch (err) {
      setCandleScanError(err instanceof Error ? err.message : "Market scan failed.");
    } finally {
      setLoadingCandleScan(false);
    }
  }, [market]);

  const fetchPaperSession = useCallback(async (action?: "start" | "cycle") => {
    setPaperLoading(true);
    setPaperError("");
    try {
      const response = await fetch("/api/candle-view/paper-test", {
        method: action ? "POST" : "GET",
        headers: action ? { "Content-Type": "application/json" } : undefined,
        body: action ? JSON.stringify({ action }) : undefined,
        cache: "no-store",
      });
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) throw new Error(`Paper-test service returned HTTP ${response.status}. Please retry after the deployment is healthy.`);
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Paper test request failed.");
      setPaperSession(data.session || null);
      setPaperConfigured(Boolean(data.configured));
    } catch (err) {
      setPaperError(err instanceof Error ? err.message : "Paper test request failed.");
    } finally {
      setPaperLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isUnlocked && activeTab === "candle") {
      fetchCandleScan(false);
      fetchPaperSession();
    }
  }, [isUnlocked, activeTab, fetchCandleScan, fetchPaperSession]);

  const handleAddWatchlist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSymbolInput.trim()) return;

    setLoadingWatchlist(true);
    setWatchlistMsg("");
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: newSymbolInput.trim(), market }),
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
        body: JSON.stringify({ symbol, market }),
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
    window.open(`/api/history?market=${historyMarket}&month=${encodeURIComponent(selectedMonth)}&download=true`, "_blank");
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

  // Keep the displayed intraday rows and timestamp on the same scheduled pipeline.
  const indianIntradayPicks: StockPick[] = (snapshot?.intradayPipeline?.picks || []).map((item) => ({
    ...item,
    isMultibagger: item.upside >= 100 || (item.target >= 2 * item.price && item.price > 0),
  }));

  // Filter Term Picks by Selected Duration
  const activeTermPicks = market === "us" ? usMarketData?.termPicks || [] : termPicks;
  const intradayPicks = [...(market === "us" ? usMarketData?.intradayPicks || [] : indianIntradayPicks)]
    .sort((a, b) => b.score - a.score || b.upside - a.upside);
  const filteredTermPicks = termFilter === "all"
    ? activeTermPicks
    : activeTermPicks.filter((p) => p.termDuration === termFilter);

  const formatUpdatedAt = (value?: string | null) =>
    value
      ? new Date(value).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Kolkata",
      }) + " IST"
      : "Awaiting first run";

  const intradayUpdatedLabel = formatUpdatedAt(market === "us" ? usMarketData?.asOf : snapshot?.intradayPipeline?.asOf);
  const currencySymbol = market === "us" ? "$" : "₹";
  const marketLabel = market === "us" ? "US" : "Indian";
  const marketLoading = market === "us" ? loadingUsMarket : loading;
  const recommendationsWithheld = snapshot?.publication?.enabled !== true;
  const publicationReason = snapshot?.publication?.reason || "Recommendation publishing is withheld until the model meets its data and validation requirements.";

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
                  Live Market Research
                </span>
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="https://liveunloan.vercel.app/"
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-bold text-cyan-300 transition hover:border-cyan-400 hover:bg-cyan-500/20 hover:text-white"
              aria-label="Go to Live Unloan home page"
            >
              <span aria-hidden="true">🏠</span> Home
            </a>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 space-y-6">
        <div className="rounded-2xl border border-rose-500/35 bg-rose-950/30 p-4">
          <div className="flex items-start gap-3"><span className="text-lg">⛔</span><div><h2 className="text-sm font-bold text-rose-200">Recommendation publishing withheld</h2>
            <p className="mt-1 text-xs leading-relaxed text-rose-100/80">{publicationReason}</p>
            <p className="mt-2 text-[11px] text-slate-400">The portal may display current market quotes and screening diagnostics, but it will not publish BUY, ACCUMULATE, targets, candle calls or paper trades.</p></div></div>
        </div>
        <div className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-[#0b1626] p-1.5 shadow-lg" aria-label="Select stock market">
          <button
            onClick={() => { setMarket("india"); setActiveTab("term"); }}
            className={`rounded-lg px-5 py-2.5 text-sm font-bold transition ${market === "india" ? "bg-indigo-600 text-white shadow-md" : "text-slate-300 hover:bg-slate-800"}`}
          >
            🇮🇳 Indian Market
          </button>
          <button
            onClick={() => { setMarket("us"); setActiveTab("term"); }}
            className={`rounded-lg px-5 py-2.5 text-sm font-bold transition ${market === "us" ? "bg-cyan-500 text-slate-950 shadow-md" : "text-slate-300 hover:bg-slate-800"}`}
          >
            🇺🇸 US Market
          </button>
        </div>

        {/* Run Time & Strategy Confirmation Banner */}
        <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-r from-[#0a192f] via-[#091526] to-[#0d1e38] p-4 text-xs shadow-lg">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="space-y-1">
              <span className="font-bold text-cyan-300 flex items-center gap-1.5 text-sm">
                <span>🤖</span> {marketLabel} Market Analysis Schedule & Rules
              </span>
              <p className="text-slate-300 leading-relaxed">
                <strong className="text-indigo-400">Term model:</strong> Publication disabled; no quota or duration bucket will be backfilled.
              </p>
              <p className="text-slate-300 leading-relaxed">
                <strong className="text-amber-400">Intraday data:</strong> Live screening diagnostics may be shown, but no trade recommendation is published.
              </p>
            </div>
            <div className="shrink-0 bg-[#060e1a] border border-slate-800 rounded-xl p-2.5 text-slate-400 text-[11px] space-y-1">
              <div><strong className="text-cyan-400">Term Durations:</strong> 1 Week | 1 Month | 3 Months | 6 Months</div>
              <div><strong className="text-purple-400">Multibagger Rule:</strong> Flagged if Upside &ge; 100%</div>
            </div>
          </div>
        </div>

        {recommendationsWithheld && (
          <div className="rounded-2xl border border-slate-700/80 bg-[#0b1626] p-4 shadow-lg">
            <h2 className="text-sm font-bold text-white">Publication requirements</h2>
            <ul className="mt-3 grid gap-2 text-xs text-slate-400 md:grid-cols-2">
              {(snapshot?.publication?.requirements || []).map((requirement) => <li key={requirement} className="rounded-lg border border-slate-800 bg-[#07111f] p-3">• {requirement}</li>)}
            </ul>
          </div>
        )}
        <details className={`${recommendationsWithheld ? "hidden" : ""} group rounded-2xl border border-slate-700/80 bg-[#0b1626] shadow-lg`}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3.5 text-sm font-bold text-white transition hover:bg-slate-800/40 [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2">
              <span aria-hidden="true">📖</span>
              Recommendation Logic & Metrics Glossary
            </span>
            <span className="text-xs font-semibold text-cyan-300 transition-transform group-open:rotate-180" aria-hidden="true">▼</span>
          </summary>
          <div className="border-t border-slate-700/70 px-4 py-4 text-xs leading-relaxed text-slate-300">
            <p className="mb-4 text-slate-400">
              The {marketLabel} market engine ranks candidates using market data, momentum, liquidity, business quality and risk. Scores are comparative screening scores—not probabilities or guaranteed returns. Term and intraday recommendations use different gates.
            </p>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <GlossaryItem term="Recommendation Score (0–100)" description="Weighted rank combining growth, quality, valuation, momentum, sector strength, liquidity, catalysts, data quality and risk. A higher score means stronger evidence relative to the screened universe." />
              <GlossaryItem term="Relative Strength (RS)" description={`Measures a stock's performance against the ${market === "us" ? "S&P 500 / US peer group" : "NIFTY 500 / sector peer group"}. Positive RS indicates benchmark outperformance over the review window.`} />
              <GlossaryItem term="Momentum" description="Uses recent returns, trend direction and price acceleration. It helps identify continuation setups but is discounted when a move is overextended or unstable." />
              <GlossaryItem term="RVOL / Volume Shock" description="Current or recent volume divided by normal volume. Above 1.0× means activity is stronger than usual; intraday candidates favour confirmed participation rather than price movement alone." />
              <GlossaryItem term="VWAP" description="Volume-Weighted Average Price estimates the session's average traded price. Price holding above VWAP can confirm demand; a large gap from VWAP can indicate an overextended entry." />
              <GlossaryItem term="EMA20 / EMA50 / EMA200" description="Exponential moving averages represent short-, medium- and long-term trend. The model rewards constructive alignment and applies caution when shorter averages fall below longer averages." />
              <GlossaryItem term="ATR & Risk Score" description="Average True Range estimates typical price volatility. ATR, drawdown, liquidity and adverse price movement feed the risk score and influence target distance and position caution." />
              <GlossaryItem term="Growth & Earnings Quality" description="Term screening reviews revenue and earnings consistency, margins, return on equity and whether reported profits are supported by operating cash flow." />
              <GlossaryItem term="Debt-to-Equity (D/E)" description="Interest-bearing debt divided by shareholder equity. Lower leverage is generally preferred; financial companies require sector-specific interpretation." />
              <GlossaryItem term="Cash-Flow Conversion" description="Operating cash flow divided by net income. It tests whether accounting earnings are translating into cash and helps flag weak earnings quality." />
              <GlossaryItem term="CMP, Target & Upside" description="CMP is the current market price. Target is the modelled price objective for the displayed horizon. Upside is (Target − CMP) ÷ CMP × 100 and can change as prices refresh." />
              <GlossaryItem term="BUY / ACCUMULATE / WATCH" description="BUY marks a stronger near-term setup; ACCUMULATE indicates staged entry over the stated horizon; WATCH means evidence or confirmation is incomplete and is not an entry signal." />
              <GlossaryItem term="Term Logic" description="Prioritises business growth, earnings quality, leverage, valuation, medium-term trend, sector strength, liquidity and risk across 1-week, 1-month, 3-month and 6-month buckets." />
              <GlossaryItem term="Intraday Logic" description="Prioritises session movement, relative volume, VWAP position, short-term momentum, liquidity and volatility. Long-term fundamental exclusions are not reused as intraday rationale." />
              <GlossaryItem term="Multibagger Flag" description="Displayed only when modelled upside is at least 100%. It is a scenario flag, not a prediction or assurance that the stock will double." />
            </div>
            <p className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200/80">
              Research screening only. Confirm live price, filings, news, liquidity, stop-loss and position size before acting.
            </p>
          </div>
        </details>

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
              <span>🎯</span> Term Model (Withheld)
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
              <span>⚡</span> Intraday Data
              <span className="text-[10px] opacity-75 font-normal">(Same Day)</span>
            </button>
            <button
              onClick={() => setActiveTab("candle")}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
                activeTab === "candle"
                  ? "bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <span>🕯️</span> Candle View
              <span className="text-[10px] opacity-75 font-normal">(OHL)</span>
            </button>
            <button
              onClick={() => setActiveTab("watchlist")}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
                activeTab === "watchlist"
                  ? "bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <span>⭐</span> {marketLabel} Watchlist
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
                  Term Recommendations Withheld
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  No recommendation quota, backfill or modelled target is being published.
                </p>
              </div>

              {/* Term Duration Sub-Filters */}
              <div className={`${recommendationsWithheld ? "hidden" : "flex"} items-center gap-1.5 bg-[#060e1a] p-1 rounded-lg border border-slate-800 text-xs font-semibold`}>
                <button
                  onClick={() => setTermFilter("1week")}
                  className={`px-3 py-1 rounded transition ${
                    termFilter === "1week" ? "bg-amber-500 text-slate-950" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  1 Week
                </button>
                <button
                  onClick={() => setTermFilter("1month")}
                  className={`px-3 py-1 rounded transition ${
                    termFilter === "1month" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  1 Month
                </button>
                <button
                  onClick={() => setTermFilter("3months")}
                  className={`px-3 py-1 rounded transition ${
                    termFilter === "3months" ? "bg-emerald-600 text-white" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  3 Months
                </button>
                <button
                  onClick={() => setTermFilter("6months")}
                  className={`px-3 py-1 rounded transition ${
                    termFilter === "6months" ? "bg-purple-600 text-white" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  6 Months
                </button>
                <button
                  onClick={() => setTermFilter("all")}
                  className={`px-3 py-1 rounded transition ${
                    termFilter === "all" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  All
                </button>
              </div>
            </div>

            {(market === "us" ? loadingUsMarket : loadingTerm) ? (
              <div className="flex items-center justify-center py-16">
                <div className="h-7 w-7 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
                <span className="ml-3 text-xs text-slate-400">Loading current market status…</span>
              </div>
            ) : filteredTermPicks.length === 0 ? (
              <div className="rounded-xl border border-slate-800 bg-[#0b1626] p-8 text-center text-slate-400">
                {publicationReason}
              </div>
            ) : (
              <TermSingleRowTable picks={filteredTermPicks} currencySymbol={currencySymbol} />
            )}
          </section>
        )}

        {/* TAB 2: Intraday Breakouts */}
        {!marketLoading && activeTab === "intraday" && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400 animate-pulse" />
                  Intraday Market Screen
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">Updated {intradayUpdatedLabel} • Live NSE gainers • ₹150–₹3,000 • Volume ≥1 lakh • VWAP/ORB/RVOL/RSI/MACD gates</p>
              </div>
              <span className="text-xs text-slate-400 font-medium bg-[#091424] px-3 py-1 rounded-lg border border-slate-800">
                Total: <strong className="text-amber-400">{intradayPicks.length}</strong>
              </span>
            </div>

            {intradayPicks.length === 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-[#0b1626] p-8 text-center text-slate-400">
                {publicationReason}
              </div>
            ) : (
              <SimpleSingleRowTable picks={intradayPicks} type="intraday" currencySymbol={currencySymbol} />
            )}
            {market === "india" && (snapshot?.intradayPipeline?.screened?.length || 0) > 0 && (
              <div className="overflow-x-auto rounded-xl border border-slate-800 bg-[#0b1626]">
                <div className="border-b border-slate-800 px-4 py-3 text-xs font-bold text-slate-300">Live NSE leaders screened—not recommendations</div>
                <table className="w-full text-xs"><thead className="bg-slate-900/70 text-slate-400"><tr><th className="px-3 py-2 text-left">Symbol</th><th className="px-3 py-2 text-right">LTP</th><th className="px-3 py-2 text-right">Day</th><th className="px-3 py-2 text-right">Volume</th><th className="px-3 py-2 text-left">Decision evidence</th></tr></thead>
                  <tbody>{snapshot!.intradayPipeline!.screened!.map((stock) => <tr key={stock.symbol} className="border-t border-slate-800"><td className="px-3 py-2 font-bold text-white">{stock.symbol}</td><td className="px-3 py-2 text-right">₹{stock.price.toLocaleString("en-IN")}</td><td className="px-3 py-2 text-right text-emerald-300">+{stock.changePercent.toFixed(2)}%</td><td className="px-3 py-2 text-right">{stock.volume.toLocaleString("en-IN")}</td><td className="px-3 py-2 text-left"><span className={stock.status === "BUY" ? "text-emerald-300" : "text-amber-300"}>{stock.status}</span>{stock.reasons.length ? ` — ${stock.reasons.join("; ")}` : " — all gates passed"}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* TAB 3: Strict Early Morning OHL Momentum */}
        {activeTab === "candle" && (
          <section className="space-y-4">
            {recommendationsWithheld ? (
              <div className="rounded-2xl border border-rose-500/30 bg-rose-950/20 p-8 text-center">
                <h2 className="text-base font-bold text-rose-200">Candle recommendations and paper trading are withheld</h2>
                <p className="mx-auto mt-2 max-w-2xl text-xs leading-relaxed text-slate-400">{publicationReason} No scanner, manual candle call, simulated entry, exit, target, or archived result is presented as actionable output.</p>
              </div>
            ) : (<>
            <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-r from-[#0a192f] to-[#0b1626] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-base font-bold text-white">🔎 Automatic Market Shortlist</h2>
                  <p className="mt-1 text-xs text-slate-400">Scans the live market universe only when the publication gate is enabled.</p>
                </div>
                <button onClick={() => fetchCandleScan(true)} disabled={loadingCandleScan || recommendationsWithheld} className="rounded-lg bg-cyan-500 px-5 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-50">
                  {recommendationsWithheld ? "Scanner Withheld" : loadingCandleScan ? "Scanning market…" : "Run Fresh Scan"}
                </button>
              </div>
              {candleScan && (
                <div className="mt-4 grid gap-2 sm:grid-cols-4">
                  <MetricCard label="Last Scan" value={formatUpdatedAt(candleScan.asOf)} />
                  <MetricCard label="Universe" value={candleScan.universeSize.toLocaleString("en-IN")} note={candleScan.universeName} />
                  <MetricCard label="Evaluated" value={candleScan.evaluated.toLocaleString("en-IN")} note={`${candleScan.unavailable} unavailable`} />
                  <MetricCard label="Shortlisted" value={candleScan.shortlisted.length.toLocaleString("en-IN")} note="All gates passed" />
                </div>
              )}
            </div>

            {candleScanError && <div className="rounded-xl border border-rose-800 bg-rose-950/40 p-4 text-xs text-rose-300">⚠️ {candleScanError}</div>}
            {loadingCandleScan && !candleScan && <div className="rounded-xl border border-slate-800 bg-[#08111e] p-8 text-center text-sm text-slate-400">Scanning completed 15-minute candles, trend, VWAP, and historical volume across the market…</div>}
            {candleScan && candleScan.shortlisted.length === 0 && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-6 text-center text-sm text-amber-200">No stocks passed every mandatory gate in the latest scan. This is a valid NO TRADE market result.</div>
            )}
            {candleScan && candleScan.shortlisted.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-emerald-300">Top 10 qualified stocks ({candleScan.shortlisted.length})</h3>
                <CandleShortlistTable results={candleScan.shortlisted} market={market} />
              </div>
            )}

            {market === "india" && (
              <div className="rounded-2xl border border-violet-500/25 bg-[#0b1626] p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-base font-bold text-white">🧪 Seven-Day Paper Test</h2>
                    <p className="mt-1 text-xs text-slate-400">Paper orders use fresh free Yahoo intraday quotes—no Dhan Data plan or live orders. Maximum simulated position ₹10,000; maximum five open positions.</p>
                  </div>
                  <div className="flex gap-2">
                    {!paperSession && <button onClick={() => fetchPaperSession("start")} disabled={paperLoading || recommendationsWithheld} className="rounded-lg bg-violet-500 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">Paper Test Withheld</button>}
                    {paperSession?.status === "ACTIVE" && <button onClick={() => fetchPaperSession("cycle")} disabled={paperLoading || recommendationsWithheld} className="rounded-lg bg-cyan-500 px-4 py-2.5 text-xs font-bold text-slate-950 disabled:opacity-50">{recommendationsWithheld ? "Paper Cycles Withheld" : paperLoading ? "Running…" : "Run Paper Cycle"}</button>}
                  </div>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  <MetricCard label="Free Quote Feed" value={paperSession?.quoteFeedLive ? "Live" : paperConfigured ? "Ready" : "Unavailable"} note="Yahoo intraday • ≤20 min freshness" />
                  <MetricCard label="Test Status" value={paperSession?.status || "Not started"} note={paperSession ? `Ends ${formatUpdatedAt(paperSession.endsAt)}` : "Seven calendar days"} />
                  <MetricCard label="Paper Trades" value={(paperSession?.trades.length || 0).toLocaleString("en-IN")} note={`${paperSession?.trades.filter((trade) => trade.status === "OPEN").length || 0} open`} />
                  <MetricCard label="Realized P&L" value={`₹${(paperSession?.realizedPnl || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`} note="Before fees and slippage" />
                </div>
                {(paperError || paperSession?.lastError) && <p className="mt-3 text-xs text-amber-300">⚠️ {paperError || paperSession?.lastError}</p>}
                {paperSession && paperSession.trades.length > 0 && (
                  <div className="table-scroll mt-4 rounded-xl border border-slate-800" tabIndex={0} aria-label="Paper trading activity">
                    <table className="w-full border-collapse text-left text-xs text-slate-300">
                      <thead className="bg-[#070e1a] text-[10px] uppercase tracking-wider text-slate-400">
                        <tr>
                          <th className="px-3 py-3">Stock</th><th className="px-3 py-3">Shortlisted / Bought</th><th className="px-3 py-3 text-right">Qty</th><th className="px-3 py-3 text-right">Buy Price</th><th className="px-3 py-3">Sold</th><th className="px-3 py-3 text-right">Sell Price</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Price Source</th><th className="px-3 py-3 text-right">P&amp;L</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70">
                        {[...paperSession.trades].reverse().map((trade) => (
                          <tr key={trade.id} className="hover:bg-slate-800/30">
                            <td className="px-3 py-3 font-bold text-white">{trade.symbol}</td>
                            <td className="px-3 py-3">{formatUpdatedAt(trade.openedAt)}</td>
                            <td className="px-3 py-3 text-right font-mono">{trade.quantity}</td>
                            <td className="px-3 py-3 text-right font-mono">₹{trade.entryPrice.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</td>
                            <td className="px-3 py-3">{trade.closedAt ? formatUpdatedAt(trade.closedAt) : "—"}</td>
                            <td className="px-3 py-3 text-right font-mono">{trade.exitPrice == null ? "—" : `₹${trade.exitPrice.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}</td>
                            <td className="px-3 py-3 font-bold text-cyan-300">{trade.status}</td>
                            <td className="px-3 py-3">{trade.source === "YAHOO_INTRADAY_FREE" ? "Yahoo intraday (free)" : "Legacy Dhan quote"}</td>
                            <td className={`px-3 py-3 text-right font-mono font-bold ${trade.pnl >= 0 ? "text-emerald-300" : "text-rose-300"}`}>₹{trade.pnl.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {paperSession && paperSession.cycles.length > 0 && (() => {
                  const cycle = paperSession.cycles.at(-1)!;
                  return <div className="mt-4 rounded-xl border border-slate-800 bg-[#08111e] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-bold text-violet-300">Latest paper cycle • {formatUpdatedAt(cycle.runAt)}</p>
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${cycle.outcome === "TRADES_OPENED" ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>{cycle.outcome.replaceAll("_", " ")}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
                      <span className="rounded-md bg-slate-900/70 p-2">Live universe <strong className="float-right text-white">{cycle.universeSize}</strong></span>
                      <span className="rounded-md bg-slate-900/70 p-2">Evaluated <strong className="float-right text-white">{cycle.evaluated}</strong></span>
                      <span className="rounded-md bg-slate-900/70 p-2">Unavailable <strong className="float-right text-white">{cycle.unavailable}</strong></span>
                      <span className="rounded-md bg-slate-900/70 p-2">Qualified <strong className="float-right text-white">{cycle.qualified}</strong></span>
                    </div>
                    {cycle.actions.length > 0 ? <div className="mt-3 flex flex-wrap gap-2">{cycle.actions.map((action) => <span key={action.symbol} className="rounded-md border border-slate-700 bg-slate-900/60 px-2.5 py-1 text-[10px] text-slate-300">{action.symbol} • {action.outcome.replaceAll("_", " ")}</span>)}</div>
                      : <p className="mt-3 text-xs text-amber-200">NO TRADE — the live NSE candidates were evaluated, but none passed every candle, liquidity, volume and freshness gate.</p>}
                  </div>;
                })()}
              </div>
            )}

            <div className="rounded-2xl border border-emerald-500/20 bg-[#0b1626] p-4">
              <h2 className="text-base font-bold text-white flex items-center gap-2"><span>🕯️</span> Manual Ticker Validation</h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                Long-only rolling 15-minute validation during the regular session. Requires a {currencySymbol}150–{currencySymbol}3,000 price, ≥1 lakh average daily shares, a bullish three-candle breakout, price above VWAP, EMA 9 above EMA 20, ≥2× same-period volume, ≤40% combined shadows, and a signal no older than 30 minutes. BUY target: +10%.
              </p>
              <form onSubmit={handleCandleEvaluation} className="mt-4 flex flex-col gap-2 sm:flex-row">
                <input
                  value={candleSymbol}
                  onChange={(e) => setCandleSymbol(e.target.value.toUpperCase())}
                  placeholder={market === "india" ? "NSE ticker, e.g. SUZLON" : "US ticker, e.g. PLTR"}
                  className="w-full rounded-lg border border-slate-700 bg-[#040810] px-3 py-2.5 text-sm font-mono text-white uppercase focus:border-emerald-500 focus:outline-none sm:max-w-sm"
                  aria-label="Stock ticker for candle evaluation"
                />
                <button disabled={recommendationsWithheld || loadingCandle || !candleSymbol.trim()} className="rounded-lg bg-emerald-500 px-5 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50">
                  {recommendationsWithheld ? "Candle Calls Withheld" : loadingCandle ? "Evaluating…" : "Evaluate Latest Candle"}
                </button>
              </form>
            </div>

            {candleError && <div className="rounded-xl border border-rose-800 bg-rose-950/40 p-4 text-xs text-rose-300">⚠️ {candleError}</div>}
            {candleResult && <CandleStrategyAlert result={candleResult} />}

            {!candleResult && !candleError && !loadingCandle && (
              <div className="rounded-xl border border-dashed border-slate-700 bg-[#08111e] p-8 text-center text-sm text-slate-400">
                Enter a ticker after a 15-minute candle has completed. The result will be BUY or NO TRADE with an exact trigger, target, stop-loss, failed gates, and time-risk guardrail.
              </div>
            )}
            </>)}
          </section>
        )}

        {/* TAB 4: Watchlist */}
        {activeTab === "watchlist" && (
          <section className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#0b1626] p-4 rounded-xl border border-slate-800">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <span>⭐</span> My {marketLabel} Stock Watchlist
                </h2>
                <p className="text-xs text-slate-400">Add stocks to track current quotes only. Recommendation labels and targets are withheld.</p>
              </div>

              {/* Add Stock Form */}
              <form onSubmit={handleAddWatchlist} className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder={market === "us" ? "Enter Ticker (e.g. AAPL, NVDA)" : "Enter Ticker (e.g. TATAMOTORS, RELIANCE)"}
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
              <WatchlistSingleRowTable holdings={watchlistItems} onRemove={handleRemoveWatchlist} currencySymbol={currencySymbol} />
            )}
          </section>
        )}

        {/* Bottom History & CSV Download */}
          <details className="group border-t border-slate-700/70 pt-6">
            <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl border border-slate-800 bg-[#0b1626] px-4 py-4 text-base font-bold text-white transition hover:bg-slate-800/50 [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2"><span>📜</span> Recommendation History</span>
              <span className="text-xs text-cyan-300 transition-transform group-open:rotate-180">▼</span>
            </summary>
            <div className="mt-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#0b1626] p-4 rounded-xl border border-slate-800">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <span>📜</span> Historical Recommendations Log
                </h2>
                <p className="text-xs text-slate-400">Daily recommendations captured month-wise with full CSV download option.</p>
              </div>

              <div className="flex items-center gap-3">
                <select
                  value={historyMarket}
                  onChange={(e) => { setHistoryMarket(e.target.value as Market); setSelectedMonth("all"); setHistoryMonths([]); }}
                  className="bg-[#040810] border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                  aria-label="History market"
                >
                  <option value="india">Indian Market</option>
                  <option value="us">US Market</option>
                </select>
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
              <HistorySingleRowTable records={historyRecords} currencySymbol={historyMarket === "us" ? "$" : "₹"} />
            )}
            </div>
          </details>
      </div>
    </main>
  );
}

// Single-Row Table Component for Term Recommendations
function TermSingleRowTable({ picks, currencySymbol }: { picks: TermRecommendation[]; currencySymbol: string }) {
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
            <th className="py-3.5 px-3 text-right">CMP ({currencySymbol})</th>
            <th className="py-3.5 px-3 text-right">Target ({currencySymbol})</th>
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
                  {currencySymbol}{stock.price ? stock.price.toLocaleString("en-IN", { maximumFractionDigits: 1 }) : "—"}
                </td>

                {/* Target */}
                <td className="py-3 px-3 text-right font-bold text-cyan-300 font-mono">
                  {currencySymbol}{stock.target ? stock.target.toLocaleString("en-IN", { maximumFractionDigits: 1 }) : "—"}
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
  currencySymbol,
}: {
  picks: StockPick[];
  type: "intraday";
  currencySymbol: string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800/90 bg-[#0b1626] shadow-xl">
      <table className="w-full text-left text-xs text-slate-300 border-collapse">
        <thead className="bg-[#070e1a] text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
          <tr>
            <th className="py-3.5 px-4">Symbol & Name</th>
            <th className="py-3.5 px-3 text-center">Rank / Confidence</th>
            <th className="py-3.5 px-3">Category</th>
            <th className="py-3.5 px-3">Sector</th>
            <th className="py-3.5 px-3 text-center">Action</th>
            <th className="py-3.5 px-3 text-right">CMP ({currencySymbol})</th>
            <th className="py-3.5 px-3 text-right">Target ({currencySymbol})</th>
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

                <td className="py-3 px-3 text-center">
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 font-bold text-amber-300">
                    #{idx + 1} <span className="text-[10px] font-medium text-slate-400">{stock.score}/100</span>
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
                  {currencySymbol}{stock.price ? stock.price.toLocaleString("en-IN", { maximumFractionDigits: 1 }) : "—"}
                </td>

                <td className="py-3 px-3 text-right font-bold text-cyan-300 font-mono">
                  {currencySymbol}{stock.target ? stock.target.toLocaleString("en-IN", { maximumFractionDigits: 1 }) : "—"}
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
                  {getIntradayRemark(stock)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function getIntradayRemark(stock: StockPick): string {
  if (stock.remark && !stock.remark.trim().toLowerCase().startsWith("not recommended")) {
    return stock.remark;
  }
  return `Intraday momentum candidate ranked ${stock.score}/100 with ${stock.changePercent >= 0 ? "+" : ""}${stock.changePercent.toFixed(1)}% session movement and ${stock.upside.toFixed(1)}% modelled upside. Confirm live VWAP, relative volume and stop-loss before entry.`;
}

function CandleShortlistTable({ results, market }: { results: CandleViewResult[]; market: Market }) {
  const currency = market === "india" ? "₹" : "$";
  const entryTime = "Latest completed 15m candle";
  const exitTime = "Target, stop, or session close";
  const formatPrice = (value: number | null | undefined) => value == null
    ? "—"
    : `${currency}${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="table-scroll rounded-xl border border-slate-800/90 bg-[#0b1626] shadow-xl" tabIndex={0} aria-label="Top ten candle momentum stocks">
      <table className="w-full border-collapse text-left text-xs text-slate-300">
        <thead className="border-b border-slate-800 bg-[#070e1a] text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          <tr>
            <th className="px-3 py-3.5 text-center">Rank</th>
            <th className="px-4 py-3.5">Stock</th>
            <th className="px-3 py-3.5 text-center">Signal</th>
            <th className="px-3 py-3.5 text-right">CMP</th>
            <th className="px-3 py-3.5 text-right">Entry Price</th>
            <th className="px-3 py-3.5 text-right">Target Price</th>
            <th className="px-3 py-3.5 text-right">Stop-Loss</th>
            <th className="px-3 py-3.5">Entry Time</th>
            <th className="px-3 py-3.5">Exit Time</th>
            <th className="px-3 py-3.5 text-right">Volume Spike</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60">
          {results.slice(0, 10).map((result, index) => (
            <tr key={`${result.symbol}-${result.sessionDate}`} className="transition-colors hover:bg-[#0e1c30]">
              <td className="px-3 py-3 text-center font-bold text-cyan-300">#{index + 1}</td>
              <td className="px-4 py-3">
                <div className="font-bold text-white">{result.symbol}</div>
                <div className="max-w-[190px] truncate text-[10px] text-slate-500">{result.name}</div>
              </td>
              <td className="px-3 py-3 text-center">
                <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-300">BUY</span>
              </td>
              <td className="px-3 py-3 text-right font-mono font-bold text-white">{formatPrice(result.currentPrice ?? result.close)}</td>
              <td className="px-3 py-3 text-right font-mono font-bold text-amber-300">{formatPrice(result.entryTrigger)}</td>
              <td className="px-3 py-3 text-right font-mono font-bold text-emerald-300">{formatPrice(result.target)}</td>
              <td className="px-3 py-3 text-right font-mono font-bold text-rose-300">{formatPrice(result.stopLoss)}</td>
              <td className="px-3 py-3 text-slate-300">{entryTime}</td>
              <td className="px-3 py-3 text-amber-200">{exitTime}</td>
              <td className="px-3 py-3 text-right font-mono font-bold text-cyan-300">{result.volumeMultiple.toFixed(2)}×</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CandleStrategyAlert({ result }: { result: CandleViewResult }) {
  const symbol = result.currency === "INR" ? "₹" : "$";
  const signalStyle = result.signalBias === "BUY"
    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
    : "border-amber-500/40 bg-amber-500/10 text-amber-300";
  const price = (value: number | null) => value == null ? "—" : `${symbol}${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const checks = [
    ["Price", result.passed.price], ["Liquidity", result.passed.liquidity], ["Directional Candle", result.passed.pattern],
    ["3-Bar Break", result.passed.breakout], ["VWAP", result.passed.vwap], ["EMA 9/20", result.passed.trend],
    ["2× Volume", result.passed.volume], ["Wick ≤40%", result.passed.wick], ["Fresh ≤30m", result.passed.freshness],
  ] as const;

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-700 bg-[#0b1626] shadow-xl">
      <div className="flex flex-col gap-3 border-b border-slate-800 bg-[#07111f] p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-bold text-white">🚨 STRATEGY ALERT: {result.symbol}</h3>
          <p className="mt-1 text-xs text-slate-400">{result.name} • {result.sessionDate} • {result.candleWindow}</p>
        </div>
        <span className={`w-fit rounded-lg border px-4 py-2 text-sm font-black ${signalStyle}`}>{result.signalBias}</span>
      </div>
      <div className="space-y-5 p-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Pattern Match</p>
          <p className="mt-1 text-sm font-semibold text-white">{result.patternMatch}</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-9">
          {checks.map(([label, passed]) => (
            <div key={label} className={`rounded-lg border p-2.5 text-center text-xs font-bold ${passed ? "border-emerald-500/25 bg-emerald-500/5 text-emerald-300" : "border-rose-500/25 bg-rose-500/5 text-rose-300"}`}>
              {passed ? "✓" : "✕"} {label}
            </div>
          ))}
        </div>
        <div>
          <h4 className="mb-3 text-sm font-bold text-cyan-300">📊 Trade Parameters</h4>
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard label="Entry Trigger Price" value={price(result.entryTrigger)} note="Break of 15-min high/low" />
            <MetricCard label="Profit Target Price" value={price(result.target)} note="Entry + 10% expected day gain" />
            <MetricCard label="Stop-Loss Price" value={price(result.stopLoss)} note="Signal-candle invalidation" />
          </div>
        </div>
        <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="O / H / L / C" value={`${price(result.open)} / ${price(result.high)} / ${price(result.low)} / ${price(result.close)}`} />
          <MetricCard label="Signal-Candle Volume" value={result.firstCandleVolume.toLocaleString("en-IN")} note={`${result.volumeMultiple.toFixed(2)}× 10-day same-period average`} />
          <MetricCard label="Average Daily Volume" value={result.averageDailyVolume.toLocaleString("en-IN")} note="Prior 10 sessions" />
          <MetricCard label="VWAP / EMA 9 / EMA 20" value={`${price(result.vwap)} / ${price(result.ema9)} / ${price(result.ema20)}`} note={`Shadows: ${result.wickPercent.toFixed(2)}% (max 40%)`} />
        </div>
        {result.rejectionReasons.length > 0 && (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4">
            <p className="text-xs font-bold text-rose-300">NO TRADE — Failed validation</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-rose-200/80">
              {result.rejectionReasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          </div>
        )}
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs leading-relaxed text-amber-200/90">
          <strong>⚠️ Active Guardrail Note:</strong> {result.guardrailNote}
        </div>
      </div>
    </article>
  );
}

function MetricCard({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="rounded-xl border border-slate-800 bg-[#07111f] p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p><p className="mt-1 break-words font-mono text-sm font-bold text-white">{value}</p>{note && <p className="mt-1 text-[10px] text-slate-500">{note}</p>}</div>;
}

function GlossaryItem({ term, description }: { term: string; description: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-[#07111f] p-3">
      <h3 className="mb-1 font-bold text-cyan-300">{term}</h3>
      <p className="text-slate-400">{description}</p>
    </div>
  );
}

// Single-Row Table Component for Watchlist
function WatchlistSingleRowTable({
  holdings,
  onRemove,
  currencySymbol,
}: {
  holdings: WatchlistRecommendation[];
  onRemove: (symbol: string) => void;
  currencySymbol: string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800/90 bg-[#0b1626] shadow-xl">
      <table className="w-full text-left text-xs text-slate-300 border-collapse">
        <thead className="bg-[#070e1a] text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
          <tr>
            <th className="py-3.5 px-4">Symbol & Name</th>
            <th className="py-3.5 px-3 text-right">CMP ({currencySymbol})</th>
            <th className="py-3.5 px-3 text-right">Day Change</th>
            <th className="py-3.5 px-3">Data Status</th>
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
                  {currencySymbol}{item.price ? item.price.toLocaleString("en-IN", { maximumFractionDigits: 1 }) : "—"}
                </td>

                <td className={`py-3 px-3 text-right font-semibold font-mono ${isPos ? "text-emerald-400" : "text-rose-400"}`}>
                  {isPos ? "+" : ""}
                  {item.changePercent ? item.changePercent.toFixed(1) : "0.0"}%
                </td>

                <td className="py-3 px-3 text-slate-400">{item.notes}</td>

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
function HistorySingleRowTable({ records, currencySymbol }: { records: HistoryRecord[]; currencySymbol: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800/90 bg-[#0b1626] shadow-xl">
      <table className="w-full text-left text-xs text-slate-300 border-collapse">
        <thead className="bg-[#070e1a] text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
          <tr>
            <th className="py-3.5 px-4">Date</th>
            <th className="py-3.5 px-4">Recommended Stock Name</th>
            <th className="py-3.5 px-3 text-center">Term Type</th>
            <th className="py-3.5 px-3 text-right">Recommended CMP ({currencySymbol})</th>
            <th className="py-3.5 px-3 text-right">Target ({currencySymbol})</th>
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
                  {currencySymbol}{r.cmp ? r.cmp.toLocaleString("en-IN", { maximumFractionDigits: 1 }) : "—"}
                </td>

                <td className="py-3 px-3 text-right font-bold text-cyan-300 font-mono">
                  {currencySymbol}{r.target ? r.target.toLocaleString("en-IN", { maximumFractionDigits: 1 }) : "—"}
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
