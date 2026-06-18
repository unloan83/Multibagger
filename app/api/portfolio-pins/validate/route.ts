import { NextResponse } from "next/server";
import {
  createPortfolioAccessValue,
  portfolioAccessCookieName,
} from "@/lib/auth";
import {
  isGoogleSheetsConfigured,
  readPortfolioPinHashesFromSheets,
} from "@/lib/google-sheets";
import { validatePortfolioPinHash } from "@/lib/portfolio-pin-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    portfolioId?: string;
    pin?: unknown;
  };
  const portfolioId = String(body.portfolioId ?? "").trim();

  if (!portfolioId) {
    return NextResponse.json({ error: "Portfolio ID is required." }, { status: 400 });
  }

  const pinHashes = isGoogleSheetsConfigured()
    ? await readPortfolioPinHashesFromSheets()
    : {};
  const result = validatePortfolioPinHash({
    enteredPin: body.pin,
    portfolioId,
    storedHash: pinHashes[portfolioId]?.hash,
  });

  const response = NextResponse.json({
    ok: result.pinMatch,
    portfolioFound: true,
    pinMatch: result.pinMatch,
    usedMasterPin: result.usedMasterPin,
    hasStoredHash: Boolean(pinHashes[portfolioId]?.hash),
  });

  if (result.pinMatch) {
    response.cookies.set(
      portfolioAccessCookieName,
      createPortfolioAccessValue(portfolioId),
      {
        httpOnly: true,
        maxAge: 60 * 60 * 24 * 7,
        path: "/",
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      },
    );
  }

  return response;
}
