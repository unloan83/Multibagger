import { getUpstoxPaperTrades, updateUpstoxPaperTrades } from "@/features/upstox/api/paper-trades";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return getUpstoxPaperTrades();
}

export async function POST(request: Request) {
  return updateUpstoxPaperTrades(request);
}
