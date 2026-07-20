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
  /** Market-cap bucket from the NIFTY 500 wealth screening universe. */
  capBucket?: "large" | "mid" | "small" | "emerging";
  /** Origin of this candidate: user portfolio or cap-segmented universe. */
  source?: "portfolio" | "wealth-universe";
  /** Thematic sector name, e.g. "Defense & Capital Goods" (long-term universe only). */
  thematicSector?: string;
};

export type AgentGrowthOutput = {
  agent: "Growth";
  generatedAt: string;
  candidates: GrowthCandidate[];
  groups: Record<AgentTimeframe, string[]>;
};

export type AgentWealthUniverseOutput = {
  agent: "WealthUniverse";
  generatedAt: string;
  candidates: GrowthCandidate[];
  byBucket: {
    large: { longTerm: GrowthCandidate[]; intraday: GrowthCandidate[] };
    mid: { longTerm: GrowthCandidate[]; intraday: GrowthCandidate[] };
    small: { longTerm: GrowthCandidate[]; intraday: GrowthCandidate[] };
  };
  snapshotAge: number;
  longTermSnapshotAge: number;
  freshness: "fresh" | "stale" | "unavailable";
  rejectionReasons: string[];
  summary: string;
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
  byTimeframe: Record<AgentTimeframe, { hit: number; miss: number; hitRate: number | null }>;
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
  intraday: number;
  swing: number;
  longTerm: number;
  earningsQuality: number;
  rebalance: number;
};

export type BayesianAgentBelief = {
  alpha: number;
  beta: number;
  totalObservations: number;
};

export type BayesianTimeframeBeliefs = {
  intraday?: BayesianAgentBelief;
  swing?: BayesianAgentBelief;
  longTerm?: BayesianAgentBelief;
};

export type BayesianState = {
  byAgent: Record<string, BayesianTimeframeBeliefs>;
  lastUpdated: string;
};

export type BayesianAdjustment = {
  agent: string;
  reliability: number;
  uncertainty: number;
  weightMultiplier: number;
  observations: number;
};

export type BayesianOutput = {
  adjustments: BayesianAdjustment[];
  state: BayesianState;
  summary: string;
};

export type FinalRecommendation = {
  symbol: string;
  company: string;
  action: AgentAction;
  timeframe: AgentTimeframe;
  confidence: number;
  score: number;
  publicationStatus: "actionable" | "portfolio-decision" | "watchlist" | "rejected";
  evidenceCompleteness: number;
  rejectionCodes: Array<
    | "INSUFFICIENT_EVIDENCE"
    | "LOW_CONFIDENCE"
    | "MISSING_TARGET"
    | "MISSING_STOP_LOSS"
    | "RISK_BLOCKED"
    | "NO_QUALIFIED_SIGNAL"
  >;
  reason: string;
  whatChangedRecently: string[];
  positiveTriggers: string[];
  negativeConcerns: string[];
  sourceSummary: string[];
  portfolioImpact: string;
  target?: number;
  stopLoss?: number;
  expectedMove?: number;
  expectedCagr?: number | null;
  riskLevel?: "low" | "medium" | "high";
  agentScores: Record<keyof OrchestratorWeights, number>;
  agentReasons: Record<string, string[]>;
  /** Market-cap bucket inherited from the NIFTY 500 wealth screening universe. */
  capBucket?: "large" | "mid" | "small" | "emerging";
  /** Origin: user portfolio-based or cap-segmented universe candidate. */
  source?: "portfolio" | "wealth-universe";
  /** Thematic sector name, e.g. "Defense & Capital Goods" (long-term universe only). */
  thematicSector?: string;
};

