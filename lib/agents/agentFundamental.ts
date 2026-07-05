import YahooFinance from "yahoo-finance2";
import type {
  AgentFundamentalOutput,
  FundamentalMetrics,
} from "@/lib/agents/types";
import { clamp, normalizeSymbol } from "@/lib/agents/utils";
import type { ManagedPortfolio } from "@/lib/portfolio";

const yf = new YahooFinance();

export async function agentFundamental(
  portfolio: ManagedPortfolio,
  now = new Date(),
): Promise<AgentFundamentalOutput> {
  const symbols = portfolio.positions
    .map((p) => p.symbol)
    .filter(Boolean)
    .slice(0, 30);

  const results = await Promise.allSettled(
    symbols.map(async (symbol) => {
      const quote = await yf.quote(symbol);
      const stats = await yf.quoteSummary(symbol, {
        modules: ["defaultKeyStatistics", "financialData", "balanceSheetHistory"],
      }) as Record<string, unknown>;
      const metrics = extractMetrics(quote, stats);
      const score = scoreFundamentals(metrics);
      const confidence = confidenceFromMetrics(metrics);
      const reasons = buildReasons(metrics, score);
      return { symbol: normalizeSymbol(symbol), metrics, score, confidence, reasons };
    }),
  );

  const byStock: AgentFundamentalOutput["byStock"] = {};
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
    agent: "Fundamental",
    generatedAt: now.toISOString(),
    byStock,
    summary: scored.length
      ? `${scored.length} stocks scored; average fundamental score ${avgScore.toFixed(1)}/5.`
      : "No fundamental data available.",
  };
}

function extractMetrics(
  quote: Awaited<ReturnType<typeof yf.quote>>,
  stats: Record<string, unknown>,
): FundamentalMetrics {
  const dk = stats?.defaultKeyStatistics as Record<string, unknown> | undefined;
  const fd = stats?.financialData as Record<string, unknown> | undefined;
  return {
    peRatio: (quote.trailingPE as number | undefined) ?? (fd?.peRatio as number | undefined) ?? null,
    pbRatio: (dk?.priceToBook as number | undefined) ?? null,
    debtEquity: (dk?.debtToEquity as number | undefined) ?? null,
    returnOnEquity: (dk?.returnOnEquity as number | undefined) ?? null,
    revenueGrowth: (fd?.revenueGrowth as number | undefined) ?? null,
    profitMargin: (fd?.profitMargins as number | undefined) ?? null,
    marketCap: (quote.marketCap as number | undefined) ?? null,
    dividendYield: (dk?.dividendYield as number | undefined) ?? null,
  };
}

function scoreFundamentals(m: FundamentalMetrics): number {
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
    else if (m.pbRatio < 3) score += 0.3;
    else if (m.pbRatio > 5) score -= 0.5;
    count++;
  }
  if (m.debtEquity !== null && m.debtEquity > 0) {
    if (m.debtEquity < 0.5) score += 1.5;
    else if (m.debtEquity < 1.5) score += 0.5;
    else if (m.debtEquity > 3) score -= 1;
    count++;
  }
  if (m.returnOnEquity !== null) {
    if (m.returnOnEquity > 0.2) score += 1.5;
    else if (m.returnOnEquity > 0.1) score += 0.5;
    else if (m.returnOnEquity < 0) score -= 1;
    count++;
  }
  if (m.revenueGrowth !== null) {
    if (m.revenueGrowth > 0.2) score += 1.5;
    else if (m.revenueGrowth > 0.05) score += 0.5;
    else if (m.revenueGrowth < 0) score -= 0.5;
    count++;
  }
  if (m.profitMargin !== null) {
    if (m.profitMargin > 0.2) score += 1;
    else if (m.profitMargin > 0.05) score += 0.3;
    else if (m.profitMargin < 0) score -= 0.5;
    count++;
  }

  return count ? clamp(score / count * 2, -5, 5) : 0;
}

function confidenceFromMetrics(m: FundamentalMetrics): number {
  const available = [m.peRatio, m.pbRatio, m.debtEquity, m.returnOnEquity, m.revenueGrowth, m.profitMargin]
    .filter((v) => v !== null).length;
  return clamp(30 + available * 10, 20, 90);
}

function buildReasons(m: FundamentalMetrics, score: number): string[] {
  const reasons: string[] = [];
  if (m.peRatio !== null) reasons.push(`PE: ${m.peRatio.toFixed(1)}`);
  if (m.returnOnEquity !== null) reasons.push(`ROE: ${(m.returnOnEquity * 100).toFixed(1)}%`);
  if (m.debtEquity !== null) reasons.push(`D/E: ${m.debtEquity.toFixed(2)}`);
  if (m.revenueGrowth !== null) reasons.push(`Rev growth: ${(m.revenueGrowth * 100).toFixed(1)}%`);
  if (m.profitMargin !== null) reasons.push(`Margin: ${(m.profitMargin * 100).toFixed(1)}%`);
  reasons.push(score >= 0 ? "Fundamentals support position." : "Fundamentals underweight.");
  return reasons;
}
