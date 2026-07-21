import fs from "node:fs/promises";
import path from "node:path";
import type { ExpertActionMatrix, ExpertQuote } from "@/lib/expert-insights";
import { readLongTermUniverseSnapshot } from "@/lib/long-term-universe";
import type {
  AgentTimeframe,
  AgentWealthUniverseOutput,
  GrowthCandidate,
} from "@/lib/agents/types";

const SNAPSHOT_PATH = path.join(process.cwd(), "data", "wealth_recommendations.json");
const MAX_AGE_HOURS = 36;
const INTRADAY_PER_BUCKET = 5;

type CapBucket = "large" | "mid" | "small";

const KEY_TO_BUCKET: Record<string, CapBucket> = {
  largeCap: "large",
  midCap: "mid",
  smallCap: "small",
};

/**
 * agentWealthUniverse — bridges two pre-computed snapshots into the agent pipeline.
 *
 * **Long-term candidates** (96 stocks across 6 thematic sectors):
 *   Reads data/long_term_universe.json (written by GET /api/snapshots/long-term-universe).
 *   Each candidate is tagged with capBucket ("large"|"mid"|"small"|"emerging")
 *   and thematicSector ("Defense & Capital Goods" etc.).
 *
 * **Intraday candidates** (cap-bucket breakouts):
 *   Reads data/wealth_recommendations.json (written by GET /api/snapshots/wealth).
 *   Only the intradayBreakouts entries are used here; longTermUpsides are
 *   superseded by the new thematic long-term universe.
 *
 * Both files are read from disk — zero live network calls — so this agent
 * adds < 50ms to the response budget.
 */
export async function agentWealthUniverse(
  now = new Date(),
): Promise<AgentWealthUniverseOutput> {
  const [longTermUniverse, intradaySnapshot] = await Promise.all([
    readLongTermUniverseSnapshot(),
    readIntradaySnapshot(),
  ]);
  const longTermSnapshotAge = longTermUniverse
    ? (now.getTime() - Date.parse(longTermUniverse.asOf)) / 3_600_000
    : -1;
  const intradaySnapshotAge = intradaySnapshot
    ? (now.getTime() - Date.parse(intradaySnapshot.asOf)) / 3_600_000
    : -1;
  const rejectionReasons: string[] = [];
  if (!longTermUniverse) rejectionReasons.push("Long-term universe snapshot is unavailable.");
  else if (!Number.isFinite(longTermSnapshotAge) || longTermSnapshotAge > MAX_AGE_HOURS) {
    rejectionReasons.push(`Long-term universe snapshot is stale (${longTermSnapshotAge.toFixed(1)} hours).`);
  }
  if (!intradaySnapshot) rejectionReasons.push("Intraday wealth snapshot is unavailable.");
  else if (!Number.isFinite(intradaySnapshotAge) || intradaySnapshotAge > MAX_AGE_HOURS) {
    rejectionReasons.push(`Intraday wealth snapshot is stale (${intradaySnapshotAge.toFixed(1)} hours).`);
  }

  // --- Long-term candidates from the thematic 96-stock universe ---
  const longTermCandidates: GrowthCandidate[] = [];

  if (longTermUniverse) {
    const ageHours = (now.getTime() - Date.parse(longTermUniverse.asOf)) / 3_600_000;
    if (Number.isFinite(ageHours) && ageHours <= MAX_AGE_HOURS) {
      for (const sector of longTermUniverse.sectors) {
        for (const [slot, picks] of Object.entries(sector.slots) as Array<[string, typeof sector.slots.large]>) {
          const capSlot = slot as "large" | "mid" | "small" | "emerging";
          for (const pick of picks) {
            longTermCandidates.push(
              screenedStockToCandidate(pick, sector.key as never, sector.title, capSlot, "Long term"),
            );
          }
        }
      }
    }
  }

  // --- Intraday candidates from the wealth snapshot (cap-bucket breakouts) ---
  const intradayCandidates: GrowthCandidate[] = [];
  const byBucket: AgentWealthUniverseOutput["byBucket"] = {
    large: { longTerm: [], intraday: [] },
    mid: { longTerm: [], intraday: [] },
    small: { longTerm: [], intraday: [] },
  };

  if (intradaySnapshot) {
    const ageHours = (now.getTime() - Date.parse(intradaySnapshot.asOf)) / 3_600_000;
    if (Number.isFinite(ageHours) && ageHours <= MAX_AGE_HOURS) {
      for (const category of intradaySnapshot.categories) {
        const bucket = KEY_TO_BUCKET[category.key];
        if (!bucket) continue;

        const intradayCands = category.intradayBreakouts
          .slice(0, INTRADAY_PER_BUCKET)
          .map((quote) => toGrowthCandidate(quote, bucket, "Intraday"));

        byBucket[bucket] = { longTerm: [], intraday: intradayCands };
        intradayCandidates.push(...intradayCands);
      }
    }
  }

  const allCandidates = [...longTermCandidates, ...intradayCandidates];

  const ltSectorSummary = longTermUniverse
    ? longTermUniverse.sectors
        .map((s) => `${s.title}: L${s.slotCounts.large}/M${s.slotCounts.mid}/S${s.slotCounts.small}/E${s.slotCounts.emerging}`)
        .join("; ")
    : "long-term snapshot unavailable";

  return {
    agent: "WealthUniverse",
    generatedAt: now.toISOString(),
    candidates: allCandidates,
    byBucket,
    snapshotAge: intradaySnapshotAge,
    longTermSnapshotAge,
    freshness: rejectionReasons.length === 0
      ? "fresh"
      : longTermUniverse || intradaySnapshot
        ? "stale"
        : "unavailable",
    rejectionReasons,
    summary: allCandidates.length > 0
      ? `${longTermCandidates.length} thematic long-term candidates (${ltSectorSummary}) + ${intradayCandidates.length} intraday cap-bucket candidates.`
      : `${rejectionReasons.join(" ")} Run wealth:snapshot and longterm:snapshot.`,
  };
}

