import { handleUpstoxCallback } from "@/features/upstox/api/callback";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleUpstoxCallback(request);
}
