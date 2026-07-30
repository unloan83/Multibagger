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
  reasons: string[];
  contributions: {
    portfolioFit: number;
    newsSentiment: number;
    governmentPolicy: number;
    expertConsensus: number;
    learningFeedback: number;
  };
};

/** No-op: returns neutral sentiment. */
export function classifyNewsSentiment(
  ..._args: unknown[]
): NewsSentiment {
  return { score: 0, label: "Neutral" };
}

/** No-op: returns empty headlines. */
export async function fetchHeadlineIntelligence(
  ..._args: unknown[]
): Promise<string[]> {
  return [];
}

/** No-op: returns empty headlines. */
export function filterSectorHeadlines(
  ..._args: unknown[]
): string[] {
  return [];
}

/** No-op: returns neutral sector directions. */
export function rankSectorDirections(
  candidates: Array<{
    sector: string;
    return20Percent: number;
    return60Percent: number;
    trendAligned: boolean;
  }>,
  ..._rest: unknown[]
): SectorDirection[] {
  const uniqueSectors = [...new Set(candidates.map((c) => c.sector))];
  return uniqueSectors.map((sector, index) => ({
    sector,
    rank: index + 1,
    score: 50,
    label: "Neutral Sector",
    return20Percent: 0,
    return60Percent: 0,
    trendBreadthPercent: 50,
    newsSentimentScore: 0,
    policyScore: 0,
  }));
}

/** No-op: returns neutral policy score. */
export function scoreGovernmentPolicy(
  ..._args: unknown[]
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
    reasons: [],
    contributions: {
      portfolioFit: 0,
      newsSentiment: 0,
      governmentPolicy: 0,
      expertConsensus: 0,
      learningFeedback: learningAdjustment,
    },
  };
}

/** No-op: returns empty learning feedback. */
export function buildLearningFeedback(
  ..._args: unknown[]
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
