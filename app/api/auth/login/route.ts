import { NextResponse } from "next/server";
import { setSessionCookie, validateCredentials } from "@/lib/auth";
import { isGoogleSheetsConfigured, readPortfoliosFromSheets } from "@/lib/google-sheets";
import { readPortfoliosFromCsvBackup, shouldUsePortfolioCsvBackup } from "@/lib/portfolio-backup";
import { normalizePortfolioName } from "@/lib/account-utils";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    email?: string;
    username?: string;
    password?: string;
  };
  const email = body.email ?? body.username ?? "";
  const user = await validateCredentials(email, body.password ?? "");

  if (!user) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }

  await setSessionCookie(user);

  const redirectTo =
    user.role === "admin"
      ? "/admin"
      : `/portfolio/${encodeURIComponent(await resolvePortfolioRouteKey(user.portfolioName ?? ""))}`;

  return NextResponse.json({
    ok: true,
    redirectTo,
    user: {
      displayName: user.displayName,
      email: user.email,
      role: user.role,
      portfolioName: user.portfolioName,
    },
  });
}

async function resolvePortfolioRouteKey(portfolioName: string) {
  const normalizedTarget = normalizePortfolioName(portfolioName);
  if (!normalizedTarget) return portfolioName;

  if (shouldUsePortfolioCsvBackup()) {
    const backupMatch = (await readPortfoliosFromCsvBackup()).find(
      (portfolio) => normalizePortfolioName(portfolio.name) === normalizedTarget,
    );
    if (backupMatch) return backupMatch.id;
  }

  if (!isGoogleSheetsConfigured()) return portfolioName;

  try {
    const portfolios = await readPortfoliosFromSheets();
    const matched = portfolios.find(
      (portfolio) => normalizePortfolioName(portfolio.name) === normalizedTarget,
    );
    return matched?.id ?? portfolioName;
  } catch {
    return portfolioName;
  }
}
