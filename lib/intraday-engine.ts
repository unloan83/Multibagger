import { readSnapshotFile } from "@/lib/snapshot-storage";

export type IntradaySlot = "09:08" | "10:45" | "13:45";

export type PaperSignal = {
  symbol: string;
  entry: number;
  stop: number;
  target: number;
  strategy: "ORB_15M" | "VWAP_CONTINUATION";
  timestamp: string;
  expiry: string;
  run_id: string;
  rank_score: number;
};

export type PaperSignalSnapshot = {
  status: "SIGNALS" | "NO_TRADE";
  asOf: string;
  run_id: string;
  source: "BREEZE_1MIN_DUCKDB" | "UPSTOX_1MIN_DUCKDB";
  mode: "PAPER_ONLY";
  evaluatedUniverseSize: number;
  reason: string | null;
  signals: PaperSignal[];
};

const FILE = "paper_signals.json";
const MAX_SNAPSHOT_AGE_MS = Number(process.env.MAX_SIGNAL_SNAPSHOT_AGE_SECONDS || 180) * 1000;

export function noTrade(reason = "NO_TRADE"): PaperSignalSnapshot {
  return {
    status: "NO_TRADE", asOf: new Date().toISOString(), run_id: "", source: "BREEZE_1MIN_DUCKDB",
    mode: "PAPER_ONLY", evaluatedUniverseSize: 0, reason, signals: [],
  };
}

export async function readPaperSignals(): Promise<PaperSignalSnapshot> {
  try {
    const raw = await readSnapshotFile(FILE);
    if (!raw) return noTrade("NO_TRADE");
    const value = JSON.parse(raw) as PaperSignalSnapshot;
    if (!validSnapshot(value)) return noTrade("NO_TRADE");
    const signals = value.signals.filter(validSignal).filter((signal) => Date.parse(signal.expiry) > Date.now());
    if (value.status === "NO_TRADE") return { ...value, signals: [] };
    if (signals.length === 0) return noTrade("NO_TRADE");
    return { ...value, signals };
  } catch {
    return noTrade("NO_TRADE");
  }
}

export function validSnapshot(value: PaperSignalSnapshot): boolean {
  const age = Date.now() - Date.parse(value?.asOf);
  if (!value || !["BREEZE_1MIN_DUCKDB", "UPSTOX_1MIN_DUCKDB"].includes(value.source) || value.mode !== "PAPER_ONLY" ||
      !Number.isFinite(age) || age < 0 || age > MAX_SNAPSHOT_AGE_MS || !value.run_id ||
      !Array.isArray(value.signals) || !["SIGNALS", "NO_TRADE"].includes(value.status)) return false;
  if (value.status === "NO_TRADE") return value.signals.length === 0 && value.reason === "NO_TRADE";
  return value.signals.length > 0 && value.signals.every((signal) => validSignal(signal) && signal.run_id === value.run_id);
}

function validSignal(signal: PaperSignal): boolean {
  return Boolean(signal && /^[A-Z0-9&-]{1,30}$/.test(signal.symbol) && signal.run_id && ["ORB_15M", "VWAP_CONTINUATION"].includes(signal.strategy)) &&
    [signal.entry, signal.stop, signal.target, signal.rank_score].every(Number.isFinite) &&
    signal.stop < signal.entry && signal.target > signal.entry &&
    Number.isFinite(Date.parse(signal.timestamp)) && Number.isFinite(Date.parse(signal.expiry));
}
