import YahooFinance from "yahoo-finance2";
import type {
  AgentEarningsQualityOutput,
  EarningsQualityMetrics,
} from "@/lib/agents/types";
import { clamp, normalizeSymbol } from "@/lib/agents/utils";
import type { ManagedPortfolio } from "@/lib/portfolio";

const yf = new YahooFinance();

export async function agentEarningsQuality(
  portfolio: ManagedPortfolio,
  now = new Date(),
): Promise<AgentEarningsQualityOutput> {
  const symbols = portfolio.positions
    .map((p) => p.symbol)
    .filter(Boolean)
    .slice(0, 30);

  const results = await Promise.allSettled(
    symbols.map(async (symbol) => {
      const quote = await yf.quote(symbol);
      const stats = await yf.quoteSummary(symbol, {
        modules: ["incomeStatementHistory", "cashflowStatementHistory", "financialData"],
      }) as Record<string, unknown>;
      const metrics = extractMetrics(quote, stats);
      const score = scoreEarningsQuality(metrics);
      const confidence = confidenceFromMetrics(metrics);
      const reasons = buildReasons(metrics, score);
      return { symbol: normalizeSymbol(symbol), metrics, score, confidence, reasons };
    }),
  );

  const byStock: AgentEarningsQualityOutput["byStock"] = {};
  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      byStock[result.value.symbol] = {
        metrics: result.value.metrics,
        score: result.value.score,
        confidence: result.value.confidence,
        reasons: result.value.reasons,
      };
    }
  }

  const scored = Object.values(byStock);
  const avgScore = scored.length
    ? scored.reduce((s, item) => s + item.score, 0) / scored.length
    : 0;

  return {
    agent: "EarningsQuality",
    generatedAt: now.toISOString(),
    byStock,
    summary: scored.length
      ? `${scored.length} stocks scored; average earnings quality score ${avgScore.toFixed(1)}/5.`
      : "No earnings quality data available.",
  };
}

function extractMetrics(
  quote: Awaited<ReturnType<typeof yf.quote>>,
  stats: Record<string, unknown>,
): EarningsQualityMetrics {
  const ish = stats?.incomeStatementHistory as Record<string, unknown> | undefined;
  const csh = stats?.cashflowStatementHistory as Record<string, unknown> | undefined;
  const fd = stats?.financialData as Record<string, unknown> | undefined;

  const incomeStatements = (ish?.incomeStatementHistory as Array<Record<string, unknown>> | undefined) ?? [];
  const cashflowStatements = (csh?.cashflowStatementHistory as Array<Record<string, unknown>> | undefined) ?? [];

  const currentIS = incomeStatements[0] as Record<string, unknown> | undefined;
  const prevIS = incomeStatements[1] as Record<string, unknown> | undefined;
  const currentCF = cashflowStatements[0] as Record<string, unknown> | undefined;
  const prevCF = cashflowStatements[1] as Record<string, unknown> | undefined;

  const revenue = (currentIS?.totalRevenue as number | undefined) ?? null;
  const prevRevenue = (prevIS?.totalRevenue as number | undefined) ?? null;
  const netIncome = (currentIS?.netIncome as number | undefined) ?? null;
  const prevNetIncome = (prevIS?.netIncome as number | undefined) ?? null;
  const grossProfit = (currentIS?.grossProfit as number | undefined) ?? null;
  const prevGrossProfit = (prevIS?.grossProfit as number | undefined) ?? null;
  const operatingCashFlow = (currentCF?.operatingCashflow as number | undefined) ?? null;
  const prevOperatingCashFlow = (prevCF?.operatingCashflow as number | undefined) ?? null;
  const capex = (currentCF?.capitalExpenditures as number | undefined) ?? null;
  const freeCashFlow = operatingCashFlow !== null && capex !== null ? operatingCashFlow + capex : null;
  const netIncomeFromCF = (currentCF?.netIncome as number | undefined) ?? netIncome;

  const grossMargin = grossProfit !== null && revenue !== null && revenue > 0
    ? grossProfit / revenue : null;
  const prevGrossMargin = prevGrossProfit !== null && prevRevenue !== null && prevRevenue > 0
    ? prevGrossProfit / prevRevenue : null;

  return {
    revenueGrowth: revenue !== null && prevRevenue !== null && prevRevenue > 0
      ? (revenue - prevRevenue) / prevRevenue : null,
    earningsGrowth: netIncome !== null && prevNetIncome !== null && prevNetIncome > 0
      ? (netIncome - prevNetIncome) / prevNetIncome : null,
    operatingCashFlow,
    netIncome: netIncomeFromCF,
    freeCashFlow,
    capex,
    grossMargin,
    prevGrossMargin,
    accrualsRatio: operatingCashFlow !== null && netIncomeFromCF !== null && netIncomeFromCF !== 0
      ? Math.abs((netIncomeFromCF - operatingCashFlow) / netIncomeFromCF) : null,
    cashFlowToNetIncome: operatingCashFlow !== null && netIncomeFromCF !== null && netIncomeFromCF !== 0
      ? operatingCashFlow / netIncomeFromCF : null,
    freeCashFlowYield: freeCashFlow !== null && quote.marketCap !== null && quote.marketCap > 0
      ? freeCashFlow / (quote.marketCap as number) : null,
  };
}

