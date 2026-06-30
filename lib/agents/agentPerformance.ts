import fs from "node:fs/promises";
import path from "node:path";
import type {
  AgentAction,
  AgentPerformanceOutput,
  AgentRecommendationLog,
  FinalRecommendation,
} from "@/lib/agents/types";
import type { ValidationRecord } from "@/lib/intelligence-validation";
import { average, clamp } from "@/lib/agents/utils";

export function agentPerformance({
  history,
  logs = [],
  now = new Date(),
}: {
  history: ValidationRecord[];
  logs?: AgentRecommendationLog[];
  now?: Date;
}): AgentPerformanceOutput {
  const legacyHistory = history.filter((record) => !logs.some((log) =>
    log.portfolioId === record.portfolioId &&
    log.stock.toUpperCase() === record.symbol.toUpperCase() &&
    log.timestamp.slice(0, 10) === record.timestamp.slice(0, 10),
  ));
  const hit = legacyHistory.filter((record) => record.validationStatus === "Hit").length + logs.filter((log) => log.status === "hit").length;
  const miss = legacyHistory.filter((record) => record.validationStatus === "Miss").length + logs.filter((log) => log.status === "miss").length;
  const pending = legacyHistory.filter((record) => ["Active", "Expired"].includes(record.validationStatus)).length + logs.filter((log) => log.status === "pending").length;
  const completed = hit + miss;
  const completedHistory = history.filter((record) => ["Hit", "Miss"].includes(record.validationStatus));
  const confidenceCalibration = completedHistory.length
    ? Math.round(clamp(100 - average(completedHistory.map((record) =>
      Math.abs(record.confidence - (record.validationStatus === "Hit" ? 100 : 0)))), 0, 100))
    : null;
  const agents = ["existingLogic", "info", "macroPolicy", "sentiment", "portfolio", "riskValidation"];
  const contributions = agents.map((agent) => {
    const completedLogs = logs.filter((log) =>
      log.status !== "pending" &&
      (log.positiveContributors.includes(agent) || log.negativeContributors.includes(agent)),
    );
    const correct = completedLogs.filter((log) => {
      const aligned = log.finalAction === "Sell"
        ? log.negativeContributors.includes(agent)
        : log.positiveContributors.includes(agent);
      return log.status === "hit" ? aligned : !aligned;
    }).length;
    const accuracy = completedLogs.length ? Math.round((correct / completedLogs.length) * 100) : null;
    const scoreAdjustment = completedLogs.length < 5 || accuracy === null
      ? 0
      : accuracy >= 70
        ? 0.3
        : accuracy < 45
          ? -0.3
          : 0;
    return {
      agent,
      positive: logs.filter((log) => log.positiveContributors.includes(agent)).length,
      negative: logs.filter((log) => log.negativeContributors.includes(agent)).length,
      completed: completedLogs.length,
      accuracy,
      scoreAdjustment,
    };
  });
  const scoreAdjustments = Object.fromEntries(
    contributions.map((item) => [item.agent, item.scoreAdjustment]),
  ) as AgentPerformanceOutput["scoreAdjustments"];
  const hitRate = completed ? Math.round((hit / completed) * 100) : null;

  return {
    agent: "Performance",
    generatedAt: now.toISOString(),
    total: hit + miss + pending,
    hit,
    miss,
    pending,
    hitRate,
    confidenceCalibration,
    contributions,
    scoreAdjustments,
    summary: completed
      ? `${hitRate}% hit rate across ${completed} completed recommendations; ${pending} pending.`
      : `No completed recommendation outcomes yet; ${pending} pending.`,
  };
}

export function toRecommendationLogs(
  recommendations: FinalRecommendation[],
  portfolioId: string,
  timestamp = new Date().toISOString(),
  context: {
    entryPrices?: Record<string, number>;
    currentLogic?: Record<string, { action: AgentAction; confidence: number }>;
    sourceTypes?: string[];
    sourceTypesBySymbol?: Record<string, string[]>;
  } = {},
): AgentRecommendationLog[] {
  const day = timestamp.slice(0, 10);
  return recommendations.map((recommendation) => {
    const current = context.currentLogic?.[recommendation.symbol];
    return ({
    id: `${day}:${portfolioId}:${recommendation.symbol}:${recommendation.timeframe}`,
    timestamp,
    portfolioId,
    stock: recommendation.symbol,
    agentScores: recommendation.agentScores,
    finalAction: recommendation.action,
    timeframe: recommendation.timeframe,
    target: recommendation.target,
    stopLoss: recommendation.stopLoss,
    confidence: recommendation.confidence,
    reason: recommendation.reason,
    entryPrice: context.entryPrices?.[recommendation.symbol] ?? 0,
    currentLogicAction: current?.action ?? "Watch",
    currentLogicConfidence: current?.confidence ?? 0,
    sourceTypes: context.sourceTypesBySymbol?.[recommendation.symbol] ?? context.sourceTypes ?? [],
    outcomes: buildPendingOutcomes(timestamp),
    outcomeReason: "Awaiting 1-day, 1-week, and 1-month evaluation windows.",
    shadowMode: true,
    status: "pending",
    positiveContributors: Object.entries(recommendation.agentScores)
      .filter(([, score]) => score >= 0.75)
      .map(([agent]) => agent),
    negativeContributors: Object.entries(recommendation.agentScores)
      .filter(([, score]) => score <= -0.75)
      .map(([agent]) => agent),
    });
  });
}

