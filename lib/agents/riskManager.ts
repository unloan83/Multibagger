import type {
  AgentPerformanceOutput,
  AgentPortfolioOutput,
  AgentRiskManagementOutput,
  FinalRecommendation,
  ManagedPortfolio,
  RiskRule,
  RiskRuleResult,
} from "@/lib/agents/types";
import { clamp, normalizeSymbol } from "@/lib/agents/utils";

export function applyRiskManagement(
  recommendations: FinalRecommendation[],
  portfolio: ManagedPortfolio,
  portfolioOutput: AgentPortfolioOutput,
  performance: AgentPerformanceOutput,
): AgentRiskManagementOutput {
  const rules: RiskRule[] = [
    positionSizingRule,
    maxLossRule,
    stopLossRule,
    takeProfitRule,
    diversificationRule,
    sectorExposureRule,
    correlationRule,
    volatilityRule,
  ];

  const results: RiskRuleResult[] = rules.map((rule) => rule(recommendations, portfolio, portfolioOutput, performance));

  const filtered = recommendations.filter((rec) => {
    const blocked = results.filter((r) => r.action === "block").some((r) =>
      r.symbols ? r.symbols.includes(rec.symbol) : false,
    );
    return !blocked;
  });

  const reasons = results.flatMap((r) => r.reasons);

  return {
    agent: "Risk Management",
    generatedAt: new Date().toISOString(),
    rules: results,
    blockedCount: recommendations.length - filtered.length,
    passedCount: filtered.length,
    reasons,
  };
}

const positionSizingRule: RiskRule = (recommendations, portfolio) => {
  const reasons: string[] = [];
  let action: RiskRuleResult["action"] = "pass";
  const blockedSymbols: string[] = [];

  for (const rec of recommendations) {
    if (rec.action !== "Buy") continue;
    const position = portfolio.positions.find((p) => normalizeSymbol(p.symbol) === rec.symbol);
    if (!position) continue;
    const currentWeight = position.portfolioWeight ?? 0;
    const maxWeight = 25;
    if (currentWeight >= maxWeight) {
      blockedSymbols.push(rec.symbol);
      reasons.push(`${rec.symbol}: position at ${currentWeight.toFixed(1)}% exceeds max ${maxWeight}%.`);
    }
  }

  if (blockedSymbols.length) action = "block";
  return { rule: "Position Sizing", action, symbols: blockedSymbols.length ? blockedSymbols : undefined, reasons: reasons.length ? reasons : ["All positions within size limits."] };
};

const maxLossRule: RiskRule = (recommendations, portfolio) => {
  const reasons: string[] = [];
  const blockedSymbols: string[] = [];
  const maxLossPerPosition = 15;

  for (const rec of recommendations) {
    if (rec.action !== "Buy") continue;
    const position = portfolio.positions.find((p) => normalizeSymbol(p.symbol) === rec.symbol);
    if (!position || !position.currentPrice) continue;
    const stopLoss = rec.stopLoss ?? position.currentPrice * 0.92;
    const lossPct = ((position.currentPrice - stopLoss) / position.currentPrice) * 100;
    if (lossPct > maxLossPerPosition) {
      blockedSymbols.push(rec.symbol);
      reasons.push(`${rec.symbol}: potential loss ${lossPct.toFixed(1)}% exceeds max ${maxLossPerPosition}%.`);
    }
  }

  return {
    rule: "Maximum Loss",
    action: blockedSymbols.length ? "warn" : "pass",
    symbols: blockedSymbols.length ? blockedSymbols : undefined,
    reasons: reasons.length ? reasons : ["All positions within maximum loss limits."],
  };
};

const stopLossRule: RiskRule = (recommendations) => {
  const reasons: string[] = [];
  let missingCount = 0;

  for (const rec of recommendations) {
    if (rec.action !== "Buy") continue;
    if (!rec.stopLoss) {
      missingCount++;
      reasons.push(`${rec.symbol}: no stop-loss set.`);
    }
  }

  return {
    rule: "Stop-Loss",
    action: missingCount > recommendations.length * 0.3 ? "warn" : "pass",
    reasons: reasons.length ? reasons : ["All buy recommendations have stop-loss levels."],
  };
};

