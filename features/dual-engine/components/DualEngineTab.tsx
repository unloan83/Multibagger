"use client";

import React, { useState, useEffect, useRef } from "react";

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

interface WorkflowRunInfo {
  id: number;
  name: string;
  status: string; // queued, in_progress, completed
  conclusion: string | null; // success, failure, null
  html_url: string;
  created_at: string;
  updated_at: string;
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
  const [githubToken, setGithubToken] = useState<string>("");
  const [showTokenInput, setShowTokenInput] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [logRecords, setLogRecords] = useState<LogRecord[]>(DEFAULT_LOGS);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [activeRun, setActiveRun] = useState<WorkflowRunInfo | null>(null);
  const [isPolling, setIsPolling] = useState<boolean>(false);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 1. Restore persistent user metrics, token & cumulative records on page load
  useEffect(() => {
    try {
      const savedVel = localStorage.getItem("dual_engine_velocity");
      const savedAtr = localStorage.getItem("dual_engine_atr");
      const savedToken = localStorage.getItem("dual_engine_github_token");
      const savedLogs = localStorage.getItem("dual_engine_records");

      if (savedVel !== null) setVelocityPercent(parseFloat(savedVel));
      if (savedAtr !== null) setAtrMultiplier(parseFloat(savedAtr));
      if (savedToken) setGithubToken(savedToken);

      if (savedLogs) {
        const parsed = JSON.parse(savedLogs);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setLogRecords(parsed);
        }
      }
    } catch {
      // Fallback if localStorage unavailable
    }
    fetchStrategyLogs();
  }, []);

  // 2. Fetch baseline strategy logs & initial workflow status
  const fetchStrategyLogs = async () => {
    try {
      const response = await fetch("/api/dual-engine", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      if (data.ok) {
        if (Array.isArray(data.records) && data.records.length > 0) {
          setLogRecords((prev) => {
            const combined = [...data.records, ...prev];
            const uniqueMap = new Map<string, LogRecord>();
            for (const r of combined) {
              const key = `${r.date}-${r.symbol}-${r.velocity}-${r.atrMult}-${r.side}`;
              if (!uniqueMap.has(key)) uniqueMap.set(key, r);
            }
            const updated = Array.from(uniqueMap.values());
            localStorage.setItem("dual_engine_records", JSON.stringify(updated));
            return updated;
          });
        }
        if (data.run) setActiveRun(data.run);
      }
    } catch (err) {
      console.error("Log fetch processing failure: ", err);
    }
  };

  // 3. Start live polling for GitHub Actions workflow run completion
  const startPollingRunStatus = () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    setIsPolling(true);

    let pollCount = 0;
    pollIntervalRef.current = setInterval(async () => {
      pollCount++;
      try {
        const res = await fetch("/api/dual-engine?check_status=true", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (data.ok && data.run) {
          setActiveRun(data.run);

          if (data.run.status === "completed") {
            stopPolling();
            setStatusMessage(`✅ Workflow Run #${data.run.id} COMPLETED (${data.run.conclusion || "success"})! Shortlisted stock output captured.`);
            if (Array.isArray(data.records)) {
              setLogRecords(data.records);
              localStorage.setItem("dual_engine_records", JSON.stringify(data.records));
            }
          } else {
            setStatusMessage(`⚙️ GitHub Actions Workflow Run #${data.run.id} in progress... (Status: ${data.run.status.toUpperCase()})`);
          }
        }
      } catch (err) {
        console.error("Polling error:", err);
      }

      if (pollCount > 30) {
        stopPolling();
        setStatusMessage("⏱️ Polling completed. Check table below for output.");
      }
    }, 3000);
  };

  const stopPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setIsPolling(false);
    setIsProcessing(false);
  };

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  // 4. Save inputs to localStorage
  const handleVelocityChange = (val: number) => {
    setVelocityPercent(val);
    localStorage.setItem("dual_engine_velocity", val.toString());
  };

  const handleAtrChange = (val: number) => {
    setAtrMultiplier(val);
    localStorage.setItem("dual_engine_atr", val.toString());
  };

  const handleTokenChange = (token: string) => {
    setGithubToken(token);
    localStorage.setItem("dual_engine_github_token", token);
  };

  // 5. Trigger Workflow Dispatch & Monitor Status Until Completed
  const executeScanDispatch = async () => {
    setIsProcessing(true);
    setStatusMessage("🚀 Triggering Dual-Engine workflow dispatch...");

    try {
      const res = await fetch("/api/dual-engine", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          velocity: velocityPercent.toString(),
          atr_mult: atrMultiplier.toString(),
          github_token: githubToken.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        setStatusMessage(data.message || `🚀 Workflow triggered for Velocity=${velocityPercent}%, ATR Mult=${atrMultiplier}x. Tracking live status...`);

        if (Array.isArray(data.records) && data.records.length > 0) {
          setLogRecords((prev) => {
            const combined = [...data.records, ...prev];
            const uniqueMap = new Map<string, LogRecord>();
            for (const r of combined) {
              const key = `${r.date}-${r.symbol}-${r.velocity}-${r.atrMult}-${r.side}`;
              if (!uniqueMap.has(key)) uniqueMap.set(key, r);
            }
            const updated = Array.from(uniqueMap.values());
            localStorage.setItem("dual_engine_records", JSON.stringify(updated));
            return updated;
          });
        }

        if (data.run) setActiveRun(data.run);

        // Start live polling for workflow completion
        startPollingRunStatus();
      } else {
        setStatusMessage(`⚠️ Workflow server response: ${data.error || "Execution error"}`);
        setIsProcessing(false);
      }
    } catch (err) {
      setStatusMessage("❌ Trigger connection error: " + (err instanceof Error ? err.message : String(err)));
      setIsProcessing(false);
    }
  };

  // 6. CSV Download Functionality
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
              Enter screening metrics &amp; run workflow. Polling tracks live GitHub Actions status until completion.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowTokenInput(!showTokenInput)}
              className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800"
            >
              ⚙️ {githubToken ? "GitHub PAT Set" : "Configure GitHub PAT"}
            </button>
            <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-400">
              Live Actions Tracker
            </span>
          </div>
        </div>

        {showTokenInput && (
          <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
            <label className="block text-xs font-bold text-amber-200">
              🔑 GitHub Personal Access Token (PAT) for Workflow Dispatch:
            </label>
            <input
              type="password"
              placeholder="Paste GitHub PAT Token (ghp_...)"
              value={githubToken}
              onChange={(e) => handleTokenChange(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-[#040810] px-3 py-2 text-xs font-mono text-white focus:border-amber-500 focus:outline-none"
            />
            <p className="text-[11px] text-slate-400">
              Optional: Entering a PAT token allows remote GitHub Actions workflow dispatching directly from your browser.
            </p>
          </div>
        )}

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
              {isProcessing ? (isPolling ? "Tracking Workflow..." : "Triggering Workflow...") : "⚡ Apply Variables & Run"}
            </button>
            <p className="text-[10px] text-slate-400 text-center">
              Triggers workflow &amp; tracks live status until completion.
            </p>
          </div>
        </div>

        {/* Live Workflow Run Status Card */}
        {activeRun && (
          <div className="mt-4 rounded-xl border border-slate-800 bg-[#050c16] p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-300">Live Workflow Run:</span>
                <span
                  className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                    activeRun.status === "completed"
                      ? activeRun.conclusion === "success"
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                        : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                      : "bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse"
                  }`}
                >
                  ● {activeRun.status.toUpperCase()} {activeRun.conclusion ? `(${activeRun.conclusion.toUpperCase()})` : ""}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono">
                Run ID #{activeRun.id} | {activeRun.name}
              </p>
            </div>

            <a
              href={activeRun.html_url}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-semibold text-cyan-400 hover:text-cyan-300 hover:bg-slate-800 transition"
            >
              View on GitHub Actions ↗
            </a>
          </div>
        )}

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