export function reconcileRecommendationLogs(
  logs: AgentRecommendationLog[],
  history: ValidationRecord[],
  currentPrices: Record<string, number> = {},
  now = new Date(),
) {
  return logs.map((log) => {
    const price = currentPrices[log.stock.toUpperCase()] ?? 0;
    const outcomes = evaluateHorizonOutcomes(log, price, now);
    const outcome = history
      .filter((record) =>
        record.portfolioId === log.portfolioId &&
        record.symbol.toUpperCase() === log.stock.toUpperCase() &&
        record.timestamp.slice(0, 10) >= log.timestamp.slice(0, 10) &&
        ["Hit", "Miss"].includes(record.validationStatus),
      )
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
    if (!outcome) {
      if (price <= 0) return { ...log, outcomes };
      if (log.finalAction === "Buy") {
        if (log.target && price >= log.target) return { ...log, outcomes, status: "hit" as const, outcomeReason: "Target reached." };
        if (log.stopLoss && price <= log.stopLoss) return { ...log, outcomes, status: "miss" as const, outcomeReason: "Stop loss reached." };
      }
      if (log.finalAction === "Sell") {
        if (log.target && price <= log.target) return { ...log, outcomes, status: "hit" as const, outcomeReason: "Downside target reached." };
        if (log.stopLoss && price >= log.stopLoss) return { ...log, outcomes, status: "miss" as const, outcomeReason: "Protective stop reached." };
      }
      const month = outcomes.find((item) => item.horizon === "1 month");
      return month && month.status !== "pending"
        ? { ...log, outcomes, status: month.status, outcomeReason: month.reason }
        : { ...log, outcomes };
    }
    return {
      ...log,
      outcomes,
      status: outcome.validationStatus === "Hit" ? "hit" as const : "miss" as const,
      outcomeReason: `Matched validation record ${outcome.recommendationId}.`,
    };
  });
}

function buildPendingOutcomes(timestamp: string): AgentRecommendationLog["outcomes"] {
  const start = Date.parse(timestamp);
  return [
    { horizon: "1 day", days: 1 },
    { horizon: "1 week", days: 7 },
    { horizon: "1 month", days: 30 },
  ].map(({ horizon, days }) => ({
    horizon: horizon as "1 day" | "1 week" | "1 month",
    dueAt: new Date(start + days * 86_400_000).toISOString(),
    evaluatedAt: null,
    price: null,
    returnPercent: null,
    status: "pending",
    reason: "Evaluation window has not closed.",
  }));
}

function evaluateHorizonOutcomes(
  log: AgentRecommendationLog,
  price: number,
  now: Date,
): AgentRecommendationLog["outcomes"] {
  const outcomes = log.outcomes?.length ? log.outcomes : buildPendingOutcomes(log.timestamp);
  return outcomes.map((outcome) => {
    if (outcome.status !== "pending" || now.getTime() < Date.parse(outcome.dueAt) || price <= 0 || log.entryPrice <= 0) {
      return outcome;
    }
    const returnPercent = ((price - log.entryPrice) / log.entryPrice) * 100;
    const hit = log.finalAction === "Buy"
      ? returnPercent > 0
      : log.finalAction === "Sell"
        ? returnPercent < 0
        : log.finalAction === "Hold"
          ? returnPercent >= -3
          : Math.abs(returnPercent) <= 5;
    return {
      ...outcome,
      evaluatedAt: now.toISOString(),
      price,
      returnPercent: Math.round(returnPercent * 100) / 100,
      status: hit ? "hit" as const : "miss" as const,
      reason: `${log.finalAction} shadow decision returned ${returnPercent.toFixed(2)}% by ${outcome.horizon}.`,
    };
  });
}

export async function readRecommendationLogs(): Promise<AgentRecommendationLog[]> {
  try {
    const content = await fs.readFile(logPath(), "utf8");
    return content.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as AgentRecommendationLog);
  } catch {
    return [];
  }
}

export async function appendRecommendationLogs(logs: AgentRecommendationLog[]) {
  if (!logs.length) return 0;
  try {
    const existing = await readRecommendationLogs();
    const ids = new Set(existing.map((log) => log.id));
    const additions = logs.filter((log) => !ids.has(log.id));
    if (!additions.length) return 0;
    const filePath = logPath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, `${additions.map((log) => JSON.stringify(log)).join("\n")}\n`, "utf8");
    return additions.length;
  } catch {
    return 0;
  }
}

function logPath() {
  return process.env.AGENT_RECOMMENDATION_LOG_PATH?.trim() || path.join(process.cwd(), "data", "agent-recommendation-logs.ndjson");
}
