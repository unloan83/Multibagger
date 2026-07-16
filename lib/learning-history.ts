import type { AgentRecommendationLog } from "@/lib/agents/types";
import type { ValidationRecord } from "@/lib/intelligence-validation";

// Outcomes produced before the publication/evidence contract was introduced
// are retained for audit but must not tune the current model.
export const LEARNING_EPOCH = "2026-07-16T00:00:00.000Z";

export function filterLearningValidationHistory(
  records: ValidationRecord[],
  now = new Date(),
) {
  const epoch = Date.parse(LEARNING_EPOCH);
  const futureLimit = now.getTime() + 60 * 60 * 1000;
  return dedupeBy(records.filter((record) => {
    const timestamp = Date.parse(record.timestamp);
    return Number.isFinite(timestamp) &&
      timestamp >= epoch &&
      timestamp <= futureLimit &&
      record.qualityStatus === "PASS" &&
      ["Accumulate", "Urgent Sell"].includes(record.action) &&
      record.predictedPrice > 0 &&
      record.targetPrice > 0 &&
      record.stopLoss > 0 &&
      Boolean(record.symbol) &&
      Boolean(record.recommendationId);
  }), (record) => record.recommendationId);
}

export function filterLearningAgentLogs(
  logs: AgentRecommendationLog[],
  now = new Date(),
) {
  const epoch = Date.parse(LEARNING_EPOCH);
  const futureLimit = now.getTime() + 60 * 60 * 1000;
  return dedupeBy(logs.filter((log) => {
    const timestamp = Date.parse(log.timestamp);
    return Number.isFinite(timestamp) &&
      timestamp >= epoch &&
      timestamp <= futureLimit &&
      ["Buy", "Sell"].includes(log.finalAction) &&
      log.entryPrice > 0 &&
      log.confidence >= 55 &&
      Boolean(log.stock) &&
      Boolean(log.id);
  }), (log) => log.id);
}

function dedupeBy<T>(rows: T[], getKey: (row: T) => string) {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    const key = getKey(row);
    const prior = byKey.get(key);
    if (!prior || Date.parse(getTimestamp(row)) >= Date.parse(getTimestamp(prior))) {
      byKey.set(key, row);
    }
  }
  return [...byKey.values()];
}

function getTimestamp(row: unknown) {
  return String((row as { timestamp?: string }).timestamp ?? "");
}
