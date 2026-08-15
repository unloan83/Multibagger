export type MarketIntelligenceWeights = {
  fundamentals: number;
  growthMomentum: number;
  institutionalSmartMoney: number;
  sectorTheme: number;
  expertConsensus: number;
  valuationCatalyst: number;
};

export const DEFAULT_MARKET_INTELLIGENCE_WEIGHTS: MarketIntelligenceWeights = {
  fundamentals: 35,
  growthMomentum: 20,
  institutionalSmartMoney: 15,
  sectorTheme: 10,
  expertConsensus: 10,
  valuationCatalyst: 10,
};

export type ExpertRecommendationRecord = {
  sourceId: string;
  sourceName: string;
  independent: boolean;
  symbol: string;
  recommendationDate: string;
  stance: "BUY" | "ACCUMULATE" | "HOLD" | "SELL";
  targetPrice?: number;
  sourceUrl?: string;
  return3Month?: number | null;
  return6Month?: number | null;
  return12Month?: number | null;
};

export type StockMarketIntelligence = {
  sourceAsOf: string;
  fiiChangeQoQ?: number;
  diiChangeQoQ?: number;
  fpiChangeQoQ?: number;
  mutualFundChangeQoQ?: number;
  institutionalHoldingChangeQoQ?: number;
  promoterHoldingChangeQoQ?: number;
  bulkBlockNetPercent?: number;
  orderBookGrowthPercent?: number;
  corporateAnnouncementScore?: number;
  operatorRisk?: boolean;
  investors?: string[];
  evidence?: string[];
};

export type MarketIntelligenceDataset = {
  asOf: string;
  weights?: Partial<MarketIntelligenceWeights>;
  stocks: Record<string, StockMarketIntelligence>;
  expertRecommendations: ExpertRecommendationRecord[];
};

export type SourceReliability = {
  sourceId: string;
  sourceName: string;
  independent: boolean;
  score: number;
  sampleSize: number;
  performance3Month: number | null;
  performance6Month: number | null;
  performance12Month: number | null;
};

export type MarketIntelligenceHistorySample = {
  componentScores?: Partial<Record<keyof MarketIntelligenceWeights, number>>;
  performance6Month?: number | null;
  performance12Month?: number | null;
};

export type MarketTriageInput = {
  symbol: string;
  kind: "STOCK" | "ETF" | "UPCOMING_IPO" | "NEW_IPO";
  modelScore: number;
  companyGatePassed: boolean;
  dataQuality: number;
  averageDailyTurnoverCr: number;
  risk: "Low" | "Medium" | "High";
  horizon: "6–12 months" | "12–24 months" | "18–24+ months";
  factorScores?: {
    growth?: number;
    momentum?: number;
    quality?: number;
    valuation?: number;
    catalyst?: number;
    liquidity?: number;
    risk?: number;
  };
  fundamentals?: {
    revenueGrowthPercent?: number | null;
    earningsGrowthPercent?: number | null;
    returnOnEquityPercent?: number | null;
    debtToEquity?: number | null;
    cashConversion?: number | null;
  };
  sectorContextScore: number;
  fallbackExpertCount?: number;
  catalystSummary?: string;
};

export type MarketIntelligenceTriage = {
  score: number;
  weights: MarketIntelligenceWeights;
  components: Record<keyof MarketIntelligenceWeights, number>;
  institutionalInterest: "STRONG" | "MODERATE" | "MIXED" | "NONE VERIFIED" | "DISTRIBUTION";
  expertConsensus: "STRONG" | "MODERATE" | "MIXED" | "NONE VERIFIED" | "NEGATIVE";
  fundamentalStrength: "STRONG" | "ADEQUATE" | "WEAK";
  growthPotential: "HIGH" | "MODERATE" | "LIMITED";
  riskLevel: "Low" | "Medium" | "High";
  suggestedHorizon: "6–12 months" | "12–24 months" | "18–24+ months";
  action: "BUY" | "WATCH" | "REJECT";
  deepValidationPassed: boolean;
  agreementCount: number;
  evidence: { institutional: string; experts: string; fundamentals: string };
  sourceReliability: SourceReliability[];
  riskFlags: string[];
};

