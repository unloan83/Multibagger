"use client";

import { useEffect, useState, useCallback } from "react";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [telegramConfigured, setTelegramConfigured] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Live timer tick state
  const [currentTime, setCurrentTime] = useState<number>(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchRecommendations = useCallback(() => {
    fetch("/api/upstox/recommendations", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && data.data?.recommendations) {
          setRecommendations(data.data.recommendations);
          setTelegramConfigured(Boolean(data.telegramConfigured));
        }
        setLoading(false);
      })
      .catch((err: unknown) => {
        const errorMsg = err instanceof Error ? err.message : "Failed to load Upstox recommendations.";
        setError(errorMsg);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchRecommendations();
    // Auto-refresh recommendations list every 15 seconds to sync timer status
    const interval = setInterval(fetchRecommendations, 15_000);
    return () => clearInterval(interval);
  }, [fetchRecommendations]);

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
      } else {
        setError(data.error || "Failed to process trade action.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error processing trade action.");
    } finally {
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
    const formatted = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    return { text: `${formatted} remaining`, isExpired: false };
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-2xl border border-purple-500/30 bg-gradient-to-r from-[#120826] via-[#1a0b36] to-[#0f172a] p-5 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xl">🚀</span>
              <h2 className="text-lg font-bold text-purple-200">Upstox Model Recommendations</h2>
              <span className="rounded-full bg-purple-500/20 px-2.5 py-0.5 text-xs font-semibold text-purple-300 border border-purple-500/30">
                Sandbox Mode
              </span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Scans every 15 minutes during market hours. Choose between <strong className="text-cyan-300">AUTOMATIC</strong> or <strong className="text-amber-300">USER DRIVEN</strong>. If no action is taken within <strong className="text-rose-300">5 minutes</strong>, the system auto-executes the recommendation.
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

      {/* Simple Tabular Format */}
      {loading ? (
        <div className="py-12 text-center text-xs text-slate-400">Loading Upstox recommendations table...</div>
      ) : recommendations.length === 0 ? (
        <div className="py-12 text-center text-xs text-slate-400">No shortlisted Upstox recommendations available at this time.</div>
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
                const isSkipped = rec.status === "SKIPPED";
                const isAuto = rec.executionMode === "AUTOMATIC";
                const timer = calculateTimeRemaining(rec.timestamp);

                return (
                  <tr key={rec.id} className="hover:bg-slate-800/40 transition">
                    {/* Stock Symbol */}
                    <td className="px-4 py-3.5">
                      <div className="font-bold text-white text-sm">{rec.symbol}</div>
                      <div className="text-[11px] text-slate-400 font-mono">{rec.instrumentKey}</div>
                    </td>

                    {/* CMP */}
                    <td className="px-4 py-3.5 text-right font-bold text-slate-200">
                      ₹{rec.cmp.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>

                    {/* Signal & Target */}
                    <td className="px-4 py-3.5 text-right">
                      <span className="inline-block rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-400 border border-emerald-500/20 mr-1.5">
                        {rec.signal}
                      </span>
                      <span className="font-bold text-emerald-300">
                        ₹{rec.target.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </span>
                    </td>

                    {/* Stop Loss */}
                    <td className="px-4 py-3.5 text-right font-bold text-rose-400">
                      ₹{rec.stopLoss.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>

                    {/* Score */}
                    <td className="px-4 py-3.5 text-center">
                      <span className="rounded-full bg-purple-500/10 px-2.5 py-1 text-xs font-bold text-purple-300 border border-purple-500/20">
                        {rec.score}/100
                      </span>
                    </td>

                    {/* Execution Mode Option Toggle */}
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

                    {/* 5-Min Timer / Status */}
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

                    {/* Action Buttons */}
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
                              title="Send interactive Telegram alert with Buy/Sell/Skip buttons"
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
  );
}
