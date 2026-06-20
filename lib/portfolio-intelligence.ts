import { analyzePortfolioHealthScore } from "@/lib/portfolio-health";
import { analyzePortfolioRisk, type RiskStatus } from "@/lib/risk-engine";
import {
  calculatePortfolioMetrics,
  formatCurrency,
  generateRecommendations,
  type HoldingWithMetrics,
  type ManagedPortfolio,
  type Recommendation,
} from "@/lib/portfolio";

type MarketOverviewInput = {
  sentiment: "Positive" | "Negative" | "Neutral";
  averageMove: number;
  gainers: Array<{ symbol: string }>;
  losers: Array<{ symbol: string }>;
};

export type ConvictionRating = "A+" | "A" | "B" | "C";
export type MarketRegime =
  | "Bull Market"
  | "Risk-On"
  | "Consolidation"
  | "Correction"
  | "Risk-Off"
  | "Transition";
export type SellDisciplineAction = "EXIT" | "REDUCE" | "HOLD";
export type SellUrgency = "High Urgency" | "Medium Urgency" | "Low Urgency";
export type OpportunityQualityLabel =
  | "Excellent Opportunities"
  | "Selective Opportunities"
  | "Caution"
  | "No Edge";

export type PortfolioImpact = {
  currentScore: number;
  projectedScore: number;
  scoreChange: number;
  reason: string[];
  sectorAllocationChange: string;
  riskChange: string;
  diversificationChange: string;
};

export type RankedOpportunity = {
  rank: number;
  symbol: string;
  company: string;
  score: number;
  conviction: ConvictionRating;
  convictionLabel: string;
  confidence: number;
  action: "BUY" | "REDUCE";
  cmp: number;
  buyRange: string;
  stopLoss: number;
  target: number;
  timeHorizon: string;
  riskLevel: "Low" | "Medium" | "High";
  reason: string;
  portfolioImpact: PortfolioImpact;
  currentWeight: number;
  targetWeight: number;
  suggestedInvestment: number;
  suggestedAllocation: string;
};

export type SellDisciplineItem = {
  symbol: string;
  company: string;
  action: SellDisciplineAction;
  reason: string;
  urgency: SellUrgency;
};

export type LearningSummaryItem = {
  label: string;
  successRate: number | null;
  sampleSize: number;
};

export type PortfolioCoachUpgrade = {
  topImprovement: string;
  biggestRisk: string;
  bestOpportunity: string;
  portfolioWeakness: string;
  suggestedNextAction: string;
};

export type PortfolioIntelligenceCore = {
  marketRegime: {
    regime: MarketRegime;
    confidence: number;
    reason: string;
  };
  opportunityQuality: {
    score: number;
    label: OpportunityQualityLabel;
    action: "ACT SELECTIVELY" | "DO NOTHING";
  };
  topOpportunities: RankedOpportunity[];
  sellDiscipline: SellDisciplineItem[];
  learningSummary: LearningSummaryItem[];
  coach: PortfolioCoachUpgrade;
};

type RecommendationWithPosition = Recommendation & {
  cmp: number;
  sector: string;
  currentWeight: number;
  holding?: HoldingWithMetrics;
};

export function buildPortfolioIntelligenceCore({
  portfolio,
  market,
  history,
}: {
  portfolio: ManagedPortfolio;
  market: MarketOverviewInput | null;
  history: Recommendation[];
}): PortfolioIntelligenceCore {
  const metrics = calculatePortfolioMetrics(portfolio.positions);
  const health = analyzePortfolioHealthScore(portfolio);
  const risk = analyzePortfolioRisk(portfolio);
  const marketRegime = buildMarketRegime(market);
  const reliability = buildHistoricalReliability(history);
  const recommendations = flattenRecommendations(generateRecommendations(portfolio, history));
  const enriched = enrichRecommendations(recommendations, portfolio);
  const topOpportunities = rankOpportunities({
    recommendations: enriched,
    portfolio,
    marketRegime: marketRegime.regime,
    riskStatus: risk.riskStatus,
    healthScore: health.healthScore,
    historicalSuccessRate: reliability.allTime.successRate,
  });
  const opportunityScore = buildOpportunityQuality(topOpportunities, marketRegime.regime, risk);
  const sellDiscipline = buildSellDiscipline(metrics.holdings, enriched, risk);
  const learningSummary = buildLearningSummary(history);
  const coach = buildCoachUpgrade({
    healthWeakness: health.weaknesses[0],
    healthOpportunity: health.opportunities[0],
    topOpportunity: topOpportunities[0],
    sellDiscipline,
    risk,
  });

  return {
    marketRegime,
    opportunityQuality: {
      score: opportunityScore,
      label: getOpportunityQualityLabel(opportunityScore),
      action: opportunityScore < 40 ? "DO NOTHING" : "ACT SELECTIVELY",
    },
    topOpportunities,
    sellDiscipline,
    learningSummary,
    coach,
  };
}

