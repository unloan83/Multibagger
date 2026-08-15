"use client";

import { useEffect, useState, useCallback } from "react";
import { IntradayPaperTrade, SystemStatus } from "@/features/upstox/lib/intraday-paper-engine";

export default function IntradayPaperSystemTab() {
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [todayTrades, setTodayTrades] = useState<IntradayPaperTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sortOrder, setSortOrder] = useState<"newest" | "chronological">("newest");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchPaperData = useCallback(() => {
    fetch("/api/intraday/paper-trades", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          setSystemStatus(data.systemStatus);
          setTodayTrades(data.todayTrades || []);
        }
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load intraday paper data.");
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchPaperData();
    const interval = setInterval(fetchPaperData, 10_000); // 10s auto-refresh
    return () => clearInterval(interval);
  }, [fetchPaperData]);

  const handleManualClose = async (tradeId: string, decision: "TARGET" | "STOP" | "MANUAL") => {
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
      }
    } catch {} finally {
      setActionLoading(null);
    }
  };

  const sortedTrades = [...todayTrades].sort((a, b) => {
    if (sortOrder === "newest") {
      return b.entryTime.localeCompare(a.entryTime);
    }
    return a.entryTime.localeCompare(b.entryTime);
  });

  return (
    <div className="space-y-6">
      {/* Intraday Summary Header Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        {/* Starting Capital */}
        <div className="rounded-xl border border-slate-800 bg-[#091526] p-4 shadow-lg">
          <div className="text-[11px] font-medium text-slate-400">Starting Capital</div>
          <div className="mt-1 text-lg font-bold text-white">
            ₹{systemStatus?.startingCapital?.toLocaleString("en-IN") || "30,000"}
          </div>
          <div className="mt-0.5 text-[10px] text-slate-500">Daily allocation (no leverage)</div>
        </div>

        {/* Profit Target */}
        <div className="rounded-xl border border-slate-800 bg-[#091526] p-4 shadow-lg">
          <div className="text-[11px] font-medium text-slate-400">Daily Target Cap</div>
          <div className="mt-1 text-lg font-bold text-amber-300">
            ₹{systemStatus?.dailyProfitTarget?.toLocaleString("en-IN") || "3,000"}
          </div>
          <div className="mt-0.5 text-[10px] text-amber-500/80">Target lock threshold</div>
        </div>

        {/* Current Daily P&L */}
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

        {/* Open Trades */}
        <div className="rounded-xl border border-slate-800 bg-[#091526] p-4 shadow-lg">
          <div className="text-[11px] font-medium text-slate-400">Open Trades</div>
          <div className="mt-1 text-lg font-bold text-cyan-300">
            {systemStatus?.openTradesCount ?? 0}
          </div>
          <div className="mt-0.5 text-[10px] text-slate-500">Active monitoring</div>
        </div>

        {/* Completed Trades */}
        <div className="rounded-xl border border-slate-800 bg-[#091526] p-4 shadow-lg">
          <div className="text-[11px] font-medium text-slate-400">Completed Trades</div>
          <div className="mt-1 text-lg font-bold text-indigo-300">
            {systemStatus?.completedTradesCount ?? 0}
          </div>
          <div className="mt-0.5 text-[10px] text-slate-500">Closed today</div>
        </div>

        {/* Trading Status */}
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

      {error && (
        <div className="rounded-xl border border-rose-800 bg-rose-950/40 p-3 text-xs text-rose-300">
          ⚠️ {error}
        </div>
      )}

      {/* Today's Trades Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
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

        {loading ? (
          <div className="py-12 text-center text-xs text-slate-400">Loading today&apos;s paper trades...</div>
        ) : sortedTrades.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-[#091526] p-8 text-center text-xs text-slate-400">
            No paper trades executed today yet. The background scanner will automatically execute qualifying recommendations when setups align.
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
                {sortedTrades.map((t) => {
                  const isOpen = t.status === "OPEN";
                  const isTarget = t.status === "TARGET HIT";
                  const isStop = t.status === "STOP LOSS HIT";

                  return (
                    <tr key={t.id} className="hover:bg-slate-800/40 transition">
                      {/* Time */}
                      <td className="px-4 py-3.5 font-mono text-slate-300">
                        {t.entryTime}
                        {t.exitTime && <div className="text-[10px] text-slate-500">Exit: {t.exitTime}</div>}
                      </td>

                      {/* Stock */}
                      <td className="px-4 py-3.5">
                        <div className="font-bold text-white">{t.symbol}</div>
                        <div className="text-[10px] text-slate-500 font-mono">{t.id}</div>
                      </td>

                      {/* Buy/Sell */}
                      <td className="px-4 py-3.5 text-center">
                        <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-bold ${
                          t.action === "BUY" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                        }`}>
                          {t.action}
                        </span>
                      </td>

                      {/* Entry */}
                      <td className="px-4 py-3.5 text-right font-bold text-slate-200">
                        ₹{t.entryPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>

                      {/* Qty */}
                      <td className="px-4 py-3.5 text-right font-mono text-slate-300">
                        {t.quantity}
                      </td>

                      {/* Target */}
                      <td className="px-4 py-3.5 text-right font-bold text-emerald-300">
                        ₹{t.targetPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>

                      {/* Stop Loss */}
                      <td className="px-4 py-3.5 text-right font-bold text-rose-400">
                        ₹{t.stopLossPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>

                      {/* Current / Exit */}
                      <td className="px-4 py-3.5 text-right font-bold text-slate-200">
                        ₹{(t.exitPrice || t.currentPrice).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5 text-center">
                        {isOpen ? (
                          <div className="flex items-center justify-center gap-1">
                            <span className="rounded-full bg-cyan-500/20 px-2.5 py-0.5 text-[11px] font-bold text-cyan-300 border border-cyan-500/30 animate-pulse">
                              OPEN
                            </span>
                            <button
                              onClick={() => handleManualClose(t.id, "TARGET")}
                              disabled={actionLoading === t.id}
                              title="Simulate Target Hit"
                              className="text-[10px] bg-emerald-950 text-emerald-400 hover:bg-emerald-800 px-1.5 py-0.5 rounded border border-emerald-700"
                            >
                              +Hit
                            </button>
                            <button
                              onClick={() => handleManualClose(t.id, "STOP")}
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

                      {/* P&L */}
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
    </div>
  );
}
