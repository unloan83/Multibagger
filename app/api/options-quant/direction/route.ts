import { updateOptionsQuantDirection } from "@/features/options-quant/api/direction";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return updateOptionsQuantDirection(request);
}
