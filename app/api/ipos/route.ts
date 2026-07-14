import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { analyzeIpos, type IpoCandidate } from "@/lib/agents/ipoAgent";
import { parseIpoNotifyCandidates } from "@/lib/agents/ipoNotify";

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
  const ipoNotifyKey = process.env.IPO_NOTIFY_API_KEY;
  if (ipoNotifyKey) {
    try {
      const candidates = await loadIpoNotifyFeed(ipoNotifyKey);
      return { candidates, source: "IPO Notify" };
    } catch (error) {
      return {
        candidates: await readLocalFeed(),
        source: "local fallback",
        warning: error instanceof Error ? error.message : "IPO Notify is unavailable.",
      };
    }
  }

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
    warning: "Set IPO_NOTIFY_API_KEY for live open/upcoming IPO and subscription data.",
  };
}

async function loadIpoNotifyFeed(apiKey: string) {
  const statuses = ["open", "upcoming"] as const;
  const payloads = await Promise.all(statuses.map(async (status) => {
    const response = await fetch(`https://iponotify.me/api/ipo/${status}?limit=10`, {
      headers: { "X-API-KEY": apiKey },
      signal: AbortSignal.timeout(8_000),
      next: { revalidate: 900 },
    });
    if (!response.ok) {
      const message = await response.text().catch(() => "");
      throw new Error(`IPO Notify ${status} feed returned HTTP ${response.status}${message ? `: ${message.slice(0, 160)}` : ""}`);
    }
    return { status, payload: await response.json() as unknown };
  }));

  return payloads.flatMap(({ status, payload }) =>
    parseIpoNotifyCandidates(payload, status),
  );
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
