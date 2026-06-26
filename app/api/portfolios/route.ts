import { NextResponse } from "next/server";
import {
  isGoogleSheetsConfigured,
  readPortfoliosFromSheets,
  savePortfolioToSheets,
  testGoogleSheetsConnection,
} from "@/lib/google-sheets";
import { isAdminRequest } from "@/lib/auth";
import { readPortfoliosFromCsvBackup, shouldUsePortfolioCsvBackup } from "@/lib/portfolio-backup";
import { isActivePortfolioName } from "@/lib/users";
import type { ManagedPortfolio } from "@/lib/portfolio";

export const runtime = "nodejs";

export async function GET() {
  if (shouldUsePortfolioCsvBackup()) {
    const backupPortfolios = (await readPortfoliosFromCsvBackup()).filter((portfolio) =>
      isActivePortfolioName(portfolio.name),
    );

    if (backupPortfolios.length > 0) {
      return NextResponse.json({
        configured: true,
        portfolios: backupPortfolios,
        source: "csv-backup",
      });
    }
  }

  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json({ configured: false, portfolios: [], source: "none" });
  }

  try {
    const portfolios = (await readPortfoliosFromSheets()).filter((portfolio) =>
      isActivePortfolioName(portfolio.name),
    );
    return NextResponse.json({ configured: true, portfolios, source: "google-sheets" });
  } catch {
    const status = await testGoogleSheetsConnection();
    return NextResponse.json(
      {
        configured: true,
        portfolios: [],
        error: status.message,
        source: "google-sheets",
        status: status.status,
      },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  if (!(await isAdminRequest())) {
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
