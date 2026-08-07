import { runTermAgentAnalysis, type TermDuration } from "@/lib/term-agent-analysis";
import { writeSnapshotFile } from "@/lib/snapshot-storage";
import { assertRecommendationPublicationEnabled } from "@/lib/recommendation-publication";

export type SwingTermHorizon = TermDuration;
export type SwingPick = {
  symbol: string; name: string; price: number; previousClose: number; changePercent: number; target: number;
  stopLoss: number; upside: number; score: number; termHorizon: SwingTermHorizon; horizonLabel: string;
  debtToEquity: null; cfoNetIncomeRatio: null; roePercent: null; fiiDiiHoldingChangeQoQ: null;
  promoterPledgePercent: null; relativeStrengthVsNifty: null; sector: string; theme: string;
  marketCapCategory: string; isMultibagger: boolean; action: "BUY" | "ACCUMULATE"; agentRationale: string;
};
export type SwingSnapshot = {
  asOf: string; sourceAsOf: string | null; source: "LIVE_TERM_SCREEN" | "UNAVAILABLE"; abstained: boolean;
  reason: string | null; runTimeIST: string; executionSlot: string; marketRegime: string;
  evaluatedUniverseSize: number; eligiblePicksCount: number;
  picksByHorizon: Record<SwingTermHorizon, SwingPick[]>; picks: SwingPick[];
};
const SWING_SNAPSHOT_FILE = "swing_recommendations.json";

export async function runSwingPipeline(): Promise<SwingSnapshot> {
  assertRecommendationPublicationEnabled();
  const term = await runTermAgentAnalysis();
  const picks = term.picks.map((item): SwingPick => ({
    symbol: item.symbol, name: item.name, price: item.price, previousClose: item.previousClose,
    changePercent: item.changePercent, target: item.target, stopLoss: round(item.price * .92), upside: item.upside,
    score: item.score, termHorizon: item.termDuration, horizonLabel: item.durationLabel,
    debtToEquity: null, cfoNetIncomeRatio: null, roePercent: null, fiiDiiHoldingChangeQoQ: null,
    promoterPledgePercent: null, relativeStrengthVsNifty: null, sector: item.sector, theme: item.theme,
    marketCapCategory: item.marketCapCategory, isMultibagger: item.isMultibagger, action: item.action,
    agentRationale: item.agentRationale,
  }));
  const picksByHorizon: Record<SwingTermHorizon, SwingPick[]> = { "1week": [], "1month": [], "3months": [], "6months": [] };
  for (const pick of picks) picksByHorizon[pick.termHorizon].push(pick);
  const snapshot: SwingSnapshot = {
    asOf: new Date().toISOString(), sourceAsOf: term.sourceAsOf, source: term.abstained ? "UNAVAILABLE" : "LIVE_TERM_SCREEN",
    abstained: term.abstained, reason: term.reason, runTimeIST: "Latest live snapshot", executionSlot: "Validated live market run",
    marketRegime: term.abstained ? "Unavailable" : "Live screened", evaluatedUniverseSize: term.totalPicks,
    eligiblePicksCount: picks.length, picksByHorizon, picks,
  };
  await writeSnapshotFile(SWING_SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2));
  return snapshot;
}

export async function readSwingRecommendations(): Promise<SwingSnapshot> {
  // Never serve the legacy seeded swing snapshot.
  return runSwingPipeline();
}
function round(value: number) { return Math.round(value * 100) / 100; }
