import { analyzePortfolioHealthScore } from "@/lib/portfolio-health";
import { analyzePortfolioRisk, type RiskStatus } from "@/lib/risk-engine";
import {
  calculatePortfolioMetrics,
  generateRecommendations,
  type ManagedPortfolio,
  type Recommendation,
} from "@/lib/portfolio";

export type MarketQuote = {
  symbol: string;
  name: string;
  segment?: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
};

export type MarketMoverGroup = {
  segment: string;
  gainers: MarketQuote[];
  losers: MarketQuote[];
};

export type MarketOverview = {
  sentiment: "Positive" | "Negative" | "Neutral";
  averageMove: number;
  indices: MarketQuote[];
  moverGroups?: MarketMoverGroup[];
  gainers: MarketQuote[];
  losers: MarketQuote[];
  refreshedAt: string;
};

export type MarketBias = "Bullish" | "Neutral" | "Bearish";
export type OpportunityQualityLabel =
  | "Excellent Opportunities"
  | "Selective Opportunities"
  | "Caution"
  | "No Edge Today";
export type RecommendedAction =
  | "BUY"
  | "HOLD"
  | "WAIT"
  | "DO NOTHING"
  | "PROTECT CAPITAL"
  | "REDUCE RISK";

export type DecisionIntelligence = {
  marketBias: {
    label: MarketBias;
    confidence: number;
    reason: string;
  };
  portfolioRisk: {
    score: number;
    status: RiskStatus;
    largestRisk: string;
  };
  bestOpportunity: {
    symbol: string;
    score: number;
    qualityLabel: OpportunityQualityLabel;
    reason: string;
  };
  biggestRisk: {
    name: string;
    severity: "LOW" | "MEDIUM" | "HIGH";
    reason: string;
  };
  recommendedAction: {
    action: RecommendedAction;
    reason: string;
  };
  explainability: {
    title: string;
    marketBias: string;
    vix: string;
    fearGreed: string;
    sectorStrength: string;
    portfolioRisk: string;
    historicalAccuracy: string;
    reasons: string[];
  };
  confidence: {
    signalStrength: number;
    historicalAccuracy: number;
    finalConfidence: number;
    label: "Low" | "Medium" | "High";
  };
  reliability: {
    last30Days: ReliabilityWindow;
    last90Days: ReliabilityWindow;
    allTime: ReliabilityWindow;
  };
  summary: string;
  snapshot: DecisionSnapshot;
};

export type ReliabilityWindow = {
  winRate: number | null;
  averageReturn: number | null;
  averageDrawdown: number | null;
  successRate: number | null;
  sampleSize: number;
};

export type DecisionSnapshot = {
  date: string;
  capturedAt: string;
  portfolioId: string;
  marketBias: MarketBias;
  portfolioHealth: number;
  riskScore: number;
  topOpportunity: string;
  recommendedAction: RecommendedAction;
  confidence: number;
};

