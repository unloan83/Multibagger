import type {
  AgentFundamentalOutput,
  AgentInfoOutput,
  AgentLongTermOutput,
  AgentMacroPolicyOutput,
  AgentPerformanceOutput,
  AgentPortfolioOutput,
  LongTermMetrics,
} from "@/lib/agents/types";
import { clamp, normalizeSymbol } from "@/lib/agents/utils";
import type { ManagedPortfolio } from "@/lib/portfolio";

export function agentLongTerm({
  portfolio,
  info,
  macroPolicy,
  fundamental,
  portfolioOutput,
  performance,
  now = new Date(),
}: {
  portfolio: ManagedPortfolio;
  info: AgentInfoOutput;
  macroPolicy: AgentMacroPolicyOutput;
  fundamental: AgentFundamentalOutput;
  portfolioOutput: AgentPortfolioOutput;
  performance: AgentPerformanceOutput;
  now?: Date;
}): AgentLongTermOutput {
  const symbols = portfolio.positions.map((p) => normalizeSymbol(p.symbol));
  const uniqueSymbols = [...new Set(symbols)];

  const byStock: AgentLongTermOutput["byStock"] = {};
  for (const symbol of uniqueSymbols) {
    const fundamentalSignal = fundamental.byStock[symbol];
    const infoSignal = info.byStock[symbol];
    const position = portfolio.positions.find((p) => normalizeSymbol(p.symbol) === symbol);
    const portfolioSignal = portfolioOutput.stocks.find((s) => s.symbol === symbol);
    const sector = position?.sector ?? "";
    const sectorSignal = macroPolicy.sectors.find((s) => s.sector === sector);
    const fMetrics = fundamentalSignal?.metrics;

    const metrics = computeLongTermMetrics(fMetrics ?? null);
    const score = scoreLongTerm(metrics, fundamentalSignal, infoSignal, sectorSignal, macroPolicy, performance);
    const confidence = longTermConfidence(metrics, fundamentalSignal, performance);
    const reasons = buildLongTermReasons(metrics, score, fundamentalSignal, infoSignal, sectorSignal, performance);
    const cagrInputs = [
      fMetrics?.returnOnEquity != null ? fMetrics.returnOnEquity * 100 : null,
      fMetrics?.revenueGrowth != null ? fMetrics.revenueGrowth * 100 * 0.6 : null,
    ].filter((v): v is number => v !== null);
    const cagr = cagrInputs.length
      ? clamp(cagrInputs.reduce((s, v) => s + v, 0) / cagrInputs.length, -10, 40)
      : null;
    const riskLevel = assessLongTermRisk(metrics, portfolioSignal, macroPolicy);

    byStock[symbol] = {
      metrics, score, confidence, reasons,
      cagr: cagr !== null ? Math.round(cagr * 10) / 10 : null,
      riskLevel,
      target: cagr !== null && position?.currentPrice
        ? Math.round(position.currentPrice * (1 + cagr / 100) * 100) / 100
        : undefined,
      stopLoss: position?.currentPrice
        ? Math.round(position.currentPrice * 0.85 * 100) / 100
        : undefined,
    };
  }

  const scored = Object.values(byStock);
  const avgScore = scored.length ? scored.reduce((s, item) => s + item.score, 0) / scored.length : 0;

  return {
    agent: "LongTerm",
    generatedAt: now.toISOString(),
    byStock,
    summary: scored.length
      ? `${scored.length} stocks scored for long-term; average score ${avgScore.toFixed(1)}/5.`
      : "No long-term data available.",
  };
}

function computeLongTermMetrics(fMetrics: AgentFundamentalOutput["byStock"][string]["metrics"] | null): LongTermMetrics {
  return {
    peRatio: fMetrics?.peRatio ?? null,
    pbRatio: fMetrics?.pbRatio ?? null,
    debtEquity: fMetrics?.debtEquity ?? null,
    returnOnEquity: fMetrics?.returnOnEquity ?? null,
    revenueGrowth: fMetrics?.revenueGrowth ?? null,
    profitMargin: fMetrics?.profitMargin ?? null,
    marketCap: fMetrics?.marketCap ?? null,
    dividendYield: fMetrics?.dividendYield ?? null,
    pegRatio: fMetrics?.peRatio && fMetrics?.revenueGrowth && fMetrics.revenueGrowth > 0
      ? fMetrics.peRatio / (fMetrics.revenueGrowth * 100)
      : null,
    freeCashFlowYield: null,
    earningsGrowth5y: fMetrics?.revenueGrowth ?? null,
    macroScore: null,
  };
}

