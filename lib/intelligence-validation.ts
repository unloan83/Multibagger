import type { Recommendation } from "@/lib/portfolio";

export type OutcomeStatus = "Active" | "Hit" | "Miss" | "Expired";
export type QualityStatus = "PASS" | "FAIL";

export type QualityFactors = {
  marketRegimeAvailable: boolean;
  sectorStrengthAvailable: boolean;
  trendConfirmationAvailable: boolean;
  riskScoreAssigned: boolean;
  confidenceCalculated: boolean;
  portfolioFitChecked: boolean;
  recommendationHorizonAssigned: boolean;
};

export type ValidationRecord = {
  timestamp: string;
  date: string;
  source: string;
  portfolioName: string;
  section: string;
  symbol: string;
  company: string;
  action: string;
  horizon: string;
  predictedPrice: number;
  targetPrice: number;
  predictedUpsidePercent: number;
  score: number;
  confidence: number;
  validationStatus: OutcomeStatus;
  hitTimestamp: string;
  actualPrice: number;
  caveat: string;
  rationale: string;
  portfolioId: string;
  recommendationId: string;
  sector: string;
  stopLoss: number;
  qualityScore: number;
  qualityStatus: QualityStatus;
  validationTimestamp: string;
  validationDate: string;
  returnPercent: number;
  marketRegime: string;
  qualityFactors: QualityFactors;
};

export type LearningRow = {
  calculatedAt: string;
  dimension: "Sector" | "Recommendation Type" | "Market Regime" | "Confidence" | "Portfolio" | "Source";
  label: string;
  hits: number;
  misses: number;
  expired: number;
  active: number;
  sampleSize: number;
  successRate: number;
  weightMultiplier: number;
};

export function validateRecommendationQuality({
  recommendation,
  marketRegime,
  sector,
  portfolioFitChecked,
}: {
  recommendation: Pick<Recommendation, "confidence" | "horizon" | "metrics">;
  marketRegime: string;
  sector: string;
  portfolioFitChecked: boolean;
}) {
  const metrics = recommendation.metrics;
  const factors: QualityFactors = {
    marketRegimeAvailable: Boolean(marketRegime),
    sectorStrengthAvailable: Boolean(sector && sector !== "Unclassified"),
    trendConfirmationAvailable: Boolean(
      metrics &&
        Number.isFinite(metrics.ema20) &&
        Number.isFinite(metrics.ema50) &&
        metrics.ema20 > 0 &&
        metrics.ema50 > 0,
    ),
    riskScoreAssigned: Boolean(metrics && Number.isFinite(metrics.riskScore)),
    confidenceCalculated:
      Number.isFinite(recommendation.confidence) &&
      recommendation.confidence >= 0 &&
      recommendation.confidence <= 100,
    portfolioFitChecked,
    recommendationHorizonAssigned: Boolean(recommendation.horizon.trim()),
  };
  const passed = Object.values(factors).filter(Boolean).length;
  const score = Math.round((passed / Object.keys(factors).length) * 100);

  return {
    factors,
    score,
    status: (score >= 85 ? "PASS" : "FAIL") as QualityStatus,
  };
}

export function calculateStopLoss(
  price: number,
  action: string,
  section: string,
  riskScore = 0,
) {
  if (price <= 0) return 0;
  const isSell = action === "Urgent Sell";
  const baseRisk = section === "Intraday" ? 0.025 : riskScore >= 55 ? 0.12 : 0.08;

  return roundPrice(price * (isSell ? 1 + baseRisk : 1 - baseRisk));
}

export function evaluateOutcome(
  record: Pick<
    ValidationRecord,
    "timestamp" | "horizon" | "predictedPrice" | "targetPrice" | "stopLoss"
  >,
  currentPrice: number,
  now = new Date(),
) {
  const returnPercent =
    record.predictedPrice > 0 && currentPrice > 0
      ? ((currentPrice - record.predictedPrice) / record.predictedPrice) * 100
      : 0;
  let status: OutcomeStatus = "Active";

  if (currentPrice > 0 && record.targetPrice > 0 && currentPrice >= record.targetPrice) {
    status = "Hit";
  } else if (currentPrice > 0 && record.stopLoss > 0 && currentPrice <= record.stopLoss) {
    status = "Miss";
  } else if (isHorizonExpired(record.timestamp, record.horizon, now)) {
    status = "Expired";
  }

  return { status, returnPercent: roundOne(returnPercent) };
}