export function buildDecisionIntelligence({
  portfolio,
  market,
  history,
}: {
  portfolio: ManagedPortfolio | null | undefined;
  market: MarketOverview | null;
  history: Recommendation[];
}): DecisionIntelligence | null {
  if (!portfolio) {
    return null;
  }

  const risk = analyzePortfolioRisk(portfolio);
  const health = analyzePortfolioHealthScore(portfolio);
  const metrics = calculatePortfolioMetrics(portfolio.positions);
  const marketBias = buildMarketBias(market);
  const reliability = buildReliability(history);
  const historicalAccuracy = reliability.last90Days.winRate ?? reliability.allTime.winRate ?? 50;
  const recommendations = generateRecommendations(portfolio, history);
  const candidates = [
    ...recommendations.intraday,
    ...recommendations.longTermPlan,
    ...recommendations.multibaggerCandidates,
    ...recommendations.etfs,
  ];
  const bestRecommendation = candidates
    .filter((recommendation) => recommendation.action === "Accumulate")
    .sort((a, b) => b.confidence - a.confidence)[0];
  const signalStrength = bestRecommendation?.confidence ?? scorePortfolioMomentum(metrics);
  const finalConfidence = clamp(Math.round(signalStrength * (0.65 + historicalAccuracy / 200)));
  const opportunityScore = scoreOpportunity({
    signalStrength,
    finalConfidence,
    marketBias: marketBias.label,
    riskScore: risk.riskScore,
  });
  const qualityLabel = getOpportunityQualityLabel(opportunityScore);
  const vix = getVixProxy(market);
  const fearGreed = getFearGreedProxy(market);
  const biggestRisk = buildBiggestRisk(risk);
  const action = chooseAction({
    marketBias: marketBias.label,
    riskStatus: risk.riskStatus,
    riskScore: risk.riskScore,
    opportunityScore,
    confidence: finalConfidence,
    vix,
  });
  const topSector = market?.moverGroups?.[0]?.segment ?? metrics.sectorAllocations[0]?.sector ?? "Mixed";
  const opportunitySymbol =
    bestRecommendation?.symbol ?? metrics.holdings[0]?.symbol ?? "NONE";

  return {
    marketBias,
    portfolioRisk: {
      score: risk.riskScore,
      status: risk.riskStatus,
      largestRisk: risk.risks[0] ?? "No major portfolio risk detected.",
    },
    bestOpportunity: {
      symbol: opportunityScore < 40 ? "NO EDGE" : opportunitySymbol,
      score: opportunityScore,
      qualityLabel,
      reason:
        opportunityScore < 40
          ? "Opportunity quality is below the minimum threshold."
          : bestRecommendation?.rationale ?? "Highest weighted opportunity from current portfolio signals.",
    },
    biggestRisk,
    recommendedAction: {
      action,
      reason: getActionReason(action, risk.risks[0], qualityLabel, marketBias.label),
    },
    explainability: {
      title:
        action === "BUY" && bestRecommendation
          ? `BUY ${bestRecommendation.symbol}`
          : `${action} today`,
      marketBias: `${marketBias.label} (${marketBias.confidence}%)`,
      vix: `${vix.toFixed(1)} proxy`,
      fearGreed: `${fearGreed}/100 proxy`,
      sectorStrength: topSector,
      portfolioRisk: `${risk.riskStatus} ${risk.riskScore}/100`,
      historicalAccuracy: `${Math.round(historicalAccuracy)}%`,
      reasons: buildReasons({
        marketBias: marketBias.label,
        riskStatus: risk.riskStatus,
        qualityLabel,
        topSector,
        vix,
        historicalAccuracy,
      }),
    },
    confidence: {
      signalStrength,
      historicalAccuracy: Math.round(historicalAccuracy),
      finalConfidence,
      label: finalConfidence >= 72 ? "High" : finalConfidence >= 55 ? "Medium" : "Low",
    },
    reliability,
    summary: buildSummary({
      healthScore: health.healthScore,
      marketBias: marketBias.label,
      riskStatus: risk.riskStatus,
      action,
      qualityLabel,
    }),
    snapshot: {
      date: getLocalDateKey(),
      capturedAt: new Date().toISOString(),
      portfolioId: portfolio.id,
      marketBias: marketBias.label,
      portfolioHealth: health.healthScore,
      riskScore: risk.riskScore,
      topOpportunity: opportunitySymbol,
      recommendedAction: action,
      confidence: finalConfidence,
    },
  };
}

function buildMarketBias(market: MarketOverview | null) {
  if (!market) {
    return {
      label: "Neutral" as const,
      confidence: 45,
      reason: "Market data is still loading.",
    };
  }

  const breadthScore = market.gainers.length - market.losers.length;
  const score =
    market.averageMove * 18 +
    breadthScore * 2 +
    (market.sentiment === "Positive" ? 18 : market.sentiment === "Negative" ? -18 : 0);
  const label: MarketBias = score > 18 ? "Bullish" : score < -18 ? "Bearish" : "Neutral";

  return {
    label,
    confidence: clamp(Math.round(52 + Math.abs(score) * 0.75)),
    reason: `${market.sentiment} sentiment with ${market.averageMove.toFixed(2)}% average index move.`,
  };
}

function scoreOpportunity({
  signalStrength,
  finalConfidence,
  marketBias,
  riskScore,
}: {
  signalStrength: number;
  finalConfidence: number;
  marketBias: MarketBias;
  riskScore: number;
}) {
  const biasAdjustment = marketBias === "Bullish" ? 10 : marketBias === "Bearish" ? -16 : -5;
  const riskAdjustment = riskScore >= 80 ? 8 : riskScore >= 60 ? 0 : -16;

  return clamp(Math.round(signalStrength * 0.45 + finalConfidence * 0.4 + biasAdjustment + riskAdjustment));
}

function getOpportunityQualityLabel(score: number): OpportunityQualityLabel {
  if (score >= 80) return "Excellent Opportunities";
  if (score >= 60) return "Selective Opportunities";
  if (score >= 40) return "Caution";
  return "No Edge Today";
}

function chooseAction({
  marketBias,
  riskStatus,
  riskScore,
  opportunityScore,
  confidence,
  vix,
}: {
  marketBias: MarketBias;
  riskStatus: RiskStatus;
  riskScore: number;
  opportunityScore: number;
  confidence: number;
  vix: number;
}): RecommendedAction {
  if (riskStatus === "RED" || vix >= 24) return "PROTECT CAPITAL";
  if (riskScore < 70) return "REDUCE RISK";
  if (opportunityScore < 40) return "DO NOTHING";
  if (marketBias === "Bearish") return "WAIT";
  if (marketBias === "Neutral" || confidence < 58) return "HOLD";
  if (opportunityScore >= 70 && confidence >= 65) return "BUY";
  return "WAIT";
}