function scoreLongTerm(
  m: LongTermMetrics,
  fundamentalSignal: AgentFundamentalOutput["byStock"][string] | undefined,
  infoSignal: AgentInfoOutput["byStock"][string] | undefined,
  sectorSignal: { score: number; reasons: string[] } | undefined,
  macroPolicy: AgentMacroPolicyOutput,
  performance: AgentPerformanceOutput,
): number {
  let score = 0;
  let count = 0;

  if (m.peRatio !== null && m.peRatio > 0) {
    if (m.peRatio < 15) score += 1.5;
    else if (m.peRatio < 25) score += 0.5;
    else if (m.peRatio > 40) score -= 1;
    count++;
  }
  if (m.pbRatio !== null && m.pbRatio > 0) {
    if (m.pbRatio < 1.5) score += 1;
    else if (m.pbRatio > 5) score -= 0.5;
    count++;
  }
  if (m.debtEquity !== null && m.debtEquity > 0) {
    if (m.debtEquity < 0.5) score += 1;
    else if (m.debtEquity > 2) score -= 1;
    count++;
  }
  if (m.returnOnEquity !== null) {
    if (m.returnOnEquity > 0.2) score += 1.5;
    else if (m.returnOnEquity > 0.1) score += 0.5;
    else if (m.returnOnEquity < 0) score -= 1;
    count++;
  }
  if (m.revenueGrowth !== null) {
    if (m.revenueGrowth > 0.2) score += 1;
    else if (m.revenueGrowth > 0.05) score += 0.3;
    else if (m.revenueGrowth < 0) score -= 0.5;
    count++;
  }
  if (m.pegRatio !== null && m.pegRatio > 0) {
    if (m.pegRatio < 1) score += 1.5;
    else if (m.pegRatio < 2) score += 0.3;
    else if (m.pegRatio > 3) score -= 0.5;
    count++;
  }
  if (m.dividendYield !== null && m.dividendYield > 0) {
    if (m.dividendYield > 0.03) score += 0.5;
    else if (m.dividendYield > 0.015) score += 0.2;
    count++;
  }
  if (sectorSignal?.score !== undefined && sectorSignal.score !== 0) {
    score += clamp(sectorSignal.score * 0.4, -1.5, 1.5);
    count++;
  }
  if (macroPolicy.marketScore !== 0) {
    score += clamp(macroPolicy.marketScore * 0.2, -1, 1);
    count++;
  }
  if (infoSignal?.score !== undefined && infoSignal.score !== 0) {
    score += clamp(infoSignal.score * 0.2, -1, 1);
    count++;
  }
  if (performance.hitRate !== null) {
    if (performance.hitRate >= 65) score += 0.3;
    else if (performance.hitRate < 45) score -= 0.3;
    count++;
  }

  return count ? clamp((score / count) * 2, -5, 5) : 0;
}

function longTermConfidence(
  m: LongTermMetrics,
  fundamentalSignal: AgentFundamentalOutput["byStock"][string] | undefined,
  performance: AgentPerformanceOutput,
): number {
  const available = [m.peRatio, m.pbRatio, m.debtEquity, m.returnOnEquity, m.revenueGrowth, m.pegRatio]
    .filter((v) => v !== null).length;
  const base = clamp(30 + available * 8, 20, 85);
  const perfBonus = performance.hitRate !== null && performance.hitRate >= 60 ? 5 : 0;
  const perfPenalty = performance.hitRate !== null && performance.hitRate < 40 ? -5 : 0;
  return clamp(base + perfBonus + perfPenalty, 15, 90);
}

function buildLongTermReasons(
  m: LongTermMetrics,
  score: number,
  fundamentalSignal?: AgentFundamentalOutput["byStock"][string],
  infoSignal?: AgentInfoOutput["byStock"][string],
  sectorSignal?: { score: number; reasons: string[] },
  performance?: AgentPerformanceOutput,
): string[] {
  const reasons: string[] = [];
  if (m.peRatio !== null) reasons.push(`PE: ${m.peRatio.toFixed(1)}`);
  if (m.pegRatio !== null) reasons.push(`PEG: ${m.pegRatio.toFixed(2)}`);
  if (m.returnOnEquity !== null) reasons.push(`ROE: ${(m.returnOnEquity * 100).toFixed(1)}%`);
  if (m.debtEquity !== null) reasons.push(`D/E: ${m.debtEquity.toFixed(2)}`);
  if (m.revenueGrowth !== null) reasons.push(`Growth: ${(m.revenueGrowth * 100).toFixed(1)}%`);
  if (m.dividendYield !== null && m.dividendYield > 0) reasons.push(`Div: ${(m.dividendYield * 100).toFixed(1)}%`);
  if (sectorSignal?.reasons.length) reasons.push(`Sector: ${sectorSignal.reasons.slice(0, 1).join(" ")}`);
  if (infoSignal?.reasons.length) reasons.push(`News: ${infoSignal.reasons.slice(0, 1).join(" ")}`);
  const perfHitRate = performance?.hitRate;
  if (perfHitRate != null) reasons.push(`Hit rate: ${perfHitRate}%`);
  reasons.push(score >= 0 ? "Long-term fundamentals support position." : "Long-term fundamentals underweight.");
  return reasons;
}

function assessLongTermRisk(
  m: LongTermMetrics,
  portfolioSignal?: { score: number; action: string; currentWeight: number },
  macroPolicy?: AgentMacroPolicyOutput,
): "low" | "medium" | "high" {
  let riskFactors = 0;
  if (m.debtEquity !== null && m.debtEquity > 2) riskFactors++;
  if (m.peRatio !== null && m.peRatio > 40) riskFactors++;
  if (m.revenueGrowth !== null && m.revenueGrowth < 0) riskFactors++;
  if (m.returnOnEquity !== null && m.returnOnEquity < 0.05) riskFactors++;
  if (portfolioSignal && portfolioSignal.currentWeight > 25) riskFactors++;
  if (portfolioSignal && portfolioSignal.score < -2) riskFactors++;
  if (macroPolicy && macroPolicy.marketScore < -2) riskFactors++;
  if (riskFactors >= 4) return "high";
  if (riskFactors >= 2) return "medium";
  return "low";
}
