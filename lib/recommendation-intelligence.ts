import fs from "node:fs/promises";
import path from "node:path";
import type { ValidationRecord } from "@/lib/intelligence-validation";

export type SentimentClass = "Positive" | "Neutral" | "Negative";
export type SectorDirectionLabel = "Top Sector" | "Strong Sector" | "Neutral Sector" | "Weak Sector";

export type SentimentSignal = {
  classification: SentimentClass;
  score: number;
  sampleSize: number;
};

export type PolicySignal = {
  classification: SentimentClass;
  score: number;
  matchedHeadlines: number;
};

export type SectorDirection = {
  sector: string;
  rank: number;
  score: number;
  label: SectorDirectionLabel;
  return20Percent: number;
  return60Percent: number;
  trendBreadthPercent: number;
  newsSentimentScore: number;
  policyScore: number;
};

export type ReviewWindow = {
  days: 7 | 30 | 90;
  hits: number;
  misses: number;
  active: number;
  expired: number;
  sampleSize: number;
  hitRate: number;
  missRate: number;
};

export type LearningFeedback = {
  adjustment: number;
  confidenceAccuracy: number;
  recommendationQualityScore: number;
  sectorAccuracy: Record<string, number>;
  sectorAdjustments: Record<string, number>;
  typeAdjustments: Record<string, number>;
  windows: ReviewWindow[];
};

export type IntelligenceFactorBreakdown = {
  technicalStrength: number;
  fundamentalStrength: number;
  portfolioFit: number;
  sectorMomentum: number;
  newsSentiment: number;
  governmentPolicy: number;
  expertConsensus: number;
  learningFeedback: number;
};

export type RecommendationIntelligence = {
  baseScore: number;
  contextAdjustment: number;
  finalScore: number;
  sentimentScore: number;
  sentiment: SentimentClass;
  sectorPolicyScore: number;
  sectorDirectionScore: number;
  sectorDirectionLabel: SectorDirectionLabel;
  sectorDirection: SectorDirection;
  expertFocusCount: number;
  learningAdjustment: number;
  factorWeights: IntelligenceFactorBreakdown;
  contributions: IntelligenceFactorBreakdown;
  reasons: string[];
};

export type TechnicalSectorInput = {
  sector: string;
  return20Percent: number;
  return60Percent: number;
  trendAligned: boolean;
};

const positiveTerms = [
  "award",
  "beat",
  "boost",
  "expansion",
  "growth",
  "improve",
  "launch",
  "order",
  "profit",
  "record",
  "recovery",
  "strong",
  "surge",
  "upgrade",
  "wins",
];

const negativeTerms = [
  "cut",
  "decline",
  "default",
  "delay",
  "downgrade",
  "fall",
  "fraud",
  "investigation",
  "loss",
  "penalty",
  "probe",
  "regulatory action",
  "resigns",
  "slump",
  "weak",
];

const policyPositiveTerms = [
  "allocation",
  "approved",
  "budget",
  "capital expenditure",
  "government order",
  "incentive",
  "investment",
  "outlay",
  "pli",
  "procurement",
  "scheme",
  "spending",
  "subsidy",
];

const policyNegativeTerms = [
  "ban",
  "cancel",
  "compliance burden",
  "cut spending",
  "duty hike",
  "investigation",
  "restriction",
  "tax hike",
];

const governmentTerms = [
  "budget",
  "cabinet",
  "government",
  "ministry",
  "policy",
  "pli",
  "regulator",
  "scheme",
];

export function classifyNewsSentiment(
  companyHeadlines: string[],
  sectorHeadlines: string[] = [],
  marketHeadlines: string[] = [],
): SentimentSignal {
  const weighted = [
    ...companyHeadlines.map((headline) => ({ headline, weight: 1 })),
    ...sectorHeadlines.map((headline) => ({ headline, weight: 0.65 })),
    ...marketHeadlines.map((headline) => ({ headline, weight: 0.35 })),
  ];
  if (!weighted.length) {
    return { classification: "Neutral", score: 0, sampleSize: 0 };
  }

  const raw = weighted.reduce(
    (sum, item) => sum + headlineTone(item.headline) * item.weight,
    0,
  );
  const score = clamp(Math.round((raw / weighted.length) * 35), -10, 10);
  return {
    classification: score >= 3 ? "Positive" : score <= -3 ? "Negative" : "Neutral",
    score,
    sampleSize: weighted.length,
  };
}

