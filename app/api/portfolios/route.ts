import { NextResponse } from "next/server";
import {
  isGoogleSheetsConfigured,
  readPortfoliosFromSheets,
  savePortfolioToSheets,
} from "@/lib/google-sheets";
import { isRequestAuthenticated } from "@/lib/auth";
import type { ManagedPortfolio } from "@/lib/portfolio";

export const runtime = "nodejs";

export async function GET() {
  if (!(await isRequestAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json({ configured: false, portfolios: [] });
  }

  const portfolios = await readPortfoliosFromSheets();
  return NextResponse.json({ configured: true, portfolios });
}

export async function POST(request: Request) {
  if (!(await isRequestAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json(
      { error: "Google Sheets is not configured." },
      { status: 503 },
    );
  }

  const body = (await request.json()) as { portfolio?: ManagedPortfolio };

  if (!body.portfolio) {
    return NextResponse.json({ error: "Portfolio is required." }, { status: 400 });
  }

  await savePortfolioToSheets(body.portfolio);
  return NextResponse.json({ ok: true });
}
