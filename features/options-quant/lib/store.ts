import { readSnapshotFile, writeSnapshotFile } from "@/lib/snapshot-storage";
import type { OptionsQuantState, PerformanceMetrics, StrategyEvaluation } from "@/features/options-quant/lib/types";

const STATE_FILE = "options-quant/state.json";

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
  return {
    schemaVersion: 1,
    asOf: new Date().toISOString(),
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
      portfolioCapitalConfigured: Number(process.env.OPTIONS_QUANT_PORTFOLIO_CAPITAL) > 0,
      sandboxOrderSubmissionEnabled: process.env.OPTIONS_QUANT_SUBMIT_SANDBOX_ORDERS === "true",
    },
  };
}

export async function readOptionsQuantState(): Promise<OptionsQuantState> {
  const content = await readSnapshotFile(STATE_FILE);
  if (!content) return createEmptyState();
  try {
    const state = JSON.parse(content) as OptionsQuantState;
    return state.schemaVersion === 1 ? state : createEmptyState();
  } catch {
    return createEmptyState();
  }
}

export async function writeOptionsQuantState(state: OptionsQuantState): Promise<void> {
  state.asOf = new Date().toISOString();
  await writeSnapshotFile(STATE_FILE, JSON.stringify(state, null, 2));
}
