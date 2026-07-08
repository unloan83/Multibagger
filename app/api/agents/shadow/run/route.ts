import { NextResponse } from "next/server";
import { buildAgentValidationReport } from "@/lib/agents/agentValidation";
import {
  readAgentRecommendationLogs,
} from "@/lib/agents/googleLogStore";
import { runMultiAgentRecommendationSystem } from "@/lib/agents/service";
import { appendAgentValidationReport } from "@/lib/agents/validationLogStore";
import { isAdminRequest } from "@/lib/auth";
import {
  isGoogleSheetsConfigured,
  readPortfoliosFromSheets,
  readValidationRecords,
} from "@/lib/google-sheets";
import { buildMarketOverview } from "@/lib/market-overview";
import { resolveQuotePositions } from "@/lib/quote-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!(await canRunShadowCron(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json({ error: "Google Sheets is not configured." }, { status: 503 });
  }

  const startedAt = new Date().toISOString();
  const [storedPortfolios, market, history] = await Promise.all([
    readPortfoliosFromSheets(),
    buildMarketOverview(),
    readValidationRecords(),
  ]);
  const portfolios = storedPortfolios.filter((portfolio) => portfolio.inputs.length > 0);
  const results: Array<{
    portfolioId: string;
    recommendations: number;
    promotionStatus: string;
  }> = [];
  const failures: Array<{ portfolioId: string; error: string }> = [];

  for (const storedPortfolio of portfolios) {
    try {
      const positions = await resolveQuotePositions(storedPortfolio.inputs);
      if (!positions.some((position) => position.currentPrice > 0)) {
        failures.push({
          portfolioId: storedPortfolio.id,
          error: "No current prices were available.",
        });
        continue;
      }
      const portfolio = {
        ...storedPortfolio,
        positions,
        refreshedAt: new Date().toISOString(),
      };
      const output = await runMultiAgentRecommendationSystem({
        portfolio,
        market,
        history,
        persist: true,
      });
      const logs = (await readAgentRecommendationLogs()).filter(
        (log) => log.portfolioId === portfolio.id,
      );
      const report = buildAgentValidationReport({
        output,
        portfolio,
        history: history.filter((record) => record.portfolioId === portfolio.id),
        logs,
      });
      await appendAgentValidationReport(report);
      results.push({
        portfolioId: portfolio.id,
        recommendations: output.recommendations.length,
        promotionStatus: report.promotionGate.status,
      });
    } catch (error) {
      failures.push({
        portfolioId: storedPortfolio.id,
        error: error instanceof Error ? error.message : "Shadow run failed.",
      });
    }
  }

  return NextResponse.json({
    ok: failures.length === 0,
    mode: "shadow",
    startedAt,
    completedAt: new Date().toISOString(),
    portfoliosAttempted: portfolios.length,
    portfoliosCompleted: results.length,
    results,
    failures,
  });
}

async function canRunShadowCron(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") ?? "";
  if (cronSecret && authorization === `Bearer ${cronSecret}`) return true;
  if (!cronSecret && (request.headers.get("user-agent") ?? "").toLowerCase().includes("vercel-cron")) {
    return true;
  }
  return isAdminRequest();
}
