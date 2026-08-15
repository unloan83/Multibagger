import { scanOptionsQuant } from "@/features/options-quant/api/scan";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return scanOptionsQuant(request);
}
