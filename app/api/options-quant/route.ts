import { getOptionsQuantDashboard } from "@/features/options-quant/api/dashboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return getOptionsQuantDashboard();
}
