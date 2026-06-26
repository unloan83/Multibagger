import { PortfolioDashboard } from "@/components/portfolio-dashboard";
import { getCurrentSessionUser } from "@/lib/auth";
import { isGoogleSheetsConfigured, readPortfoliosFromSheets } from "@/lib/google-sheets";
import { readPortfoliosFromCsvBackup, shouldUsePortfolioCsvBackup } from "@/lib/portfolio-backup";
import { normalizePortfolioName } from "@/lib/users";
import { redirect } from "next/navigation";

export default async function PortfolioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const decodedId = decodeURIComponent(id);
  const user = await getCurrentSessionUser();

  if (!user) {
    redirect("/login");
  }

  if (user.role !== "admin" && !(await isMappedPortfolio(decodedId, user.portfolioName))) {
    redirect(user.portfolioName ? `/portfolio/${encodeURIComponent(user.portfolioName)}` : "/login");
  }

  return <PortfolioDashboard initialPortfolioId={decodedId} accountMode />;
}

async function isMappedPortfolio(routeKey: string, portfolioName?: string) {
  const normalizedName = normalizePortfolioName(portfolioName ?? "");
  if (!normalizedName) return false;
  if (normalizePortfolioName(routeKey) === normalizedName) return true;

  if (shouldUsePortfolioCsvBackup()) {
    const backupMatch = (await readPortfoliosFromCsvBackup()).some(
      (portfolio) =>
        portfolio.id === routeKey &&
        normalizePortfolioName(portfolio.name) === normalizedName,
    );
    if (backupMatch) return true;
  }

  if (!isGoogleSheetsConfigured()) return false;

  try {
    const portfolios = await readPortfoliosFromSheets();
    return portfolios.some(
      (portfolio) =>
        portfolio.id === routeKey &&
        normalizePortfolioName(portfolio.name) === normalizedName,
    );
  } catch {
    return false;
  }
}