function buildBiggestRisk(risk: ReturnType<typeof analyzePortfolioRisk>) {
  const severity: "LOW" | "MEDIUM" | "HIGH" =
    risk.riskScore < 60 ? "HIGH" : risk.riskScore < 80 ? "MEDIUM" : "LOW";

  return {
    name: risk.risks[0] ?? "No major risk",
    severity,
    reason: risk.recommendations[0] ?? "Risk engine does not require immediate action.",
  };
}

function buildReliability(history: Recommendation[]) {
  return {
    last30Days: buildReliabilityWindow(history, 30),
    last90Days: buildReliabilityWindow(history, 90),
    allTime: buildReliabilityWindow(history),
  };
}

function buildReliabilityWindow(history: Recommendation[], days?: number): ReliabilityWindow {
  const cutoff = days ? Date.now() - days * 24 * 60 * 60 * 1000 : 0;
  const scoped = history.filter((item) => {
    const createdAt = new Date(item.createdAt).getTime();
    return Number.isFinite(createdAt) && createdAt >= cutoff;
  });
  const scored = scoped.filter((item) => item.status === "Hit" || item.status === "Miss");
  const hits = scored.filter((item) => item.status === "Hit").length;
  const winRate = scored.length === 0 ? null : (hits / scored.length) * 100;

  return {
    winRate,
    averageReturn: null,
    averageDrawdown: null,
    successRate: winRate,
    sampleSize: scored.length,
  };
}

function getActionReason(
  action: RecommendedAction,
  topRisk: string | undefined,
  qualityLabel: OpportunityQualityLabel,
  marketBias: MarketBias,
) {
  if (action === "PROTECT CAPITAL") return topRisk ?? "Risk or volatility is elevated.";
  if (action === "REDUCE RISK") return topRisk ?? "Portfolio risk is above preferred range.";
  if (action === "DO NOTHING") return `${qualityLabel}; no statistically attractive setup today.`;
  if (action === "BUY") return `${qualityLabel} with ${marketBias.toLowerCase()} market bias.`;
  if (action === "HOLD") return "Existing positions can be held while conditions remain mixed.";
  return "Wait for stronger market breadth, lower risk, or higher confidence.";
}

function buildReasons({
  marketBias,
  riskStatus,
  qualityLabel,
  topSector,
  vix,
  historicalAccuracy,
}: {
  marketBias: MarketBias;
  riskStatus: RiskStatus;
  qualityLabel: OpportunityQualityLabel;
  topSector: string;
  vix: number;
  historicalAccuracy: number;
}) {
  return [
    `${marketBias} market bias`,
    `${topSector} is the strongest visible sector context`,
    `${vix < 20 ? "Lower" : "Elevated"} VIX proxy`,
    `${riskStatus} portfolio risk status`,
    `${qualityLabel}`,
    `Historical accuracy ${Math.round(historicalAccuracy)}%`,
  ];
}

function buildSummary({
  healthScore,
  marketBias,
  riskStatus,
  action,
  qualityLabel,
}: {
  healthScore: number;
  marketBias: MarketBias;
  riskStatus: RiskStatus;
  action: RecommendedAction;
  qualityLabel: OpportunityQualityLabel;
}) {
  if (action === "PROTECT CAPITAL" || riskStatus === "RED") {
    return "Portfolio risk elevated. Focus on capital preservation.";
  }

  if (action === "DO NOTHING" || qualityLabel === "No Edge Today") {
    return "Market conditions mixed. No high-conviction opportunities today.";
  }

  if (healthScore >= 70 && marketBias === "Bullish") {
    return "Portfolio healthy. Market conditions favorable. Selective buying opportunities exist.";
  }

  return "Portfolio stable. Stay selective and act only on high-confidence signals.";
}

function scorePortfolioMomentum(metrics: ReturnType<typeof calculatePortfolioMetrics>) {
  if (metrics.holdings.length === 0) return 35;

  const positiveCount = metrics.holdings.filter((holding) => holding.dayChangePercent > 0).length;

  return clamp(Math.round(45 + (positiveCount / metrics.holdings.length) * 35 + metrics.dayChangePercent * 2));
}

function getVixProxy(market: MarketOverview | null) {
  return Math.max(10, Math.min(28, 16 + Math.abs(market?.averageMove ?? 0) * 1.7));
}

function getFearGreedProxy(market: MarketOverview | null) {
  return Math.max(0, Math.min(100, Math.round(50 + (market?.averageMove ?? 0) * 4)));
}

function getLocalDateKey() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}
