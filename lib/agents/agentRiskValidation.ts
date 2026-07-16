import type {
  AgentGrowthOutput,
  AgentEarningsQualityOutput,
  AgentFundamentalOutput,
  AgentInfoOutput,
  AgentMacroPolicyOutput,
  AgentPortfolioOutput,
  AgentRiskValidationOutput,
  AgentSentimentOutput,
  AgentTechnicalOutput,
} from "@/lib/agents/types";
import { average, clamp, normalizeSymbol } from "@/lib/agents/utils";

export function agentRiskValidation({
  growth,
  info,
  macroPolicy,
  sentiment,
  portfolio,
  fundamental,
  technical,
  earningsQuality,
  now = new Date(),
}: {
  growth: AgentGrowthOutput;
  info: AgentInfoOutput;
  macroPolicy: AgentMacroPolicyOutput;
  sentiment: AgentSentimentOutput;
  portfolio: AgentPortfolioOutput;
  fundamental?: AgentFundamentalOutput;
  technical?: AgentTechnicalOutput;
  earningsQuality?: AgentEarningsQualityOutput;
  now?: Date;
}): AgentRiskValidationOutput {
  const decisions = growth.candidates.map((candidate) => {
    const infoSignal = info.byStock[candidate.symbol];
    const sentimentSignal = sentiment.byStock[candidate.symbol];
    const sectorSignal = macroPolicy.sectors.find((item) => item.sector === candidate.sector);
    const portfolioSignal = portfolio.stocks.find((item) => item.symbol === candidate.symbol);
    const fundamentalSignal = fundamental?.byStock[candidate.symbol];
    const technicalSignal = technical?.byStock[candidate.symbol];
    const earningsSignal = earningsQuality?.byStock[candidate.symbol];
    const directionalScores = [
      infoSignal?.score,
      sentimentSignal?.score,
      sectorSignal?.score,
      fundamentalSignal?.score ?? candidate.supportingScores.fundamental,
      technicalSignal?.score ?? candidate.supportingScores.technical,
      earningsSignal?.score,
    ]
      .filter((score): score is number => score !== undefined && Math.abs(score) >= 0.75);
    const relevantEvents = info.events.filter((event) =>
      event.affectedStocks?.some((symbol) => normalizeSymbol(symbol) === candidate.symbol),
    );
    const conflictingSignals = directionalScores.some((score) => score > 0) && directionalScores.some((score) => score < 0);
    const staleInformation = relevantEvents.length > 0 && relevantEvents.every(
      (event) => event.freshnessMinutes === null || event.freshnessMinutes > 1_440,
    );
    const supportConfidence = average([
      candidate.confidence,
      infoSignal?.confidence ?? 25,
      sentimentSignal?.confidence ?? 25,
      sectorSignal?.confidence ?? macroPolicy.confidence,
    ]);
    const poorConfidence = candidate.confidence < 55 || supportConfidence < 45;
    const excessiveVolatility = (candidate.volatilityScore ?? 0) >= 65;
    const weakLiquidity = candidate.liquidityScore !== undefined && candidate.liquidityScore < 22;
    const eventUncertainty = relevantEvents.some(
      (event) => event.impact === "mixed" || (Math.abs(event.impactScore) >= 2 && event.confidence < 55),
    );
    const weakNewsSources = relevantEvents.length === 0 || relevantEvents.every(
      (event) => event.sourceCredibility < 50,
    );
    const reliableSpecialistEvidence = [fundamentalSignal, technicalSignal, earningsSignal]
      .some((signal) => signal && signal.confidence >= 55 && Math.abs(signal.score) >= 0.75) ||
      (candidate.source === "wealth-universe" &&
        Math.abs(candidate.supportingScores.fundamental) >= 0.75 &&
        Math.abs(candidate.supportingScores.technical) >= 0.75);
    const weakSources = weakNewsSources && !reliableSpecialistEvidence;
    const portfolioMismatch = Boolean(
      portfolioSignal &&
      ((candidate.proposedAction === "Buy" && ["Sell", "Hold"].includes(portfolioSignal.action) && portfolioSignal.currentWeight > 20) ||
        (candidate.proposedAction === "Sell" && portfolioSignal.score >= 1.5)),
    );
    const checks = {
      conflictingSignals,
      staleInformation,
      poorConfidence,
      excessiveVolatility,
      weakLiquidity,
      eventUncertainty,
      portfolioMismatch,
      weakSources,
    };
    const failed = Object.values(checks).filter(Boolean).length;
    const severe =
      excessiveVolatility ||
      weakLiquidity ||
      portfolioMismatch ||
      weakSources ||
      staleInformation ||
      conflictingSignals;
    const shouldDowngrade = candidate.proposedAction !== "Watch" && (failed >= 2 || severe || poorConfidence);
    const direction = candidate.proposedAction === "Buy" ? 1 : candidate.proposedAction === "Sell" ? -1 : 0;
    const validatedStrength = Math.max(0, 4 - failed * 1.5) * direction;
    const reasons = Object.entries(checks)
      .filter(([, value]) => value)
      .map(([key]) => riskReason[key as keyof typeof riskReason]);

    return {
      symbol: candidate.symbol,
      score: Math.round(clamp(validatedStrength, -5, 5) * 10) / 10,
      confidence: Math.round(clamp(50 + failed * 6 + relevantEvents.length * 2, 45, 90)),
      blocked: severe && failed >= 2,
      downgradeTo: shouldDowngrade
        ? candidate.proposedAction === "Sell" ? "Hold" as const : "Watch" as const
        : undefined,
      checks,
      reasons: reasons.length ? reasons : ["No material validation failure detected."],
    };
  });

  return { agent: "Risk & Validation", generatedAt: now.toISOString(), decisions };
}

const riskReason = {
  conflictingSignals: "Material signals point in conflicting directions.",
  staleInformation: "Relevant information is stale or has no verified timestamp.",
  poorConfidence: "Evidence confidence is below the action threshold.",
  excessiveVolatility: "Modeled volatility/risk is excessive.",
  weakLiquidity: "Modeled liquidity is too weak for a reliable entry or exit.",
  eventUncertainty: "Event impact is mixed or uncertain.",
  portfolioMismatch: "The proposed action conflicts with portfolio concentration or exposure.",
  weakSources: "Only weak sources support the proposed action.",
};
