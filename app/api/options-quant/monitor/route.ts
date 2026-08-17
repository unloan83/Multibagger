import { monitorOptionsQuant } from "@/features/options-quant/api/monitor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  return monitorOptionsQuant(request);
}
