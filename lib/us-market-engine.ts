import type { TermRecommendation } from "@/lib/term-agent-analysis";
import { writeSnapshotFile } from "@/lib/snapshot-storage";
import { assertRecommendationPublicationEnabled } from "@/lib/recommendation-publication";

export type UsIntradayPick = {
  symbol: string; name: string; price: number; previousClose: number; changePercent: number;
  target: number; upside: number; score: number; action: "BUY"; remark: string; theme: string;
  sector: string; marketCapCategory: string; isMultibagger: boolean;
};
export type UsMarketSnapshot = {
  asOf: string; market: "US"; source: "UNAVAILABLE"; abstained: true; reason: string;
  termPicks: TermRecommendation[]; intradayPicks: UsIntradayPick[];
};
const SNAPSHOT_FILE = "us_market_recommendations.json";

export async function runUsMarketPipeline(): Promise<UsMarketSnapshot> {
  assertRecommendationPublicationEnabled();
  const snapshot: UsMarketSnapshot = {
    asOf: new Date().toISOString(), market: "US", source: "UNAVAILABLE", abstained: true,
    reason: "US recommendations are paused until a live universe-discovery and indicator pipeline is available.",
    termPicks: [], intradayPicks: [],
  };
  await writeSnapshotFile(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2));
  return snapshot;
}
export async function readUsMarketSnapshot(): Promise<UsMarketSnapshot> { return runUsMarketPipeline(); }