export function scoreGovernmentPolicy(
  sector: string,
  sectorHeadlines: string[],
  policyHeadlines: string[],
): PolicySignal {
  const sectorTerms = normalizedSectorTerms(sector);
  const relevant = [...sectorHeadlines, ...policyHeadlines].filter((headline) => {
    const normalized = headline.toLowerCase();
    return (
      governmentTerms.some((term) => normalized.includes(term)) &&
      sectorTerms.some((term) => normalized.includes(term))
    );
  });
  if (!relevant.length) {
    return { classification: "Neutral", score: 0, matchedHeadlines: 0 };
  }

  const raw = relevant.reduce((sum, headline) => {
    const normalized = headline.toLowerCase();
    const positive = policyPositiveTerms.filter((term) => normalized.includes(term)).length;
    const negative = policyNegativeTerms.filter((term) => normalized.includes(term)).length;
    return sum + positive - negative * 1.5;
  }, 0);
  const score = clamp(Math.round((raw / relevant.length) * 4), -10, 10);
  return {
    classification: score >= 3 ? "Positive" : score <= -3 ? "Negative" : "Neutral",
    score,
    matchedHeadlines: relevant.length,
  };
}

export function rankSectorDirections(
  rows: TechnicalSectorInput[],
  sectorNews: Record<string, string[]>,
  policyHeadlines: string[],
) {
  const groups = rows.reduce<Record<string, TechnicalSectorInput[]>>((acc, row) => {
    acc[row.sector] = [...(acc[row.sector] ?? []), row];
    return acc;
  }, {});

  const ranked = Object.entries(groups)
    .map(([sector, sectorRows]) => {
      const return20Percent = average(sectorRows.map((row) => row.return20Percent));
      const return60Percent = average(sectorRows.map((row) => row.return60Percent));
      const trendBreadthPercent =
        (sectorRows.filter((row) => row.trendAligned).length / sectorRows.length) * 100;
      const news = classifyNewsSentiment([], sectorNews[sector] ?? []);
      const policy = scoreGovernmentPolicy(
        sector,
        sectorNews[sector] ?? [],
        policyHeadlines,
      );
      const score = clamp(
        Math.round(
          50 +
            clamp(return20Percent, -20, 20) * 1.2 +
            clamp(return60Percent, -30, 30) * 0.6 +
            (trendBreadthPercent - 50) * 0.25 +
            news.score * 0.8 +
            policy.score * 0.8,
        ),
        0,
        100,
      );
      return {
        sector,
        score,
        return20Percent,
        return60Percent,
        trendBreadthPercent,
        newsSentimentScore: news.score,
        policyScore: policy.score,
      };
    })
    .sort((a, b) => b.score - a.score);

  return ranked.map((sector, index): SectorDirection => ({
    ...sector,
    rank: index + 1,
    label:
      index === 0
        ? "Top Sector"
        : index >= Math.max(1, Math.floor(ranked.length * 0.8))
          ? "Weak Sector"
        : sector.score >= 62
          ? "Strong Sector"
          : sector.score < 40
            ? "Weak Sector"
            : "Neutral Sector",
  }));
}

export function filterSectorHeadlines(
  sector: string,
  headlines: string[],
) {
  const terms = normalizedSectorTerms(sector);
  return headlines.filter((headline) => {
    const normalized = headline.toLowerCase();
    return terms.some((term) => normalized.includes(term));
  });
}

export function buildLearningFeedback(
  records: ValidationRecord[],
  now = new Date(),
): LearningFeedback {
  const windows = ([7, 30, 90] as const).map((days) =>
    summarizeReviewWindow(records, days, now),
  );
  const completed = records.filter((record) =>
    ["Hit", "Miss"].includes(record.validationStatus),
  );
  const sectorAccuracy = groupAccuracy(completed, (record) => record.sector || "Unclassified");
  const typeAccuracy = groupAccuracy(completed, (record) => record.section || "Unknown");
  const sectorAdjustments = Object.fromEntries(
    Object.entries(sectorAccuracy).map(([sector, hitRate]) => [
      sector,
      feedbackAdjustment(hitRate, completed.filter((record) => record.sector === sector).length),
    ]),
  );
  const typeAdjustments = Object.fromEntries(
    Object.entries(typeAccuracy).map(([type, hitRate]) => [
      type,
      feedbackAdjustment(hitRate, completed.filter((record) => record.section === type).length),
    ]),
  );
  const confidenceAccuracy = calculateConfidenceAccuracy(completed);
  const qualityAverage = average(records.map((record) => record.qualityScore));
  if (!records.length) {
    return {
      adjustment: 0,
      confidenceAccuracy: 0,
      recommendationQualityScore: 0,
      sectorAccuracy: {},
      sectorAdjustments: {},
      typeAdjustments: {},
      windows,
    };
  }
  const recentHitRate = windows[1].sampleSize ? windows[1].hitRate : 50;
  const recommendationQualityScore = clamp(
    Math.round(qualityAverage * 0.35 + recentHitRate * 0.4 + confidenceAccuracy * 0.25),
    0,
    100,
  );

  return {
    adjustment: feedbackAdjustment(recentHitRate, windows[1].sampleSize),
    confidenceAccuracy,
    recommendationQualityScore,
    sectorAccuracy,
    sectorAdjustments,
    typeAdjustments,
    windows,
  };
}