export type AgentRecommendationLog = {
  id: string;
  timestamp: string;
  portfolioId: string;
  stock: string;
  agentScores: Record<string, number>;
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

export type IntradayMetrics = {
  // --- existing ---
  rsi14: number | null;
  shortSMA: number | null;
  atr14: number | null;
  volumeSurge: number | null;
  priceChange1h: number | null;
  priceChangeOpen: number | null;
  intradayVolatility: number | null;
  lastPrice: number | null;
  stopLossDistance: number | null;
  targetDistance: number | null;
  // --- new ---
  /** Volume-weighted average price across all 15m bars fetched. */
  vwap: number | null;
  /** Percentage the current price is above (+) or below (−) VWAP. */
  vwapDistancePct: number | null;
  /** Today's open vs previous close as a percentage. */
  gapPct: number | null;
  /** Direction of the overnight gap. */
  gapType: "up" | "down" | "flat" | null;
  /** High of the first 30-minute opening range (first 2 × 15m candles). */
  orbHigh: number | null;
  /** Low of the first 30-minute opening range. */
  orbLow: number | null;
  /** Where current price sits relative to the ORB. */
  priceVsOrb: "above" | "below" | "inside" | null;
  /** Actual risk:reward ratio based on ATR — replaces fixed 1.8 ×. */
  dynamicRR: number | null;
  /** True if the stock is within 1% of a 5 %/10 %/20 % NSE circuit limit. */
  isNearCircuit: boolean;
  /** Sector rotation score from macroPolicy (−5 to +5). */
  sectorMomentum: number | null;
  /** Which candidate pool this stock came from. */
  source: "portfolio" | "universe" | "mover";
};


export type SwingMetrics = {
  sma20: number | null;
  sma50: number | null;
  rsi14: number | null;
  macdLine: number | null;
  signalLine: number | null;
  atr14: number | null;
  volumeRatio: number | null;
  priceChange1w: number | null;
  priceChange1m: number | null;
  atrPercent: number | null;
  stopLossPct: number | null;
  lastPrice: number | null;
};

export type LongTermMetrics = {
  peRatio: number | null;
  pbRatio: number | null;
  debtEquity: number | null;
  returnOnEquity: number | null;
  revenueGrowth: number | null;
  profitMargin: number | null;
  marketCap: number | null;
  dividendYield: number | null;
  pegRatio: number | null;
  freeCashFlowYield: number | null;
  earningsGrowth5y: number | null;
  macroScore: number | null;
};

export type EarningsQualityMetrics = {
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  operatingCashFlow: number | null;
  netIncome: number | null;
  freeCashFlow: number | null;
  capex: number | null;
  grossMargin: number | null;
  prevGrossMargin: number | null;
  accrualsRatio: number | null;
  cashFlowToNetIncome: number | null;
  freeCashFlowYield: number | null;
};

export type AgentEarningsQualityOutput = {
  agent: "EarningsQuality";
  generatedAt: string;
  byStock: Record<string, {
    metrics: EarningsQualityMetrics;
    score: number;
    confidence: number;
    reasons: string[];
  }>;
  summary: string;
};

export type RebalanceMetrics = {
  positionWeight: number;
  sectorWeight: number;
  sectorDeviation: number | null;
  maxPositionWeight: number;
  maxSectorWeight: number;
  concentrationRisk: "low" | "medium" | "high";
  rebalanceUrgency: "low" | "medium" | "high";
};

export type AgentRebalanceOutput = {
  agent: "Rebalance";
  generatedAt: string;
  byStock: Record<string, {
    metrics: RebalanceMetrics;
    score: number;
    confidence: number;
    reasons: string[];
  }>;
  summary: string;
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

export type AgentIntradayOutput = {
  agent: "Intraday";
  generatedAt: string;
  byStock: Record<string, {
    metrics: IntradayMetrics;
    score: number;
    confidence: number;
    reasons: string[];
  }>;
  summary: string;
};

export type AgentSwingOutput = {
  agent: "Swing";
  generatedAt: string;
  byStock: Record<string, {
    metrics: SwingMetrics;
    score: number;
    confidence: number;
    reasons: string[];
  }>;
  summary: string;
};

export type AgentLongTermOutput = {
  agent: "LongTerm";
  generatedAt: string;
  byStock: Record<string, {
    metrics: LongTermMetrics;
    score: number;
    confidence: number;
    reasons: string[];
    cagr: number | null;
    riskLevel: "low" | "medium" | "high";
    target?: number;
    stopLoss?: number;
  }>;
  summary: string;
};

export type RAGDocument = {
  source: string;
  content: string;
  relevance: "high" | "medium" | "low";
  publishedAt: string;
  url?: string;
};

export type RAGContext = {
  documents: RAGDocument[];
};

export type RiskRule = (
  recommendations: FinalRecommendation[],
  portfolio: ManagedPortfolio,
  portfolioOutput: AgentPortfolioOutput,
  performance: AgentPerformanceOutput,
) => RiskRuleResult;

export type RiskRuleResult = {
  rule: string;
  action: "pass" | "warn" | "block";
  symbols?: string[];
  reasons: string[];
};

export type AgentRiskManagementOutput = {
  agent: "Risk Management";
  generatedAt: string;
  rules: RiskRuleResult[];
  blockedCount: number;
  passedCount: number;
  reasons: string[];
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
  wealthUniverse: AgentWealthUniverseOutput;
  riskValidation: AgentRiskValidationOutput;
  performance: AgentPerformanceOutput;
  fundamental: AgentFundamentalOutput;
  technical: AgentTechnicalOutput;
  intraday: AgentIntradayOutput;
  swing: AgentSwingOutput;
  longTerm: AgentLongTermOutput;
  earningsQuality: AgentEarningsQualityOutput;
  rebalance: AgentRebalanceOutput;
  bayesian: BayesianOutput;
  riskManagement: AgentRiskManagementOutput;
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