export function resolveMarketIntelligenceWeights(
  overrides: Partial<MarketIntelligenceWeights> = {},
  history: MarketIntelligenceHistorySample[] = [],
): MarketIntelligenceWeights {
  const configured = { ...DEFAULT_MARKET_INTELLIGENCE_WEIGHTS, ...overrides };
  const total = Object.values(configured).reduce((sum, value) => sum + value, 0);
  if (Object.values(configured).some((value) => !Number.isFinite(value) || value < 0) || total <= 0) {
    throw new Error("Market Intelligence Triage weights must be finite, non-negative numbers.");
  }
  const normalized = Object.fromEntries(Object.entries(configured).map(([key, value]) => [key, value * 100 / total])) as MarketIntelligenceWeights;
  return recalibrateWeights(normalized, history);
}

export function calculateSourceReliability(records: ExpertRecommendationRecord[]): SourceReliability[] {
  const bySource = new Map<string, ExpertRecommendationRecord[]>();
  for (const record of records) bySource.set(record.sourceId, [...(bySource.get(record.sourceId) ?? []), record]);
  return [...bySource.entries()].map(([sourceId, rows]) => {
    const window3 = averageKnown(rows.map((row) => row.return3Month));
    const window6 = averageKnown(rows.map((row) => row.return6Month));
    const window12 = averageKnown(rows.map((row) => row.return12Month));
    const samples = rows.reduce((count, row) => count + Number(row.return3Month != null || row.return6Month != null || row.return12Month != null), 0);
    const available: Array<[number | null, number]> = [[window3, 0.25], [window6, 0.35], [window12, 0.4]];
    const measured = available.filter((item): item is [number, number] => item[0] !== null);
    const performance = measured.length ? measured.reduce((sum, [value, weight]) => sum + value * weight, 0) / measured.reduce((sum, [, weight]) => sum + weight, 0) : 0;
    const confidence = Math.min(1, samples / 5);
    let score = 50 + clamp(performance * 1.5, -35, 35) * confidence;
    if (rows[0].independent && score >= 60) score += 5;
    return {
      sourceId,
      sourceName: rows[0].sourceName,
      independent: rows[0].independent,
      score: Math.round(clamp(score, 15, 95)),
      sampleSize: samples,
      performance3Month: window3,
      performance6Month: window6,
      performance12Month: window12,
    };
  }).sort((a, b) => b.score - a.score);
}