function rankOpportunities({
  recommendations,
  portfolio,
  marketRegime,
  riskStatus,
  healthScore,
  historicalSuccessRate,
}: {
  recommendations: RecommendationWithPosition[];
  portfolio: ManagedPortfolio;
  marketRegime: MarketRegime;
  riskStatus: RiskStatus;
  healthScore: number;
  historicalSuccessRate: number;
}) {
  const buyCandidates = recommendations.filter((item) => item.action === "Accumulate");

  return buyCandidates
    .map((recommendation) => {
      const sectorStrength = scoreSectorStrength(recommendation.sector, marketRegime);
      const momentum = recommendation.metrics?.momentumScore ?? recommendation.confidence;
      const portfolioFit = scorePortfolioFit(recommendation.currentWeight, recommendation.sector, portfolio);
      const riskProfile = scoreRiskProfile(recommendation.metrics?.riskScore ?? 35, riskStatus);
      const score = clamp(
        Math.round(
          sectorStrength * 0.18 +
            momentum * 0.2 +
            regimeScore(marketRegime) * 0.17 +
            portfolioFit * 0.22 +
            historicalSuccessRate * 0.13 +
            riskProfile * 0.1,
        ),
      );
      const conviction = getConviction(score);
      const cmp = recommendation.cmp;
      const riskLevel = getRiskLevel(score, recommendation.metrics?.riskScore ?? 35);
      const targetWeight = getTargetWeight(score, recommendation.currentWeight, portfolio.appetite);
      const suggestedInvestment = getSuggestedInvestment({
        portfolio,
        currentWeight: recommendation.currentWeight,
        targetWeight,
      });

      return {
        rank: 0,
        symbol: recommendation.symbol,
        company: recommendation.company,
        score,
        conviction,
        convictionLabel: convictionLabel[conviction],
        confidence: clamp(Math.round(recommendation.confidence * 0.7 + score * 0.3)),
        action: "BUY" as const,
        cmp,
        buyRange: formatBuyRange(cmp, recommendation.section === "Intraday"),
        stopLoss: getStopLoss(cmp, riskLevel),
        target: getTarget(cmp, riskLevel),
        timeHorizon: recommendation.horizon,
        riskLevel,
        reason: recommendation.rationale,
        portfolioImpact: buildPortfolioImpact({
          healthScore,
          currentWeight: recommendation.currentWeight,
          targetWeight,
          sector: recommendation.sector,
          score,
          riskLevel,
        }),
        currentWeight: recommendation.currentWeight,
        targetWeight,
        suggestedInvestment,
        suggestedAllocation:
          suggestedInvestment > 0
            ? `${formatCurrency(suggestedInvestment)} staged buy`
            : "Hold current allocation; no fresh capital needed.",
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

function buildSellDiscipline(
  holdings: HoldingWithMetrics[],
  recommendations: RecommendationWithPosition[],
  risk: ReturnType<typeof analyzePortfolioRisk>,
) {
  const sellSignals = new Set(
    recommendations
      .filter((item) => item.action === "Urgent Sell")
      .map((item) => item.symbol),
  );

  const rows = holdings.map((holding): SellDisciplineItem => {
    const hasSellSignal = sellSignals.has(holding.symbol);
    const isTopConcentration =
      holding.symbol === risk.metrics.maxStockSymbol && risk.metrics.maxStockAllocation > 22;

    if (hasSellSignal) {
      return {
        symbol: holding.symbol,
        company: holding.company,
        action: "EXIT",
        reason:
          "Persistent deterioration is confirmed across short, medium and long trend windows.",
        urgency: "High Urgency",
      };
    }

    if (isTopConcentration || holding.portfolioWeight > 25) {
      return {
        symbol: holding.symbol,
        company: holding.company,
        action: "HOLD",
        reason:
          "Concentration is high, but concentration alone is not a sell signal; rebalance with future allocations unless decline evidence appears.",
        urgency: "Low Urgency",
      };
    }

    return {
      symbol: holding.symbol,
      company: holding.company,
      action: "HOLD",
      reason: "No sell threshold triggered.",
      urgency: "Low Urgency",
    };
  });

  return rows
    .sort((a, b) => sellRank[a.action] - sellRank[b.action])
    .slice(0, 8);
}

function buildPortfolioImpact({
  healthScore,
  currentWeight,
  targetWeight,
  sector,
  score,
  riskLevel,
}: {
  healthScore: number;
  currentWeight: number;
  targetWeight: number;
  sector: string;
  score: number;
  riskLevel: "Low" | "Medium" | "High";
}): PortfolioImpact {
  const allocationGap = Math.max(0, targetWeight - currentWeight);
  const diversificationBoost = currentWeight === 0 ? 3 : allocationGap >= 3 ? 2 : 1;
  const riskPenalty = riskLevel === "High" ? -2 : riskLevel === "Medium" ? -1 : 1;
  const scoreChange = clampToRange(Math.round((score - 60) / 8 + diversificationBoost + riskPenalty), -8, 10);

  return {
    currentScore: healthScore,
    projectedScore: clamp(healthScore + scoreChange),
    scoreChange,
    reason: [
      currentWeight === 0 ? `Adds ${sector} exposure.` : `Improves ${sector} allocation discipline.`,
      riskLevel === "Low" ? "Risk profile supports staged buying." : "Position size controls risk.",
      allocationGap > 0 ? "Target weight prevents over-allocation." : "No extra allocation required.",
    ],
    sectorAllocationChange:
      allocationGap > 0 ? `${sector} +${allocationGap.toFixed(1)}% target exposure` : `${sector} unchanged`,
    riskChange: riskLevel === "Low" ? "Risk improves" : riskLevel === "Medium" ? "Risk neutral" : "Risk increases",
    diversificationChange:
      currentWeight === 0 ? "Diversification improves" : "Diversification stable",
  };
}

function buildMarketRegime(market: MarketOverviewInput | null) {
  if (!market) {
    return {
      regime: "Transition" as const,
      confidence: 45,
      reason: "Market data unavailable; using neutral transition regime.",
    };
  }

  const breadth = market.gainers.length - market.losers.length;
  const move = market.averageMove;
  const confidence = clamp(Math.round(52 + Math.abs(move) * 10 + Math.abs(breadth) * 2));

  if (market.sentiment === "Positive" && move > 1.2 && breadth >= 3) {
    return { regime: "Bull Market" as const, confidence, reason: "Positive breadth with strong index movement." };
  }
  if (market.sentiment === "Positive" && move >= 0.25) {
    return { regime: "Risk-On" as const, confidence, reason: "Positive sentiment supports selective risk taking." };
  }
  if (market.sentiment === "Negative" && move < -1.2) {
    return { regime: "Risk-Off" as const, confidence, reason: "Broad negative move requires capital protection." };
  }
  if (market.sentiment === "Negative") {
    return { regime: "Correction" as const, confidence, reason: "Negative sentiment and weak breadth." };
  }
  if (Math.abs(move) < 0.35) {
    return { regime: "Consolidation" as const, confidence, reason: "Flat index movement suggests range-bound action." };
  }

  return { regime: "Transition" as const, confidence, reason: "Market signals are mixed." };
}

function buildOpportunityQuality(
  opportunities: RankedOpportunity[],
  marketRegime: MarketRegime,
  risk: ReturnType<typeof analyzePortfolioRisk>,
) {
  const topScore = opportunities[0]?.score ?? 0;
  const breadthScore = opportunities.length >= 3 ? 6 : opportunities.length * 2;
  const riskAdjustment = risk.riskStatus === "GREEN" ? 6 : risk.riskStatus === "YELLOW" ? 0 : -12;

  return clamp(Math.round(topScore * 0.76 + regimeScore(marketRegime) * 0.12 + breadthScore + riskAdjustment));
}

function buildLearningSummary(history: Recommendation[]) {
  const bySection = history.reduce<Record<string, { hit: number; total: number }>>((acc, item) => {
    if (item.status !== "Hit" && item.status !== "Miss") {
      return acc;
    }

    const bucket = acc[item.section] ?? { hit: 0, total: 0 };
    bucket.total += 1;
    bucket.hit += item.status === "Hit" ? 1 : 0;
    acc[item.section] = bucket;
    return acc;
  }, {});

  const rows = Object.entries(bySection).map(([label, value]) => ({
    label,
    successRate: value.total === 0 ? null : Math.round((value.hit / value.total) * 100),
    sampleSize: value.total,
  }));

  return rows.length
    ? rows.slice(0, 5)
    : [
        { label: "Defense", successRate: null, sampleSize: 0 },
        { label: "Power", successRate: null, sampleSize: 0 },
        { label: "Banking", successRate: null, sampleSize: 0 },
      ];
}

function buildCoachUpgrade({
  healthWeakness,
  healthOpportunity,
  topOpportunity,
  sellDiscipline,
  risk,
}: {
  healthWeakness?: string;
  healthOpportunity?: string;
  topOpportunity?: RankedOpportunity;
  sellDiscipline: SellDisciplineItem[];
  risk: ReturnType<typeof analyzePortfolioRisk>;
}): PortfolioCoachUpgrade {
  const reduceCandidate = sellDiscipline.find((item) => item.action === "REDUCE" || item.action === "EXIT");
  const bestOpportunity = topOpportunity?.symbol ?? "No high-conviction buy";
  const suggestedNextAction =
    topOpportunity && reduceCandidate
      ? `Shift capital from ${reduceCandidate.symbol} toward ${topOpportunity.symbol} in stages.`
      : topOpportunity
        ? `Add ${topOpportunity.symbol} only up to ${topOpportunity.targetWeight.toFixed(1)}% target weight.`
        : "Hold existing allocation and wait for better opportunity quality.";

  return {
    topImprovement: healthOpportunity ?? risk.recommendations[0] ?? "Maintain allocation discipline.",
    biggestRisk: risk.risks[0] ?? "No major risk detected.",
    bestOpportunity,
    portfolioWeakness: healthWeakness ?? "No major weakness detected.",
    suggestedNextAction,
  };
}

function enrichRecommendations(
  recommendations: Recommendation[],
  portfolio: ManagedPortfolio,
): RecommendationWithPosition[] {
  const metrics = calculatePortfolioMetrics(portfolio.positions);

  return recommendations.map((recommendation) => {
    const position = portfolio.positions.find((item) => item.symbol === recommendation.symbol);
    const holding = metrics.holdings.find((item) => item.symbol === recommendation.symbol);

    return {
      ...recommendation,
      cmp: position?.currentPrice ?? holding?.currentPrice ?? 0,
      sector: position?.sector ?? holding?.sector ?? recommendation.section,
      currentWeight: holding?.portfolioWeight ?? 0,
      holding,
    };
  });
}

function scoreSectorStrength(sector: string, marketRegime: MarketRegime) {
  const cyclicalBoost = ["Bull Market", "Risk-On"].includes(marketRegime) ? 8 : 0;
  const defensiveBoost = ["Correction", "Risk-Off"].includes(marketRegime) ? 6 : 0;

  if (["Information Technology", "Healthcare", "Power", "Consumer Durables"].some((item) => sector.includes(item))) {
    return 68 + cyclicalBoost;
  }

  if (["Fast Moving Consumer Goods", "Broad Market ETF"].some((item) => sector.includes(item))) {
    return 64 + defensiveBoost;
  }

  if (sector.includes("Financial")) {
    return 62 + (marketRegime === "Risk-On" ? 8 : 0);
  }

  return 58;
}

function scorePortfolioFit(currentWeight: number, sector: string, portfolio: ManagedPortfolio) {
  const metrics = calculatePortfolioMetrics(portfolio.positions);
  const sectorWeight =
    metrics.sectorAllocations.find((item) => item.sector === sector)?.percentage ?? 0;
  const newNameBoost = currentWeight === 0 ? 14 : 0;
  const concentrationPenalty = currentWeight > 15 ? (currentWeight - 15) * 2 : 0;
  const sectorPenalty = sectorWeight > 30 ? (sectorWeight - 30) * 1.2 : 0;

  return clamp(Math.round(72 + newNameBoost - concentrationPenalty - sectorPenalty));
}

function scoreRiskProfile(riskScore: number, riskStatus: RiskStatus) {
  const statusPenalty = riskStatus === "RED" ? 18 : riskStatus === "YELLOW" ? 7 : 0;

  return clamp(Math.round(92 - riskScore * 0.75 - statusPenalty));
}

function regimeScore(regime: MarketRegime) {
  return {
    "Bull Market": 88,
    "Risk-On": 78,
    Consolidation: 58,
    Correction: 42,
    "Risk-Off": 28,
    Transition: 52,
  }[regime];
}

function buildHistoricalReliability(history: Recommendation[]) {
  const scored = history.filter((item) => item.status === "Hit" || item.status === "Miss");
  const hits = scored.filter((item) => item.status === "Hit").length;
  const successRate = scored.length === 0 ? 60 : Math.round((hits / scored.length) * 100);

  return {
    allTime: {
      successRate,
      sampleSize: scored.length,
    },
  };
}

function getTargetWeight(score: number, currentWeight: number, appetite: ManagedPortfolio["appetite"]) {
  const appetiteCap = appetite === "aggressive" ? 10 : appetite === "safe" ? 6 : 8;
  const scoreTarget = score >= 85 ? appetiteCap : score >= 75 ? appetiteCap - 1.5 : score >= 65 ? appetiteCap - 3 : 3;

  return Math.max(currentWeight, Math.min(appetiteCap, scoreTarget));
}

function getSuggestedInvestment({
  portfolio,
  currentWeight,
  targetWeight,
}: {
  portfolio: ManagedPortfolio;
  currentWeight: number;
  targetWeight: number;
}) {
  const totalValue = calculatePortfolioMetrics(portfolio.positions).totalValue;
  const gap = Math.max(0, targetWeight - currentWeight);

  return Math.round((totalValue * gap) / 100);
}

function formatBuyRange(cmp: number, intraday: boolean) {
  if (cmp <= 0) return "Pending CMP";

  const low = cmp * (intraday ? 0.992 : 0.96);
  const high = cmp * (intraday ? 1.006 : 1.01);

  return `${formatCurrency(low)}-${formatCurrency(high)}`;
}

function getStopLoss(cmp: number, riskLevel: "Low" | "Medium" | "High") {
  if (cmp <= 0) return 0;

  return Math.round(cmp * (riskLevel === "Low" ? 0.93 : riskLevel === "Medium" ? 0.9 : 0.86));
}

function getTarget(cmp: number, riskLevel: "Low" | "Medium" | "High") {
  if (cmp <= 0) return 0;

  return Math.round(cmp * (riskLevel === "Low" ? 1.14 : riskLevel === "Medium" ? 1.18 : 1.24));
}

function getRiskLevel(score: number, riskScore: number): "Low" | "Medium" | "High" {
  if (score >= 78 && riskScore <= 35) return "Low";
  if (score >= 62 && riskScore <= 58) return "Medium";
  return "High";
}

function getConviction(score: number): ConvictionRating {
  if (score >= 85) return "A+";
  if (score >= 75) return "A";
  if (score >= 60) return "B";
  return "C";
}

function getOpportunityQualityLabel(score: number): OpportunityQualityLabel {
  if (score >= 80) return "Excellent Opportunities";
  if (score >= 60) return "Selective Opportunities";
  if (score >= 40) return "Caution";
  return "No Edge";
}

function flattenRecommendations(recommendations: ReturnType<typeof generateRecommendations>) {
  return [
    ...recommendations.intraday,
    ...recommendations.longTermPlan,
    ...recommendations.multibaggerCandidates,
    ...recommendations.etfs,
  ];
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

function clampToRange(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

const convictionLabel: Record<ConvictionRating, string> = {
  "A+": "Highest Conviction",
  A: "Strong Conviction",
  B: "Moderate Conviction",
  C: "Speculative",
};

const sellRank: Record<SellDisciplineAction, number> = {
  EXIT: 0,
  REDUCE: 1,
  HOLD: 2,
};
