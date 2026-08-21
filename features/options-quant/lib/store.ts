import fs from "node:fs/promises";
import path from "node:path";

import { readSnapshotFile, writeSnapshotFile } from "@/lib/snapshot-storage";
import { getOptionsQuantConfig } from "@/features/options-quant/lib/config";
import type { OptionsQuantState, PerformanceMetrics, StrategyEvaluation } from "@/features/options-quant/lib/types";

const STATE_FILE = "options-quant/state.json";
const STATE_KEY = "options-quant";

function sqliteStatePath(): string | null {
  return process.env.OPTIONS_QUANT_STATE_DB?.trim() || null;
}

async function openStateDatabase(filename: string) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(filename);
  database.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS options_quant_state (
      state_key TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  return database;
}

function parseState(content: string | null): OptionsQuantState {
  if (!content) return createEmptyState();
  const state = JSON.parse(content) as OptionsQuantState;
  if (state.schemaVersion !== 1) return createEmptyState();
  const config = getOptionsQuantConfig();
  state.configuration = {
    ...state.configuration,
    automaticCyclesEnabled: config.enabled,
    profitTargetRupees: config.profitTargetRupees,
    dailyProfitTargetRupees: config.dailyProfitTargetRupees,
    executionPaused: config.executionPaused,
  };
  return state;
}

export function emptyMetrics(): PerformanceMetrics {
  return {
    closedTrades: 0,
    grossPnl: 0,
    netPnl: 0,
    winRate: 0,
    profitFactor: null,
    expectancyPerTrade: 0,
    maximumDrawdown: 0,
    averageWin: 0,
    averageLoss: 0,
    costs: 0,
    slippage: 0,
    signalAccuracy: 0,
    capitalUtilisation: 0,
    strategyPerformance: {
      BULL_CALL_SPREAD: { trades: 0, netPnl: 0, winRate: 0 },
      BEAR_PUT_SPREAD: { trades: 0, netPnl: 0, winRate: 0 },
    },
  };
}

function initialEvaluation(): StrategyEvaluation {
  return {
    decision: "GO",
    evaluatedAt: new Date(0).toISOString(),
    reasons: ["Ready to begin Phase 1 only after market data, capital, and direction evidence are configured."],
    minimumShadowTrades: 30,
    minimumRealTrades: 50,
  };
}

export function createEmptyState(): OptionsQuantState {
  const config = getOptionsQuantConfig();
  return {
    schemaVersion: 1,
    asOf: new Date(0).toISOString(),
    stage: "SHADOW",
    broker: "UPSTOX",
    executionCapability: "SHADOW_AND_SANDBOX_ONLY",
    direction: null,
    liveOpportunity: null,
    positions: [],
    noTradeReasons: ["No fresh market-intelligence direction has been ingested."],
    metrics: emptyMetrics(),
    evaluation: initialEvaluation(),
    configuration: {
      marketDataConfigured: Boolean(process.env.UPSTOX_ACCESS_TOKEN),
      sandboxConfigured: Boolean(process.env.UPSTOX_SANDBOX_ACCESS_TOKEN),
      portfolioCapitalConfigured: config.portfolioCapital > 0,
      sandboxOrderSubmissionEnabled: config.submitSandboxOrders,
      automaticCyclesEnabled: config.enabled,
      executionPaused: config.executionPaused,
      profitTargetRupees: config.profitTargetRupees,
      dailyProfitTargetRupees: config.dailyProfitTargetRupees,
    },
  };
}

export async function readOptionsQuantState(): Promise<OptionsQuantState> {
  const databasePath = sqliteStatePath();
  if (databasePath) {
    const database = await openStateDatabase(databasePath);
    try {
      const row = database.prepare(
        "SELECT content FROM options_quant_state WHERE state_key = ?",
      ).get(STATE_KEY) as { content?: string } | undefined;
      return parseState(row?.content || null);
    } finally {
      database.close();
    }
  }
  try {
    const content = await readSnapshotFile(STATE_FILE);
    return parseState(content);
  } catch {
    return createEmptyState();
  }
}

export async function writeOptionsQuantState(state: OptionsQuantState): Promise<void> {
  state.asOf = new Date().toISOString();
  const content = JSON.stringify(state, null, 2);
  const databasePath = sqliteStatePath();
  if (databasePath) {
    const database = await openStateDatabase(databasePath);
    try {
      database.prepare(`
        INSERT INTO options_quant_state (state_key, content, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(state_key) DO UPDATE SET
          content = excluded.content,
          updated_at = excluded.updated_at
      `).run(STATE_KEY, content, state.asOf);
    } finally {
      database.close();
    }
    return;
  }
  await writeSnapshotFile(STATE_FILE, content);
}
