import type { ValidationRecord } from "@/lib/intelligence-validation";
import { filterLearningValidationHistory } from "@/lib/learning-history";

export type ModelEvaluation = {
  generatedAt: string;
  status: "INSUFFICIENT_DATA" | "SHADOW_ONLY" | "ELIGIBLE_FOR_REVIEW";
  sample: { total: number; completed: number; training: number; test: number };
  outOfSample: {
    hitRate: number | null;
    averageReturnPercent: number | null;
    cashBaselineReturnPercent: 0;
    excessReturnVsCashPercent: number | null;
    brierScore: number | null;
    maximumDrawdownPercent: number | null;
  };
  walkForward: Array<{
    fold: number;
    trainingThrough: string;
    testFrom: string;
    testThrough: string;
    sampleSize: number;
    hitRate: number;
    averageReturnPercent: number;
  }>;
  regimeStress: Array<{
    regime: string;
    sampleSize: number;
    hitRate: number;
    averageReturnPercent: number;
    maximumDrawdownPercent: number;
  }>;
  promotionGate: {
    eligible: boolean;
    minimumCompleted: number;
    minimumTest: number;
    reasons: string[];
  };
  limitations: string[];
};

const MIN_COMPLETED = 50;
const MIN_TEST = 20;
const TRAINING_FRACTION = 0.7;

export function evaluateRecommendationModel(
  input: ValidationRecord[],
  now = new Date(),
): ModelEvaluation {
  const clean = filterLearningValidationHistory(input, now);
  const completed = clean
    .filter((record) => record.validationStatus === "Hit" || record.validationStatus === "Miss")
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const split = Math.max(1, Math.floor(completed.length * TRAINING_FRACTION));
  const training = completed.slice(0, split);
  const test = completed.slice(split);
  const metrics = metricsFor(test);
  const walkForward = buildWalkForward(completed);
  const regimeStress = Object.entries(groupBy(test, (record) => record.marketRegime || "Unknown"))
    .map(([regime, records]) => ({ regime, sampleSize: records.length, ...requiredMetrics(records) }))
    .sort((a, b) => b.sampleSize - a.sampleSize);
  const reasons: string[] = [];
  if (completed.length < MIN_COMPLETED) reasons.push(`Only ${completed.length} completed outcomes; ${MIN_COMPLETED} required.`);
  if (test.length < MIN_TEST) reasons.push(`Only ${test.length} held-out outcomes; ${MIN_TEST} required.`);
  if (metrics.hitRate == null || metrics.hitRate < 55) reasons.push("Held-out hit rate is below 55%.");
  if (metrics.averageReturnPercent == null || metrics.averageReturnPercent <= 0) reasons.push("Held-out average return does not beat the 0% cash baseline.");
  if (metrics.brierScore == null || metrics.brierScore > 0.25) reasons.push("Held-out confidence calibration has not cleared the 0.25 Brier threshold.");
  if (metrics.maximumDrawdownPercent == null || metrics.maximumDrawdownPercent < -15) reasons.push("Held-out maximum drawdown exceeds the 15% capital-preservation limit.");
  if (regimeStress.some((regime) => regime.sampleSize >= 5 && regime.averageReturnPercent < 0)) {
    reasons.push("At least one sufficiently sampled market regime has negative average returns.");
  }
  const sufficient = completed.length >= MIN_COMPLETED && test.length >= MIN_TEST;
  const eligible = sufficient && reasons.length === 0;

  return {
    generatedAt: now.toISOString(),
    status: !sufficient ? "INSUFFICIENT_DATA" : eligible ? "ELIGIBLE_FOR_REVIEW" : "SHADOW_ONLY",
    sample: { total: clean.length, completed: completed.length, training: training.length, test: test.length },
    outOfSample: {
      ...metrics,
      cashBaselineReturnPercent: 0,
      excessReturnVsCashPercent: metrics.averageReturnPercent,
    },
    walkForward,
    regimeStress,
    promotionGate: { eligible, minimumCompleted: MIN_COMPLETED, minimumTest: MIN_TEST, reasons },
    limitations: [
      "Cash is the only free baseline currently available; NIFTY point-in-time benchmark returns are not yet stored.",
      "Validation uses recommendation outcomes, not a survivorship-bias-free historical security master.",
      "Transaction costs and slippage must be embedded in future outcome snapshots for institutional-grade evaluation.",
    ],
  };
}

function buildWalkForward(records: ValidationRecord[]) {
  if (records.length < 30) return [];
  const folds = [];
  const testSize = Math.max(5, Math.floor(records.length * 0.15));
  for (let end = Math.max(20, records.length - testSize * 3); end + testSize <= records.length; end += testSize) {
    const test = records.slice(end, end + testSize);
    const metrics = requiredMetrics(test);
    folds.push({
      fold: folds.length + 1,
      trainingThrough: records[end - 1].timestamp,
      testFrom: test[0].timestamp,
      testThrough: test.at(-1)!.timestamp,
      sampleSize: test.length,
      hitRate: metrics.hitRate,
      averageReturnPercent: metrics.averageReturnPercent,
    });
  }
  return folds;
}

function metricsFor(records: ValidationRecord[]) {
  if (!records.length) return { hitRate: null, averageReturnPercent: null, brierScore: null, maximumDrawdownPercent: null };
  const hitRate = percent(records.filter((record) => record.validationStatus === "Hit").length / records.length);
  const averageReturnPercent = round(records.reduce((sum, record) => sum + directionalReturn(record), 0) / records.length);
  const brierScore = round(records.reduce((sum, record) => {
    const probability = record.confidence / 100;
    const outcome = record.validationStatus === "Hit" ? 1 : 0;
    return sum + (probability - outcome) ** 2;
  }, 0) / records.length, 4);
  return { hitRate, averageReturnPercent, brierScore, maximumDrawdownPercent: maximumDrawdown(records) };
}

function requiredMetrics(records: ValidationRecord[]) {
  const metrics = metricsFor(records);
  return {
    hitRate: metrics.hitRate ?? 0,
    averageReturnPercent: metrics.averageReturnPercent ?? 0,
    maximumDrawdownPercent: metrics.maximumDrawdownPercent ?? 0,
  };
}

function directionalReturn(record: ValidationRecord) {
  return record.action === "Urgent Sell" ? -record.returnPercent : record.returnPercent;
}

function maximumDrawdown(records: ValidationRecord[]) {
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  for (const record of records) {
    equity *= 1 + Math.max(-99, directionalReturn(record)) / 100;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, ((equity - peak) / peak) * 100);
  }
  return round(maxDrawdown);
}

function groupBy<T>(rows: T[], getKey: (row: T) => string) {
  return rows.reduce<Record<string, T[]>>((groups, row) => {
    const key = getKey(row);
    groups[key] = [...(groups[key] ?? []), row];
    return groups;
  }, {});
}

function percent(value: number) { return Math.round(value * 100); }
function round(value: number, digits = 2) { const scale = 10 ** digits; return Math.round(value * scale) / scale; }
