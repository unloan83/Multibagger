import { readWealthRecommendationsSnapshot, type ExpertQuote } from "@/lib/expert-insights";
import { writeSnapshotFile } from "@/lib/snapshot-storage";

export type TermDuration = "1week" | "1month" | "3months" | "6months";
export type TermRecommendation = {
  symbol: string; name: string; price: number; previousClose: number; changePercent: number;
  target: number; upside: number; termDuration: TermDuration; durationLabel: string; score: number;
  action: "BUY" | "ACCUMULATE"; theme: string; sector: string; marketCapCategory: string;
  isMultibagger: boolean; agentRationale: string;
};
export type BacktestMetrics = null;
export type MetricDefinition = { metric: string; formula: string; institutionalThreshold: string };
export type TermAnalysisResult = {
  asOf: string; sourceAsOf: string | null; source: "LIVE_WEALTH_SNAPSHOT" | "UNAVAILABLE";
  abstained: boolean; reason: string | null; agentName: string; executionSlot: string; totalPicks: number;
  byDuration: Record<TermDuration, TermRecommendation[]>; picks: TermRecommendation[];
  backtestMetrics: BacktestMetrics; metricDefinitions: MetricDefinition[];
};

const TERM_SNAPSHOT_FILE = "term_recommendations.json";
export const VERIFIED_BACKTEST_METRICS: BacktestMetrics = null;
export const INSTITUTIONAL_METRIC_DEFINITIONS: MetricDefinition[] = [];

export async function runTermAgentAnalysis(): Promise<TermAnalysisResult> {
  const source = await readWealthRecommendationsSnapshot();
  const age = source ? Date.now() - Date.parse(source.asOf) : Number.POSITIVE_INFINITY;
  const sourceIsFresh = Boolean(source && Number.isFinite(age) && age >= 0 && age <= 36 * 60 * 60_000 && !source.abstained);
  const byDuration = emptyBuckets();
  if (sourceIsFresh && source) {
    for (const category of source.categories) {
      const cap = category.key === "largeCap" ? "Large Cap" : category.key === "midCap" ? "Mid Cap" : "Small Cap";
      for (const quote of category.longTermUpsides.filter((item) => item.action === "Accumulate")) {
        const termDuration = durationFor(quote);
        byDuration[termDuration].push(toRecommendation(quote, cap, termDuration));
      }
    }
  }
  for (const duration of Object.keys(byDuration) as TermDuration[]) byDuration[duration].sort((a, b) => b.score - a.score);
  const picks = (Object.keys(byDuration) as TermDuration[]).flatMap((duration) => byDuration[duration]);
  const result: TermAnalysisResult = {
    asOf: new Date().toISOString(), sourceAsOf: sourceIsFresh ? source!.asOf : null,
    source: sourceIsFresh ? "LIVE_WEALTH_SNAPSHOT" : "UNAVAILABLE", abstained: !sourceIsFresh || picks.length === 0,
    reason: sourceIsFresh ? (picks.length ? null : "The live wealth screen produced no stocks that cleared every gate.") : "The live wealth snapshot is unavailable, stale, or abstained; no term recommendations were published.",
    agentName: "Multibagger live term screen", executionSlot: "Latest validated market snapshot", totalPicks: picks.length,
    byDuration, picks, backtestMetrics: null, metricDefinitions: [],
  };
  await writeSnapshotFile(TERM_SNAPSHOT_FILE, JSON.stringify(result, null, 2));
  return result;
}

export async function readTermRecommendations(): Promise<TermAnalysisResult> {
  // Always derive from the currently validated wealth snapshot. Legacy term files are never served.
  return runTermAgentAnalysis();
}

function emptyBuckets(): Record<TermDuration, TermRecommendation[]> { return { "1week": [], "1month": [], "3months": [], "6months": [] }; }
function durationFor(quote: ExpertQuote): TermDuration { return quote.upside <= 10 ? "1week" : quote.upside <= 18 ? "1month" : quote.upside <= 35 ? "3months" : "6months"; }
function labelFor(duration: TermDuration) { return duration === "1week" ? "1 Week" : duration === "1month" ? "1 Month" : duration === "3months" ? "3 Months" : "6 Months"; }
function toRecommendation(quote: ExpertQuote, cap: string, termDuration: TermDuration): TermRecommendation {
  return { symbol: quote.symbol, name: quote.name, price: quote.price, previousClose: quote.previousClose, changePercent: quote.changePercent,
    target: quote.target, upside: quote.upside, termDuration, durationLabel: labelFor(termDuration), score: quote.score,
    action: termDuration === "1week" ? "BUY" : "ACCUMULATE", theme: quote.theme, sector: quote.sector, marketCapCategory: cap,
    isMultibagger: quote.upside >= 100 && quote.target >= quote.price * 2,
    agentRationale: `${quote.remark} Live source: ${quote.fundamentalAsOf}.`, };
}
