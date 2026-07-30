/**
 * Simplified recommendation intelligence — stubs for the removed
 * news/sentiment/policy/learning system.
 * 
 * All functions return neutral/no-op values so the scoring engine
 * continues to work based purely on fundamental + technical factors.
 */

export type SectorDirection = {
  sector: string;
  rank: number;
  score: number;
  label: string;
  return20Percent: number;
  return60Percent: number;
  trendBreadthPercent: number;
  newsSentimentScore: number;
  policyScore: number;
};

export type LearningFeedback = {
  adjustment: number;
  sectorAdjustments: Record<string, number>;
  typeAdjustments: Record<string, number>;
  recommendationQualityScore: number;
  confidenceAccuracy: number;
  windows: ReviewWindow[];
  sectorAccuracy: Record<string, number>;
};

export type ReviewWindow = {
  label: string;
  hitRate: number;
  totalPicks: number;
};

export type NewsSentiment = {
  score: number;
  label: string;
};

export type PolicyScore = {
  score: number;
  label: string;
};

export type RecommendationIntelligence = {
  finalScore: number;
  newsSentimentScore: number;
  policySupportScore: number;
  sectorDirectionScore: number;
  expertFocusCount: number;
  learningAdjustment: number;
  sectorDirection: SectorDirection;
};

/** No-op: returns neutral sentiment. */
export function classifyNewsSentiment(
  _headlines: string[],
  _sectorHeadlines: string[],
  _marketHeadlines: string[],
): NewsSentiment {
  return { score: 0, label: "Neutral" };
}

/** No-op: returns empty headlines. */
export async function fetchHeadlineIntelligence(
  _query: string,
  _count: number,
): Promise<string[]> {
  return [];
}

/** No-op: returns empty headlines. */
export function filterSectorHeadlines(
  _sector: string,
  _headlines: string[],
): string[] {
  return [];
}

/** No-op: returns neutral sector directions. */
export function rankSectorDirections(
  _sectors: string[],
  _headlines: string[],
  _sectorHeadlinesMap: Record<string, string[]>,
): Record<string, SectorDirection> {
  return {};
}

/** No-op: returns neutral policy score. */
export function scoreGovernmentPolicy(
  _theme: string,
  _sectorHeadlines: string[],
  _policyHeadlines: string[],
): PolicyScore {
  return { score: 0, label: "Neutral" };
}

/** Score pass-through — no news/sentiment/learning adjustments. */
export function applyRecommendationIntelligence({
  baseScore,
  sectorDirection,
  expertFocusCount,
  learningAdjustment,
}: {
  baseScore: number;
  technicalStrength: number;
  fundamentalStrength: number;
  sectorDirection: SectorDirection;
  newsSentiment: NewsSentiment;
  policy: PolicyScore;
  expertFocusCount: number;
  learningAdjustment: number;
}): RecommendationIntelligence {
  return {
    finalScore: Math.min(100, Math.max(0, baseScore + learningAdjustment)),
    newsSentimentScore: 0,
    policySupportScore: 0,
    sectorDirectionScore: sectorDirection.score,
    expertFocusCount,
    learningAdjustment,
    sectorDirection,
  };
}

/** No-op: returns empty learning feedback. */
export function buildLearningFeedback(
  _records: unknown[],
): LearningFeedback {
  return {
    adjustment: 0,
    sectorAdjustments: {},
    typeAdjustments: {},
    recommendationQualityScore: 0,
    confidenceAccuracy: 0,
    windows: [],
    sectorAccuracy: {},
  };
}

/** No-op: returns empty expert consensus counts. */
export async function readExpertConsensusCounts(): Promise<Record<string, number>> {
  return {};
}
