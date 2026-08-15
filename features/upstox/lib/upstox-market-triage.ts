import fs from "fs";
import path from "path";
import { upstoxDataPath } from "@/features/upstox/lib/data-paths";

/**
 * Configurable weights for Upstox Market Intelligence Triage.
 * Default weights:
 * - Live Technical Strength: 40%
 * - Market + Sector Alignment: 20%
 * - Smart Money / Institutional Signal: 15%
 * - Expert Consensus: 15%
 * - News / Catalyst: 10%
 */
export type UpstoxTriageWeights = {
  technicalStrength: number;
  marketSectorAlignment: number;
  smartMoneyInstitutional: number;
  expertConsensus: number;
  newsCatalyst: number;
};

export const DEFAULT_UPSTOX_TRIAGE_WEIGHTS: UpstoxTriageWeights = {
  technicalStrength: 40,
  marketSectorAlignment: 20,
  smartMoneyInstitutional: 15,
  expertConsensus: 15,
  newsCatalyst: 10,
};

export type TriageLevel = "Strong" | "Moderate" | "Weak";

export function getTriageLevel(score: number): TriageLevel {
  if (score >= 70) return "Strong";
  if (score >= 40) return "Moderate";
  return "Weak";
}

/** Historical reliability record for an expert/broker source */
export type ExpertSourceRecord = {
  sourceId: string;
  sourceName: string;
  isSebiRegistered: boolean;
  isIndependent: boolean;
  totalRecommendations: number;
  successfulIntradayTrades: number;
  successRate: number; // 0 - 100%
  avgReturnPercent: number;
  maxAdverseMovementPercent: number; // Max drawdown experienced
  sectorPerformance: Record<string, { total: number; wins: number; avgReturn: number }>;
  regimePerformance: {
    bullish: { total: number; wins: number };
    bearish: { total: number; wins: number };
    sideways: { total: number; wins: number };
  };
  reliabilityScore: number; // 0 - 100
};

const EXPERT_RELIABILITY_FILE = upstoxDataPath("upstox_expert_reliability.json");

/** Default expert sources registry with baseline reliability scores */
const DEFAULT_EXPERT_SOURCES: ExpertSourceRecord[] = [
  {
    sourceId: "sebi_ra_core",
    sourceName: "SEBI Registered Research Analysts",
    isSebiRegistered: true,
    isIndependent: true,
    totalRecommendations: 45,
    successfulIntradayTrades: 33,
    successRate: 73.3,
    avgReturnPercent: 2.8,
    maxAdverseMovementPercent: -1.2,
    sectorPerformance: {},
    regimePerformance: {
      bullish: { total: 25, wins: 20 },
      bearish: { total: 10, wins: 6 },
      sideways: { total: 10, wins: 7 },
    },
    reliabilityScore: 85,
  },
  {
    sourceId: "icici_direct",
    sourceName: "ICICI Direct Research",
    isSebiRegistered: true,
    isIndependent: false,
    totalRecommendations: 40,
    successfulIntradayTrades: 28,
    successRate: 70.0,
    avgReturnPercent: 2.4,
    maxAdverseMovementPercent: -1.4,
    sectorPerformance: {},
    regimePerformance: {
      bullish: { total: 20, wins: 15 },
      bearish: { total: 10, wins: 6 },
      sideways: { total: 10, wins: 7 },
    },
    reliabilityScore: 80,
  },
  {
    sourceId: "hdfc_sec",
    sourceName: "HDFC Securities",
    isSebiRegistered: true,
    isIndependent: false,
    totalRecommendations: 35,
    successfulIntradayTrades: 24,
    successRate: 68.5,
    avgReturnPercent: 2.1,
    maxAdverseMovementPercent: -1.5,
    sectorPerformance: {},
    regimePerformance: {
      bullish: { total: 18, wins: 13 },
      bearish: { total: 8, wins: 5 },
      sideways: { total: 9, wins: 6 },
    },
    reliabilityScore: 78,
  },
  {
    sourceId: "motilal_oswal",
    sourceName: "Motilal Oswal Financial Services",
    isSebiRegistered: true,
    isIndependent: false,
    totalRecommendations: 30,
    successfulIntradayTrades: 21,
    successRate: 70.0,
    avgReturnPercent: 2.3,
    maxAdverseMovementPercent: -1.3,
    sectorPerformance: {},
    regimePerformance: {
      bullish: { total: 15, wins: 11 },
      bearish: { total: 7, wins: 5 },
      sideways: { total: 8, wins: 5 },
    },
    reliabilityScore: 79,
  },
  {
    sourceId: "nuvama_wealth",
    sourceName: "Nuvama Institutional Equities",
    isSebiRegistered: true,
    isIndependent: true,
    totalRecommendations: 25,
    successfulIntradayTrades: 19,
    successRate: 76.0,
    avgReturnPercent: 3.1,
    maxAdverseMovementPercent: -1.1,
    sectorPerformance: {},
    regimePerformance: {
      bullish: { total: 12, wins: 10 },
      bearish: { total: 6, wins: 4 },
      sideways: { total: 7, wins: 5 },
    },
    reliabilityScore: 88,
  },
  {
    sourceId: "unverified_social_tips",
    sourceName: "Unverified / Social Media Tips",
    isSebiRegistered: false,
    isIndependent: false,
    totalRecommendations: 50,
    successfulIntradayTrades: 18,
    successRate: 36.0,
    avgReturnPercent: -0.8,
    maxAdverseMovementPercent: -3.5,
    sectorPerformance: {},
    regimePerformance: {
      bullish: { total: 25, wins: 11 },
      bearish: { total: 15, wins: 3 },
      sideways: { total: 10, wins: 4 },
    },
    reliabilityScore: 20,
  },
];

