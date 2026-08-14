"use client";

import { useEffect, useState } from "react";

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

  const fetchRecommendations = () => {
    setLoading(true);
    fetch("/api/upstox/recommendations", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && data.data?.recommendations) {
          setRecommendations(data.data.recommendations);
          setTelegramConfigured(Boolean(data.telegramConfigured));
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Failed to load Upstox recommendations.");
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchRecommendations();
  }, []);

  const handleModeChange = async (id: string, newMode: "AUTOMATIC" | "USER_DRIVEN") => {
    setActionLoading(id);
    try {
      const res = await fetch("/api/upstox/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_mode", id, mode: newMode }),
      });
      const data = await res.json();
      if (data.ok && data.data?.recommendations) {
        setRecommendations(data.data.recommendations);
        setMsg(data.message);
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
        setMsg(data.message);
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
        setMsg(data.message);
      } else {
        setError(data.error || "Failed to process action.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error processing action.");
    } finally {
      setActionLoading(null);
    }
  };


  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-2xl border border-purple-500/30 bg-gradient-to-r from-[#120826] via-[#1a0b36] to-[#0f172a] p-5 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xl">📈</span>
              <h2 className="text-lg font-bold text-purple-200">Upstox Model Recommendations</h2>
              <span className="rounded-full bg-purple-500/20 px-2.5 py-0.5 text-xs font-semibold text-purple-300 border border-purple-500/30">
                Sandbox Mode
              </span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Segregated Sandbox model predictions and trade execution workflow. Choose between <strong className="text-cyan-300">AUTOMATIC</strong> (model-driven sandbox trade) or <strong className="text-amber-300">USER DRIVEN</strong> (Telegram notification with Buy/Sell/Skip buttons).
            </p>
          </div>

          <div className="shrink-0 flex flex-col items-end gap-1.5 text-right">
            <div className="text-xs text-emerald-400 font-semibold flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
              Upstox Sandbox Connected
            </div>
            <div className="text-[11px] text-slate-400">
              Telegram Bot: {telegramConfigured ? <span className="text-cyan-400 font-semibold">Active ✓</span> : <span className="text-amber-400">Not Configured</span>}
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

      {/* Recommendations Grid */}
      {loading ? (
        <div className="py-12 text-center text-xs text-slate-400">Loading Upstox recommendations...</div>
      ) : recommendations.length === 0 ? (
        <div className="py-12 text-center text-xs text-slate-400">No shortlisted Upstox recommendations available at this time.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {recommendations.map((rec) => {
            const isPending = rec.status === "PENDING" || rec.status === "TELEGRAM_SENT";
            const isBuyExecuted = rec.status === "BUY_EXECUTED";
            const isSellExecuted = rec.status === "SELL_EXECUTED";
            const isSkipped = rec.status === "SKIPPED";
            const isAuto = rec.executionMode === "AUTOMATIC";

            return (
              <div
                key={rec.id}
                className="rounded-2xl border border-slate-800 bg-[#091526] p-5 shadow-lg flex flex-col justify-between space-y-4 hover:border-slate-700 transition"
              >
                {/* Stock Info */}
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold text-white">{rec.symbol}</h3>
                        <span className="text-[10px] font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                          {rec.instrumentKey}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">{rec.name}</p>
                    </div>
                    <div className="text-right">
                      <span className="inline-block rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-bold text-emerald-400 border border-emerald-500/20">
                        {rec.signal} @ ₹{rec.cmp.toLocaleString("en-IN")}
                      </span>
                      <div className="text-[11px] text-slate-400 mt-1">Score: <strong className="text-cyan-400">{rec.score}</strong>/100</div>
                    </div>
                  </div>

                  {/* Target & Stop Loss */}
                  <div className="grid grid-cols-2 gap-2 text-xs bg-[#060e1a] p-3 rounded-xl border border-slate-800/80">
                    <div>
                      <span className="text-slate-400 block text-[11px]">Target Objective</span>
                      <span className="font-bold text-emerald-400">₹{rec.target.toLocaleString("en-IN")}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[11px]">Stop Loss</span>
                      <span className="font-bold text-rose-400">₹{rec.stopLoss.toLocaleString("en-IN")}</span>
                    </div>
                  </div>

                  {/* Remark */}
                  <p className="text-xs text-slate-300 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/60">
                    💡 <strong className="text-purple-300">Model Rationale:</strong> {rec.remark}
                  </p>
                </div>

                {/* Execution Mode & Action Section */}
                <div className="pt-3 border-t border-slate-800 space-y-3">
                  {/* Mode Option Selection */}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400 font-medium">Recommended Action Option:</span>
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
                  </div>

                  {/* Status Badge */}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Execution Status:</span>
                    {isBuyExecuted && (
                      <span className="rounded-full bg-emerald-500/20 px-2.5 py-1 text-[11px] font-bold text-emerald-300 border border-emerald-500/30">
                        ✓ BUY EXECUTED (ID: {rec.orderId})
                      </span>
                    )}
                    {isSellExecuted && (
                      <span className="rounded-full bg-rose-500/20 px-2.5 py-1 text-[11px] font-bold text-rose-300 border border-rose-500/30">
                        ✓ SELL EXECUTED (ID: {rec.orderId})
                      </span>
                    )}
                    {isSkipped && (
                      <span className="rounded-full bg-slate-800 px-2.5 py-1 text-[11px] font-bold text-slate-400 border border-slate-700">
                        ⏭️ SKIPPED
                      </span>
                    )}
                    {rec.status === "TELEGRAM_SENT" && (
                      <span className="rounded-full bg-cyan-500/20 px-2.5 py-1 text-[11px] font-bold text-cyan-300 border border-cyan-500/30">
                        📱 TELEGRAM SENT (Awaiting Button Action)
                      </span>
                    )}
                    {rec.status === "PENDING" && (
                      <span className="rounded-full bg-amber-500/20 px-2.5 py-1 text-[11px] font-bold text-amber-300 border border-amber-500/30">
                        ⏳ PENDING
                      </span>
                    )}
                  </div>

                  {/* Action Buttons */}
                  {isPending && (
                    <div className="space-y-2 pt-1">
                      {isAuto ? (
                        <button
                          onClick={() => handleActionDecision(rec.id, rec.signal, true)}
                          disabled={actionLoading === rec.id}
                          className="w-full rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 py-2.5 text-xs font-bold text-white shadow-md hover:from-cyan-500 hover:to-blue-500 transition disabled:opacity-50"
                        >
                          {actionLoading === rec.id ? "Executing Model Sandbox Trade..." : "🤖 Let Model Execute Sandbox Decision"}
                        </button>
                      ) : (
                        <div className="space-y-2">
                          <button
                            onClick={() => handleSendTelegram(rec.id)}
                            disabled={actionLoading === rec.id}
                            className="w-full rounded-xl border border-cyan-500/40 bg-cyan-500/10 py-2 text-xs font-bold text-cyan-300 hover:bg-cyan-500/20 hover:text-white transition flex items-center justify-center gap-1.5 disabled:opacity-50"
                          >
                            <span>📱</span> Send Telegram Alert with Interactive Action Buttons
                          </button>

                          <div className="grid grid-cols-3 gap-2">
                            <button
                              onClick={() => handleActionDecision(rec.id, "BUY")}
                              disabled={actionLoading === rec.id}
                              className="rounded-lg bg-emerald-600/90 py-2 text-xs font-bold text-white hover:bg-emerald-500 transition disabled:opacity-50"
                            >
                              🛒 Buy
                            </button>
                            <button
                              onClick={() => handleActionDecision(rec.id, "SELL")}
                              disabled={actionLoading === rec.id}
                              className="rounded-lg bg-rose-600/90 py-2 text-xs font-bold text-white hover:bg-rose-500 transition disabled:opacity-50"
                            >
                              🔻 Sell
                            </button>
                            <button
                              onClick={() => handleActionDecision(rec.id, "SKIP")}
                              disabled={actionLoading === rec.id}
                              className="rounded-lg bg-slate-800 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700 transition disabled:opacity-50"
                            >
                              ⏭️ Skip
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
