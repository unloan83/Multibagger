import { GET as runDailyTelegram } from "@/app/api/communication/telegram/daily/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  return runDailyTelegram(request);
}