export function buildLearningRows(records: ValidationRecord[], now = new Date()) {
  const completed = records.filter(
    (record) =>
      record.validationStatus === "Hit" ||
      record.validationStatus === "Miss" ||
      record.validationStatus === "Expired",
  );
  const dimensions: Array<[LearningRow["dimension"], (record: ValidationRecord) => string]> = [
    ["Sector", (record) => record.sector || "Unclassified"],
    ["Recommendation Type", (record) => record.section || "Unknown"],
    ["Market Regime", (record) => record.marketRegime || "Unknown"],
    ["Confidence", (record) => confidenceBucket(record.confidence)],
    ["Portfolio", (record) => record.portfolioName || "Unknown"],
    ["Source", (record) => sourceLabel(record.source)],
  ];

  return dimensions.flatMap(([dimension, getLabel]) => {
    const groups = records.reduce<Record<string, ValidationRecord[]>>((acc, record) => {
      const label = getLabel(record);
      acc[label] = [...(acc[label] ?? []), record];
      return acc;
    }, {});

    return Object.entries(groups).map(([label, rows]): LearningRow => {
      const hits = rows.filter((row) => row.validationStatus === "Hit").length;
      const misses = rows.filter((row) => row.validationStatus === "Miss").length;
      const expired = rows.filter((row) => row.validationStatus === "Expired").length;
      const active = rows.filter((row) => row.validationStatus === "Active").length;
      const scored = hits + misses;
      const successRate = scored ? Math.round((hits / scored) * 100) : 0;

      return {
        calculatedAt: now.toISOString(),
        dimension,
        label,
        hits,
        misses,
        expired,
        active,
        sampleSize: scored,
        successRate,
        weightMultiplier: feedbackWeight(successRate, scored),
      };
    });
  }).filter((row) => row.label !== "Unknown" || completed.length > 0);
}

export function buildIntelligenceSummary(records: ValidationRecord[], portfolioId?: string) {
  const scoped = portfolioId
    ? records.filter((record) => record.portfolioId === portfolioId)
    : records;
  const recent = [...scoped]
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, 20);

  return {
    total: scoped.length,
    quality: {
      averageScore: average(scoped.map((record) => record.qualityScore)),
      passed: scoped.filter((record) => record.qualityStatus === "PASS").length,
      failed: scoped.filter((record) => record.qualityStatus === "FAIL").length,
    },
    outcomes: summarizeOutcomes(scoped),
    last7Days: summarizeOutcomes(filterDays(scoped, 7)),
    last30Days: summarizeOutcomes(filterDays(scoped, 30)),
    confidenceCalibration: buildLearningRows(scoped).filter(
      (row) => row.dimension === "Confidence",
    ),
    learning: buildLearningRows(scoped),
    recent,
  };
}

function summarizeOutcomes(records: ValidationRecord[]) {
  const hits = records.filter((record) => record.validationStatus === "Hit").length;
  const misses = records.filter((record) => record.validationStatus === "Miss").length;
  const active = records.filter((record) => record.validationStatus === "Active").length;
  const expired = records.filter((record) => record.validationStatus === "Expired").length;
  const scored = hits + misses;

  return {
    total: records.length,
    hits,
    misses,
    active,
    expired,
    hitRate: scored ? Math.round((hits / scored) * 100) : 0,
  };
}

function filterDays(records: ValidationRecord[], days: number) {
  const cutoff = Date.now() - days * 86_400_000;
  return records.filter((record) => Date.parse(record.timestamp) >= cutoff);
}

function isHorizonExpired(timestamp: string, horizon: string, now: Date) {
  const created = Date.parse(timestamp);
  if (!Number.isFinite(created)) return false;
  return now.getTime() - created > horizonDays(horizon) * 86_400_000;
}

function horizonDays(horizon: string) {
  const normalized = horizon.toLowerCase();
  if (normalized.includes("today") || normalized.includes("intraday") || normalized.includes("min")) return 1;
  if (normalized.includes("1-3 year")) return 1_095;
  if (normalized.includes("6-12 month")) return 365;
  const dayMatch = normalized.match(/(\d+)\s*day/u);
  if (dayMatch) return Number(dayMatch[1]);
  const monthMatch = normalized.match(/(\d+)(?:-(\d+))?\s*month/u);
  if (monthMatch) return Number(monthMatch[2] ?? monthMatch[1]) * 30;
  return 90;
}

function confidenceBucket(confidence: number) {
  if (confidence >= 90) return "90-100";
  if (confidence >= 80) return "80-89";
  if (confidence >= 70) return "70-79";
  if (confidence >= 60) return "60-69";
  return "Below 60";
}

function sourceLabel(source: string) {
  if (source === "expert-insight") return "Expert Recommendation";
  if (source === "market-recommendation") return "Market Recommendation";
  if (source === "portfolio-recommendation") return "Portfolio Recommendation";
  return source || "Unknown";
}

function feedbackWeight(successRate: number, sampleSize: number) {
  if (sampleSize < 5) return 1;
  if (successRate >= 75) return 1.15;
  if (successRate >= 65) return 1.08;
  if (successRate < 45) return 0.85;
  if (successRate < 55) return 0.92;
  return 1;
}

function average(values: number[]) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

function roundPrice(value: number) {
  return Math.round(value * 100) / 100;
}