export function scoreMarketIntelligenceTriage(
  input: MarketTriageInput,
  dataset: MarketIntelligenceDataset,
  weights: MarketIntelligenceWeights,
): MarketIntelligenceTriage {
  const external = dataset.stocks[input.symbol];
  const reliability = calculateSourceReliability(dataset.expertRecommendations);
  const sourceScores = new Map(reliability.map((source) => [source.sourceId, source]));
  const currentRecommendations = dedupeCurrentRecommendations(
    dataset.expertRecommendations.filter((record) => record.symbol === input.symbol && isWithinDays(record.recommendationDate, dataset.asOf, 180)),
  );
  const fundamentalScore = scoreFundamentals(input);
  const growthMomentumScore = scoreGrowthMomentum(input, external);
  const institutionalScore = scoreInstitutional(external, dataset.asOf);
  const sectorScore = clamp(input.sectorContextScore, 0, 100);
  const expertScore = scoreExperts(currentRecommendations, sourceScores, input.fallbackExpertCount ?? 0);
  const valuationCatalystScore = scoreValuationCatalyst(input, external);
  const components: MarketIntelligenceTriage["components"] = {
    fundamentals: fundamentalScore,
    growthMomentum: growthMomentumScore,
    institutionalSmartMoney: institutionalScore,
    sectorTheme: sectorScore,
    expertConsensus: expertScore,
    valuationCatalyst: valuationCatalystScore,
  };
  const score = Math.round((Object.keys(weights) as Array<keyof MarketIntelligenceWeights>).reduce((sum, key) => sum + components[key] * weights[key] / 100, 0));
  const riskFlags = buildRiskFlags(input, external);
  const deepValidationPassed = input.companyGatePassed && riskFlags.length === 0 && fundamentalScore >= 55 && input.dataQuality >= 70;
  const agreementCount = [fundamentalScore >= 65, growthMomentumScore >= 60, institutionalScore >= 55, sectorScore >= 60, expertScore >= 55, valuationCatalystScore >= 55].filter(Boolean).length;
  const buyEligible = deepValidationPassed && score >= 75 && fundamentalScore >= 65 && institutionalScore >= 55 && expertScore >= 55 && agreementCount >= 4;
  const watchThreshold = input.kind === "ETF" ? 45 : 55;
  const action = buyEligible ? "BUY" : deepValidationPassed && score >= watchThreshold ? "WATCH" : "REJECT";
  return {
    score,
    weights,
    components,
    institutionalInterest: institutionalLabel(institutionalScore, external),
    expertConsensus: expertLabel(expertScore, currentRecommendations.length, input.fallbackExpertCount ?? 0),
    fundamentalStrength: fundamentalScore >= 70 ? "STRONG" : fundamentalScore >= 55 ? "ADEQUATE" : "WEAK",
    growthPotential: growthMomentumScore >= 70 ? "HIGH" : growthMomentumScore >= 50 ? "MODERATE" : "LIMITED",
    riskLevel: riskFlags.length > 0 ? "High" : input.risk,
    suggestedHorizon: input.horizon,
    action,
    deepValidationPassed,
    agreementCount,
    evidence: {
      institutional: institutionalEvidence(external),
      experts: expertEvidence(currentRecommendations, sourceScores, input.fallbackExpertCount ?? 0),
      fundamentals: `Quality ${fundamentalScore}/100; growth/momentum ${growthMomentumScore}/100; valuation/catalyst ${valuationCatalystScore}/100.`,
    },
    sourceReliability: currentRecommendations.map((record) => sourceScores.get(record.sourceId)).filter((value): value is SourceReliability => Boolean(value)),
    riskFlags,
  };
}

function scoreFundamentals(input: MarketTriageInput) {
  if (input.kind === "ETF") return clamp(input.modelScore, 0, 100);
  const quality = clamp((input.factorScores?.quality ?? 0) / 20 * 100, 0, 100);
  const safety = clamp((input.factorScores?.risk ?? 0) / 10 * 100, 0, 100);
  const data = clamp(input.dataQuality, 0, 100);
  const cash = input.fundamentals?.cashConversion == null ? 50 : clamp(input.fundamentals.cashConversion * 70, 0, 100);
  return Math.round(quality * 0.5 + safety * 0.2 + data * 0.2 + cash * 0.1);
}

function scoreGrowthMomentum(input: MarketTriageInput, external?: StockMarketIntelligence) {
  const growth = clamp((input.factorScores?.growth ?? 0) / 20 * 100, 0, 100);
  const momentum = clamp((input.factorScores?.momentum ?? 0) / 15 * 100, 0, 100);
  const orderBook = external?.orderBookGrowthPercent == null ? 0 : clamp(50 + external.orderBookGrowthPercent, 0, 100);
  return Math.round(growth * 0.6 + momentum * 0.3 + orderBook * 0.1);
}

