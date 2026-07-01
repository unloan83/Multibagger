import { NextResponse } from "next/server";
import {
  isGoogleSheetsConfigured,
  readNotificationHistoryFromSheets,
} from "@/lib/google-sheets";
import { canAccessPortfolio } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json({ configured: false, history: [] });
  }

  const url = new URL(request.url);
  const portfolioId = url.searchParams.get("portfolioId") ?? undefined;
  if (!portfolioId) {
    return NextResponse.json({ error: "Portfolio ID is required." }, { status: 400 });
  }
  if (!(await canAccessPortfolio(portfolioId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const history = await readNotificationHistoryFromSheets(portfolioId);

  return NextResponse.json({ configured: true, history });
}