export function applyRecommendationIntelligence({
  baseScore,
  technicalStrength,
  fundamentalStrength,
  portfolioFit = 50,
  sectorDirection,
  newsSentiment,
  policy,
  expertFocusCount,
  learningAdjustment,
}: {
  baseScore: number;
  technicalStrength: number;
  fundamentalStrength: number;
  portfolioFit?: number;
  sectorDirection: SectorDirection;
  newsSentiment: SentimentSignal;
  policy: PolicySignal;
  expertFocusCount: number;
  learningAdjustment: number;
}): RecommendationIntelligence {
  const sectorAdjustment = clamp((sectorDirection.score - 50) / 12.5, -4, 4);
  const newsAdjustment = clamp(newsSentiment.score * 0.3, -3, 3);
  const policyAdjustment = clamp(policy.score * 0.2, -2, 2);
  const expertAdjustment = clamp(expertFocusCount * 0.4, 0, 2);
  const boundedLearning = clamp(learningAdjustment, -2, 2);
  const contextAdjustment = clamp(
    sectorAdjustment +
      newsAdjustment +
      policyAdjustment +
      expertAdjustment +
      boundedLearning,
    -12,
    12,
  );
  const factorWeights: IntelligenceFactorBreakdown = {
    technicalStrength: 25,
    fundamentalStrength: 30,
    portfolioFit: 5,
    sectorMomentum: 15,
    newsSentiment: 8,
    governmentPolicy: 5,
    expertConsensus: 5,
    learningFeedback: 7,
  };
  const contributions: IntelligenceFactorBreakdown = {
    technicalStrength: normalizeContribution(technicalStrength, factorWeights.technicalStrength),
    fundamentalStrength: normalizeContribution(fundamentalStrength, factorWeights.fundamentalStrength),
    portfolioFit: normalizeContribution(portfolioFit, factorWeights.portfolioFit),
    sectorMomentum: normalizeContribution(sectorDirection.score, factorWeights.sectorMomentum),
    newsSentiment: normalizeContribution((newsSentiment.score + 10) * 5, factorWeights.newsSentiment),
    governmentPolicy: normalizeContribution((policy.score + 10) * 5, factorWeights.governmentPolicy),
    expertConsensus: normalizeContribution(Math.min(100, expertFocusCount * 20), factorWeights.expertConsensus),
    learningFeedback: normalizeContribution(50 + boundedLearning * 20, factorWeights.learningFeedback),
  };
  const reasons = [
    `${sectorDirection.label}: ${sectorDirection.sector} scored ${sectorDirection.score}/100.`,
    `News sentiment ${newsSentiment.classification.toLowerCase()} (${newsSentiment.score}/10).`,
    `Government policy impact ${policy.classification.toLowerCase()} (${policy.score}/10).`,
    `Expert focus count ${expertFocusCount}.`,
    `Learning adjustment ${boundedLearning >= 0 ? "+" : ""}${boundedLearning.toFixed(1)} points.`,
  ];

  return {
    baseScore,
    contextAdjustment: roundOne(contextAdjustment),
    finalScore: clamp(Math.round(baseScore + contextAdjustment), 0, 100),
    sentimentScore: newsSentiment.score,
    sentiment: newsSentiment.classification,
    sectorPolicyScore: policy.score,
    sectorDirectionScore: sectorDirection.score,
    sectorDirectionLabel: sectorDirection.label,
    sectorDirection,
    expertFocusCount,
    learningAdjustment: boundedLearning,
    factorWeights,
    contributions,
    reasons,
  };
}

