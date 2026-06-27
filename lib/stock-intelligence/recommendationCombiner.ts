import type {
  AnalyzedEvidence,
  ExistingRecommendationSignal,
  IntelligenceWeights,
  StockIntelligenceRecommendation,
} from "./types";

export function getIntelligenceWeights(env: Record<string, string | undefined> = process.env): IntelligenceWeights {
  const raw = {
    existingLogic: positiveNumber(env.STOCK_INTELLIGENCE_EXISTING_WEIGHT, 60),
    newsSentiment: positiveNumber(env.STOCK_INTELLIGENCE_NEWS_WEIGHT, 25),
    sectorMacro: positiveNumber(env.STOCK_INTELLIGENCE_MACRO_WEIGHT, 15),
  };
  const total = raw.existingLogic + raw.newsSentiment + raw.sectorMacro || 100;
  return {
    existingLogic: roundOne(raw.existingLogic / total * 100),
    newsSentiment: roundOne(raw.newsSentiment / total * 100),
    sectorMacro: roundOne(raw.sectorMacro / total * 100),
  };
}

export function combineRecommendation(input: {
  signal: ExistingRecommendationSignal;
  stockEvidence: AnalyzedEvidence[];
  sectorEvidence: AnalyzedEvidence[];
  newsImpactScore: number;
  macroImpactScore: number;
  evidenceConfidence: number;
  independentSources: number;
  credibleSources: number;
  weights: IntelligenceWeights;
}): StockIntelligenceRecommendation {
  const { signal, weights } = input;
  const existingDirectionalScore =
    signal.action === "SELL" ? 100 - signal.score : signal.action === "BUY" ? signal.score : 50;
  const normalizedNews = (clamp(input.newsImpactScore, -5, 5) + 5) * 10;
  const normalizedMacro = (clamp(input.macroImpactScore, -5, 5) + 5) * 10;
  const finalScore = Math.round(
    existingDirectionalScore * weights.existingLogic / 100
      + normalizedNews * weights.newsSentiment / 100
      + normalizedMacro * weights.sectorMacro / 100,
  );
  const enoughEvidence = input.independentSources >= 2 && input.credibleSources >= 2 && input.evidenceConfidence >= 55;
  const contextSupportsBuy = input.newsImpactScore >= 0 && input.macroImpactScore >= -1;
  const contextSupportsSell = input.newsImpactScore <= 0.5 && input.macroImpactScore <= 1;
  const action = decideAction(signal, finalScore, enoughEvidence, contextSupportsBuy, contextSupportsSell);
  const allEvidence = [...input.stockEvidence, ...input.sectorEvidence]
    .sort((a, b) => evidenceRank(b) - evidenceRank(a))
    .slice(0, 10);
  const positiveTriggers = allEvidence.filter((item) => item.impactScore > 0).slice(0, 3).map((item) => item.title);
  const negativeConcerns = allEvidence.filter((item) => item.impactScore < 0).slice(0, 3).map((item) => item.title);
  const whatChanged = [
    ...(signal.priceVolumeContext ?? []).map((item) => `Price/volume: ${item}`),
    ...allEvidence.filter((item) => item.freshness === "today" || item.freshness === "this week").map((item) => item.title),
  ].slice(0, 4);
  const confidence = Math.round(clamp(
    signal.confidence * 0.6 + input.evidenceConfidence * 0.4 - (enoughEvidence ? 0 : 15),
    20,
    95,
  ));

  return {
    symbol: signal.symbol,
    company: signal.company || signal.symbol,
    sector: signal.sector || "Unclassified",
    source: signal.source,
    action,
    timeframe: signal.timeframe,
    confidence,
    existingLogicScore: Math.round(clamp(signal.score, 0, 100)),
    newsImpactScore: roundOne(input.newsImpactScore),
    sectorMacroImpactScore: roundOne(input.macroImpactScore),
    finalScore: clamp(finalScore, 0, 100),
    reason: buildReason(signal, action, input, enoughEvidence),
    positiveTriggers,
    negativeConcerns,
    whatChanged,
    target: action === "Buy" || action === "Sell" ? validPrice(signal.target) : undefined,
    stopLoss: action === "Buy" || action === "Sell" ? validPrice(signal.stopLoss) : undefined,
    sourceSummary: allEvidence.slice(0, 5).map(({ title, url, source, publishedAt, credibility, impact }) => ({
      title, url, source, publishedAt, credibility, impact,
    })),
    evidence: allEvidence,
  };
}

function decideAction(
  signal: ExistingRecommendationSignal,
  finalScore: number,
  enoughEvidence: boolean,
  supportsBuy: boolean,
  supportsSell: boolean,
): StockIntelligenceRecommendation["action"] {
  if (!enoughEvidence) return signal.source === "portfolio" ? "Hold" : "Watch";
  if (signal.action === "BUY" && finalScore >= 65 && supportsBuy) return "Buy";
  if (signal.action === "SELL" && signal.score >= 65 && finalScore <= 45 && supportsSell) return "Sell";
  if (signal.source === "portfolio") return "Hold";
  return "Watch";
}

function buildReason(
  signal: ExistingRecommendationSignal,
  action: StockIntelligenceRecommendation["action"],
  input: Parameters<typeof combineRecommendation>[0],
  enoughEvidence: boolean,
) {
  if (!enoughEvidence) {
    return `${action}: the existing ${signal.action.toLowerCase()} signal remains the starting point, but recent independent evidence is too limited or conflicting for an aggressive call.`;
  }
  return `${action}: existing logic scored ${Math.round(signal.score)}/100; recent company/news impact is ${signed(input.newsImpactScore)}/5 and sector/macro impact is ${signed(input.macroImpactScore)}/5.`;
}

function evidenceRank(item: AnalyzedEvidence) {
  const credibility = item.credibility === "high" ? 30 : item.credibility === "medium" ? 15 : 0;
  const freshness = item.freshness === "today" ? 20 : item.freshness === "this week" ? 10 : 0;
  return credibility + freshness + item.confidence + Math.abs(item.impactScore) * 5;
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function validPrice(value?: number) {
  return value && value > 0 ? value : undefined;
}

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${roundOne(value)}`;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}
