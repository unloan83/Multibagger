import { getCurrentSessionUser } from "@/lib/auth";
import { normalizePortfolioName } from "@/lib/account-utils";
import { isGoogleSheetsConfigured, readPortfoliosFromSheets } from "@/lib/google-sheets";
import { readPortfoliosFromCsvBackup, shouldUsePortfolioCsvBackup } from "@/lib/portfolio-backup";
import { redirect } from "next/navigation";

export default async function Home() {
  const user = await getCurrentSessionUser();

  if (!user) {
    redirect("/login");
  }

  const routeKey = await resolvePortfolioRouteKey(user.portfolioName ?? "");

  if (routeKey) {
    redirect(`/portfolio/${encodeURIComponent(routeKey)}`);
  }

  return (
    <main className="min-h-screen bg-background">
      <section className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center gap-5 px-5 text-center">
        <div className="terminal-panel rounded-2xl border border-sky-400/20 px-6 py-8 shadow-[0_24px_80px_rgba(0,0,0,0.34)]">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#1E88E5]">UNLOAN STOCK PLANNER</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-normal text-white">No portfolio is mapped to this profile.</h1>
          <p className="mt-3 text-base leading-7 text-slate-300">Please contact admin.</p>
        </div>
      </section>
    </main>
  );
}

async function resolvePortfolioRouteKey(portfolioName: string) {
  const normalizedTarget = normalizePortfolioName(portfolioName);
  if (!normalizedTarget) return "";

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
