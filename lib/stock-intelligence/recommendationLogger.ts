import {
  appendStockIntelligenceLogs,
  isGoogleSheetsConfigured,
  readStockIntelligenceLogs,
  updateStockIntelligenceOutcomes,
} from "@/lib/google-sheets";
import type { StockIntelligenceLogRow, StockIntelligenceRecommendation } from "./types";

export async function logRecommendations(input: {
  portfolioId: string;
  portfolioName: string;
  recommendations: StockIntelligenceRecommendation[];
  currentPrices: Record<string, number>;
}) {
  if (!isGoogleSheetsConfigured()) return { logged: false, updatedOutcomes: 0 };
  const updatedOutcomes = await updatePendingOutcomes(input.currentPrices);
  const timestamp = new Date().toISOString();
  const rows: StockIntelligenceLogRow[] = input.recommendations.map((item) => ({
    timestamp,
    portfolioId: input.portfolioId,
    portfolioName: input.portfolioName,
    symbol: item.symbol,
    action: item.action,
    timeframe: item.timeframe,
    confidence: item.confidence,
    newsImpactScore: item.newsImpactScore,
    sectorMacroImpactScore: item.sectorMacroImpactScore,
    existingLogicScore: item.existingLogicScore,
    finalScore: item.finalScore,
    sources: item.sourceSummary.map((source) => source.url),
    finalReason: item.reason,
    entryPrice: input.currentPrices[item.symbol] ?? 0,
    target: item.target ?? 0,
    stopLoss: item.stopLoss ?? 0,
    performanceStatus: "pending",
    evaluatedAt: "",
  }));
  await appendStockIntelligenceLogs(rows);
  return { logged: true, updatedOutcomes };
}

export async function updatePendingOutcomes(currentPrices: Record<string, number>) {
  const rows = await readStockIntelligenceLogs();
  const updates: Array<{ sheetRow: number; status: "hit" | "miss"; evaluatedAt: string }> = [];
  const evaluatedAt = new Date().toISOString();
  for (const row of rows) {
    if (row.performanceStatus !== "pending") continue;
    const price = currentPrices[row.symbol];
    if (!price || !row.target || !row.stopLoss || !row.sheetRow || (row.action !== "Buy" && row.action !== "Sell")) continue;
    const hit = row.action === "Buy" ? price >= row.target : price <= row.target;
    const miss = row.action === "Buy" ? price <= row.stopLoss : price >= row.stopLoss;
    if (!hit && !miss) continue;
    updates.push({ sheetRow: row.sheetRow, status: hit ? "hit" : "miss", evaluatedAt });
  }
  await updateStockIntelligenceOutcomes(updates);
  return updates.length;
}
