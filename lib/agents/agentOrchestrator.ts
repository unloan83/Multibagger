import type {
  AgentAction,
  AgentEarningsQualityOutput,
  AgentFundamentalOutput,
  AgentGrowthOutput,
  AgentInfoOutput,
  AgentIntradayOutput,
  AgentLongTermOutput,
  AgentMacroPolicyOutput,
  AgentOrchestratorOutput,
  AgentPerformanceOutput,
  AgentPortfolioOutput,
  AgentRebalanceOutput,
  AgentRiskValidationOutput,
  AgentSentimentOutput,
  AgentSwingOutput,
  AgentTechnicalOutput,
  AgentWealthUniverseOutput,
  BayesianOutput,
  FinalRecommendation,
  GrowthCandidate,
  OrchestratorWeights,
} from "@/lib/agents/types";
import { buildRAGContext, enrichRecommendationWithRAG } from "@/lib/agents/ragEngine";
import { applyRiskManagement } from "@/lib/agents/riskManager";
import { clamp, normalizeSymbol, scoreToPercent } from "@/lib/agents/utils";
import type { ManagedPortfolio } from "@/lib/portfolio";

export const defaultOrchestratorWeights: OrchestratorWeights = {
  existingLogic: 28,
  info: 14,
  macroPolicy: 9,
  sentiment: 5,
  portfolio: 7,
  riskValidation: 7,
  fundamental: 7,
  technical: 4,
  intraday: 4,
  swing: 4,
  longTerm: 4,
  earningsQuality: 4,
  rebalance: 3,
};

export const intradayOrchestratorWeights: OrchestratorWeights = {
  existingLogic: 20, info: 8, macroPolicy: 8, sentiment: 5, portfolio: 2,
  riskValidation: 10, fundamental: 3, technical: 15, intraday: 20,
  swing: 5, longTerm: 1, earningsQuality: 1, rebalance: 2,
};

export const longTermOrchestratorWeights: OrchestratorWeights = {
  existingLogic: 14, info: 8, macroPolicy: 8, sentiment: 3, portfolio: 5,
  riskValidation: 10, fundamental: 20, technical: 5, intraday: 1,
  swing: 3, longTerm: 14, earningsQuality: 6, rebalance: 3,
};

export const swingOrchestratorWeights: OrchestratorWeights = {
  existingLogic: 22, info: 10, macroPolicy: 8, sentiment: 5, portfolio: 5,
  riskValidation: 10, fundamental: 8, technical: 10, intraday: 4,
  swing: 10, longTerm: 3, earningsQuality: 2, rebalance: 3,
};

