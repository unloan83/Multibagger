import type { ManagedPortfolio, Recommendation } from "@/lib/portfolio";
import type { ValidationRecord } from "@/lib/intelligence-validation";

export type AgentImpact = "positive" | "negative" | "neutral" | "mixed";
export type AgentAction = "Buy" | "Hold" | "Sell" | "Watch";
export type AgentTimeframe =
  | "Intraday"
  | "Short term"
  | "3-6 months"
  | "6-12 months"
  | "Long term";

export type SourceCredibility = "high" | "medium" | "low";

export type IntelligenceSource = {
  name: string;
  credibility: SourceCredibility;
  url?: string;
  publishedAt?: string;
  kind:
    | "exchange_filing"
    | "company_update"
    | "company_news"
    | "quarterly_result"
    | "corporate_action"
    | "sector_news"
    | "government_policy"
    | "regulator"
    | "politics"
    | "global_market"
    | "macro"
    | "analyst"
    | "blog"
    | "social";
};

export type RawIntelligenceEvent = {
  summary: string;
  affectedStocks?: string[];
  affectedSectors?: string[];
  source: IntelligenceSource;
};

export type ScoredIntelligenceEvent = RawIntelligenceEvent & {
  impact: AgentImpact;
  impactScore: number;
  freshnessMinutes: number | null;
  sourceCredibility: number;
  confidence: number;
  reasons: string[];
};

export type AgentScore = {
  score: number;
  confidence: number;
  reasons: string[];
};

export type AgentInfoOutput = {
  agent: "Info";
  generatedAt: string;
  events: ScoredIntelligenceEvent[];
  byStock: Record<string, AgentScore>;
  sourceSummary: string[];
};

export type SectorImpact = AgentScore & {
  sector: string;
  affectedStocks: string[];
  impact: AgentImpact;
};

export type AgentMacroPolicyOutput = {
  agent: "Macro & Policy";
  generatedAt: string;
  marketScore: number;
  confidence: number;
  sectors: SectorImpact[];
  reasons: string[];
};

export type AgentSentimentOutput = {
  agent: "Sentiment";
  generatedAt: string;
  market: AgentScore & { classification: "bullish" | "bearish" | "neutral" | "mixed" };
  byStock: Record<string, AgentScore & { classification: "bullish" | "bearish" | "neutral" | "mixed" }>;
  lowQualityShare: number;
};

export type PortfolioStockImpact = AgentScore & {
  symbol: string;
  action: AgentAction;
  currentWeight: number;
  profitLossPercent: number | null;
  overlap: string[];
};

export type AgentPortfolioOutput = {
  agent: "Portfolio";
  generatedAt: string;
  portfolioId: string;
  concentrationRisk: number;
  sectorConcentration: Record<string, number>;
  stocks: PortfolioStockImpact[];
  reasons: string[];
};

export type GrowthCandidate = {
  symbol: string;
  company: string;
  sector: string;
  proposedAction: AgentAction;
  timeframe: AgentTimeframe;
  existingLogicScore: number;
  supportingScores: {
    info: number;
    macroPolicy: number;
    sentiment: number;
    portfolio: number;
    fundamental: number;
    technical: number;
  };
  confidence: number;
  reason: string;
  positiveTriggers: string[];
  negativeConcerns: string[];
  volatilityScore?: number;
  liquidityScore?: number;
  target?: number;
  stopLoss?: number;
};

export type AgentGrowthOutput = {
  agent: "Growth";
  generatedAt: string;
  candidates: GrowthCandidate[];
  groups: Record<AgentTimeframe, string[]>;
};

export type RiskDecision = {
  symbol: string;
  score: number;
  confidence: number;
  blocked: boolean;
  downgradeTo?: "Hold" | "Watch";
  checks: {
    conflictingSignals: boolean;
    staleInformation: boolean;
    poorConfidence: boolean;
    excessiveVolatility: boolean;
    weakLiquidity: boolean;
    eventUncertainty: boolean;
    portfolioMismatch: boolean;
    weakSources: boolean;
  };
  reasons: string[];
};

export type AgentRiskValidationOutput = {
  agent: "Risk & Validation";
  generatedAt: string;
  decisions: RiskDecision[];
};

export type PerformanceContribution = {
  agent: string;
  positive: number;
  negative: number;
  completed: number;
  accuracy: number | null;
  scoreAdjustment: number;
};

