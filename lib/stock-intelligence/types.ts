export type IntelligenceImpact = "Positive" | "Negative" | "Neutral" | "Mixed" | "Unknown";
export type SourceCredibility = "high" | "medium" | "low";
export type EvidenceFreshness = "today" | "this week" | "older";
export type EvidenceCategory =
  | "company"
  | "sector"
  | "market"
  | "policy"
  | "political-economic"
  | "quarterly-results"
  | "management-commentary"
  | "corporate-action"
  | "regulatory"
  | "analyst-blog"
  | "price-volume";

export type IntelligenceEvidence = {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  category: EvidenceCategory;
  credibility: SourceCredibility;
  queryScope: "stock" | "sector" | "macro";
  relatedSymbols?: string[];
};

export type AnalyzedEvidence = IntelligenceEvidence & {
  impact: IntelligenceImpact;
  impactScore: number;
  confidence: number;
  freshness: EvidenceFreshness;
  explanation: string;
};

export type ExistingRecommendationSignal = {
  symbol: string;
  company: string;
  sector?: string;
  source: "portfolio" | "opportunity";
  action: "BUY" | "HOLD" | "SELL" | "WATCH";
  score: number;
  confidence: number;
  timeframe: "Intraday" | "Short term" | "3–6 months" | "6–12 months";
  reason: string;
  currentPrice?: number;
  target?: number;
  stopLoss?: number;
  priceVolumeContext?: string[];
};

export type IntelligenceWeights = {
  existingLogic: number;
  newsSentiment: number;
  sectorMacro: number;
};

export type StockIntelligenceRecommendation = {
  symbol: string;
  company: string;
  sector: string;
  source: ExistingRecommendationSignal["source"];
  action: "Buy" | "Hold" | "Sell" | "Watch";
  timeframe: ExistingRecommendationSignal["timeframe"];
  confidence: number;
  existingLogicScore: number;
  newsImpactScore: number;
  sectorMacroImpactScore: number;
  finalScore: number;
  reason: string;
  positiveTriggers: string[];
  negativeConcerns: string[];
  whatChanged: string[];
  stopLoss?: number;
  target?: number;
  sourceSummary: Array<Pick<AnalyzedEvidence, "title" | "url" | "source" | "publishedAt" | "credibility" | "impact">>;
  evidence: AnalyzedEvidence[];
  intradayScore?: number;
  swingScore?: number;
  longTermScore?: number;
  expectedMove?: number;
  expectedCagr?: number | null;
  riskLevel?: "low" | "medium" | "high";
  agentReasons?: {
    intraday?: string[];
    swing?: string[];
    longTerm?: string[];
  };
};

export type StockIntelligenceReport = {
  agent: "Stock Intelligence Agent";
  generatedAt: string;
  portfolioId: string;
  portfolioName: string;
  weights: IntelligenceWeights;
  recommendations: StockIntelligenceRecommendation[];
  confidenceNote: string;
  sourceStatus: string;
  disclaimer: "This is AI-assisted market analysis, not certified investment advice. Please verify before acting.";
};

export type StockIntelligenceLogRow = {
  timestamp: string;
  portfolioId: string;
  portfolioName: string;
  symbol: string;
  action: StockIntelligenceRecommendation["action"];
  timeframe: string;
  confidence: number;
  newsImpactScore: number;
  sectorMacroImpactScore: number;
  existingLogicScore: number;
  finalScore: number;
  sources: string[];
  finalReason: string;
  entryPrice: number;
  target: number;
  stopLoss: number;
  performanceStatus: "hit" | "miss" | "pending";
  evaluatedAt: string;
  sheetRow?: number;
};