function scoreInstitutional(external: StockMarketIntelligence | undefined, referenceDate: string) {
  if (!external || !isWithinDays(external.sourceAsOf, referenceDate, 200)) return 0;
  const changes = [external.fiiChangeQoQ, external.diiChangeQoQ, external.fpiChangeQoQ, external.mutualFundChangeQoQ, external.institutionalHoldingChangeQoQ].filter((value): value is number => typeof value === "number");
  if (!changes.length && external.bulkBlockNetPercent == null) return 0;
  const averageChange = changes.length ? changes.reduce((sum, value) => sum + value, 0) / changes.length : 0;
  return Math.round(clamp(50 + averageChange * 12 + (external.bulkBlockNetPercent ?? 0) * 8, 0, 100));
}

function scoreExperts(records: ExpertRecommendationRecord[], sources: Map<string, SourceReliability>, fallbackCount: number) {
  if (!records.length) return fallbackCount > 0 ? clamp(50 + fallbackCount * 8, 0, 70) : 0;
  const weighted = records.map((record) => {
    const reliability = sources.get(record.sourceId)?.score ?? 50;
    const stance = record.stance === "BUY" ? 1 : record.stance === "ACCUMULATE" ? 0.8 : record.stance === "HOLD" ? 0.25 : -1;
    return { value: reliability * stance, reliability };
  });
  const breadthBonus = Math.min(20, Math.max(0, records.length - 1) * 5);
  return Math.round(clamp(weighted.reduce((sum, row) => sum + row.value, 0) / weighted.length + breadthBonus, 0, 100));
}

function scoreValuationCatalyst(input: MarketTriageInput, external?: StockMarketIntelligence) {
  const valuation = clamp((input.factorScores?.valuation ?? 0) / 15 * 100, 0, 100);
  const baseCatalyst = clamp((input.factorScores?.catalyst ?? 0) / 10 * 100, 0, 100);
  const announcement = external?.corporateAnnouncementScore == null ? baseCatalyst : clamp(external.corporateAnnouncementScore, 0, 100);
  return Math.round(valuation * 0.65 + announcement * 0.35);
}

function buildRiskFlags(input: MarketTriageInput, external?: StockMarketIntelligence) {
  const flags: string[] = [];
  const debt = input.fundamentals?.debtToEquity;
  if (!input.companyGatePassed) flags.push("Existing fundamental safety gate did not pass.");
  if (typeof debt === "number" && debt > 100) flags.push("Debt-to-equity exceeds 100%.");
  if ((input.factorScores?.liquidity ?? 0) < 3 || input.averageDailyTurnoverCr < 2) flags.push("Liquidity is below the minimum investability floor.");
  if (input.risk === "High") flags.push("High modelled risk.");
  if (external?.operatorRisk) flags.push("Potential operator-driven/speculative activity requires rejection.");
  return [...new Set(flags)];
}

function dedupeCurrentRecommendations(records: ExpertRecommendationRecord[]) {
  const latestBySource = new Map<string, ExpertRecommendationRecord>();
  for (const record of records) {
    const current = latestBySource.get(record.sourceId);
    if (!current || record.recommendationDate > current.recommendationDate) latestBySource.set(record.sourceId, record);
  }
  return [...latestBySource.values()];
}

function institutionalLabel(score: number, external?: StockMarketIntelligence): MarketIntelligenceTriage["institutionalInterest"] {
  if (!external || score === 0) return "NONE VERIFIED";
  if (score >= 70) return "STRONG";
  if (score >= 55) return "MODERATE";
  if (score >= 40) return "MIXED";
  return "DISTRIBUTION";
}

function expertLabel(score: number, recordCount: number, fallbackCount: number): MarketIntelligenceTriage["expertConsensus"] {
  if (recordCount === 0 && fallbackCount === 0) return "NONE VERIFIED";
  if (score >= 70) return "STRONG";
  if (score >= 55) return "MODERATE";
  if (score >= 40) return "MIXED";
  return "NEGATIVE";
}

