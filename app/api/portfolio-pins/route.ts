import { NextResponse } from "next/server";
import { isRequestAuthenticated } from "@/lib/auth";
import {
  isGoogleSheetsConfigured,
  readPortfolioPinHashesFromSheets,
  savePortfolioPinHashToSheets,
} from "@/lib/google-sheets";

export const runtime = "nodejs";

export async function GET() {
  if (!(await isRequestAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json({ configured: false, pinHashes: {} });
  }

  const pinHashes = await readPortfolioPinHashesFromSheets();

  return NextResponse.json({ configured: true, pinHashes });
}

export async function PUT(request: Request) {
  if (!(await isRequestAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json(
      { error: "Google Sheets is not configured." },
      { status: 503 },
    );
  }

  const body = (await request.json()) as {
    portfolioId?: string;
    pinHash?: string;
  };
  const portfolioId = String(body.portfolioId ?? "").trim();
  const pinHash = String(body.pinHash ?? "").trim();

  if (!portfolioId || !/^[a-f0-9]{64}$/iu.test(pinHash)) {
    return NextResponse.json(
      { error: "Portfolio ID and valid PIN hash are required." },
      { status: 400 },
    );
  }

  await savePortfolioPinHashToSheets({ portfolioId, pinHash });

  return NextResponse.json({ ok: true });
}
