import { handleUpstoxAction } from "@/features/upstox/api/action";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleUpstoxAction(request);
}
