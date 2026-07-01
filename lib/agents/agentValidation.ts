import type { AgentOrchestratorOutput, AgentRecommendationLog } from "@/lib/agents/types";
import type {
  AgentHealthValidation,
  AgentValidationReport,
  CoverageArea,
  CoverageValidation,
  FreshnessClass,
  ReliabilityRow,
  SourceAudit,
  ValidationAgentName,
  ValidationSourceType,
} from "@/lib/agents/validationTypes";
import type { ValidationRecord } from "@/lib/intelligence-validation";
import type { ManagedPortfolio } from "@/lib/portfolio";
import { average, clamp, credibilityScore, round } from "@/lib/agents/utils";

export function buildAgentValidationReport({
  output,
  portfolio,
  history,
  logs,
  now = new Date(),
}: {
  output: AgentOrchestratorOutput;
  portfolio: ManagedPortfolio;
  history: ValidationRecord[];
  logs: AgentRecommendationLog[];
  now?: Date;
}): AgentValidationReport {
  const sources = output.info.events.map((event) => sourceAudit(event.source, now));
  if (portfolio.positions.some((position) => position.currentPrice > 0)) {
    sources.push({
      name: "Authenticated portfolio quote snapshot",
      type: "market data",
      credibility: "high",
      credibilityScore: 90,
      urlOrReference: "same-origin portfolio quote snapshot",
      timestamp: output.generatedAt,
      freshness: "today",
      freshnessScore: 100,
    });
  }
  const coverage = buildCoverage(output, portfolio);
  const missingCoverage = coverage.filter((item) => item.status !== "covered");
  const staleSources = sources.filter((source) => source.freshness === "stale");
  const agentHealth = buildAgentHealth(output, sources, coverage);
  const orchestratorValidation = output.recommendations.map((recommendation) => {
    const candidate = output.growth.candidates.find((item) => item.symbol === recommendation.symbol);
    const risk = output.riskValidation.decisions.find((item) => item.symbol === recommendation.symbol);
    const supportingAgents = Object.entries(recommendation.agentScores)
      .filter(([, score]) => actionAligned(recommendation.action, score))
      .map(([agent]) => agent);
    const opposingAgents = Object.entries(recommendation.agentScores)
      .filter(([, score]) => actionOpposed(recommendation.action, score))
      .map(([agent]) => agent);
    const downgradeReasons = [
      ...(risk?.checks.conflictingSignals ? ["conflict" as const] : []),
      ...(risk?.checks.staleInformation ? ["stale data" as const] : []),
      ...(risk?.checks.weakSources ? ["weak sources" as const] : []),
      ...(missingCoverage.length ? ["missing data" as const] : []),
      ...(risk?.checks.poorConfidence ? ["low confidence" as const] : []),
    ];
    return {
      symbol: recommendation.symbol,
      finalAction: recommendation.action,
      timeframe: recommendation.timeframe,
      confidence: recommendation.confidence,
      currentLogicAction: candidate?.proposedAction ?? "Watch",
      currentLogicConfidence: candidate?.confidence ?? 0,
      supportingAgents,
      opposingAgents,
      reason: recommendation.reason,
      confidenceDowngraded:
        recommendation.action !== candidate?.proposedAction || downgradeReasons.length > 0,
      downgradeReasons,
    };
  });
  const shadowComparison = orchestratorValidation.map((decision) => {
    const recommendation = output.recommendations.find((item) => item.symbol === decision.symbol);
    const log = latestLog(logs, decision.symbol);
    return {
      symbol: decision.symbol,
      currentLogicAction: decision.currentLogicAction,
      agentAction: decision.finalAction,
      sameAction: decision.currentLogicAction === decision.finalAction,
      currentLogicConfidence: decision.currentLogicConfidence,
      agentConfidence: decision.confidence,
      explanationQuality: recommendation ? explanationQuality(recommendation) : 0,
      result: log?.status ?? "pending",
    };
  });
  const currentLogic = currentLogicReliability(history);
  const agentLogic = logReliability("Agent logic", logs);
  const accuracyImprovement = currentLogic.accuracy === null || agentLogic.accuracy === null
    ? null
    : agentLogic.accuracy - currentLogic.accuracy;
  const explanationAverage = Math.round(average(shadowComparison.map((item) => item.explanationQuality)));
  const promotionReasons = [
    ...(agentLogic.completed < 30 ? [`Only ${agentLogic.completed}/30 completed shadow recommendations.`] : []),
    ...(accuracyImprovement === null ? ["Accuracy improvement cannot be measured yet."] : accuracyImprovement < 5 ? [`Accuracy improvement is ${accuracyImprovement} percentage points; 5 required.`] : []),
    ...(explanationAverage < 80 ? [`Explanation quality is ${explanationAverage}/100; 80 required.`] : []),
    ...(missingCoverage.length ? [`${missingCoverage.length} source coverage areas remain incomplete.`] : []),
  ];
  const eligible = promotionReasons.length === 0;

  return {
    runId: `shadow:${portfolio.id}:${now.toISOString()}`,
    generatedAt: now.toISOString(),
    mode: "shadow",
    portfolioId: portfolio.id,
    agentHealth,
    sourceCoverage: coverage,
    missingSourceAlerts: missingCoverage.map((item) =>
      `${item.area}: ${item.missingDataType}. Confidence -${item.confidenceImpact}.`,
    ),
    staleDataAlerts: staleSources.map((source) =>
      `${source.name} is stale (${source.timestamp ?? "timestamp unavailable"}).`,
    ),
    accessGaps: missingCoverage.map((item) => ({
      agent: accessGapAgent(item.area),
      missingDataType: item.missingDataType ?? item.area,
      requiredAccess: item.requiredAccess ?? "Trusted structured data source",
      confidenceImpact: item.confidenceImpact,
    })),
    orchestratorValidation,
    shadowComparison,
    performance: {
      currentLogic,
      agentLogic,
      accuracyImprovement,
      confidenceCalibration: output.performance.confidenceCalibration,
      hitMissRatio: `${agentLogic.hits}:${agentLogic.misses}`,
      agentContribution: output.performance.contributions.map((item) => ({
        label: item.agent,
        completed: item.completed,
        hits: item.accuracy === null ? 0 : Math.round(item.completed * item.accuracy / 100),
        misses: item.accuracy === null ? 0 : item.completed - Math.round(item.completed * item.accuracy / 100),
        accuracy: item.accuracy,
      })),
      sourceReliability: sourceReliability(logs),
      horizonAccuracy: horizonReliability(logs),
      recentOutcomes: logs
        .slice()
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .slice(0, 20)
        .map((log) => ({
          stock: log.stock,
          action: log.finalAction,
          status: log.status,
          oneDay: horizonResult(log, "1 day"),
          oneWeek: horizonResult(log, "1 week"),
          oneMonth: horizonResult(log, "1 month"),
          reason: log.outcomeReason,
        })),
    },
    promotionGate: {
      eligible,
      status: eligible ? "ELIGIBLE_FOR_REVIEW" : "SHADOW_ONLY",
      completedAgentRecommendations: agentLogic.completed,
      minimumRequired: 30,
      explanationQuality: explanationAverage,
      accuracyImprovement,
      reasons: eligible ? ["Minimum evidence gate passed; manual review is still required."] : promotionReasons,
    },
  };
}

