import { NextResponse } from "next/server";
import { buildMarketOverview } from "@/lib/market-overview";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await buildMarketOverview());
}