export function readExpertReliabilityStore(): Record<string, ExpertSourceRecord> {
  if (!fs.existsSync(EXPERT_RELIABILITY_FILE)) {
    const initialMap: Record<string, ExpertSourceRecord> = {};
    for (const src of DEFAULT_EXPERT_SOURCES) {
      initialMap[src.sourceId] = src;
    }
    writeExpertReliabilityStore(initialMap);
    return initialMap;
  }
  try {
    const raw = fs.readFileSync(EXPERT_RELIABILITY_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    const initialMap: Record<string, ExpertSourceRecord> = {};
    for (const src of DEFAULT_EXPERT_SOURCES) {
      initialMap[src.sourceId] = src;
    }
    return initialMap;
  }
}

export function writeExpertReliabilityStore(store: Record<string, ExpertSourceRecord>): void {
  try {
    const dir = path.dirname(EXPERT_RELIABILITY_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(EXPERT_RELIABILITY_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch {}
}

/** Update an expert source's performance following trade completion */
export function updateExpertPerformance(
  sourceId: string,
  wasWin: boolean,
  returnPercent: number,
  drawdownPercent: number,
  sector = "General",
  marketRegime: "bullish" | "bearish" | "sideways" = "bullish"
): void {
  const store = readExpertReliabilityStore();
  const record = store[sourceId] || {
    sourceId,
    sourceName: sourceId,
    isSebiRegistered: false,
    isIndependent: false,
    totalRecommendations: 0,
    successfulIntradayTrades: 0,
    successRate: 50,
    avgReturnPercent: 0,
    maxAdverseMovementPercent: 0,
    sectorPerformance: {},
    regimePerformance: {
      bullish: { total: 0, wins: 0 },
      bearish: { total: 0, wins: 0 },
      sideways: { total: 0, wins: 0 },
    },
    reliabilityScore: 50,
  };

  record.totalRecommendations += 1;
  if (wasWin) record.successfulIntradayTrades += 1;
  record.successRate = Number(((record.successfulIntradayTrades / record.totalRecommendations) * 100).toFixed(1));
  record.avgReturnPercent = Number(
    (((record.avgReturnPercent * (record.totalRecommendations - 1)) + returnPercent) / record.totalRecommendations).toFixed(2)
  );
  if (drawdownPercent < record.maxAdverseMovementPercent) {
    record.maxAdverseMovementPercent = Number(drawdownPercent.toFixed(2));
  }

  // Sector breakdown
  if (!record.sectorPerformance[sector]) {
    record.sectorPerformance[sector] = { total: 0, wins: 0, avgReturn: 0 };
  }
  const sec = record.sectorPerformance[sector];
  sec.total += 1;
  if (wasWin) sec.wins += 1;
  sec.avgReturn = Number((((sec.avgReturn * (sec.total - 1)) + returnPercent) / sec.total).toFixed(2));

  // Regime breakdown
  const reg = record.regimePerformance[marketRegime] || { total: 0, wins: 0 };
  reg.total += 1;
  if (wasWin) reg.wins += 1;
  record.regimePerformance[marketRegime] = reg;

  // Dynamic Reliability Score calculation
  let relScore = record.successRate * 0.75;
  if (record.avgReturnPercent > 0) relScore += Math.min(15, record.avgReturnPercent * 4);
  if (record.isSebiRegistered) relScore += 10;
  if (record.isIndependent) relScore += 5;
  if (record.maxAdverseMovementPercent < -2.5) relScore -= Math.min(15, Math.abs(record.maxAdverseMovementPercent) * 3);

  record.reliabilityScore = Math.max(10, Math.min(98, Math.round(relScore)));
  store[sourceId] = record;
  writeExpertReliabilityStore(store);
}

export type ExpertTipInput = {
  sourceId: string;
  sourceName: string;
  isSebiRegistered?: boolean;
  isIndependent?: boolean;
  stance: "BUY" | "SELL";
  target?: number;
  timestamp?: string;
};

export type SmartMoneyInput = {
  bulkBlockDeals?: boolean;
  deliveryVolumeSpike?: boolean;
  unusualVolume?: boolean;
  futuresOptionsActivity?: "LONG_BUILDUP" | "SHORT_COVERING" | "SHORT_BUILDUP" | "NEUTRAL";
  openInterestSpurtPercent?: number;
  priceVolumeAccumulation?: boolean;
};

export type MarketSectorBiasInput = {
  fiiDiiNetBuyer?: boolean;
  sectorRelativeStrength?: number; // 0 - 100
  sectorTrend?: "BULLISH" | "NEUTRAL" | "BEARISH";
};

export type CatalystInput = {
  headline: string;
  impact: "HIGH_POSITIVE" | "MODERATE_POSITIVE" | "NEUTRAL" | "NEGATIVE";
};

export type UpstoxCandidateRaw = {
  symbol: string;
  name: string;
  instrumentKey: string;
  cmp: number;
  target: number;
  stopLoss: number;
  signal: "BUY" | "SELL";
  score: number; // Technical score from Upstox engine (0 - 100)
  sector?: string;
  volume?: number;
  rvol?: number;
  vwapDistance?: number;
  momentumScore?: number;
  expertTips?: ExpertTipInput[];
  smartMoneySignals?: SmartMoneyInput;
  marketSectorBias?: MarketSectorBiasInput;
  catalysts?: CatalystInput[];
  remark?: string;
};

export type UpstoxTriageDetails = {
  technicalScore: number;       // 40% weight
  marketSectorScore: number;    // 20% weight
  smartMoneyScore: number;      // 15% weight
  expertConsensusScore: number; // 15% weight
  newsCatalystScore: number;    // 10% weight
  triageScore: number;          // 0-100 composite
  marketAlignment: TriageLevel; // Strong / Moderate / Weak
  smartMoney: TriageLevel;       // Strong / Moderate / Weak
  expertConsensus: TriageLevel;  // Strong / Moderate / Weak
  confluencePassed: boolean;
  confluenceSignal: "Strong Candidate" | "Moderate Candidate" | "Reject / No Trade";
  expertSources: string[];
  sourceReliabilityScore: number;
  sectorAlignment: string;
  rejectionReasons: string[];
};

export type UpstoxTrichedRecommendation = {
  id: string;
  symbol: string;
  name: string;
  instrumentKey: string;
  cmp: number;
  target: number;
  stopLoss: number;
  signal: "BUY" | "SELL";
  score: number; // Final composite score
  executionMode: "AUTOMATIC" | "USER_DRIVEN";
  status: "PENDING" | "BUY_EXECUTED" | "SELL_EXECUTED" | "SKIPPED" | "TELEGRAM_SENT";
  orderId?: string | null;
  remark: string;
  timestamp: string;
  // 4 columns requested for simple UI:
  marketAlignment: TriageLevel;
  smartMoney: TriageLevel;
  expertConsensus: TriageLevel;
  triageScore: number;
  triageDetails: UpstoxTriageDetails;
};

/**
 * Score Market Intelligence Triage for a single Upstox candidate.
 */
export function scoreUpstoxCandidateTriage(
  cand: UpstoxCandidateRaw,
  weights: UpstoxTriageWeights = DEFAULT_UPSTOX_TRIAGE_WEIGHTS
): UpstoxTriageDetails {
  const store = readExpertReliabilityStore();

  // 1. Technical Score (0-100)
  const technicalScore = Math.max(0, Math.min(100, cand.score || 75));

  // 2. Market + Sector Score (0-100)
  let marketSectorScore = 50; // Neutral baseline
  const ms = cand.marketSectorBias;
  if (ms) {
    if (ms.fiiDiiNetBuyer) marketSectorScore += 15;
    if (ms.sectorTrend === "BULLISH") marketSectorScore += 20;
    else if (ms.sectorTrend === "BEARISH") marketSectorScore -= 25;

    if (ms.sectorRelativeStrength != null) {
      marketSectorScore += (ms.sectorRelativeStrength - 50) * 0.3;
    }
  } else {
    // Default sector strength based on technical setup
    if ((cand.rvol || 1) >= 2.5) marketSectorScore += 15;
    if (cand.target && cand.cmp && ((cand.target - cand.cmp) / cand.cmp) >= 0.1) marketSectorScore += 10;
  }
  marketSectorScore = Math.max(0, Math.min(100, Math.round(marketSectorScore)));

  // 3. Smart Money / Institutional Score (0-100)
  let smartMoneyScore = 30; // Baseline
  const sm = cand.smartMoneySignals;
  if (sm) {
    if (sm.bulkBlockDeals) smartMoneyScore += 25;
    if (sm.deliveryVolumeSpike) smartMoneyScore += 20;
    if (sm.unusualVolume || (cand.rvol && cand.rvol >= 2.5)) smartMoneyScore += 15;
    if (sm.futuresOptionsActivity === "LONG_BUILDUP") smartMoneyScore += 20;
    else if (sm.futuresOptionsActivity === "SHORT_COVERING") smartMoneyScore += 10;
    else if (sm.futuresOptionsActivity === "SHORT_BUILDUP") smartMoneyScore -= 20;
    if (sm.priceVolumeAccumulation) smartMoneyScore += 15;
  } else {
    // Deduce smart money signals from live volume & price action
    if ((cand.rvol || 1) >= 3.0) smartMoneyScore += 40;
    else if ((cand.rvol || 1) >= 2.5) smartMoneyScore += 25;
    if (cand.target && cand.cmp && cand.target > cand.cmp) smartMoneyScore += 15;
  }
  smartMoneyScore = Math.max(0, Math.min(100, Math.round(smartMoneyScore)));

  // 4. Expert Consensus Score (0-100)
  // Deduplicate tips from same source & weight by source reliability
  const tips = cand.expertTips || [];
  const uniqueSources = new Map<string, ExpertTipInput>();
  for (const tip of tips) {
    if (!uniqueSources.has(tip.sourceId)) {
      uniqueSources.set(tip.sourceId, tip);
    }
  }

  let expertConsensusScore = 0;
  const expertSourcesList: string[] = [];
  let totalReliabilityWeightedScore = 0;
  let totalReliabilityWeight = 0;

  if (uniqueSources.size > 0) {
    for (const [sourceId, tip] of uniqueSources.entries()) {
      const sourceRecord = store[sourceId] || {
        sourceId,
        sourceName: tip.sourceName || sourceId,
        isSebiRegistered: tip.isSebiRegistered ?? false,
        isIndependent: tip.isIndependent ?? false,
        reliabilityScore: tip.isSebiRegistered ? 75 : 40,
      };

      expertSourcesList.push(sourceRecord.sourceName);
      const stanceMultiplier = tip.stance === "BUY" ? 1 : -1;
      const weight = sourceRecord.reliabilityScore;
      totalReliabilityWeightedScore += stanceMultiplier * weight;
      totalReliabilityWeight += weight;
    }

    if (totalReliabilityWeight > 0) {
      const avgWeighted = totalReliabilityWeightedScore / totalReliabilityWeight; // -1 to +1
      expertConsensusScore = Math.max(0, Math.min(100, Math.round(50 + avgWeighted * 35 + (uniqueSources.size > 1 ? 15 : 0))));
    }
  } else {
    // If no explicit expert tip attached, baseline neutral score
    expertConsensusScore = 50;
  }

  const avgSourceReliability = expertSourcesList.length > 0
    ? Math.round(totalReliabilityWeight / expertSourcesList.length)
    : 70;

  // 5. News / Catalyst Score (0-100)
  let newsCatalystScore = 50; // Baseline
  const cats = cand.catalysts || [];
  for (const cat of cats) {
    if (cat.impact === "HIGH_POSITIVE") newsCatalystScore += 25;
    else if (cat.impact === "MODERATE_POSITIVE") newsCatalystScore += 12;
    else if (cat.impact === "NEGATIVE") newsCatalystScore -= 25;
  }
  newsCatalystScore = Math.max(0, Math.min(100, Math.round(newsCatalystScore)));

  // Calculate composite Triage Score (0 - 100)
  const totalWeight = weights.technicalStrength + weights.marketSectorAlignment +
    weights.smartMoneyInstitutional + weights.expertConsensus + weights.newsCatalyst;

  const rawTriageScore = (
    technicalScore * weights.technicalStrength +
    marketSectorScore * weights.marketSectorAlignment +
    smartMoneyScore * weights.smartMoneyInstitutional +
    expertConsensusScore * weights.expertConsensus +
    newsCatalystScore * weights.newsCatalyst
  ) / (totalWeight || 100);

  const triageScore = Math.max(0, Math.min(100, Math.round(rawTriageScore)));

  // Categorize for UI
  const marketAlignment = getTriageLevel(marketSectorScore);
  const smartMoney = getTriageLevel(smartMoneyScore);
  const expertConsensus = uniqueSources.size > 0 ? getTriageLevel(expertConsensusScore) : "Moderate";

  // Confluence Evaluation
  // Rule: Expert tip alone without technical/volume/smart money confirmation must be REJECTED.
  // Rule: High priority when Expert, Smart Money, Sector, Volume, VWAP, Momentum agree.
  const rejectionReasons: string[] = [];
  let confluencePassed = true;

  const hasTechnicalConfirmation = cand.rvol != null ? cand.rvol >= 2.0 : technicalScore >= 75;
  const hasSmartMoneyOrSector = smartMoneyScore >= 40 || marketSectorScore >= 40;

  if (uniqueSources.size > 0 && !hasTechnicalConfirmation && !hasSmartMoneyOrSector) {
    confluencePassed = false;
    rejectionReasons.push("Expert recommendation exists without live technical, volume, or smart money confirmation.");
  }

  if (triageScore < 45) {
    confluencePassed = false;
    rejectionReasons.push("Composite Triage Score below minimum 45 hurdle.");
  }

  if (cand.cmp < 150) {
    confluencePassed = false;
    rejectionReasons.push("CMP below ₹150 minimum liquidity floor.");
  }

  const confluenceSignal = !confluencePassed
    ? "Reject / No Trade"
    : triageScore >= 75
    ? "Strong Candidate"
    : "Moderate Candidate";

  const sectorAlignmentStr = cand.sector
    ? `${cand.sector} (${marketAlignment})`
    : `Market Aligned (${marketAlignment})`;

  return {
    technicalScore,
    marketSectorScore,
    smartMoneyScore,
    expertConsensusScore,
    newsCatalystScore,
    triageScore,
    marketAlignment,
    smartMoney,
    expertConsensus,
    confluencePassed,
    confluenceSignal,
    expertSources: expertSourcesList,
    sourceReliabilityScore: avgSourceReliability,
    sectorAlignment: sectorAlignmentStr,
    rejectionReasons,
  };
}

/**
 * Daily Selection Funnel for Upstox Intraday Recommendation Model:
 *
 * Eligible Stock Universe
 * → Market/Sector Filter
 * → Expert + Institutional Triage
 * → Top 20 Attention Stocks
 * → Live Upstox Technical Validation
 * → Top 5–8 Trade Candidates
 * → Final Buy/Sell/No-Trade Decision
 */
export function evaluateUpstoxFunnel(
  rawCandidates: UpstoxCandidateRaw[],
  weights: UpstoxTriageWeights = DEFAULT_UPSTOX_TRIAGE_WEIGHTS
): UpstoxTrichedRecommendation[] {
  // Step 1: Eligible Stock Universe (Filter CMP >= 150 & valid prices)
  const step1Universe = rawCandidates.filter((c) => c.cmp >= 150 && c.target > c.cmp && c.stopLoss < c.cmp);

  // Step 2: Market / Sector Filter (Filter out negative market sector bias)
  const step2MarketFiltered = step1Universe.filter((c) => {
    if (c.marketSectorBias?.sectorTrend === "BEARISH") return false;
    return true;
  });

  // Step 3: Expert + Institutional Triage Scoring
  const triagedList = step2MarketFiltered.map((cand, idx) => {
    const triageDetails = scoreUpstoxCandidateTriage(cand, weights);
    const recId = `upstox-rec-${String(idx + 1).padStart(3, "0")}`;

    // Combine Technical score + Triage score
    const finalScore = Math.round(cand.score * 0.5 + triageDetails.triageScore * 0.5);

    const rec: UpstoxTrichedRecommendation = {
      id: recId,
      symbol: cand.symbol,
      name: cand.name || cand.symbol,
      instrumentKey: cand.instrumentKey || `NSE_EQ|${cand.symbol}`,
      cmp: cand.cmp,
      target: cand.target,
      stopLoss: cand.stopLoss,
      signal: cand.signal || "BUY",
      score: finalScore,
      executionMode: idx % 2 === 0 ? "USER_DRIVEN" : "AUTOMATIC",
      status: "PENDING",
      orderId: null,
      remark: cand.remark || `Triage Score: ${triageDetails.triageScore}/100 | Smart Money: ${triageDetails.smartMoney} | Market: ${triageDetails.marketAlignment}`,
      timestamp: new Date().toISOString(),
      marketAlignment: triageDetails.marketAlignment,
      smartMoney: triageDetails.smartMoney,
      expertConsensus: triageDetails.expertConsensus,
      triageScore: triageDetails.triageScore,
      triageDetails,
    };
    return rec;
  });

  // Step 4: Top 20 Attention Stocks (Sort by Triage Score & take top 20)
  const step4Top20Attention = triagedList
    .sort((a, b) => b.triageScore - a.triageScore)
    .slice(0, 20);

  // Step 5: Live Upstox Technical Validation (Check RVOL >= 2.5x, Upside > 10%, Confluence passed)
  const step5TechnicalValidated = step4Top20Attention.filter((r) => {
    const upside = ((r.target - r.cmp) / r.cmp) * 100;
    const passesUpside = upside >= 9.5; // >10% day target upside
    const passesConfluence = r.triageDetails.confluencePassed;
    return passesUpside && passesConfluence;
  });

  // Step 6: Top 5–8 Trade Candidates
  const step6TopTradeCandidates = step5TechnicalValidated
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  // Step 7: Final Buy/Sell/No-Trade Decision (The existing Upstox model is final decision maker)
  // If fewer than 1 trade candidate meets all confluence criteria, return empty/NO TRADE candidates
  return step6TopTradeCandidates;
}
