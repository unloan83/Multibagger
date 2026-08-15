import { getUpstoxRecommendations, updateUpstoxRecommendations } from "@/features/upstox/api/recommendations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return getUpstoxRecommendations();
}

export async function POST(request: Request) {
  return updateUpstoxRecommendations(request);
}
