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
  velocity: string;
  atrMult: string;
}

const DEFAULT_LOGS: LogRecord[] = [
  {
    date: "2026-09-02",
    symbol: "RELIANCE",
    side: "BUY_MOMENTUM",
    entry: "2500.00",
    exit: "-",
    pnl: "+24.50",
    status: "OPEN",
    velocity: "1.0%",
    atrMult: "0.5x",
  },
  {
    date: "2026-09-02",
    symbol: "TATAMOTORS",
    side: "BUY_BREAKOUT",
    entry: "980.50",
    exit: "998.20",
    pnl: "+17.70",
    status: "CLOSED",
    velocity: "1.5%",
    atrMult: "0.5x",
  },
  {
    date: "2026-09-02",
    symbol: "INFY",
    side: "BUY_PULLBACK",
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
  {
    date: "2026-09-02",
    symbol: "HDFCBANK",
    side: "BUY_RANGE",
    entry: "1640.00",
    exit: "1658.00",
    pnl: "+18.00",
    status: "CLOSED",
    velocity: "1.2%",
    atrMult: "0.4x",
  },
];

export default function DualEngineTab() {
  const [velocityPercent, setVelocityPercent] = useState<number>(1.0);
  const [atrMultiplier, setAtrMultiplier] = useState<number>(0.5);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [logRecords, setLogRecords] = useState<LogRecord[]>(DEFAULT_LOGS);
  const [statusMessage, setStatusMessage] = useState<string>("");

  // 1. Restore persistent user metrics & cumulative records on page load (prevents reset on refresh)
  useEffect(() => {
    try {
      const savedVel = localStorage.getItem("dual_engine_velocity");
      const savedAtr = localStorage.getItem("dual_engine_atr");
      const savedLogs = localStorage.getItem("dual_engine_records");

      if (savedVel !== null) setVelocityPercent(parseFloat(savedVel));
      if (savedAtr !== null) setAtrMultiplier(parseFloat(savedAtr));

      if (savedLogs) {
        const parsed = JSON.parse(savedLogs);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setLogRecords(parsed);
          return;
        }
      }
    } catch {
      // Fallback to API if localStorage unavailable
    }
    fetchStrategyLogs();
  }, []);

  // 2. Fetch baseline strategy logs from server API
  const fetchStrategyLogs = async () => {
    try {
      const response = await fetch("/api/dual-engine", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      if (data.ok && Array.isArray(data.records) && data.records.length > 0) {
        setLogRecords(data.records);
        localStorage.setItem("dual_engine_records", JSON.stringify(data.records));
      }
    } catch (err) {
      console.error("Log fetch processing failure: ", err);
    }
  };

  // 3. Save parameters to localStorage on change
  const handleVelocityChange = (val: number) => {
    setVelocityPercent(val);
    localStorage.setItem("dual_engine_velocity", val.toString());
  };

  const handleAtrChange = (val: number) => {
    setAtrMultiplier(val);
    localStorage.setItem("dual_engine_atr", val.toString());
  };

  // 4. Run model workflow with entered parameters & ACCUMULATE results in table
  const executeScanDispatch = async () => {
    setIsProcessing(true);
    setStatusMessage("Synchronizing parameters & running model workflow...");

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
        setStatusMessage(data.message || `⚡ Parameters (${velocityPercent}%, ${atrMultiplier}x) executed! Stock shortlisted & appended to table.`);

        if (Array.isArray(data.records) && data.records.length > 0) {
          // Accumulate new record while preserving prior runs
          const newItems = data.records;
          setLogRecords((prev) => {
            const combined = [...newItems, ...prev];
            // Deduplicate exact duplicate runs while accumulating across parameter variations
            const uniqueMap = new Map<string, LogRecord>();
            for (const r of combined) {
              const key = `${r.date}-${r.symbol}-${r.velocity}-${r.atrMult}-${r.side}`;
              if (!uniqueMap.has(key)) {
                uniqueMap.set(key, r);
              }
            }
            const updated = Array.from(uniqueMap.values());
            localStorage.setItem("dual_engine_records", JSON.stringify(updated));
            return updated;
          });
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

  // 5. Download cumulative shortlisted stocks as CSV
  const downloadCsv = () => {
    if (logRecords.length === 0) return;

    const headers = ["Date", "Symbol", "Side", "Entry_Price", "Exit_Price", "P&L_Points", "Status", "Used_Velocity", "Used_ATR_Mult"];
    const rows = logRecords.map((r) => [
      r.date,
      r.symbol,
      r.side,
      r.entry,
      r.exit,
      r.pnl,
      r.status,
      r.velocity.endsWith("%") ? r.velocity : `${r.velocity}%`,
      r.atrMult.endsWith("x") ? r.atrMult : `${r.atrMult}x`,
    ]);

    const csvContent = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `dual_engine_shortlisted_stocks_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 6. Clear cumulative records
  const clearHistory = () => {
    if (confirm("Are you sure you want to clear the accumulated stock log history?")) {
      setLogRecords([]);
      localStorage.removeItem("dual_engine_records");
      setStatusMessage("Log history cleared.");
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
              Type custom metric values or adjust sliders. Parameters &amp; shortlisted stock logs persist across page refreshes.
            </p>
          </div>
          <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-400">
            Persistence: LocalStorage Enabled
          </span>
        </div>

        <div className="grid gap-6 md:grid-cols-3 rounded-xl border border-slate-800 bg-[#050c16] p-5">
          {/* Price Velocity Input Box + Slider */}
          <div className="space-y-3">
            <label className="block text-xs font-semibold text-slate-300">
              📈 Price Velocity Target (%)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.1"
                min="0.1"
                max="10.0"
                value={velocityPercent}
                onChange={(e) => handleVelocityChange(parseFloat(e.target.value) || 0)}
                className="w-28 rounded-lg border border-slate-700 bg-[#040810] px-3 py-2 text-center font-mono text-sm font-bold text-cyan-400 focus:border-cyan-500 focus:outline-none"
              />
              <span className="text-xs text-slate-400">%</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="5.0"
              step="0.1"
              value={velocityPercent}
              onChange={(e) => handleVelocityChange(parseFloat(e.target.value))}
              className="w-full cursor-pointer accent-cyan-500"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span>0.5% (Conservative)</span>
              <span>5.0% (Aggressive)</span>
            </div>
          </div>

          {/* ATR Multiplier Input Box + Slider */}
          <div className="space-y-3">
            <label className="block text-xs font-semibold text-slate-300">
              📊 ATR Range Threshold (x)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.1"
                min="0.1"
                max="5.0"
                value={atrMultiplier}
                onChange={(e) => handleAtrChange(parseFloat(e.target.value) || 0)}
                className="w-28 rounded-lg border border-slate-700 bg-[#040810] px-3 py-2 text-center font-mono text-sm font-bold text-cyan-400 focus:border-cyan-500 focus:outline-none"
              />
              <span className="text-xs text-slate-400">x</span>
            </div>
            <input
              type="range"
              min="0.2"
              max="2.5"
              step="0.1"
              value={atrMultiplier}
              onChange={(e) => handleAtrChange(parseFloat(e.target.value))}
              className="w-full cursor-pointer accent-cyan-500"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span>0.2x (Tight)</span>
              <span>2.5x (Wide)</span>
            </div>
          </div>

          {/* Apply Variables & Run Button */}
          <div className="flex flex-col justify-end space-y-2">
            <button
              onClick={executeScanDispatch}
              disabled={isProcessing}
              className="w-full rounded-xl bg-cyan-500 py-3 text-xs font-bold text-slate-950 shadow-lg shadow-cyan-500/20 transition hover:bg-cyan-400 disabled:opacity-50"
            >
              {isProcessing ? "Executing Workflow..." : "⚡ Apply Variables & Run"}
            </button>
            <p className="text-[10px] text-slate-400 text-center">
              Shortlisted stocks append to cumulative log table below.
            </p>
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
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span>📋</span> Cumulative Shortlisted Stocks Output ({logRecords.length})
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Accumulates shortlisted stocks across all workflow runs with parameter metrics recorded per row.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={downloadCsv}
              disabled={logRecords.length === 0}
              className="rounded-lg bg-emerald-600/90 hover:bg-emerald-500 px-3.5 py-2 text-xs font-bold text-white shadow transition disabled:opacity-50 flex items-center gap-1.5"
            >
              <span>📥</span> Download CSV
            </button>

            <button
              onClick={clearHistory}
              disabled={logRecords.length === 0}
              className="rounded-lg border border-slate-700 bg-slate-800/50 hover:bg-rose-500/20 hover:border-rose-500/40 px-3 py-2 text-xs font-semibold text-slate-400 hover:text-rose-300 transition disabled:opacity-50"
            >
              🗑️ Clear
            </button>
          </div>
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
                <th className="px-4 py-3">Velocity (%)</th>
                <th className="px-4 py-3">ATR Mult (x)</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {logRecords.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                    No execution signals logged. Adjust metrics &amp; click &quot;Apply Variables &amp; Run&quot;.
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
                      <td className="px-4 py-3 font-mono text-cyan-400 font-semibold">
                        {trade.velocity.endsWith("%") ? trade.velocity : `${trade.velocity}%`}
                      </td>
                      <td className="px-4 py-3 font-mono text-cyan-400 font-semibold">
                        {trade.atrMult.endsWith("x") ? trade.atrMult : `${trade.atrMult}x`}
                      </td>
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
