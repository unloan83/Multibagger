import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { analyzeIpos, type IpoCandidate } from "@/lib/agents/ipoAgent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const { candidates, source, warning } = await loadIpoFeed();
  const recommendations = analyzeIpos(candidates);

  return NextResponse.json({
    agent: "IPO Intelligence Agent",
    generatedAt: new Date().toISOString(),
    source,
    warning,
    count: recommendations.length,
    recommendations,
    methodology: [
      "Official issue facts should be reconciled with NSE/BSE and the issuer's SEBI-filed offer document.",
      "Fundamentals, valuation, demand and issue structure contribute 90% of the weighted score; unofficial GMP is capped at 10%.",
      "BUY requires a score of at least 70, fresh data, adequate fundamentals and reasonable valuation. Serious risk flags force AVOID.",
    ],
    disclaimer: "Research screening only. Grey-market premiums are unofficial, unregulated and are not guaranteed listing-price forecasts.",
  }, {
    headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=1800" },
  });
}

async function loadIpoFeed(): Promise<{
  candidates: IpoCandidate[];
  source: string;
  warning?: string;
}> {
  const url = process.env.IPO_FEED_URL;
  if (url) {
    try {
      const response = await fetch(url, {
        headers: process.env.IPO_FEED_API_KEY
          ? { Authorization: `Bearer ${process.env.IPO_FEED_API_KEY}` }
          : undefined,
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error(`IPO feed returned HTTP ${response.status}`);
      const payload = await response.json() as unknown;
      return { candidates: parseCandidates(payload), source: url };
    } catch (error) {
      const fallback = await readLocalFeed();
      return {
        candidates: fallback,
        source: "local fallback",
        warning: error instanceof Error ? error.message : "Configured IPO feed is unavailable.",
      };
    }
  }

  return {
    candidates: await readLocalFeed(),
    source: "local fallback",
    warning: "Set IPO_FEED_URL (and optionally IPO_FEED_API_KEY) for live NSE/BSE, subscription and GMP data.",
  };
}

function parseCandidates(payload: unknown): IpoCandidate[] {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { candidates?: unknown }).candidates)
      ? (payload as { candidates: unknown[] }).candidates
      : [];
  return rows.filter(isIpoCandidate);
}

function isIpoCandidate(value: unknown): value is IpoCandidate {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<IpoCandidate>;
  return Boolean(
    row.id && row.company && row.openDate && row.closeDate && row.dataAsOf &&
    row.priceBandHigh && row.priceBandHigh > 0 && row.lotSize && row.lotSize > 0 &&
    row.exchange && row.status,
  );
}

async function readLocalFeed() {
  try {
    const raw = await fs.readFile(path.join(process.cwd(), "data", "ipo-feed.json"), "utf8");
    return parseCandidates(JSON.parse(raw));
  } catch {
    return [];
  }
}