export type AgentPerformanceOutput = {
  agent: "Performance";
  generatedAt: string;
  total: number;
  hit: number;
  miss: number;
  pending: number;
  hitRate: number | null;
  confidenceCalibration: number | null;
  contributions: PerformanceContribution[];
  scoreAdjustments: Record<keyof OrchestratorWeights, number>;
  summary: string;
};

export type OrchestratorWeights = {
  existingLogic: number;
  info: number;
  macroPolicy: number;
  sentiment: number;
  portfolio: number;
  riskValidation: number;
  fundamental: number;
  technical: number;
};

export type FinalRecommendation = {
  symbol: string;
  company: string;
  action: AgentAction;
  timeframe: AgentTimeframe;
  confidence: number;
  score: number;
  reason: string;
  whatChangedRecently: string[];
  positiveTriggers: string[];
  negativeConcerns: string[];
  sourceSummary: string[];
  portfolioImpact: string;
  target?: number;
  stopLoss?: number;
  agentScores: Record<keyof OrchestratorWeights, number>;
  agentReasons: Record<string, string[]>;
};

export type AgentRecommendationLog = {
  id: string;
  timestamp: string;
  portfolioId: string;
  stock: string;
  agentScores: FinalRecommendation["agentScores"];
  finalAction: AgentAction;
  timeframe: AgentTimeframe;
  target?: number;
  stopLoss?: number;
  confidence: number;
  reason: string;
  entryPrice: number;
  currentLogicAction: AgentAction;
  currentLogicConfidence: number;
  sourceTypes: string[];
  outcomes: Array<{
    horizon: "1 day" | "1 week" | "1 month";
    dueAt: string;
    evaluatedAt: string | null;
    price: number | null;
    returnPercent: number | null;
    status: "hit" | "miss" | "pending";
    reason: string;
  }>;
  outcomeReason: string;
  shadowMode: true;
  status: "hit" | "miss" | "pending";
  positiveContributors: string[];
  negativeContributors: string[];
};

export type FundamentalMetrics = {
  peRatio: number | null;
  pbRatio: number | null;
  debtEquity: number | null;
  returnOnEquity: number | null;
  revenueGrowth: number | null;
  profitMargin: number | null;
  marketCap: number | null;
  dividendYield: number | null;
};

export type TechnicalMetrics = {
  rsi14: number | null;
  sma20: number | null;
  sma50: number | null;
  volumeAvg20: number | null;
  volumeToday: number | null;
  priceChange1d: number | null;
  priceChange1w: number | null;
  priceChange1m: number | null;
  atr14: number | null;
};

export type AgentFundamentalOutput = {
  agent: "Fundamental";
  generatedAt: string;
  byStock: Record<string, {
    metrics: FundamentalMetrics;
    score: number;
    confidence: number;
    reasons: string[];
  }>;
  summary: string;
};

export type AgentTechnicalOutput = {
  agent: "Technical";
  generatedAt: string;
  byStock: Record<string, {
    metrics: TechnicalMetrics;
    score: number;
    confidence: number;
    reasons: string[];
  }>;
  summary: string;
};

export type AgentOrchestratorOutput = {
  agent: "Orchestrator";
  generatedAt: string;
  weights: OrchestratorWeights;
  recommendations: FinalRecommendation[];
  info: AgentInfoOutput;
  macroPolicy: AgentMacroPolicyOutput;
  sentiment: AgentSentimentOutput;
  portfolio: AgentPortfolioOutput;
  growth: AgentGrowthOutput;
  riskValidation: AgentRiskValidationOutput;
  performance: AgentPerformanceOutput;
  fundamental: AgentFundamentalOutput;
  technical: AgentTechnicalOutput;
  disclaimer: "AI-assisted market analysis, not certified investment advice. Please verify before acting.";
};

export type MultiAgentInput = {
  portfolio: ManagedPortfolio;
  existingRecommendations: Recommendation[];
  history: ValidationRecord[];
  events: RawIntelligenceEvent[];
  market?: {
    sentiment: "Positive" | "Negative" | "Neutral";
    averageMove: number;
  } | null;
  fundamentalOverrides?: Record<string, { score: number; confidence: number }>;
  technicalOverrides?: Record<string, { score: number; confidence: number }>;
};