export function agentOrchestrator({
  info,
  macroPolicy,
  sentiment,
  portfolio,
  growth,
  wealthUniverse,
  riskValidation,
  performance,
  fundamental,
  technical,
  intraday,
  swing,
  longTerm,
  earningsQuality,
  rebalance,
  portfolioInput,
  weights = defaultOrchestratorWeights,
  bayesian,
  now = new Date(),
}: {
  info: AgentInfoOutput;
  macroPolicy: AgentMacroPolicyOutput;
  sentiment: AgentSentimentOutput;
  portfolio: AgentPortfolioOutput;
  growth: AgentGrowthOutput;
  wealthUniverse?: AgentWealthUniverseOutput;
  riskValidation: AgentRiskValidationOutput;
  performance: AgentPerformanceOutput;
  fundamental: AgentFundamentalOutput;
  technical: AgentTechnicalOutput;
  intraday: AgentIntradayOutput;
  swing: AgentSwingOutput;
  longTerm: AgentLongTermOutput;
  earningsQuality: AgentEarningsQualityOutput;
  rebalance: AgentRebalanceOutput;
  portfolioInput: ManagedPortfolio;
  weights?: OrchestratorWeights;
  bayesian?: BayesianOutput;
  now?: Date;
}): AgentOrchestratorOutput {
  validateWeights(weights);
  const recommendations = growth.candidates.map((candidate): FinalRecommendation => {
    const infoSignal = info.byStock[candidate.symbol];
    const sectorSignal = macroPolicy.sectors.find((item) => item.sector === candidate.sector);
    const sentimentSignal = sentiment.byStock[candidate.symbol];
    const portfolioSignal = portfolio.stocks.find((item) => item.symbol === candidate.symbol);
    const risk = riskValidation.decisions.find((item) => item.symbol === candidate.symbol);
    const existingLogic = candidate.proposedAction === "Buy"
      ? clamp((candidate.existingLogicScore - 50) / 10, 0.5, 5)
      : candidate.proposedAction === "Sell"
        ? -clamp(candidate.confidence / 20, 0.5, 5)
        : 0;
    const fundamentalSignal = fundamental.byStock[candidate.symbol];
    const technicalSignal = technical.byStock[candidate.symbol];
    const intradaySignal = intraday.byStock[candidate.symbol];
    const swingSignal = swing.byStock[candidate.symbol];
    const longTermSignal = longTerm.byStock[candidate.symbol];
    const earningsQualitySignal = earningsQuality.byStock[candidate.symbol];
    const rebalanceSignal = rebalance.byStock[candidate.symbol];

    const agentScores = {
      existingLogic: roundScore(existingLogic + performance.scoreAdjustments.existingLogic),
      info: roundScore((infoSignal?.score ?? 0) + performance.scoreAdjustments.info),
      macroPolicy: roundScore((sectorSignal?.score ?? macroPolicy.marketScore * 0.5) + performance.scoreAdjustments.macroPolicy),
      sentiment: roundScore((sentimentSignal?.score ?? sentiment.market.score * 0.4) + performance.scoreAdjustments.sentiment),
      portfolio: roundScore((portfolioSignal?.score ?? 0) + performance.scoreAdjustments.portfolio),
      riskValidation: roundScore((risk?.score ?? 0) + performance.scoreAdjustments.riskValidation),
      fundamental: roundScore((fundamentalSignal?.score ?? candidate.supportingScores.fundamental) + performance.scoreAdjustments.fundamental),
      technical: roundScore((technicalSignal?.score ?? candidate.supportingScores.technical) + performance.scoreAdjustments.technical),
      intraday: roundScore((intradaySignal?.score ?? 0) + performance.scoreAdjustments.intraday),
      swing: roundScore((swingSignal?.score ?? 0) + performance.scoreAdjustments.swing),
      longTerm: roundScore((longTermSignal?.score ?? 0) + performance.scoreAdjustments.longTerm),
      earningsQuality: roundScore((earningsQualitySignal?.score ?? 0) + performance.scoreAdjustments.earningsQuality),
      rebalance: roundScore((rebalanceSignal?.score ?? 0) + performance.scoreAdjustments.rebalance),
    };
    const bayesianMultipliers = bayesian?.adjustments.reduce(
      (map, adj) => { map[adj.agent] = adj.weightMultiplier; return map; },
      {} as Record<string, number>,
    ) ?? {};
    const timeframeWeights = weights === defaultOrchestratorWeights
      ? weightsForTimeframe(candidate.timeframe)
      : weights;
    const adjustedWeights = Object.fromEntries(
      Object.entries(timeframeWeights).map(([key, w]) => [key, w * (bayesianMultipliers[key] ?? 1.0)]),
    ) as OrchestratorWeights;
    const totalAdjustedWeight = Object.values(adjustedWeights).reduce((sum, value) => sum + value, 0);
    const score = Math.round(Object.entries(adjustedWeights).reduce((sum, [key, weight]) =>
      sum + scoreToPercent(agentScores[key as keyof OrchestratorWeights]) * weight, 0) / totalAdjustedWeight);
    let action = chooseAction(candidate.proposedAction, score, Boolean(portfolioSignal));
    if (risk?.downgradeTo && ["Buy", "Sell"].includes(action)) action = risk.downgradeTo;
    if (risk?.blocked) action = candidate.proposedAction === "Sell" ? "Hold" : "Watch";
    const sourceSummary = info.events
      .filter((event) =>
        event.affectedStocks?.some((symbol) => normalizeSymbol(symbol) === candidate.symbol) ||
        event.affectedSectors?.includes(candidate.sector),
      )
      .slice(0, 4)
      .map((event) => `${event.source.name}: ${event.summary}`);
    const confidenceInputs = [
      candidate.confidence,
      infoSignal?.confidence ?? 30,
      sectorSignal?.confidence ?? macroPolicy.confidence,
      sentimentSignal?.confidence ?? sentiment.market.confidence,
      portfolioSignal?.confidence ?? 40,
      risk?.confidence ?? 50,
      fundamentalSignal?.confidence ?? 30,
      technicalSignal?.confidence ?? 30,
      intradaySignal?.confidence ?? 25,
      swingSignal?.confidence ?? 30,
      longTermSignal?.confidence ?? 35,
      earningsQualitySignal?.confidence ?? 30,
      rebalanceSignal?.confidence ?? 35,
    ];
    const conflictPenalty = risk?.checks.conflictingSignals ? 12 : 0;
    const calibration = performance.confidenceCalibration ?? 55;
    const rawConfidence = Math.round(clamp(
      confidenceInputs.reduce((sum, value) => sum + value, 0) / confidenceInputs.length * 0.85 + calibration * 0.15 - conflictPenalty,
      15,
      95,
    ));
    const evidenceCompleteness = calculateEvidenceCompleteness({
      candidate, infoSignal, fundamentalSignal, technicalSignal, intradaySignal,
      longTermSignal, earningsQualitySignal, risk,
    });
    const confidence = Math.min(rawConfidence, evidenceCompleteness);
    const rejectionCodes: FinalRecommendation["rejectionCodes"] = [];
    if (evidenceCompleteness < 55) rejectionCodes.push("INSUFFICIENT_EVIDENCE");
    if (confidence < 55) rejectionCodes.push("LOW_CONFIDENCE");
    const target = longTermSignal?.target ?? (["Buy", "Sell"].includes(action) ? candidate.target : undefined);
    const stopLoss = longTermSignal?.stopLoss ?? (["Buy", "Sell"].includes(action) ? candidate.stopLoss : undefined);
    if (action === "Buy" && !target) rejectionCodes.push("MISSING_TARGET");
    if (action === "Buy" && !stopLoss) rejectionCodes.push("MISSING_STOP_LOSS");
    if (risk?.blocked) rejectionCodes.push("RISK_BLOCKED");
    if (candidate.proposedAction === "Watch") rejectionCodes.push("NO_QUALIFIED_SIGNAL");
    if (action === "Buy" && rejectionCodes.length) action = portfolioSignal ? "Hold" : "Watch";
    const publicationStatus: FinalRecommendation["publicationStatus"] = action === "Buy" || action === "Sell"
      ? "actionable"
      : portfolioSignal
        ? "portfolio-decision"
        : rejectionCodes.includes("RISK_BLOCKED") || rejectionCodes.includes("INSUFFICIENT_EVIDENCE")
          ? "rejected"
          : "watchlist";
    const riskReasons = risk?.reasons ?? [];
    const positiveTriggers = [
      ...candidate.positiveTriggers,
      ...(infoSignal?.score && infoSignal.score > 0 ? infoSignal.reasons : []),
      ...(sectorSignal?.score && sectorSignal.score > 0 ? sectorSignal.reasons : []),
    ].slice(0, 5);
    const negativeConcerns = [
      ...candidate.negativeConcerns,
      ...riskReasons.filter((reason) => !reason.startsWith("No material")),
      ...(infoSignal?.score && infoSignal.score < 0 ? infoSignal.reasons : []),
    ].slice(0, 6);
    const reason = action === candidate.proposedAction
      ? `${candidate.reason} Orchestrator score ${score}/100 after all specialist checks.`
      : `${candidate.proposedAction} was downgraded to ${action}: ${riskReasons.join(" ") || "combined evidence did not clear the action threshold."}`;

    return {
      symbol: candidate.symbol,
      company: candidate.company,
      action,
      timeframe: candidate.timeframe,
      confidence,
      score,
      publicationStatus,
      evidenceCompleteness,
      rejectionCodes,
      reason,
      whatChangedRecently: infoSignal?.reasons.slice(0, 3) ?? ["No verified recent company event in the current feed."],
      positiveTriggers,
      negativeConcerns,
      sourceSummary,
      portfolioImpact: portfolioSignal
        ? `${portfolioSignal.action}: ${portfolioSignal.reasons.join(" ")}`
        : "Stock is not a current holding; no holding-level portfolio impact.",
      target: ["Buy", "Sell"].includes(action) ? target : undefined,
      stopLoss: ["Buy", "Sell"].includes(action) ? stopLoss : undefined,
      expectedMove: intradaySignal?.metrics?.targetDistance ?? undefined,
      expectedCagr: longTermSignal?.cagr ?? null,
      riskLevel: longTermSignal?.riskLevel ?? (
        intradaySignal?.metrics?.intradayVolatility != null && intradaySignal.metrics.intradayVolatility > 3
          ? "high"
          : "medium"
      ),
      agentScores,
      agentReasons: {
        existingLogic: [candidate.reason],
        info: infoSignal?.reasons ?? ["No stock-specific event."],
        macroPolicy: sectorSignal?.reasons ?? macroPolicy.reasons,
        sentiment: sentimentSignal?.reasons ?? sentiment.market.reasons,
        portfolio: portfolioSignal?.reasons ?? ["Not a current holding."],
        riskValidation: riskReasons,
        fundamental: fundamentalSignal?.reasons ?? ["No fundamental data."],
        technical: technicalSignal?.reasons ?? ["No technical data."],
        intraday: intradaySignal?.reasons ?? ["No intraday data."],
        swing: swingSignal?.reasons ?? ["No swing data."],
        longTerm: longTermSignal?.reasons ?? ["No long-term data."],
        earningsQuality: earningsQualitySignal?.reasons ?? ["No earnings quality data."],
        rebalance: rebalanceSignal?.reasons ?? ["No rebalance data."],
      },
      capBucket: candidate.capBucket,
      source: candidate.source,
      thematicSector: candidate.thematicSector,
    };
  }).sort((a, b) => b.score - a.score);

  const rag = buildRAGContextForTop(recommendations.slice(0, 5), info, fundamental, technical, intraday, swing, longTerm);
  const enriched = recommendations.map((rec) => {
    const ctx = rag[rec.symbol];
    return ctx ? enrichRecommendationWithRAG(rec, ctx) : rec;
  });

  const riskManagement = applyRiskManagement(enriched, portfolioInput, portfolio, performance);
  const blockedSymbols = new Set(riskManagement.rules
    .filter((rule) => rule.action === "block")
    .flatMap((rule) => rule.symbols ?? []));
  const riskAdjusted = enriched.map((recommendation) => {
    if (!blockedSymbols.has(recommendation.symbol) || !["Buy", "Sell"].includes(recommendation.action)) {
      return recommendation;
    }
    const isHolding = portfolioInput.positions.some(
      (position) => normalizeSymbol(position.symbol) === recommendation.symbol && position.quantity > 0,
    );
    const action: AgentAction = isHolding ? "Hold" : "Watch";
    const reasons = riskManagement.rules
      .filter((rule) => rule.action === "block" && rule.symbols?.includes(recommendation.symbol))
      .flatMap((rule) => rule.reasons);
    return {
      ...recommendation,
      action,
      publicationStatus: "portfolio-decision" as const,
      rejectionCodes: [...new Set([...recommendation.rejectionCodes, "RISK_BLOCKED" as const])],
      target: undefined,
      stopLoss: undefined,
      reason: `${recommendation.action} was blocked by portfolio risk management and changed to ${action}: ${reasons.join(" ")}`,
      negativeConcerns: [...new Set([...recommendation.negativeConcerns, ...reasons])].slice(0, 6),
    };
  });

  return {
    agent: "Orchestrator",
    generatedAt: now.toISOString(),
    weights,
    recommendations: riskAdjusted,
    info,
    macroPolicy,
    sentiment,
    portfolio,
    growth,
    wealthUniverse: wealthUniverse ?? {
      agent: "WealthUniverse",
      generatedAt: now.toISOString(),
      candidates: [],
      byBucket: {
        large: { longTerm: [], intraday: [] },
        mid: { longTerm: [], intraday: [] },
        small: { longTerm: [], intraday: [] },
      },
      snapshotAge: -1,
      longTermSnapshotAge: -1,
      freshness: "unavailable",
      rejectionReasons: ["Wealth universe was not supplied to the orchestrator."],
      summary: "Wealth universe was not supplied to the orchestrator.",
    },
    riskValidation,
    performance,
    fundamental,
    technical,
    intraday,
    swing,
    longTerm,
    earningsQuality,
    rebalance,
    bayesian: bayesian ?? {
      adjustments: [],
      state: { byAgent: {}, lastUpdated: now.toISOString() },
      summary: "Bayesian layer not enabled.",
    },
    riskManagement,
    disclaimer: "AI-assisted market analysis, not certified investment advice. Please verify before acting.",
  };
}