function buildCoverage(output: AgentOrchestratorOutput, portfolio: ManagedPortfolio): CoverageValidation[] {
  const events = output.info.events;
  const definitions: Array<{
    area: CoverageArea;
    count: number;
    missing: string;
    access: string;
    impact: number;
  }> = [
    { area: "company news", count: countKinds(events, ["company_news", "company_update", "corporate_action"]), missing: "verified company news and corporate updates", access: "Trusted company-news or issuer announcement feed", impact: 8 },
    { area: "exchange filings", count: countKinds(events, ["exchange_filing"]), missing: "official exchange filings", access: "NSE/BSE corporate announcements or licensed filings API", impact: 12 },
    { area: "sector news", count: countKinds(events, ["sector_news"]), missing: "sector-specific news", access: "Trusted sector-news feed", impact: 6 },
    { area: "policy/government updates", count: countKinds(events, ["government_policy", "politics", "regulator"]), missing: "official policy, government, or regulator updates", access: "Government/RBI/SEBI official release feeds", impact: 10 },
    { area: "macro/global news", count: countKinds(events, ["macro", "global_market"]), missing: "macro and global-market context", access: "Trusted macroeconomic and global-market feed", impact: 8 },
    { area: "quarterly results", count: countKinds(events, ["quarterly_result"]), missing: "quarterly results", access: "Exchange results feed or company investor-relations source", impact: 10 },
    { area: "analyst/blog sentiment", count: countKinds(events, ["analyst", "blog", "social"]), missing: "analyst and blog sentiment", access: "Attributed analyst/news commentary feed; social remains low confidence", impact: 4 },
    { area: "volume/price context", count: portfolio.positions.filter((position) => position.currentPrice > 0 && (position.volume ?? 0) > 0).length, missing: "current price and volume context", access: "Reliable exchange quote and historical-bars provider", impact: 15 },
  ];
  return definitions.map((item) => ({
    area: item.area,
    status: item.count >= 2 ? "covered" : item.count === 1 ? "partial" : "missing",
    evidenceCount: item.count,
    missingDataType: item.count >= 2 ? null : item.missing,
    requiredAccess: item.count >= 2 ? null : item.access,
    confidenceImpact: item.count >= 2 ? 0 : item.count === 1 ? Math.ceil(item.impact / 2) : item.impact,
  }));
}

