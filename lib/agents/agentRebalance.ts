import type {
  AgentRebalanceOutput,
  RebalanceMetrics,
} from "@/lib/agents/types";
import type { ManagedPortfolio } from "@/lib/portfolio";
import { clamp, normalizeSymbol } from "@/lib/agents/utils";

export function agentRebalance(
  portfolio: ManagedPortfolio,
  now = new Date(),
): AgentRebalanceOutput {
  const symbols = portfolio.positions
    .filter((p) => p.quantity > 0)
    .map((p) => normalizeSymbol(p.symbol))
    .filter(Boolean)
    .slice(0, 50);

  const totalValue = portfolio.positions.reduce((sum, p) => sum + p.currentPrice * p.quantity, 0);
  const sectorValues: Record<string, number> = {};
  for (const pos of portfolio.positions) {
    const value = pos.currentPrice * pos.quantity;
    sectorValues[pos.sector] = (sectorValues[pos.sector] ?? 0) + value;
  }

  const byStock: AgentRebalanceOutput["byStock"] = {};
  for (const symbol of symbols) {
    const position = portfolio.positions.find((p) => normalizeSymbol(p.symbol) === symbol);
    if (!position) continue;

    const metrics = computeMetrics(position, totalValue, sectorValues);
    const score = scoreRebalance(metrics);
    const confidence = 40 + (metrics.positionWeight !== null ? 20 : 0) + (metrics.sectorDeviation !== null ? 15 : 0);
    const reasons = buildReasons(metrics, score);

    byStock[symbol] = { metrics, score, confidence: Math.min(confidence, 85), reasons };
  }

  const scored = Object.values(byStock);
  const avgScore = scored.length
    ? scored.reduce((s, item) => s + item.score, 0) / scored.length
    : 0;

  return {
    agent: "Rebalance",
    generatedAt: now.toISOString(),
    byStock,
    summary: scored.length
      ? `${scored.length} positions reviewed; average rebalance score ${avgScore.toFixed(1)}/5.`
      : "No positions to rebalance.",
  };
}

function computeMetrics(
  position: { symbol: string; sector: string; currentPrice: number; quantity: number; volume?: number },
  totalValue: number,
  sectorValues: Record<string, number>,
): RebalanceMetrics {
  const positionValue = position.currentPrice * position.quantity;
  const positionWeight = totalValue > 0 ? (positionValue / totalValue) * 100 : 0;
  const sectorExposure = sectorValues[position.sector] ?? 0;
  const sectorWeight = totalValue > 0 ? (sectorExposure / totalValue) * 100 : 0;
  const targetSectorWeight = 100 / Object.keys(sectorValues).length;
  const sectorDeviation = Object.keys(sectorValues).length > 1
    ? sectorWeight - targetSectorWeight : 0;

  return {
    positionWeight,
    sectorWeight,
    sectorDeviation,
    maxPositionWeight: 25,
    maxSectorWeight: 35,
    concentrationRisk: positionWeight > 25 ? "high" : positionWeight > 15 ? "medium" : "low",
    rebalanceUrgency: positionWeight > 30 ? "high" : positionWeight > 20 || Math.abs(sectorDeviation) > 15 ? "medium" : "low",
  };
}

function scoreRebalance(m: RebalanceMetrics): number {
  let score = 0;
  let count = 0;

  if (m.positionWeight > 0) {
    if (m.positionWeight < 5) score += 0.5;
    else if (m.positionWeight < 15) score += 0.3;
    else if (m.positionWeight > 25) score -= 1;
    else if (m.positionWeight > 20) score -= 0.3;
    count++;
  }
  if (m.sectorDeviation !== null) {
    if (Math.abs(m.sectorDeviation) > 20) score -= 1;
    else if (Math.abs(m.sectorDeviation) > 10) score -= 0.3;
    else if (Math.abs(m.sectorDeviation) < 3) score += 0.3;
    count++;
  }
  if (m.concentrationRisk === "high") score -= 0.5;
  else if (m.concentrationRisk === "low") score += 0.5;
  count++;

  return count ? clamp((score / count) * 2, -3, 3) : 0;
}

function buildReasons(m: RebalanceMetrics, score: number): string[] {
  const reasons: string[] = [];
  reasons.push(`Weight: ${m.positionWeight.toFixed(1)}%`);
  if (m.sectorDeviation !== null) reasons.push(`Sector dev: ${m.sectorDeviation > 0 ? "+" : ""}${m.sectorDeviation.toFixed(1)}%`);
  reasons.push(`Risk: ${m.concentrationRisk}`);
  reasons.push(`Urgency: ${m.rebalanceUrgency}`);
  reasons.push(score >= 0 ? "Portfolio allocation balanced." : "Consider rebalancing this position.");
  return reasons;
}