function buildRAGContextForTop(
  top: FinalRecommendation[],
  info: AgentInfoOutput,
  fundamental: AgentFundamentalOutput,
  technical: AgentTechnicalOutput,
  intraday: AgentIntradayOutput,
  swing: AgentSwingOutput,
  longTerm: AgentLongTermOutput,
): Record<string, ReturnType<typeof buildRAGContext>> {
  const result: Record<string, ReturnType<typeof buildRAGContext>> = {};
  for (const rec of top) {
    result[rec.symbol] = buildRAGContext(rec.symbol, info, fundamental, technical, intraday, swing, longTerm);
  }
  return result;
}

function chooseAction(proposed: AgentAction, score: number, isHolding: boolean): AgentAction {
  if (proposed === "Watch") return isHolding ? "Hold" : "Watch";
  if (proposed === "Buy") return score >= 58 ? "Buy" : isHolding ? "Hold" : "Watch";
  if (proposed === "Sell") return score <= 42 ? "Sell" : "Hold";
  return proposed;
}

function weightsForTimeframe(timeframe: GrowthCandidate["timeframe"]) {
  if (timeframe === "Intraday") return intradayOrchestratorWeights;
  if (timeframe === "Long term" || timeframe === "6-12 months") return longTermOrchestratorWeights;
  return swingOrchestratorWeights;
}