const takeProfitRule: RiskRule = (recommendations) => {
  const reasons: string[] = [];
  let missingCount = 0;

  for (const rec of recommendations) {
    if (rec.action !== "Buy") continue;
    if (!rec.target) {
      missingCount++;
      reasons.push(`${rec.symbol}: no take-profit target set.`);
    }
  }

  return {
    rule: "Take-Profit",
    action: missingCount > recommendations.length * 0.3 ? "warn" : "pass",
    reasons: reasons.length ? reasons : ["All buy recommendations have take-profit targets."],
  };
};

const diversificationRule: RiskRule = (recommendations, portfolio, portfolioOutput) => {
  const reasons: string[] = [];
  const totalHoldings = portfolio.positions.length;
  const buyCount = recommendations.filter((r) => r.action === "Buy").length;
  const maxNewPositions = Math.max(3, Math.round(totalHoldings * 0.3));

  if (buyCount > maxNewPositions) {
    reasons.push(`${buyCount} buy signals exceeds max ${maxNewPositions} new positions (30% of ${totalHoldings} holdings).`);
    return { rule: "Diversification", action: "warn", reasons };
  }

  return { rule: "Diversification", action: "pass", reasons: ["Portfolio diversification within limits."] };
};

const sectorExposureRule: RiskRule = (recommendations, portfolio, portfolioOutput) => {
  const reasons: string[] = [];
  const sectorLimit = 30;
  const sectorExposure = portfolioOutput.sectorConcentration;

  for (const rec of recommendations) {
    if (rec.action !== "Buy") continue;
    const candidate = portfolio.positions.find((p) => normalizeSymbol(p.symbol) === rec.symbol);
    if (!candidate) continue;
    const currentExposure = sectorExposure[candidate.sector] ?? 0;
    if (currentExposure >= sectorLimit) {
      reasons.push(`${candidate.sector} at ${currentExposure.toFixed(1)}% exceeds ${sectorLimit}% limit.`);
    }
  }

  return {
    rule: "Sector Exposure",
    action: reasons.length ? "warn" : "pass",
    reasons: reasons.length ? reasons : ["All sector exposures within limits."],
  };
};

const correlationRule: RiskRule = (recommendations, portfolio) => {
  const reasons: string[] = [];
  const sectors = new Set(recommendations.filter((r) => r.action === "Buy").map((r) => {
    const pos = portfolio.positions.find((p) => normalizeSymbol(p.symbol) === r.symbol);
    return pos?.sector ?? "Unknown";
  }));

  if (sectors.size <= 1 && recommendations.filter((r) => r.action === "Buy").length > 1) {
    reasons.push(`All buy signals in same sector (${[...sectors].join(", ")}). Consider diversifying.`);
  }

  return {
    rule: "Correlation",
    action: reasons.length ? "warn" : "pass",
    reasons: reasons.length ? reasons : ["Adequate sector diversification."],
  };
};

const volatilityRule: RiskRule = (recommendations, portfolio) => {
  const reasons: string[] = [];
  for (const rec of recommendations) {
    if (rec.action !== "Buy") continue;
    const position = portfolio.positions.find((p) => normalizeSymbol(p.symbol) === rec.symbol);
    if (!position) continue;
    const volatility = position.volatilityScore ?? position.riskScore ?? 0;
    if (volatility >= 70) {
      reasons.push(`${rec.symbol}: high volatility (${volatility.toFixed(0)}/100).`);
    }
  }

  return {
    rule: "Volatility Check",
    action: reasons.length ? "warn" : "pass",
    reasons: reasons.length ? reasons : ["All recommended stocks within acceptable volatility range."],
  };
};
