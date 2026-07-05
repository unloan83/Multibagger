import type {
  AgentAction,
  AgentFundamentalOutput,
  AgentGrowthOutput,
  AgentInfoOutput,
  AgentMacroPolicyOutput,
  AgentOrchestratorOutput,
  AgentPerformanceOutput,
  AgentPortfolioOutput,
  AgentRiskValidationOutput,
  AgentSentimentOutput,
  AgentTechnicalOutput,
  FinalRecommendation,
  OrchestratorWeights,
} from "@/lib/agents/types";
import { clamp, normalizeSymbol, scoreToPercent } from "@/lib/agents/utils";

export const defaultOrchestratorWeights: OrchestratorWeights = {
  existingLogic: 35,
  info: 20,
  macroPolicy: 15,
  sentiment: 10,
  portfolio: 10,
  riskValidation: 10,
  fundamental: 10,
  technical: 5,
};

export function agentOrchestrator({
  info,
  macroPolicy,
  sentiment,
  portfolio,
  growth,
  riskValidation,
  performance,
  fundamental,
  technical,
  weights = defaultOrchestratorWeights,
  now = new Date(),
}: {
  info: AgentInfoOutput;
  macroPolicy: AgentMacroPolicyOutput;
  sentiment: AgentSentimentOutput;
  portfolio: AgentPortfolioOutput;
  growth: AgentGrowthOutput;
  riskValidation: AgentRiskValidationOutput;
  performance: AgentPerformanceOutput;
  fundamental: AgentFundamentalOutput;
  technical: AgentTechnicalOutput;
  weights?: OrchestratorWeights;
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
    const agentScores = {
      existingLogic: roundScore(existingLogic + performance.scoreAdjustments.existingLogic),
      info: roundScore((infoSignal?.score ?? 0) + performance.scoreAdjustments.info),
      macroPolicy: roundScore((sectorSignal?.score ?? macroPolicy.marketScore * 0.5) + performance.scoreAdjustments.macroPolicy),
      sentiment: roundScore((sentimentSignal?.score ?? sentiment.market.score * 0.4) + performance.scoreAdjustments.sentiment),
      portfolio: roundScore((portfolioSignal?.score ?? 0) + performance.scoreAdjustments.portfolio),
      riskValidation: roundScore((risk?.score ?? 0) + performance.scoreAdjustments.riskValidation),
      fundamental: roundScore((fundamentalSignal?.score ?? 0) + performance.scoreAdjustments.fundamental),
      technical: roundScore((technicalSignal?.score ?? 0) + performance.scoreAdjustments.technical),
    };
    const totalWeight = Object.values(weights).reduce((sum, value) => sum + value, 0);
    const score = Math.round(Object.entries(weights).reduce((sum, [key, weight]) =>
      sum + scoreToPercent(agentScores[key as keyof OrchestratorWeights]) * weight, 0) / totalWeight);
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
    ];
    const conflictPenalty = risk?.checks.conflictingSignals ? 12 : 0;
    const calibration = performance.confidenceCalibration ?? 55;
    const confidence = Math.round(clamp(
      confidenceInputs.reduce((sum, value) => sum + value, 0) / confidenceInputs.length * 0.85 + calibration * 0.15 - conflictPenalty,
      15,
      95,
    ));
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
      reason,
      whatChangedRecently: infoSignal?.reasons.slice(0, 3) ?? ["No verified recent company event in the current feed."],
      positiveTriggers,
      negativeConcerns,
      sourceSummary,
      portfolioImpact: portfolioSignal
        ? `${portfolioSignal.action}: ${portfolioSignal.reasons.join(" ")}`
        : "Stock is not a current holding; no holding-level portfolio impact.",
      target: ["Buy", "Sell"].includes(action) ? candidate.target : undefined,
      stopLoss: ["Buy", "Sell"].includes(action) ? candidate.stopLoss : undefined,
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
      },
    };
  }).sort((a, b) => b.score - a.score);

  return {
    agent: "Orchestrator",
    generatedAt: now.toISOString(),
    weights,
    recommendations,
    info,
    macroPolicy,
    sentiment,
    portfolio,
    growth,
    riskValidation,
    performance,
    fundamental,
    technical,
    disclaimer: "AI-assisted market analysis, not certified investment advice. Please verify before acting.",
  };
}

function chooseAction(proposed: AgentAction, score: number, isHolding: boolean): AgentAction {
  if (proposed === "Watch") return isHolding ? "Hold" : "Watch";
  if (proposed === "Buy") return score >= 62 ? "Buy" : isHolding ? "Hold" : "Watch";
  if (proposed === "Sell") return score <= 42 ? "Sell" : "Hold";
  return proposed;
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
