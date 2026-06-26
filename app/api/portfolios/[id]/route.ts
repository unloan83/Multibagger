import { NextResponse } from "next/server";
import {
  deletePortfolioFromSheets,
  isGoogleSheetsConfigured,
  savePortfolioToSheets,
} from "@/lib/google-sheets";
import { isAdminRequest } from "@/lib/auth";
import type { ManagedPortfolio } from "@/lib/portfolio";

export const runtime = "nodejs";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json(
      { error: "Google Sheets is not configured." },
      { status: 503 },
    );
  }

  const { id } = await params;
  const body = (await request.json()) as { portfolio?: ManagedPortfolio };

  if (!body.portfolio || body.portfolio.id !== id) {
    return NextResponse.json({ error: "Portfolio mismatch." }, { status: 400 });
  }

  await savePortfolioToSheets(body.portfolio);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json(
      { error: "Google Sheets is not configured." },
      { status: 503 },
    );
  }

  const { id } = await params;
  await deletePortfolioFromSheets(id);
  return NextResponse.json({ ok: true });
}