async function readIntradaySnapshot(): Promise<ExpertActionMatrix | null> {
  try {
    const json = await fs.readFile(SNAPSHOT_PATH, "utf8");
    return JSON.parse(json) as ExpertActionMatrix;
  } catch {
    return null;
  }
}

/**
 * Converts a ThematicSectorCandidate (which is a ScreenedStock + thematic tags)
 * into the GrowthCandidate shape the orchestrator consumes.
 */
function screenedStockToCandidate(
  stock: {
    symbol: string;
    name: string;
    theme: string;
    capBucket: string;
    score: number;
    remark: string;
    reasons: string[];
    caveats: string[];
    metrics: { riskScore?: number; liquidityScore?: number };
    price?: number;
    target: number;
    revenueGrowthPercent: number;
    factorScores: { growth: number; quality: number; valuation: number; momentum: number };
  },
  thematicSectorKey: string,
  thematicSectorTitle: string,
  capSlot: "large" | "mid" | "small" | "emerging",
  timeframe: AgentTimeframe,
): GrowthCandidate {
  const capLabel = capSlot === "emerging"
    ? "Emerging"
    : capSlot === "large" ? "Large Cap" : capSlot === "mid" ? "Mid Cap" : "Small Cap";

  return {
    symbol: stock.symbol,
    company: stock.name,
    sector: stock.theme,
    proposedAction: "Buy",
    timeframe,
    existingLogicScore: Math.round(stock.score),
    supportingScores: {
      info: 0,
      macroPolicy: 0,
      sentiment: 0,
      portfolio: 0,
      fundamental: normalizeFactorScore(
        (stock.factorScores.growth + stock.factorScores.quality + stock.factorScores.valuation) / 3,
        18,
      ),
      technical: normalizeFactorScore(stock.factorScores.momentum, 15),
    },
    confidence: Math.min(85, Math.round(stock.score)),
    reason: stock.remark ||
      `${stock.symbol} is a ${capLabel} pick in the ${thematicSectorTitle} thematic sector (score ${stock.score}/100).`,
    positiveTriggers: stock.reasons.slice(0, 3),
    negativeConcerns: stock.caveats.slice(0, 3),
    volatilityScore: stock.metrics.riskScore,
    liquidityScore: stock.metrics.liquidityScore,
    target: (stock.metrics as { target?: number }).target ?? (stock.target > 0 ? stock.target : undefined),
    stopLoss: stock.price && stock.price > 0 ? Math.round(stock.price * 0.85 * 100) / 100 : undefined,
    capBucket: capSlot,
    source: "wealth-universe",
    thematicSector: thematicSectorTitle,
  };
}

/**
 * Converts an ExpertQuote (from the intraday/wealth snapshot) into a GrowthCandidate.
 * Used only for the intraday breakout slots.
 */
function toGrowthCandidate(
  quote: ExpertQuote,
  capBucket: CapBucket,
  timeframe: AgentTimeframe,
): GrowthCandidate {
  const proposedAction = quote.action === "Accumulate" ? "Buy" as const : "Watch" as const;
  const capLabel = capBucket === "large" ? "Large Cap" : capBucket === "mid" ? "Mid Cap" : "Small Cap";

  return {
    symbol: quote.symbol,
    company: quote.name,
    sector: quote.sector || quote.theme,
    proposedAction,
    timeframe,
    existingLogicScore: Math.round(quote.score),
    supportingScores: {
      info: 0,
      macroPolicy: 0,
      sentiment: 0,
      portfolio: 0,
      fundamental: normalizeFactorScore(
        (quote.factorScores.growth + quote.factorScores.quality + quote.factorScores.valuation) / 3,
        18,
      ),
      technical: normalizeFactorScore(quote.factorScores.momentum, 15),
    },
    confidence: Math.min(85, Math.round(quote.score)),
    reason: quote.remark ||
      `${quote.symbol} screened from the ${capLabel} NIFTY 500 universe (score ${quote.score}/100).`,
    positiveTriggers: quote.reasons.slice(0, 3),
    negativeConcerns: quote.caveats.slice(0, 3),
    volatilityScore: quote.metrics?.riskScore,
    liquidityScore: quote.metrics?.liquidityScore,
    target: quote.metrics?.target > 0 ? quote.metrics.target : (quote.target > 0 ? quote.target : undefined),
    stopLoss: quote.price > 0
      ? Math.round(quote.price * (1 - Math.max(1.2, quote.metrics?.atrPercent ?? 1.2) / 100) * 100) / 100
      : undefined,
    capBucket,
    source: "wealth-universe",
  };
}

function normalizeFactorScore(value: number, maxValue: number): number {
  if (!maxValue) return 0;
  return Math.round(((value / maxValue) * 10 - 5) * 10) / 10;
}