function scoreEarningsQuality(m: EarningsQualityMetrics): number {
  let score = 0;
  let count = 0;

  if (m.revenueGrowth !== null) {
    if (m.revenueGrowth > 0.15) score += 1;
    else if (m.revenueGrowth > 0) score += 0.3;
    else if (m.revenueGrowth < -0.1) score -= 1;
    count++;
  }
  if (m.earningsGrowth !== null) {
    if (m.earningsGrowth > m.revenueGrowth! - 0.05) score += 1.5;
    else if (m.earningsGrowth > 0) score += 0.3;
    else if (m.earningsGrowth < -0.2) score -= 1;
    count++;
  }
  if (m.cashFlowToNetIncome !== null) {
    if (m.cashFlowToNetIncome > 1) score += 1.5;
    else if (m.cashFlowToNetIncome > 0.8) score += 0.5;
    else if (m.cashFlowToNetIncome < 0.5) score -= 1;
    count++;
  }
  if (m.accrualsRatio !== null) {
    if (m.accrualsRatio < 0.1) score += 1;
    else if (m.accrualsRatio < 0.3) score += 0.3;
    else if (m.accrualsRatio > 0.5) score -= 1;
    count++;
  }
  if (m.freeCashFlowYield !== null) {
    if (m.freeCashFlowYield > 0.05) score += 1.5;
    else if (m.freeCashFlowYield > 0.02) score += 0.5;
    else if (m.freeCashFlowYield < 0) score -= 0.5;
    count++;
  }
  if (m.grossMargin !== null && m.prevGrossMargin !== null) {
    const marginChange = m.grossMargin - m.prevGrossMargin;
    if (marginChange > 0.02) score += 0.5;
    else if (marginChange < -0.02) score -= 0.5;
    count++;
  }

  return count ? clamp((score / count) * 2, -5, 5) : 0;
}

function confidenceFromMetrics(m: EarningsQualityMetrics): number {
  const available = [m.revenueGrowth, m.earningsGrowth, m.operatingCashFlow, m.freeCashFlow, m.grossMargin]
    .filter((v) => v !== null).length;
  return clamp(25 + available * 12, 15, 85);
}

function buildReasons(m: EarningsQualityMetrics, score: number): string[] {
  const reasons: string[] = [];
  if (m.revenueGrowth !== null) reasons.push(`Rev growth: ${(m.revenueGrowth * 100).toFixed(1)}%`);
  if (m.earningsGrowth !== null) reasons.push(`Earnings growth: ${(m.earningsGrowth * 100).toFixed(1)}%`);
  if (m.cashFlowToNetIncome !== null) reasons.push(`CF/NI: ${m.cashFlowToNetIncome.toFixed(2)}`);
  if (m.accrualsRatio !== null) reasons.push(`Accruals: ${(m.accrualsRatio * 100).toFixed(1)}%`);
  if (m.freeCashFlowYield !== null) reasons.push(`FCF yield: ${(m.freeCashFlowYield * 100).toFixed(1)}%`);
  if (m.grossMargin !== null) reasons.push(`Gross margin: ${(m.grossMargin * 100).toFixed(1)}%`);
  reasons.push(score >= 0 ? "Earnings quality supports position." : "Earnings quality concerns.");
  return reasons;
}