export async function fetchHeadlineIntelligence(query: string, count = 8) {
  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=0&newsCount=${count}`,
      {
        headers: { "User-Agent": "Mozilla/5.0" },
        next: { revalidate: 1_800 },
      },
    );
    if (!response.ok) return [];
    const data = (await response.json()) as {
      news?: Array<{ title?: string }>;
    };
    return (data.news ?? [])
      .map((item) => item.title?.trim())
      .filter((title): title is string => Boolean(title))
      .slice(0, count);
  } catch {
    return [];
  }
}

export async function readExpertConsensusCounts() {
  const remote = await readRemoteExpertConsensus();
  if (Object.keys(remote).length) return remote;
  const configured = await readConfiguredExpertConsensus();
  return configured;
}

function headlineTone(headline: string) {
  const normalized = headline.toLowerCase();
  const positive = positiveTerms.filter((term) => normalized.includes(term)).length;
  const negative = negativeTerms.filter((term) => normalized.includes(term)).length;
  return clamp(positive - negative * 1.25, -3, 3);
}

function normalizedSectorTerms(sector: string) {
  const normalized = sector.toLowerCase();
  const terms = normalized
    .split(/[^a-z0-9]+/u)
    .filter((term) => term.length >= 4);
  const aliases: Record<string, string[]> = {
    "automobile and auto components": ["automobile", "auto", "electric vehicle", "ev"],
    "capital goods": ["capital goods", "manufacturing", "industrial"],
    "information technology": ["information technology", "technology", "digital", "semiconductor"],
    "oil gas & consumable fuels": ["oil", "gas", "fuel", "energy"],
    "power": ["power", "electricity", "grid", "renewable"],
    "telecommunication": ["telecom", "5g", "broadband"],
  };
  return [...new Set([sector.toLowerCase(), ...terms, ...(aliases[normalized] ?? [])])];
}

function summarizeReviewWindow(
  records: ValidationRecord[],
  days: 7 | 30 | 90,
  now: Date,
): ReviewWindow {
  const cutoff = now.getTime() - days * 86_400_000;
  const scoped = records.filter((record) => Date.parse(record.timestamp) >= cutoff);
  const hits = scoped.filter((record) => record.validationStatus === "Hit").length;
  const misses = scoped.filter((record) => record.validationStatus === "Miss").length;
  const active = scoped.filter((record) => record.validationStatus === "Active").length;
  const expired = scoped.filter((record) => record.validationStatus === "Expired").length;
  const sampleSize = hits + misses;
  return {
    days,
    hits,
    misses,
    active,
    expired,
    sampleSize,
    hitRate: sampleSize ? Math.round((hits / sampleSize) * 100) : 0,
    missRate: sampleSize ? Math.round((misses / sampleSize) * 100) : 0,
  };
}

function groupAccuracy(
  records: ValidationRecord[],
  getKey: (record: ValidationRecord) => string,
) {
  const groups = records.reduce<Record<string, ValidationRecord[]>>((acc, record) => {
    const key = getKey(record);
    acc[key] = [...(acc[key] ?? []), record];
    return acc;
  }, {});
  return Object.fromEntries(
    Object.entries(groups).map(([key, rows]) => {
      const hits = rows.filter((row) => row.validationStatus === "Hit").length;
      return [key, rows.length ? Math.round((hits / rows.length) * 100) : 0];
    }),
  );
}

function calculateConfidenceAccuracy(records: ValidationRecord[]) {
  if (!records.length) return 0;
  const error = average(
    records.map((record) => {
      const outcome = record.validationStatus === "Hit" ? 100 : 0;
      return Math.abs(record.confidence - outcome);
    }),
  );
  return clamp(Math.round(100 - error), 0, 100);
}

function feedbackAdjustment(hitRate: number, sampleSize: number) {
  if (sampleSize < 5) return 0;
  if (hitRate >= 75) return 2;
  if (hitRate >= 65) return 1;
  if (hitRate < 45) return -2;
  if (hitRate < 55) return -1;
  return 0;
}

async function readConfiguredExpertConsensus() {
  try {
    const filePath = path.join(process.cwd(), "data", "expert-consensus.json");
    const data = JSON.parse(await fs.readFile(filePath, "utf8")) as {
      symbols?: Array<{ symbol?: string; count?: number }>;
    };
    return Object.fromEntries(
      (data.symbols ?? [])
        .filter((row) => row.symbol && Number.isFinite(row.count))
        .map((row) => [String(row.symbol).toUpperCase(), clamp(Number(row.count), 0, 20)]),
    );
  } catch {
    return {};
  }
}

async function readRemoteExpertConsensus() {
  const url = process.env.EXPERT_CONSENSUS_URL?.trim();
  if (!url) return {};
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 3_600 },
    });
    if (!response.ok) return {};
    const data = (await response.json()) as {
      symbols?: Array<{ symbol?: string; count?: number }>;
    };
    return Object.fromEntries(
      (data.symbols ?? [])
        .filter((row) => row.symbol && Number.isFinite(row.count))
        .map((row) => [
          String(row.symbol).toUpperCase(),
          clamp(Number(row.count), 0, 20),
        ]),
    );
  } catch {
    return {};
  }
}

function normalizeContribution(score: number, weight: number) {
  return roundOne((clamp(score, 0, 100) / 100) * weight);
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}