function buildAgentHealth(
  output: AgentOrchestratorOutput,
  sources: SourceAudit[],
  coverage: CoverageValidation[],
): AgentHealthValidation[] {
  const sourceCredibility = Math.round(average(sources.map((source) => source.credibilityScore)));
  const freshness = Math.round(average(sources.map((source) => source.freshnessScore)));
  const missing = coverage.filter((item) => item.status !== "covered").map((item) => item.area);
  const metrics: Array<[ValidationAgentName, number, number, string, string[]]> = [
    ["Info", average(Object.values(output.info.byStock).map((item) => item.score)), average(output.info.events.map((item) => item.confidence)), `${output.info.events.length} intelligence events scored.`, missing],
    ["Macro & Policy", output.macroPolicy.marketScore, output.macroPolicy.confidence, output.macroPolicy.reasons.join(" "), missing.filter((item) => item.includes("policy") || item.includes("macro") || item.includes("sector"))],
    ["Sentiment", output.sentiment.market.score, output.sentiment.market.confidence, `${output.sentiment.market.classification} sentiment; ${output.sentiment.lowQualityShare}% low-quality share.`, missing.filter((item) => item.includes("sentiment") || item.includes("company news"))],
    ["Portfolio", average(output.portfolio.stocks.map((item) => item.score)), average(output.portfolio.stocks.map((item) => item.confidence)), output.portfolio.reasons.join(" "), coverage.filter((item) => item.area === "volume/price context" && item.status !== "covered").map((item) => item.area)],
    ["Growth", average(output.growth.candidates.map((item) => signedCandidateScore(item.proposedAction, item.existingLogicScore))), average(output.growth.candidates.map((item) => item.confidence)), `${output.growth.candidates.length} candidates evaluated; none are final actions.`, missing],
    ["Risk & Validation", average(output.riskValidation.decisions.map((item) => item.score)), average(output.riskValidation.decisions.map((item) => item.confidence)), `${output.riskValidation.decisions.filter((item) => item.downgradeTo).length} actions downgraded.`, missing],
    ["Performance", output.performance.hitRate === null ? 0 : clamp((output.performance.hitRate - 50) / 10, -5, 5), output.performance.total ? Math.min(100, output.performance.total * 3) : 0, output.performance.summary, output.performance.total ? [] : ["completed recommendation outcomes"]],
    ["Orchestrator", average(output.recommendations.map((item) => actionScore(item.action, item.score))), average(output.recommendations.map((item) => item.confidence)), `${output.recommendations.length} shadow decisions produced.`, missing],
  ];
  return metrics.map(([agent, signal, confidence, reason, missingInformation]) => {
    const confidencePenalty = coverage
      .filter((item) => missingInformation.includes(item.area))
      .reduce((sum, item) => sum + item.confidenceImpact, 0);
    const adjustedConfidence = Math.round(clamp(confidence - confidencePenalty, 0, 100));
    return {
      agent,
      health: adjustedConfidence < 25 ? "blocked" : adjustedConfidence < 55 || missingInformation.length ? "degraded" : "healthy",
      signalScore: round(clamp(signal, -5, 5), 1),
      confidence: adjustedConfidence,
      freshnessScore: freshness,
      sourceCredibilityScore: sourceCredibility,
      reason,
      missingInformation,
      sources,
    };
  });
}

function sourceAudit(source: AgentOrchestratorOutput["info"]["events"][number]["source"], now: Date): SourceAudit {
  const timestamp = source.publishedAt && Number.isFinite(Date.parse(source.publishedAt))
    ? source.publishedAt
    : null;
  const age = timestamp ? Math.max(0, now.getTime() - Date.parse(timestamp)) : Number.POSITIVE_INFINITY;
  const freshness = freshnessClass(age);
  return {
    name: source.name,
    type: sourceType(source.kind),
    credibility: source.credibility,
    credibilityScore: credibilityScore(source.credibility),
    urlOrReference: source.url ?? source.name,
    timestamp,
    freshness,
    freshnessScore: freshness === "today" ? 100 : freshness === "this week" ? 75 : freshness === "older" ? 40 : 10,
  };
}

