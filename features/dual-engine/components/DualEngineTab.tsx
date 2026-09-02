"use client";

import React, { useState, useEffect } from "react";

interface LogRecord {
  date: string;
  symbol: string;
  side: string;
  entry: string;
  exit: string;
  pnl: string;
  status: string;
  velocity?: string;
  atrMult?: string;
}

const DEFAULT_LOGS: LogRecord[] = [
  {
    date: "2026-09-02",
    symbol: "RELIANCE",
    side: "BUY_TEST",
    entry: "2450.00",
    exit: "-",
    pnl: "+15.50",
    status: "OPEN",
    velocity: "1.5%",
    atrMult: "0.5x",
  },
  {
    date: "2026-09-02",
    symbol: "TATAMOTORS",
    side: "BUY_MOMENTUM",
    entry: "980.50",
    exit: "998.20",
    pnl: "+17.70",
    status: "CLOSED",
    velocity: "1.2%",
    atrMult: "0.5x",
  },
  {
    date: "2026-09-02",
    symbol: "INFY",
    side: "BUY_BREAKOUT",
    entry: "1820.00",
    exit: "-",
    pnl: "+8.40",
    status: "OPEN",
    velocity: "1.0%",
    atrMult: "0.5x",
  },
  {
    date: "2026-09-02",
    symbol: "SBIN",
    side: "BUY_VOLATILITY",
    entry: "815.00",
    exit: "827.60",
    pnl: "+12.60",
    status: "CLOSED",
    velocity: "1.8%",
    atrMult: "0.6x",
  },
];

export default function DualEngineTab() {
  const [velocityPercent, setVelocityPercent] = useState<number>(1.0);
  const [atrMultiplier, setAtrMultiplier] = useState<number>(0.5);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [logRecords, setLogRecords] = useState<LogRecord[]>(DEFAULT_LOGS);
  const [statusMessage, setStatusMessage] = useState<string>("");

  const fetchStrategyLogs = async () => {
    try {
      const response = await fetch("/api/dual-engine", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      if (data.ok && Array.isArray(data.records) && data.records.length > 0) {
        setLogRecords(data.records);
      }
    } catch (err) {
      console.error("Log fetch processing failure: ", err);
    }
  };

  useEffect(() => {
    fetchStrategyLogs();
  }, []);

  const executeScanDispatch = async () => {
    setIsProcessing(true);
    setStatusMessage("Synchronizing parameters & running model...");
    try {
      const res = await fetch("/api/dual-engine", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          velocity: velocityPercent.toString(),
          atr_mult: atrMultiplier.toString(),
        }),
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        setStatusMessage("⚡ Parameters synchronized! Dual-Engine scan completed.");
        if (Array.isArray(data.records)) {
          setLogRecords(data.records);
        }
      } else {
        setStatusMessage(`⚠️ Workflow server response: ${data.error || "Execution completed"}`);
      }
    } catch (err) {
      setStatusMessage("❌ Trigger connection error: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Control Module Card */}
      <div className="rounded-2xl border border-slate-800 bg-[#091322] p-6 shadow-xl">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center mb-6">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
              <span>🛠️</span> Dual-Engine Strategy Configuration
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Adjust core screening metrics (Velocity Target &amp; ATR Range) to trigger model calculations &amp; view shortlisted stocks.
            </p>
          </div>
          <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-400">
            Engine Mode: Dynamic Multi-Factor
          </span>
        </div>

        <div className="grid gap-6 md:grid-cols-3 rounded-xl border border-slate-800 bg-[#050c16] p-5">
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-300">
              📈 Price Velocity Target: <span className="font-bold text-cyan-400">{velocityPercent.toFixed(1)}%</span>
            </label>
            <input
              type="range"
              min="0.5"
              max="3.0"
              step="0.1"
              value={velocityPercent}
              onChange={(e) => setVelocityPercent(parseFloat(e.target.value))}
              className="w-full cursor-pointer accent-cyan-500"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span>0.5% (Conservative)</span>
              <span>3.0% (Aggressive)</span>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-300">
              📊 ATR Range Threshold: <span className="font-bold text-cyan-400">{atrMultiplier.toFixed(1)}x</span>
            </label>
            <input
              type="range"
              min="0.2"
              max="1.5"
              step="0.1"
              value={atrMultiplier}
              onChange={(e) => setAtrMultiplier(parseFloat(e.target.value))}
              className="w-full cursor-pointer accent-cyan-500"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span>0.2x (Tight)</span>
              <span>1.5x (Wide)</span>
            </div>
          </div>

          <div className="flex flex-col justify-end">
            <button
              onClick={executeScanDispatch}
              disabled={isProcessing}
              className="w-full rounded-xl bg-cyan-500 py-3 text-xs font-bold text-slate-950 shadow-lg shadow-cyan-500/20 transition hover:bg-cyan-400 disabled:opacity-50"
            >
              {isProcessing ? "Synchronizing System..." : "⚡ Apply Variables & Run"}
            </button>
          </div>
        </div>

        {statusMessage && (
          <div className="mt-4 rounded-lg border border-slate-800 bg-[#07111f] p-3 text-xs font-medium text-cyan-300">
            {statusMessage}
          </div>
        )}
      </div>

      {/* Dynamic Spreadsheet Output UI */}
      <div className="rounded-2xl border border-slate-800 bg-[#091322] p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <span>📋</span> Real-Time Shortlisted Stocks &amp; Execution Output
          </h3>
          <button
            onClick={fetchStrategyLogs}
            className="rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800"
          >
            ↻ Refresh CSV Output
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-[#050c16]">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="border-b border-slate-800 bg-[#091322] font-semibold text-slate-400">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Symbol</th>
                <th className="px-4 py-3">Side</th>
                <th className="px-4 py-3">Entry Price</th>
                <th className="px-4 py-3">Exit Price</th>
                <th className="px-4 py-3">Net P&amp;L Points</th>
                <th className="px-4 py-3">Velocity</th>
                <th className="px-4 py-3">ATR Mult</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {logRecords.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                    No execution signals logged for this layout config.
                  </td>
                </tr>
              ) : (
                logRecords.map((trade, i) => {
                  const isBuy = trade.side.toUpperCase().includes("BUY");
                  const pnlVal = parseFloat(trade.pnl);
                  const isPositive = !isNaN(pnlVal) && pnlVal > 0;
                  const isNegative = !isNaN(pnlVal) && pnlVal < 0;

                  return (
                    <tr key={i} className="hover:bg-slate-800/30 transition">
                      <td className="px-4 py-3 font-mono text-slate-400">{trade.date}</td>
                      <td className="px-4 py-3 font-bold text-white">{trade.symbol}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                            isBuy ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                          }`}
                        >
                          {trade.side}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-200">
                        {trade.entry.startsWith("₹") ? trade.entry : `₹${trade.entry}`}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-200">
                        {trade.exit !== "-" && trade.exit !== "" ? (trade.exit.startsWith("₹") ? trade.exit : `₹${trade.exit}`) : "-"}
                      </td>
                      <td
                        className={`px-4 py-3 font-mono font-bold ${
                          isPositive ? "text-emerald-400" : isNegative ? "text-rose-400" : "text-slate-300"
                        }`}
                      >
                        {trade.pnl}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-400">{trade.velocity || `${velocityPercent}%`}</td>
                      <td className="px-4 py-3 font-mono text-slate-400">{trade.atrMult || `${atrMultiplier}x`}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-[11px] font-semibold ${
                            trade.status === "CLOSED" ? "text-slate-400" : "text-amber-400"
                          }`}
                        >
                          ● {trade.status}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
