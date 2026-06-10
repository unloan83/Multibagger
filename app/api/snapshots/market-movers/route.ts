import { NextResponse } from "next/server";
import { isRequestAuthenticated } from "@/lib/auth";
import {
  appendMarketMoverRows,
  isGoogleSheetsConfigured,
  type MarketMoverRow,
} from "@/lib/google-sheets";
import { buildMarketOverview } from "@/lib/market-overview";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await canRunSnapshot(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json(
      { error: "Google Sheets is not configured." },
      { status: 503 },
    );
  }

  const timestamp = new Date().toISOString();
  const overview = await buildMarketOverview();
  const rows: MarketMoverRow[] = overview.moverGroups.flatMap((group) => [
    ...group.gainers.map((quote) => ({
      timestamp,
      segment: group.segment,
      category: "gainer" as const,
      quote,
    })),
    ...group.losers.map((quote) => ({
      timestamp,
      segment: group.segment,
      category: "loser" as const,
      quote,
    })),
  ]);

  await appendMarketMoverRows(rows);

  return NextResponse.json({
    ok: true,
    appended: rows.length,
    sentiment: overview.sentiment,
    timestamp,
  });
}

async function canRunSnapshot(request: Request) {
  if (await isRequestAuthenticated()) {
    return true;
  }

  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") ?? "";

  if (cronSecret) {
    return authorization === `Bearer ${cronSecret}`;
  }

  return (request.headers.get("user-agent") ?? "").toLowerCase().includes("vercel-cron");
}
