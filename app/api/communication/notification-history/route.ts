import { NextResponse } from "next/server";
import {
  isGoogleSheetsConfigured,
  readNotificationHistoryFromSheets,
} from "@/lib/google-sheets";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json({ configured: false, history: [] });
  }

  const url = new URL(request.url);
  const portfolioId = url.searchParams.get("portfolioId") ?? undefined;
  const history = await readNotificationHistoryFromSheets(portfolioId);

  return NextResponse.json({ configured: true, history });
}
