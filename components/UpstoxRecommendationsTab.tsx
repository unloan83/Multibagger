"use client";

import { useEffect, useState, useCallback } from "react";
import {
  IntradayPaperTrade,
  DailySummary,
  SystemStatus,
} from "@/lib/intraday-paper-engine";

export type UpstoxRec = {
  id: string;
  symbol: string;
  name: string;
  instrumentKey: string;
  cmp: number;
  target: number;
  stopLoss: number;
  signal: "BUY" | "SELL";
  score: number;
  executionMode: "AUTOMATIC" | "USER_DRIVEN";
  status: "PENDING" | "BUY_EXECUTED" | "SELL_EXECUTED" | "SKIPPED" | "TELEGRAM_SENT";
  orderId?: string | null;
  remark: string;
  timestamp: string;
};

export default function UpstoxRecommendationsTab() {
  const [recommendations, setRecommendations] = useState<UpstoxRec[]>([]);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [todayTrades, setTodayTrades] = useState<IntradayPaperTrade[]>([]);
  const [allTrades, setAllTrades] = useState<IntradayPaperTrade[]>([]);
  const [dailySummaries, setDailySummaries] = useState<DailySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [telegramConfigured, setTelegramConfigured] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Filters for History Table
  const [filterDate, setFilterDate] = useState<string>("all");
  const [filterStock, setFilterStock] = useState<string>("");
  const [filterTargetHit, setFilterTargetHit] = useState<string>("all");
  const [filterPnl, setFilterPnl] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<"newest" | "chronological">("newest");

  // Timer tick for 5-min countdown
  const [currentTime, setCurrentTime] = useState<number>(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchAllData = useCallback(() => {
    // 1. Fetch Upstox recommendations & mode state
    const p1 = fetch("/api/upstox/recommendations", { cache: "no-store" }).then((res) => res.json());
    // 2. Fetch paper engine trades & history
    const p2 = fetch("/api/intraday/paper-trades", { cache: "no-store" }).then((res) => res.json());

    Promise.all([p1, p2])
      .then(([recData, paperData]) => {
        if (recData.ok && recData.data?.recommendations) {
          setRecommendations(recData.data.recommendations);
          setTelegramConfigured(Boolean(recData.telegramConfigured));
        }
        if (paperData.ok) {
          setSystemStatus(paperData.systemStatus);
          setTodayTrades(paperData.todayTrades || []);
          setAllTrades(paperData.allTrades || []);
          setDailySummaries(paperData.dailySummaries || []);
        }
        setLoading(false);
      })
      .catch((err: unknown) => {
        const errorMsg = err instanceof Error ? err.message : "Failed to load data.";
        setError(errorMsg);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchAllData();
    const interval = setInterval(fetchAllData, 10_000); // 10s auto refresh
    return () => clearInterval(interval);
  }, [fetchAllData]);

  const handleModeChange = async (id: string, newMode: "AUTOMATIC" | "USER_DRIVEN") => {
    setActionLoading(id);
    setMsg("");
    setError("");
    try {
      const res = await fetch("/api/upstox/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_mode", id, mode: newMode }),
      });
      const data = await res.json();
      if (data.ok && data.data?.recommendations) {
        setRecommendations(data.data.recommendations);
        setMsg(data.message || `Updated mode to ${newMode}`);
      } else {
        setError(data.error || "Failed to update mode.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error updating mode.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleSendTelegram = async (id: string) => {
    setActionLoading(id);
    setMsg("");
    setError("");
    try {
      const res = await fetch("/api/upstox/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send_telegram", id }),
      });
      const data = await res.json();
      if (data.ok && data.data?.recommendations) {
        setRecommendations(data.data.recommendations);
        setMsg(data.message || "Telegram interactive alert sent!");
      } else {
        setError(data.error || "Failed to send Telegram alert.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error sending Telegram alert.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleActionDecision = async (id: string, decision: "BUY" | "SELL" | "SKIP", isAuto = false) => {
    setActionLoading(id);
    setMsg("");
    setError("");
    try {
      const actionType = isAuto ? "execute_auto" : "manual_action";
      const res = await fetch("/api/upstox/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: actionType, id, decision }),
      });
      const data = await res.json();
      if (data.ok && data.data?.recommendations) {
        setRecommendations(data.data.recommendations);
        setMsg(data.message || `Trade ${decision} processed successfully.`);
        fetchAllData(); // Refresh paper trade ledger
      } else {
        setError(data.error || "Failed to process trade action.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error processing trade action.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleManualTradeClose = async (tradeId: string, decision: "TARGET" | "STOP" | "MANUAL") => {
    setActionLoading(tradeId);
    try {
      const res = await fetch("/api/intraday/paper-trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "execute_manual", tradeId, decision }),
      });
      const data = await res.json();
      if (data.ok) {
        setSystemStatus(data.systemStatus);
        setTodayTrades(data.todayTrades || []);
        setAllTrades(data.allTrades || []);
        setDailySummaries(data.dailySummaries || []);
      }
    } catch {} finally {
      setActionLoading(null);
    }
  };

  const calculateTimeRemaining = (timestamp: string): { text: string; isExpired: boolean } => {
    const start = new Date(timestamp).getTime();
    const elapsedSeconds = Math.floor((currentTime - start) / 1000);
    const totalSeconds = 5 * 60; // 5 minutes
    const remaining = totalSeconds - elapsedSeconds;

    if (remaining <= 0) {
      return { text: "00:00 (Auto-Executing...)", isExpired: true };
    }

    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    return { text: `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")} remaining`, isExpired: false };
  };

  const sortedTodayTrades = [...todayTrades].sort((a, b) => {
    if (sortOrder === "newest") return b.entryTime.localeCompare(a.entryTime);
    return a.entryTime.localeCompare(b.entryTime);
  });

  const uniqueDates = Array.from(new Set(allTrades.map((t) => t.date))).sort().reverse();

  const filteredHistoryTrades = allTrades.filter((t) => {
    if (filterDate !== "all" && t.date !== filterDate) return false;
    if (filterStock.trim() && !t.symbol.toLowerCase().includes(filterStock.trim().toLowerCase())) return false;
    if (filterTargetHit !== "all" && t.targetHit !== filterTargetHit) return false;
    if (filterPnl === "win" && t.pnlRupees <= 0) return false;
    if (filterPnl === "loss" && t.pnlRupees >= 0) return false;
    return true;
  });

  return (
    <div className="space-y-8">
      {/* 1. Header Banner & Mode Schedule */}
      <div className="rounded-2xl border border-purple-500/30 bg-gradient-to-r from-[#120826] via-[#1a0b36] to-[#0f172a] p-5 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xl">🚀</span>
              <h2 className="text-lg font-bold text-purple-200">Upstox Recommendations & Paper Trading</h2>
              <span className="rounded-full bg-purple-500/20 px-2.5 py-0.5 text-xs font-semibold text-purple-300 border border-purple-500/30">
                PAPER TRADING ONLY
              </span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Mon, Tue, Wed = <strong className="text-cyan-300">AUTOMATIC Systems Driven</strong> | Thu, Fri = <strong className="text-amber-300">USER DRIVEN</strong>. If no action is taken within <strong className="text-rose-300">5 minutes</strong>, system auto-executes.
            </p>
            <div className="pt-1 flex flex-wrap gap-2 text-[11px]">
              <span className="rounded bg-slate-900/80 px-2 py-0.5 font-medium text-cyan-300 border border-cyan-500/20">
                CMP: ₹150 - ₹3,000
              </span>
              <span className="rounded bg-slate-900/80 px-2 py-0.5 font-medium text-emerald-300 border border-emerald-500/20">
                Target Upside: &gt;10% Day Surge
              </span>
              <span className="rounded bg-slate-900/80 px-2 py-0.5 font-medium text-purple-300 border border-purple-500/20">
                RVOL Spike: &ge; 2.5x
              </span>
              <span className="rounded bg-slate-900/80 px-2 py-0.5 font-medium text-amber-300 border border-amber-500/20">
                Auto-Timer: 5 Mins
              </span>
            </div>
          </div>

          <div className="shrink-0 flex flex-col items-end gap-1.5 text-right">
            <div className="text-xs text-emerald-400 font-semibold flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
              Upstox Sandbox Connected
            </div>
            <div className="text-[11px] text-slate-400">
              Telegram Bot: {telegramConfigured ? <span className="text-cyan-400 font-semibold">Active ✓ (Connected)</span> : <span className="text-amber-400">Not Connected</span>}
            </div>
          </div>
        </div>
      </div>

      {msg && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/40 p-3.5 text-xs text-emerald-300 flex items-center justify-between shadow-md">
          <span>✅ {msg}</span>
          <button onClick={() => setMsg("")} className="text-slate-400 hover:text-white">Dismiss</button>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-800 bg-rose-950/40 p-3.5 text-xs text-rose-300 flex items-center justify-between shadow-md">
          <span>⚠️ {error}</span>
          <button onClick={() => setError("")} className="text-slate-400 hover:text-white">Dismiss</button>
        </div>
      )}

      {/* 2. System Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        <div className="rounded-xl border border-slate-800 bg-[#091526] p-4 shadow-lg">
          <div className="text-[11px] font-medium text-slate-400">Starting Capital</div>
          <div className="mt-1 text-lg font-bold text-white">
            ₹{systemStatus?.startingCapital?.toLocaleString("en-IN") || "30,000"}
          </div>
          <div className="mt-0.5 text-[10px] text-slate-500">Daily allocation</div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#091526] p-4 shadow-lg">
          <div className="text-[11px] font-medium text-slate-400">Daily Target Cap</div>
          <div className="mt-1 text-lg font-bold text-amber-300">
            ₹{systemStatus?.dailyProfitTarget?.toLocaleString("en-IN") || "3,000"}
          </div>
          <div className="mt-0.5 text-[10px] text-amber-500/80">Target lock threshold</div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#091526] p-4 shadow-lg">
          <div className="text-[11px] font-medium text-slate-400">Current Daily P&L</div>
          <div className={`mt-1 text-lg font-bold ${
            (systemStatus?.currentDailyPnl || 0) >= 0 ? "text-emerald-400" : "text-rose-400"
          }`}>
            {(systemStatus?.currentDailyPnl || 0) >= 0 ? "+" : ""}
            ₹{(systemStatus?.currentDailyPnl || 0).toLocaleString("en-IN")}
          </div>
          <div className="mt-0.5 text-[10px] text-slate-500">Realized cumulative P&L</div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#091526] p-4 shadow-lg">
          <div className="text-[11px] font-medium text-slate-400">Open Trades</div>
          <div className="mt-1 text-lg font-bold text-cyan-300">
            {systemStatus?.openTradesCount ?? 0}
          </div>
          <div className="mt-0.5 text-[10px] text-slate-500">Active monitoring</div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#091526] p-4 shadow-lg">
          <div className="text-[11px] font-medium text-slate-400">Completed Trades</div>
          <div className="mt-1 text-lg font-bold text-indigo-300">
            {systemStatus?.completedTradesCount ?? 0}
          </div>
          <div className="mt-0.5 text-[10px] text-slate-500">Closed today</div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#091526] p-4 shadow-lg">
          <div className="text-[11px] font-medium text-slate-400">Trading Status</div>
          <div className="mt-1">
            {systemStatus?.tradingStatus === "TARGET ACHIEVED" ? (
              <span className="inline-block rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-bold text-emerald-300 border border-emerald-500/30">
                🎯 TARGET ACHIEVED
              </span>
            ) : systemStatus?.tradingStatus === "CAPITAL EXHAUSTED" ? (
              <span className="inline-block rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-bold text-amber-300 border border-amber-500/30">
                ⚠️ CAPITAL LIMIT
              </span>
            ) : (
              <span className="inline-block rounded-full bg-cyan-500/20 px-2.5 py-0.5 text-xs font-bold text-cyan-300 border border-cyan-500/30 animate-pulse">
                ⚡ ACTIVE MONITORING
              </span>
            )}
          </div>
          <div className="mt-1 text-[10px] text-slate-400">
            Mode: <strong className="text-white">{systemStatus?.tradingMode}</strong> ({systemStatus?.dayName})
          </div>
        </div>
      </div>

      {/* 3. Upstox Recommendations List (Simple Tabular Format - Rationale Skipped) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span>📈</span> Shortlisted Recommendations
            </h3>
            <p className="text-xs text-slate-400">Filtered candidates with target upside &gt;10% and RVOL &ge;2.5x spike.</p>
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center text-xs text-slate-400">Loading recommendations...</div>
        ) : recommendations.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-400">No shortlisted recommendations available at this time.</div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-[#091526] shadow-xl">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#060e1a] text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
                <tr>
                  <th className="px-4 py-3.5 font-bold">Stock</th>
                  <th className="px-4 py-3.5 font-bold text-right">CMP (₹)</th>
                  <th className="px-4 py-3.5 font-bold text-right">Signal & Target</th>
                  <th className="px-4 py-3.5 font-bold text-right">Stop Loss</th>
                  <th className="px-4 py-3.5 font-bold text-center">Score</th>
                  <th className="px-4 py-3.5 font-bold text-center">Execution Mode Option</th>
                  <th className="px-4 py-3.5 font-bold text-center">5-Min Timer / Status</th>
                  <th className="px-4 py-3.5 font-bold text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 font-medium">
                {recommendations.map((rec) => {
                  const isPending = rec.status === "PENDING" || rec.status === "TELEGRAM_SENT";
                  const isBuyExecuted = rec.status === "BUY_EXECUTED";
                  const isSellExecuted = rec.status === "SELL_EXECUTED";
                  const isAuto = rec.executionMode === "AUTOMATIC";
                  const timer = calculateTimeRemaining(rec.timestamp);

                  return (
                    <tr key={rec.id} className="hover:bg-slate-800/40 transition">
                      <td className="px-4 py-3.5">
                        <div className="font-bold text-white text-sm">{rec.symbol}</div>
                        <div className="text-[11px] text-slate-400 font-mono">{rec.instrumentKey}</div>
                      </td>

                      <td className="px-4 py-3.5 text-right font-bold text-slate-200">
                        ₹{rec.cmp.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>

                      <td className="px-4 py-3.5 text-right">
                        <span className="inline-block rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-400 border border-emerald-500/20 mr-1.5">
                          {rec.signal}
                        </span>
                        <span className="font-bold text-emerald-300">
                          ₹{rec.target.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </span>
                      </td>

                      <td className="px-4 py-3.5 text-right font-bold text-rose-400">
                        ₹{rec.stopLoss.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>

                      <td className="px-4 py-3.5 text-center">
                        <span className="rounded-full bg-purple-500/10 px-2.5 py-1 text-xs font-bold text-purple-300 border border-purple-500/20">
                          {rec.score}/100
                        </span>
                      </td>

                      <td className="px-4 py-3.5 text-center">
                        <div className="inline-flex rounded-lg border border-slate-800 bg-[#060e1a] p-1">
                          <button
                            onClick={() => handleModeChange(rec.id, "AUTOMATIC")}
                            disabled={actionLoading === rec.id}
                            className={`px-2.5 py-1 rounded text-[11px] font-bold transition ${
                              rec.executionMode === "AUTOMATIC"
                                ? "bg-cyan-500 text-slate-950 shadow"
                                : "text-slate-400 hover:text-white"
                            }`}
                          >
                            🤖 Automatic
                          </button>
                          <button
                            onClick={() => handleModeChange(rec.id, "USER_DRIVEN")}
                            disabled={actionLoading === rec.id}
                            className={`px-2.5 py-1 rounded text-[11px] font-bold transition ${
                              rec.executionMode === "USER_DRIVEN"
                                ? "bg-amber-500 text-slate-950 shadow"
                                : "text-slate-400 hover:text-white"
                            }`}
                          >
                            👤 User Driven
                          </button>
                        </div>
                      </td>

                      <td className="px-4 py-3.5 text-center">
                        {isPending ? (
                          <div className="space-y-1">
                            <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                              timer.isExpired ? "bg-rose-500/20 text-rose-300 animate-pulse" : "bg-amber-500/20 text-amber-300"
                            }`}>
                              ⏳ {timer.text}
                            </span>
                            <div className="text-[10px] text-slate-400">
                              {rec.status === "TELEGRAM_SENT" ? "Telegram Sent" : "Pending Action"}
                            </div>
                          </div>
                        ) : isBuyExecuted ? (
                          <span className="rounded-full bg-emerald-500/20 px-2.5 py-1 text-[11px] font-bold text-emerald-300 border border-emerald-500/30">
                            ✓ BUY EXECUTED
                          </span>
                        ) : isSellExecuted ? (
                          <span className="rounded-full bg-rose-500/20 px-2.5 py-1 text-[11px] font-bold text-rose-300 border border-rose-500/30">
                            ✓ SELL EXECUTED
                          </span>
                        ) : (
                          <span className="rounded-full bg-slate-800 px-2.5 py-1 text-[11px] font-bold text-slate-400">
                            ⏭️ SKIPPED
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3.5 text-center">
                        {isPending ? (
                          isAuto ? (
                            <button
                              onClick={() => handleActionDecision(rec.id, rec.signal, true)}
                              disabled={actionLoading === rec.id}
                              className="rounded-lg bg-cyan-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-cyan-500 transition disabled:opacity-50"
                            >
                              {actionLoading === rec.id ? "Executing..." : "🤖 Auto Execute"}
                            </button>
                          ) : (
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => handleSendTelegram(rec.id)}
                                disabled={actionLoading === rec.id}
                                title="Send interactive Telegram alert"
                                className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-bold text-cyan-300 hover:bg-cyan-500/20 hover:text-white transition disabled:opacity-50"
                              >
                                📱 Alert
                              </button>
                              <button
                                onClick={() => handleActionDecision(rec.id, "BUY")}
                                disabled={actionLoading === rec.id}
                                className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-500 transition disabled:opacity-50"
                              >
                                🛒 Buy
                              </button>
                              <button
                                onClick={() => handleActionDecision(rec.id, "SELL")}
                                disabled={actionLoading === rec.id}
                                className="rounded-lg bg-rose-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-rose-500 transition disabled:opacity-50"
                              >
                                🔻 Sell
                              </button>
                              <button
                                onClick={() => handleActionDecision(rec.id, "SKIP")}
                                disabled={actionLoading === rec.id}
                                className="rounded-lg bg-slate-800 px-2 py-1 text-[11px] font-bold text-slate-300 hover:bg-slate-700 transition disabled:opacity-50"
                              >
                                Skip
                              </button>
                            </div>
                          )
                        ) : (
                          <span className="text-[11px] text-slate-400 font-mono">
                            {rec.orderId || "Completed"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 4. TODAY'S TRADES TABLE */}
      <div className="space-y-3 pt-4 border-t border-slate-800">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span>📋</span> Today&apos;s Trades
            </h3>
            <p className="text-xs text-slate-400">Live paper trades executed today with automatic target and stop loss tracking.</p>
          </div>

          <div className="flex items-center gap-2 bg-[#060e1a] p-1 rounded-lg border border-slate-800 text-xs font-medium">
            <span className="text-slate-400 px-2">Sort:</span>
            <button
              onClick={() => setSortOrder("newest")}
              className={`px-2.5 py-0.5 rounded ${sortOrder === "newest" ? "bg-amber-500 text-slate-950 font-bold" : "text-slate-400"}`}
            >
              Newest First
            </button>
            <button
              onClick={() => setSortOrder("chronological")}
              className={`px-2.5 py-0.5 rounded ${sortOrder === "chronological" ? "bg-amber-500 text-slate-950 font-bold" : "text-slate-400"}`}
            >
              Chronological
            </button>
          </div>
        </div>

        {sortedTodayTrades.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-[#091526] p-8 text-center text-xs text-slate-400">
            No paper trades executed today yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-[#091526] shadow-xl">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#060e1a] text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
                <tr>
                  <th className="px-4 py-3.5 font-bold">Time</th>
                  <th className="px-4 py-3.5 font-bold">Stock</th>
                  <th className="px-4 py-3.5 font-bold text-center">Buy/Sell</th>
                  <th className="px-4 py-3.5 font-bold text-right">Entry</th>
                  <th className="px-4 py-3.5 font-bold text-right">Qty</th>
                  <th className="px-4 py-3.5 font-bold text-right">Target</th>
                  <th className="px-4 py-3.5 font-bold text-right">Stop Loss</th>
                  <th className="px-4 py-3.5 font-bold text-right">Current/Exit</th>
                  <th className="px-4 py-3.5 font-bold text-center">Status</th>
                  <th className="px-4 py-3.5 font-bold text-right">P&L (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 font-medium">
                {sortedTodayTrades.map((t) => {
                  const isOpen = t.status === "OPEN";
                  const isTarget = t.status === "TARGET HIT";
                  const isStop = t.status === "STOP LOSS HIT";

                  return (
                    <tr key={t.id} className="hover:bg-slate-800/40 transition">
                      <td className="px-4 py-3.5 font-mono text-slate-300">
                        {t.entryTime}
                        {t.exitTime && <div className="text-[10px] text-slate-500">Exit: {t.exitTime}</div>}
                      </td>

                      <td className="px-4 py-3.5">
                        <div className="font-bold text-white">{t.symbol}</div>
                        <div className="text-[10px] text-slate-500 font-mono">{t.id}</div>
                      </td>

                      <td className="px-4 py-3.5 text-center">
                        <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-bold ${
                          t.action === "BUY" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                        }`}>
                          {t.action}
                        </span>
                      </td>

                      <td className="px-4 py-3.5 text-right font-bold text-slate-200">
                        ₹{t.entryPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>

                      <td className="px-4 py-3.5 text-right font-mono text-slate-300">
                        {t.quantity}
                      </td>

                      <td className="px-4 py-3.5 text-right font-bold text-emerald-300">
                        ₹{t.targetPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>

                      <td className="px-4 py-3.5 text-right font-bold text-rose-400">
                        ₹{t.stopLossPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>

                      <td className="px-4 py-3.5 text-right font-bold text-slate-200">
                        ₹{(t.exitPrice || t.currentPrice).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>

                      <td className="px-4 py-3.5 text-center">
                        {isOpen ? (
                          <div className="flex items-center justify-center gap-1">
                            <span className="rounded-full bg-cyan-500/20 px-2.5 py-0.5 text-[11px] font-bold text-cyan-300 border border-cyan-500/30 animate-pulse">
                              OPEN
                            </span>
                            <button
                              onClick={() => handleManualTradeClose(t.id, "TARGET")}
                              disabled={actionLoading === t.id}
                              title="Simulate Target Hit"
                              className="text-[10px] bg-emerald-950 text-emerald-400 hover:bg-emerald-800 px-1.5 py-0.5 rounded border border-emerald-700"
                            >
                              +Hit
                            </button>
                            <button
                              onClick={() => handleManualTradeClose(t.id, "STOP")}
                              disabled={actionLoading === t.id}
                              title="Simulate Stop Loss Hit"
                              className="text-[10px] bg-rose-950 text-rose-400 hover:bg-rose-800 px-1.5 py-0.5 rounded border border-rose-700"
                            >
                              -Stop
                            </button>
                          </div>
                        ) : isTarget ? (
                          <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300 border border-emerald-500/30">
                            ✓ TARGET HIT
                          </span>
                        ) : isStop ? (
                          <span className="rounded-full bg-rose-500/20 px-2.5 py-0.5 text-[11px] font-bold text-rose-300 border border-rose-500/30">
                            ❌ STOP LOSS HIT
                          </span>
                        ) : (
                          <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-[11px] font-bold text-slate-300">
                            {t.status}
                          </span>
                        )}
                      </td>

                      <td className={`px-4 py-3.5 text-right font-bold ${
                        t.pnlRupees > 0 ? "text-emerald-400" : t.pnlRupees < 0 ? "text-rose-400" : "text-slate-400"
                      }`}>
                        {t.pnlRupees > 0 ? "+" : ""}
                        ₹{t.pnlRupees.toLocaleString("en-IN")}
                        <div className="text-[10px] opacity-80">{t.pnlPercent}%</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 5. PERMANENT HISTORICAL TRADE TABLE (EVIDENCE LEDGER) */}
      <div className="space-y-4 pt-6 border-t border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-emerald-300 flex items-center gap-2">
              <span>📜</span> Permanent Trade History Ledger
            </h3>
            <p className="text-xs text-slate-400">Directly tracks whether recommended targets and stop losses were achieved.</p>
          </div>

          <div className="text-xs text-emerald-400 font-bold bg-emerald-950/60 border border-emerald-500/30 px-3 py-1.5 rounded-lg">
            Target Hit Rate: {allTrades.length > 0 ? `${Math.round((allTrades.filter(t => t.targetHit === "YES").length / allTrades.length) * 100)}%` : "0%"}
          </div>
        </div>

        {/* Filters Bar */}
        <div className="rounded-xl border border-slate-800 bg-[#060e1a] p-3.5 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Filter Date</label>
              <select
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-[#091526] px-3 py-1 text-white"
              >
                <option value="all">All Dates ({uniqueDates.length})</option>
                {uniqueDates.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Stock Search</label>
              <input
                type="text"
                placeholder="Search symbol..."
                value={filterStock}
                onChange={(e) => setFilterStock(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-[#091526] px-3 py-1 text-white placeholder:text-slate-600"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Target Hit</label>
              <select
                value={filterTargetHit}
                onChange={(e) => setFilterTargetHit(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-[#091526] px-3 py-1 text-white"
              >
                <option value="all">All Signals</option>
                <option value="YES">Target Hit: YES ✓</option>
                <option value="NO">Target Hit: NO ❌</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Profit / Loss</label>
              <select
                value={filterPnl}
                onChange={(e) => setFilterPnl(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-[#091526] px-3 py-1 text-white"
              >
                <option value="all">All Outcomes</option>
                <option value="win">Wins</option>
                <option value="loss">Losses</option>
              </select>
            </div>
          </div>
        </div>

        {filteredHistoryTrades.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-[#091526] p-6 text-center text-xs text-slate-400">
            No historical records match current filters.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-[#091526] shadow-xl">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#060e1a] text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
                <tr>
                  <th className="px-3.5 py-3 font-bold">Date & Time</th>
                  <th className="px-3.5 py-3 font-bold">Stock</th>
                  <th className="px-3.5 py-3 font-bold text-center">Buy/Sell</th>
                  <th className="px-3.5 py-3 font-bold text-right">Entry</th>
                  <th className="px-3.5 py-3 font-bold text-right">Qty</th>
                  <th className="px-3.5 py-3 font-bold text-right">Capital</th>
                  <th className="px-3.5 py-3 font-bold text-right">Target</th>
                  <th className="px-3.5 py-3 font-bold text-right">Stop Loss</th>
                  <th className="px-3.5 py-3 font-bold text-right">Exit Price</th>
                  <th className="px-3.5 py-3 font-bold text-center">Target Hit</th>
                  <th className="px-3.5 py-3 font-bold text-center">Stop Loss Hit</th>
                  <th className="px-3.5 py-3 font-bold text-center">Exit Reason</th>
                  <th className="px-3.5 py-3 font-bold text-right">P&L (₹)</th>
                  <th className="px-3.5 py-3 font-bold text-right">Cumulative P&L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 font-medium">
                {filteredHistoryTrades.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-800/40 transition">
                    <td className="px-3.5 py-3 font-mono text-slate-300 whitespace-nowrap">
                      <div>{t.date}</div>
                      <div className="text-[10px] text-slate-500">{t.entryTime} {t.exitTime ? `→ ${t.exitTime}` : ""}</div>
                    </td>

                    <td className="px-3.5 py-3">
                      <div className="font-bold text-white">{t.symbol}</div>
                      <div className="text-[10px] text-slate-500 font-mono">{t.id}</div>
                    </td>

                    <td className="px-3.5 py-3 text-center">
                      <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-bold ${
                        t.action === "BUY" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                      }`}>
                        {t.action}
                      </span>
                    </td>

                    <td className="px-3.5 py-3 text-right font-bold text-slate-200">
                      ₹{t.entryPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>

                    <td className="px-3.5 py-3 text-right font-mono text-slate-300">
                      {t.quantity}
                    </td>

                    <td className="px-3.5 py-3 text-right font-mono text-slate-300">
                      ₹{t.capitalUsed.toLocaleString("en-IN")}
                    </td>

                    <td className="px-3.5 py-3 text-right font-bold text-emerald-300">
                      ₹{t.targetPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>

                    <td className="px-3.5 py-3 text-right font-bold text-rose-400">
                      ₹{t.stopLossPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>

                    <td className="px-3.5 py-3 text-right font-bold text-slate-200">
                      {t.exitPrice ? `₹${t.exitPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "—"}
                    </td>

                    <td className="px-3.5 py-3 text-center font-bold">
                      {t.targetHit === "YES" ? (
                        <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] text-emerald-300 border border-emerald-500/30">
                          YES ✓
                        </span>
                      ) : (
                        <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">
                          NO
                        </span>
                      )}
                    </td>

                    <td className="px-3.5 py-3 text-center font-bold">
                      {t.stopLossHit === "YES" ? (
                        <span className="rounded bg-rose-500/20 px-2 py-0.5 text-[11px] text-rose-300 border border-rose-500/30">
                          YES ❌
                        </span>
                      ) : (
                        <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">
                          NO
                        </span>
                      )}
                    </td>

                    <td className="px-3.5 py-3 text-center">
                      <span className="text-[11px] font-semibold text-slate-300">
                        {t.exitReason}
                      </span>
                    </td>

                    <td className={`px-3.5 py-3 text-right font-bold ${
                      t.pnlRupees > 0 ? "text-emerald-400" : t.pnlRupees < 0 ? "text-rose-400" : "text-slate-400"
                    }`}>
                      {t.pnlRupees > 0 ? "+" : ""}
                      ₹{t.pnlRupees.toLocaleString("en-IN")}
                      <div className="text-[10px] opacity-80">{t.pnlPercent}%</div>
                    </td>

                    <td className={`px-3.5 py-3 text-right font-bold ${
                      t.cumulativeDailyPnl >= 0 ? "text-emerald-300" : "text-rose-300"
                    }`}>
                      ₹{t.cumulativeDailyPnl.toLocaleString("en-IN")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 6. DAILY PERFORMANCE HISTORY SUMMARY TABLE */}
      <div className="space-y-3 pt-4 border-t border-slate-800">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <span>📅</span> Daily Performance History Summaries
          </h3>
          <p className="text-xs text-slate-400">Mon, Tue, Wed evidence collection summary.</p>
        </div>

        {dailySummaries.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-[#091526] p-6 text-center text-xs text-slate-400">
            No daily summary history recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-[#091526]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#060e1a] text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
                <tr>
                  <th className="px-4 py-3 font-bold">Date</th>
                  <th className="px-4 py-3 font-bold text-center">Total Trades</th>
                  <th className="px-4 py-3 font-bold text-center">Targets Hit</th>
                  <th className="px-4 py-3 font-bold text-center">Stop Loss Hit</th>
                  <th className="px-4 py-3 font-bold text-center">Other Exits</th>
                  <th className="px-4 py-3 font-bold text-center">Wins</th>
                  <th className="px-4 py-3 font-bold text-center">Losses</th>
                  <th className="px-4 py-3 font-bold text-right">Daily P&L</th>
                  <th className="px-4 py-3 font-bold text-center">₹3,000 Target Achieved</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 font-medium">
                {dailySummaries.map((s) => (
                  <tr key={s.date} className="hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-bold text-white">{s.date}</td>
                    <td className="px-4 py-3 text-center text-slate-200">{s.trades}</td>
                    <td className="px-4 py-3 text-center text-emerald-400 font-bold">{s.targetsHit}</td>
                    <td className="px-4 py-3 text-center text-rose-400 font-bold">{s.stopLossesHit}</td>
                    <td className="px-4 py-3 text-center text-slate-400">{s.otherExits}</td>
                    <td className="px-4 py-3 text-center text-emerald-300 font-bold">{s.wins}</td>
                    <td className="px-4 py-3 text-center text-rose-300 font-bold">{s.losses}</td>
                    <td className={`px-4 py-3 text-right font-bold ${s.dailyPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {s.dailyPnl >= 0 ? "+" : ""}₹{s.dailyPnl.toLocaleString("en-IN")}
                    </td>
                    <td className="px-4 py-3 text-center font-bold">
                      {s.target3kAchieved === "YES" ? (
                        <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs text-emerald-300 border border-emerald-500/30">
                          YES 🎯
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs text-slate-400">
                          NO
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
