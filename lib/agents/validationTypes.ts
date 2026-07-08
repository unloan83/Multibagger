import type {
  AgentAction,
  AgentRecommendationLog,
  AgentTimeframe,
  SourceCredibility,
} from "@/lib/agents/types";

export type ValidationAgentName =
  | "Info"
  | "Macro & Policy"
  | "Sentiment"
  | "Portfolio"
  | "Growth"
  | "Risk & Validation"
  | "Performance"
  | "Orchestrator"
  | "Fundamental"
  | "Technical"
  | "Intraday"
  | "Swing"
  | "LongTerm"
  | "EarningsQuality"
  | "Rebalance"
  | "Risk Management";

export type ValidationSourceType =
  | "exchange filing"
  | "company update"
  | "financial news"
  | "government"
  | "regulator"
  | "blog"
  | "social"
  | "market data"
  | "unknown";

export type FreshnessClass = "today" | "this week" | "older" | "stale";

export type SourceAudit = {
  name: string;
  type: ValidationSourceType;
  credibility: SourceCredibility;
  credibilityScore: number;
  urlOrReference: string;
  timestamp: string | null;
  freshness: FreshnessClass;
  freshnessScore: number;
};

export type CoverageArea =
  | "company news"
  | "exchange filings"
  | "sector news"
  | "policy/government updates"
  | "macro/global news"
  | "quarterly results"
  | "analyst/blog sentiment"
  | "volume/price context"
  | "fundamental metrics"
  | "technical indicators"
  | "intraday signals"
  | "swing signals"
  | "long-term fundamentals"
  | "earnings quality"
  | "portfolio rebalancing";

export type CoverageValidation = {
  area: CoverageArea;
  status: "covered" | "partial" | "missing";
  evidenceCount: number;
  missingDataType: string | null;
  requiredAccess: string | null;
  confidenceImpact: number;
};

export type AgentHealthValidation = {
  agent: ValidationAgentName;
  health: "healthy" | "degraded" | "blocked";
  signalScore: number;
  confidence: number;
  freshnessScore: number;
  sourceCredibilityScore: number;
  reason: string;
  missingInformation: string[];
  sources: SourceAudit[];
};

export type OrchestratorDecisionValidation = {
  symbol: string;
  finalAction: AgentAction;
  timeframe: AgentTimeframe;
  confidence: number;
  currentLogicAction: AgentAction;
  currentLogicConfidence: number;
  supportingAgents: string[];
  opposingAgents: string[];
  reason: string;
  confidenceDowngraded: boolean;
  downgradeReasons: Array<"conflict" | "stale data" | "weak sources" | "missing data" | "low confidence">;
};

export type ShadowComparison = {
  symbol: string;
  currentLogicAction: AgentAction;
  agentAction: AgentAction;
  sameAction: boolean;
  currentLogicConfidence: number;
  agentConfidence: number;
  explanationQuality: number;
  result: AgentRecommendationLog["status"];
};

export type ReliabilityRow = {
  label: string;
  completed: number;
  hits: number;
  misses: number;
  accuracy: number | null;
};

export type AgentValidationReport = {
  runId: string;
  generatedAt: string;
  mode: "shadow";
  portfolioId: string;
  agentHealth: AgentHealthValidation[];
  sourceCoverage: CoverageValidation[];
  missingSourceAlerts: string[];
  staleDataAlerts: string[];
  accessGaps: Array<{
    agent: ValidationAgentName;
    missingDataType: string;
    requiredAccess: string;
    confidenceImpact: number;
  }>;
  orchestratorValidation: OrchestratorDecisionValidation[];
  shadowComparison: ShadowComparison[];
  performance: {
    currentLogic: ReliabilityRow;
    agentLogic: ReliabilityRow;
    accuracyImprovement: number | null;
    confidenceCalibration: number | null;
    hitMissRatio: string;
    agentContribution: ReliabilityRow[];
    sourceReliability: ReliabilityRow[];
    horizonAccuracy: ReliabilityRow[];
    recentOutcomes: Array<{
      stock: string;
      action: AgentAction;
      status: AgentRecommendationLog["status"];
      oneDay: string;
      oneWeek: string;
      oneMonth: string;
      reason: string;
    }>;
  };
  promotionGate: {
    eligible: boolean;
    status: "SHADOW_ONLY" | "ELIGIBLE_FOR_REVIEW";
    completedAgentRecommendations: number;
    minimumRequired: number;
    explanationQuality: number;
    accuracyImprovement: number | null;
    reasons: string[];
  };
};