function calculateEvidenceCompleteness({
  candidate,
  infoSignal,
  fundamentalSignal,
  technicalSignal,
  intradaySignal,
  longTermSignal,
  earningsQualitySignal,
  risk,
}: {
  candidate: GrowthCandidate;
  infoSignal?: AgentInfoOutput["byStock"][string];
  fundamentalSignal?: AgentFundamentalOutput["byStock"][string];
  technicalSignal?: AgentTechnicalOutput["byStock"][string];
  intradaySignal?: AgentIntradayOutput["byStock"][string];
  longTermSignal?: AgentLongTermOutput["byStock"][string];
  earningsQualitySignal?: AgentEarningsQualityOutput["byStock"][string];
  risk?: AgentRiskValidationOutput["decisions"][number];
}) {
  const cachedFundamental = candidate.supportingScores.fundamental !== 0;
  const cachedTechnical = candidate.supportingScores.technical !== 0;
  const checks = candidate.timeframe === "Intraday"
    ? [
        Boolean(technicalSignal || cachedTechnical), Boolean(intradaySignal),
        candidate.liquidityScore != null, candidate.volatilityScore != null,
        Boolean(candidate.target), Boolean(candidate.stopLoss), Boolean(risk), Boolean(infoSignal),
      ]
    : [
        Boolean(fundamentalSignal || cachedFundamental), Boolean(technicalSignal || cachedTechnical),
        Boolean(longTermSignal || cachedFundamental), Boolean(earningsQualitySignal || cachedFundamental),
        Boolean(candidate.target), Boolean(candidate.stopLoss), Boolean(risk), Boolean(infoSignal),
      ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

function validateWeights(weights: OrchestratorWeights) {
  const values = Object.values(weights);
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("Orchestrator weights must be finite, non-negative numbers.");
  }
  if (Math.abs(values.reduce((sum, value) => sum + value, 0) - 100) > 0.001) {
    throw new Error("Orchestrator weights must total 100.");
  }
}

function roundScore(score: number) {
  return Math.round(clamp(score, -5, 5) * 10) / 10;
}