function institutionalEvidence(external?: StockMarketIntelligence) {
  if (!external) return "No source-dated institutional, mutual-fund, promoter, or bulk/block-deal record is available; no smart-money points are awarded.";
  const changes = [
    ["FII", external.fiiChangeQoQ], ["DII", external.diiChangeQoQ], ["FPI", external.fpiChangeQoQ],
    ["Mutual fund", external.mutualFundChangeQoQ], ["Institutional", external.institutionalHoldingChangeQoQ],
    ["Promoter", external.promoterHoldingChangeQoQ], ["Bulk/block net", external.bulkBlockNetPercent],
  ].filter((item): item is [string, number] => typeof item[1] === "number");
  const summary = changes.map(([label, value]) => `${label} ${value >= 0 ? "+" : ""}${value.toFixed(2)}pp`).join("; ");
  return `${summary || "No quantified ownership change"}. Source as of ${external.sourceAsOf}. Filings show positioning, not the investor's motive.`;
}

function expertEvidence(records: ExpertRecommendationRecord[], sources: Map<string, SourceReliability>, fallbackCount: number) {
  if (!records.length) return fallbackCount > 0 ? `${fallbackCount} legacy expert signal(s) are present, but source-level history is unavailable, so their weight is capped.` : "No current, source-identified analyst recommendation is available; no consensus points are awarded.";
  return records.map((record) => `${record.sourceName} ${record.stance} (reliability ${sources.get(record.sourceId)?.score ?? 50}/100)`).join("; ");
}

function recalibrateWeights(base: MarketIntelligenceWeights, history: MarketIntelligenceHistorySample[]) {
  const matured = history.filter((row) => row.componentScores && (row.performance6Month != null || row.performance12Month != null));
  if (matured.length < 20) return roundWeights(base);
  const adjusted = { ...base };
  for (const key of Object.keys(base) as Array<keyof MarketIntelligenceWeights>) {
    const pairs = matured.flatMap((row) => {
      const factor = row.componentScores?.[key];
      const outcome = row.performance12Month ?? row.performance6Month;
      return factor == null || outcome == null ? [] : [{ factor, outcome }];
    });
    adjusted[key] *= 1 + clamp(rankCorrelation(pairs), -0.2, 0.2);
  }
  const total = Object.values(adjusted).reduce((sum, value) => sum + value, 0);
  return roundWeights(Object.fromEntries(Object.entries(adjusted).map(([key, value]) => [key, value * 100 / total])) as MarketIntelligenceWeights);
}

function rankCorrelation(rows: Array<{ factor: number; outcome: number }>) {
  if (rows.length < 5) return 0;
  const factorMean = rows.reduce((sum, row) => sum + row.factor, 0) / rows.length;
  const outcomeMean = rows.reduce((sum, row) => sum + row.outcome, 0) / rows.length;
  const covariance = rows.reduce((sum, row) => sum + (row.factor - factorMean) * (row.outcome - outcomeMean), 0);
  const factorVariance = rows.reduce((sum, row) => sum + (row.factor - factorMean) ** 2, 0);
  const outcomeVariance = rows.reduce((sum, row) => sum + (row.outcome - outcomeMean) ** 2, 0);
  return factorVariance && outcomeVariance ? covariance / Math.sqrt(factorVariance * outcomeVariance) : 0;
}

function roundWeights(weights: MarketIntelligenceWeights) {
  const keys = Object.keys(weights) as Array<keyof MarketIntelligenceWeights>;
  const rounded = Object.fromEntries(keys.map((key) => [key, Math.round(weights[key] * 100) / 100])) as MarketIntelligenceWeights;
  rounded.valuationCatalyst = Math.round((rounded.valuationCatalyst + 100 - Object.values(rounded).reduce((sum, value) => sum + value, 0)) * 100) / 100;
  return rounded;
}

function averageKnown(values: Array<number | null | undefined>) {
  const known = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null;
}

function isWithinDays(date: string, referenceDate: string, maximumDays: number) {
  const timestamp = Date.parse(date);
  const reference = Date.parse(referenceDate);
  return Number.isFinite(timestamp) && Number.isFinite(reference) && reference >= timestamp && (reference - timestamp) / 86_400_000 <= maximumDays;
}

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
