"use client";

import { useEffect, useState, useCallback } from "react";
import { IntradayPaperTrade, DailySummary } from "@/lib/intraday-paper-engine";

export default function TradeHistoryTab() {
  const [allTrades, setAllTrades] = useState<IntradayPaperTrade[]>([]);
  const [dailySummaries, setDailySummaries] = useState<DailySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filters
  const [filterDate, setFilterDate] = useState<string>("all");
  const [filterStock, setFilterStock] = useState<string>("");
  const [filterTargetHit, setFilterTargetHit] = useState<string>("all"); // all, YES, NO
  const [filterPnl, setFilterPnl] = useState<string>("all"); // all, win, loss

  const fetchTradeHistory = useCallback(() => {
    fetch("/api/intraday/paper-trades", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          setAllTrades(data.allTrades || []);
          setDailySummaries(data.dailySummaries || []);
        }
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load trade history.");
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchTradeHistory();
  }, [fetchTradeHistory]);

  const uniqueDates = Array.from(new Set(allTrades.map((t) => t.date))).sort().reverse();

  const filteredTrades = allTrades.filter((t) => {
    if (filterDate !== "all" && t.date !== filterDate) return false;
    if (filterStock.trim() && !t.symbol.toLowerCase().includes(filterStock.trim().toLowerCase())) return false;
    if (filterTargetHit !== "all" && t.targetHit !== filterTargetHit) return false;
    if (filterPnl === "win" && t.pnlRupees <= 0) return false;
    if (filterPnl === "loss" && t.pnlRupees >= 0) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-[#061e14] via-[#0b291c] to-[#0f172a] p-5 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xl">📜</span>
              <h2 className="text-lg font-bold text-emerald-200">Permanent Trade History & Evidence Ledger</h2>
              <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-300 border border-emerald-500/30">
                Persistent Database Storage
              </span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Every paper trade is permanently recorded across application restarts. Directly evaluates whether recommended targets and stop losses were hit.
            </p>
          </div>

          <div className="shrink-0 flex items-center gap-3">
            <div className="text-right">
              <div className="text-xs text-slate-400 font-medium">Total Historical Trades</div>
              <div className="text-lg font-bold text-white">{allTrades.length}</div>
            </div>
            <div className="text-right pl-3 border-l border-slate-700">
              <div className="text-xs text-slate-400 font-medium">Target Hit Rate</div>
              <div className="text-lg font-bold text-emerald-400">
                {allTrades.length > 0
                  ? `${Math.round((allTrades.filter((t) => t.targetHit === "YES").length / allTrades.length) * 100)}%`
                  : "0%"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-800 bg-rose-950/40 p-3 text-xs text-rose-300">
          ⚠️ {error}
        </div>
      )}

      {/* Filter Bar */}
      <div className="rounded-xl border border-slate-800 bg-[#091526] p-4 space-y-3">
        <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">Filters</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          {/* Date Filter */}
          <div>
            <label className="block text-slate-400 mb-1">Date</label>
            <select
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-[#060e1a] px-3 py-1.5 text-white font-medium focus:outline-none focus:border-emerald-500"
            >
              <option value="all">All Dates ({uniqueDates.length})</option>
              {uniqueDates.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          {/* Stock Search Filter */}
          <div>
            <label className="block text-slate-400 mb-1">Stock Symbol</label>
            <input
              type="text"
              placeholder="Search symbol (e.g. RELIANCE)..."
              value={filterStock}
              onChange={(e) => setFilterStock(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-[#060e1a] px-3 py-1.5 text-white font-medium focus:outline-none focus:border-emerald-500 placeholder:text-slate-600"
            />
          </div>

          {/* Target Hit Filter */}
          <div>
            <label className="block text-slate-400 mb-1">Target Hit</label>
            <select
              value={filterTargetHit}
              onChange={(e) => setFilterTargetHit(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-[#060e1a] px-3 py-1.5 text-white font-medium focus:outline-none focus:border-emerald-500"
            >
              <option value="all">All Signals</option>
              <option value="YES">Target Hit: YES ✓</option>
              <option value="NO">Target Hit: NO ❌</option>
            </select>
          </div>

          {/* Profit / Loss Filter */}
          <div>
            <label className="block text-slate-400 mb-1">Profit / Loss</label>
            <select
              value={filterPnl}
              onChange={(e) => setFilterPnl(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-[#060e1a] px-3 py-1.5 text-white font-medium focus:outline-none focus:border-emerald-500"
            >
              <option value="all">All Outcomes</option>
              <option value="win">Profitable Trades (Wins)</option>
              <option value="loss">Loss Trades</option>
            </select>
          </div>
        </div>
      </div>

      {/* Permanent Historical Trade Table */}
      {loading ? (
        <div className="py-12 text-center text-xs text-slate-400">Loading historical trade ledger...</div>
      ) : filteredTrades.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-[#091526] p-8 text-center text-xs text-slate-400">
          No historical trade records matching the selected filters.
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
              {filteredTrades.map((t) => {
                const isTargetYes = t.targetHit === "YES";
                const isStopYes = t.stopLossHit === "YES";

                return (
                  <tr key={t.id} className="hover:bg-slate-800/40 transition">
                    {/* Date & Time */}
                    <td className="px-3.5 py-3 font-mono text-slate-300 whitespace-nowrap">
                      <div>{t.date}</div>
                      <div className="text-[10px] text-slate-500">{t.entryTime} {t.exitTime ? `→ ${t.exitTime}` : ""}</div>
                    </td>

                    {/* Stock */}
                    <td className="px-3.5 py-3">
                      <div className="font-bold text-white">{t.symbol}</div>
                      <div className="text-[10px] text-slate-500 font-mono">{t.id}</div>
                    </td>

                    {/* Buy/Sell */}
                    <td className="px-3.5 py-3 text-center">
                      <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-bold ${
                        t.action === "BUY" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                      }`}>
                        {t.action}
                      </span>
                    </td>

                    {/* Entry Price */}
                    <td className="px-3.5 py-3 text-right font-bold text-slate-200">
                      ₹{t.entryPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>

                    {/* Qty */}
                    <td className="px-3.5 py-3 text-right font-mono text-slate-300">
                      {t.quantity}
                    </td>

                    {/* Capital Used */}
                    <td className="px-3.5 py-3 text-right font-mono text-slate-300">
                      ₹{t.capitalUsed.toLocaleString("en-IN")}
                    </td>

                    {/* Target Price */}
                    <td className="px-3.5 py-3 text-right font-bold text-emerald-300">
                      ₹{t.targetPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>

                    {/* Stop Loss Price */}
                    <td className="px-3.5 py-3 text-right font-bold text-rose-400">
                      ₹{t.stopLossPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>

                    {/* Exit Price */}
                    <td className="px-3.5 py-3 text-right font-bold text-slate-200">
                      {t.exitPrice ? `₹${t.exitPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "—"}
                    </td>

                    {/* Target Hit: YES / NO */}
                    <td className="px-3.5 py-3 text-center font-bold">
                      {isTargetYes ? (
                        <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] text-emerald-300 border border-emerald-500/30">
                          YES ✓
                        </span>
                      ) : (
                        <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">
                          NO
                        </span>
                      )}
                    </td>

                    {/* Stop Loss Hit: YES / NO */}
                    <td className="px-3.5 py-3 text-center font-bold">
                      {isStopYes ? (
                        <span className="rounded bg-rose-500/20 px-2 py-0.5 text-[11px] text-rose-300 border border-rose-500/30">
                          YES ❌
                        </span>
                      ) : (
                        <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">
                          NO
                        </span>
                      )}
                    </td>

                    {/* Exit Reason */}
                    <td className="px-3.5 py-3 text-center">
                      <span className="text-[11px] font-semibold text-slate-300">
                        {t.exitReason}
                      </span>
                    </td>

                    {/* P&L ₹ */}
                    <td className={`px-3.5 py-3 text-right font-bold ${
                      t.pnlRupees > 0 ? "text-emerald-400" : t.pnlRupees < 0 ? "text-rose-400" : "text-slate-400"
                    }`}>
                      {t.pnlRupees > 0 ? "+" : ""}
                      ₹{t.pnlRupees.toLocaleString("en-IN")}
                      <div className="text-[10px] opacity-80">{t.pnlPercent}%</div>
                    </td>

                    {/* Cumulative Daily P&L */}
                    <td className={`px-3.5 py-3 text-right font-bold ${
                      t.cumulativeDailyPnl >= 0 ? "text-emerald-300" : "text-rose-300"
                    }`}>
                      ₹{t.cumulativeDailyPnl.toLocaleString("en-IN")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* End-of-Day Daily Summary Table */}
      <div className="space-y-3 pt-4 border-t border-slate-800">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <span>📅</span> Daily Performance History Summaries
          </h3>
          <p className="text-xs text-slate-400">Aggregated daily trading summaries across Monday, Tuesday and Wednesday test runs.</p>
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
