import type {
  AgentFundamentalOutput,
  AgentInfoOutput,
  AgentIntradayOutput,
  AgentLongTermOutput,
  AgentSwingOutput,
  AgentTechnicalOutput,
  FinalRecommendation,
  FundamentalMetrics,
  RAGContext,
  RAGDocument,
  TechnicalMetrics,
} from "@/lib/agents/types";
import { normalizeSymbol } from "@/lib/agents/utils";

export function buildRAGContext(
  symbol: string,
  info: AgentInfoOutput,
  fundamental: AgentFundamentalOutput,
  technical: AgentTechnicalOutput,
  intraday: AgentIntradayOutput,
  swing: AgentSwingOutput,
  longTerm: AgentLongTermOutput,
): RAGContext {
  const docs: RAGDocument[] = [];
  const norm = normalizeSymbol(symbol);

  const infoSignal = info.byStock[norm];
  if (infoSignal && infoSignal.reasons.length) {
    docs.push({
      source: "News & Events",
      content: infoSignal.reasons.join(". "),
      relevance: "high",
      publishedAt: info.generatedAt,
      url: undefined,
    });
  }

  const infoEvents = info.events
    .filter((e) => e.affectedStocks?.some((s) => normalizeSymbol(s) === norm))
    .slice(0, 3);
  for (const event of infoEvents) {
    docs.push({
      source: `${event.source.name} (${event.source.kind})`,
      content: event.summary,
      relevance: event.source.kind === "quarterly_result" ? "high" : event.source.kind === "analyst" ? "medium" : "low",
      publishedAt: event.source.publishedAt ?? info.generatedAt,
      url: event.source.url,
    });
  }

  const fData = fundamental.byStock[norm]?.metrics;
  if (fData) {
    const fundamentalText = buildFundamentalText(fData);
    docs.push({
      source: "Yahoo Finance Fundamentals",
      content: fundamentalText,
      relevance: "high",
      publishedAt: fundamental.generatedAt,
    });
  }

  const tData = technical.byStock[norm]?.metrics;
  if (tData) {
    const technicalText = buildTechnicalText(tData);
    docs.push({
      source: "Yahoo Finance Technical Analysis",
      content: technicalText,
      relevance: "medium",
      publishedAt: technical.generatedAt,
    });
  }

  const iData = intraday.byStock[norm]?.metrics;
  if (iData) {
    const intradayText = buildIntradayText(iData);
    docs.push({
      source: "Intraday Analysis",
      content: intradayText,
      relevance: "medium",
      publishedAt: intraday.generatedAt,
    });
  }

  const sData = swing.byStock[norm]?.metrics;
  if (sData) {
    const swingText = buildSwingText(sData);
    docs.push({
      source: "Swing Analysis",
      content: swingText,
      relevance: "medium",
      publishedAt: swing.generatedAt,
    });
  }

  return { documents: docs };
}

export function enrichRecommendationWithRAG(
  recommendation: FinalRecommendation,
  rag: RAGContext,
): FinalRecommendation {
  const citedSources = rag.documents
    .filter((d) => d.relevance === "high")
    .slice(0, 3)
    .map((d) => `${d.source}: ${d.content.slice(0, 200)}`);

  const enrichedReason = recommendation.reason.includes("because")
    ? recommendation.reason
    : `${recommendation.reason} Based on ${rag.documents.filter((d) => d.relevance === "high").length} high-relevance sources.`;

  return {
    ...recommendation,
    reason: enrichedReason,
    sourceSummary: [...new Set([...recommendation.sourceSummary, ...citedSources])].slice(0, 6),
  };
}

function buildFundamentalText(m: FundamentalMetrics): string {
  const parts: string[] = [];
  if (m.peRatio !== null) parts.push(`PE ratio ${m.peRatio.toFixed(1)}`);
  if (m.pbRatio !== null) parts.push(`PB ratio ${m.pbRatio.toFixed(1)}`);
  if (m.debtEquity !== null) parts.push(`debt/equity ${m.debtEquity.toFixed(2)}`);
  if (m.returnOnEquity !== null) parts.push(`ROE ${(m.returnOnEquity * 100).toFixed(1)}%`);
  if (m.revenueGrowth !== null) parts.push(`revenue growth ${(m.revenueGrowth * 100).toFixed(1)}%`);
  if (m.profitMargin !== null) parts.push(`profit margin ${(m.profitMargin * 100).toFixed(1)}%`);
  if (m.marketCap !== null) parts.push(`market cap ${formatMarketCap(m.marketCap)}`);
  if (m.dividendYield !== null && m.dividendYield > 0) parts.push(`dividend yield ${(m.dividendYield * 100).toFixed(2)}%`);
  return `Fundamentals: ${parts.join(", ")}.`;
}

function buildTechnicalText(m: TechnicalMetrics): string {
  const parts: string[] = [];
  if (m.rsi14 !== null) parts.push(`RSI(14) ${m.rsi14.toFixed(0)}`);
  if (m.sma20 !== null) parts.push(`SMA20 ${m.sma20.toFixed(1)}`);
  if (m.sma50 !== null) parts.push(`SMA50 ${m.sma50.toFixed(1)}`);
  if (m.priceChange1d !== null) parts.push(`1d change ${m.priceChange1d.toFixed(2)}%`);
  if (m.priceChange1w !== null) parts.push(`1w change ${m.priceChange1w.toFixed(2)}%`);
  return `Technicals: ${parts.join(", ")}.`;
}

function buildIntradayText(m: { rsi14: number | null; volumeSurge: number | null; priceChange1h: number | null }): string {
  const parts: string[] = [];
  if (m.rsi14 !== null) parts.push(`intraday RSI ${m.rsi14.toFixed(0)}`);
  if (m.volumeSurge !== null) parts.push(`volume surge ${m.volumeSurge.toFixed(1)}x`);
  if (m.priceChange1h !== null) parts.push(`1h change ${m.priceChange1h.toFixed(2)}%`);
  return `Intraday: ${parts.join(", ")}.`;
}

function buildSwingText(m: { rsi14: number | null; macdLine: number | null; signalLine: number | null }): string {
  const parts: string[] = [];
  if (m.rsi14 !== null) parts.push(`swing RSI ${m.rsi14.toFixed(0)}`);
  if (m.macdLine !== null && m.signalLine !== null) parts.push(`MACD ${m.macdLine.toFixed(2)}/signal ${m.signalLine.toFixed(2)}`);
  return `Swing: ${parts.join(", ")}.`;
}

function formatMarketCap(cap: number): string {
  if (cap >= 1e12) return `${(cap / 1e12).toFixed(2)}T`;
  if (cap >= 1e9) return `${(cap / 1e9).toFixed(1)}B`;
  if (cap >= 1e6) return `${(cap / 1e6).toFixed(0)}M`;
  return `${cap.toFixed(0)}`;
}
