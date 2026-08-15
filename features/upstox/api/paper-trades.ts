import { NextResponse } from "next/server";
import fs from "fs";
import {
  updateAndGetPaperState,
  executeManualTradeAction,
  type CandidateSignal,
} from "@/features/upstox/lib/intraday-paper-engine";
import { upstoxDataPath } from "@/features/upstox/lib/data-paths";


const RECOMMENDATIONS_FILE = upstoxDataPath("upstox_recommendations.json");

function getCandidatesFromRecommendations(): CandidateSignal[] {
  if (!fs.existsSync(RECOMMENDATIONS_FILE)) return [];
  try {
    const raw = fs.readFileSync(RECOMMENDATIONS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    const recs = parsed.recommendations || [];
    return recs.map((r: {
      symbol: string;
      cmp: number;
      target: number;
      stopLoss: number;
      signal?: "BUY" | "SELL";
      score?: number;
      triageScore?: number;
      marketAlignment?: "Strong" | "Moderate" | "Weak";
      smartMoney?: "Strong" | "Moderate" | "Weak";
      expertConsensus?: "Strong" | "Moderate" | "Weak";
      triageDetails?: {
        expertSources?: string[];
        sourceReliabilityScore?: number;
        smartMoneyScore?: number;
        sectorAlignment?: string;
        technicalScore?: number;
      };
    }) => ({
      symbol: r.symbol,
      cmp: r.cmp,
      target: r.target,
      stopLoss: r.stopLoss,
      signal: r.signal || "BUY",
      score: r.score || 85,
      triageScore: r.triageScore,
      marketAlignment: r.marketAlignment,
      smartMoney: r.smartMoney,
      expertConsensus: r.expertConsensus,
      expertSources: r.triageDetails?.expertSources,
      sourceReliabilityScore: r.triageDetails?.sourceReliabilityScore,
      smartMoneyScore: r.triageDetails?.smartMoneyScore,
      sectorAlignment: r.triageDetails?.sectorAlignment,
      technicalScore: r.triageDetails?.technicalScore || r.score,
    }));
  } catch {
    return [];
  }
}

export async function getUpstoxPaperTrades() {
  try {
    const candidates = getCandidatesFromRecommendations();
    const state = updateAndGetPaperState(candidates);
    return NextResponse.json({ ok: true, ...state });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load paper trading data." },
      { status: 500 }
    );
  }
}

export async function updateUpstoxPaperTrades(request: Request) {
  try {
    const body = await request.json();
    const { action, tradeId, decision } = body;

    if (action === "execute_manual" && tradeId) {
      const act = decision === "TARGET" ? "CLOSE_TARGET" : decision === "STOP" ? "CLOSE_STOP" : "CLOSE_MANUAL";
      const success = executeManualTradeAction(tradeId, act);
      if (success) {
        const candidates = getCandidatesFromRecommendations();
        const state = updateAndGetPaperState(candidates);
        return NextResponse.json({ ok: true, message: `Trade ${tradeId} closed.`, ...state });
      }
      return NextResponse.json({ ok: false, error: "Failed to close trade." }, { status: 400 });
    }

    if (action === "trigger_tick") {
      const candidates = getCandidatesFromRecommendations();
      const state = updateAndGetPaperState(candidates);
      return NextResponse.json({ ok: true, message: "Paper tick processed.", ...state });
    }

    return NextResponse.json({ ok: false, error: "Invalid action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Error executing paper trade action." },
      { status: 500 }
    );
  }
}