function sourceType(kind: string): ValidationSourceType {
  if (kind === "exchange_filing") return "exchange filing";
  if (["company_update", "quarterly_result", "corporate_action"].includes(kind)) return "company update";
  if (["company_news", "sector_news", "macro", "global_market", "analyst"].includes(kind)) return "financial news";
  if (["government_policy", "politics"].includes(kind)) return "government";
  if (kind === "regulator") return "regulator";
  if (kind === "blog") return "blog";
  if (kind === "social") return "social";
  return "unknown";
}

function freshnessClass(ageMs: number): FreshnessClass {
  if (ageMs <= 86_400_000) return "today";
  if (ageMs <= 7 * 86_400_000) return "this week";
  if (ageMs <= 30 * 86_400_000) return "older";
  return "stale";
}

function countKinds(events: AgentOrchestratorOutput["info"]["events"], kinds: string[]) {
  return events.filter((event) => kinds.includes(event.source.kind)).length;
}

function currentLogicReliability(history: ValidationRecord[]): ReliabilityRow {
  const completed = history.filter((record) => ["Hit", "Miss"].includes(record.validationStatus));
  const hits = completed.filter((record) => record.validationStatus === "Hit").length;
  return reliability("Current logic", completed.length, hits);
}

function logReliability(label: string, logs: AgentRecommendationLog[]) {
  const completed = logs.filter((log) => log.status !== "pending");
  return reliability(label, completed.length, completed.filter((log) => log.status === "hit").length);
}

function reliability(label: string, completed: number, hits: number): ReliabilityRow {
  return { label, completed, hits, misses: completed - hits, accuracy: completed ? Math.round(hits / completed * 100) : null };
}

function sourceReliability(logs: AgentRecommendationLog[]) {
  const labels = [...new Set(logs.flatMap((log) => log.sourceTypes ?? []).map(sourceType))];
  return labels.map((label) => {
    const scoped = logs.filter((log) =>
      log.status !== "pending" &&
      log.sourceTypes?.some((kind) => sourceType(kind) === label),
    );
    return reliability(label, scoped.length, scoped.filter((log) => log.status === "hit").length);
  });
}

function horizonReliability(logs: AgentRecommendationLog[]) {
  return (["1 day", "1 week", "1 month"] as const).map((horizon) => {
    const outcomes = logs
      .flatMap((log) => log.outcomes ?? [])
      .filter((outcome) => outcome.horizon === horizon && outcome.status !== "pending");
    return reliability(
      horizon,
      outcomes.length,
      outcomes.filter((outcome) => outcome.status === "hit").length,
    );
  });
}

function horizonResult(log: AgentRecommendationLog, horizon: "1 day" | "1 week" | "1 month") {
  const outcome = log.outcomes?.find((item) => item.horizon === horizon);
  if (!outcome || outcome.status === "pending") return "pending";
  const change = outcome.returnPercent === null ? "" : ` · ${outcome.returnPercent}%`;
  return `${outcome.status}${change}`;
}

function latestLog(logs: AgentRecommendationLog[], symbol: string) {
  return logs.filter((log) => log.stock === symbol).sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
}

function explanationQuality(recommendation: AgentOrchestratorOutput["recommendations"][number]) {
  const checks = [
    Boolean(recommendation.reason),
    Boolean(recommendation.portfolioImpact),
    Object.keys(recommendation.agentReasons).length > 0,
    recommendation.positiveTriggers.length > 0 || recommendation.negativeConcerns.length > 0,
    recommendation.sourceSummary.length > 0,
  ];
  return Math.round(checks.filter(Boolean).length / checks.length * 100);
}

function actionAligned(action: string, score: number) {
  return action === "Buy" ? score >= 0.75 : action === "Sell" ? score <= -0.75 : Math.abs(score) < 1.5;
}

function actionOpposed(action: string, score: number) {
  return action === "Buy" ? score <= -0.75 : action === "Sell" ? score >= 0.75 : Math.abs(score) >= 2;
}

function signedCandidateScore(action: string, score: number) {
  const value = clamp((score - 50) / 10, -5, 5);
  return action === "Sell" ? -Math.abs(value) : action === "Buy" ? Math.abs(value) : 0;
}

function actionScore(action: string, score: number) {
  const value = clamp((score - 50) / 10, -5, 5);
  return action === "Sell" ? -Math.abs(value) : action === "Buy" ? Math.abs(value) : 0;
}

function accessGapAgent(area: CoverageArea): ValidationAgentName {
  if (area.includes("policy") || area.includes("macro") || area.includes("sector")) return "Macro & Policy";
  if (area.includes("sentiment")) return "Sentiment";
  if (area.includes("volume")) return "Portfolio";
  return "Info";
}
