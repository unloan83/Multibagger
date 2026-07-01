import { NextResponse } from "next/server";
import { buildAgentValidationReport } from "@/lib/agents/agentValidation";
import { readAgentRecommendationLogs } from "@/lib/agents/googleLogStore";
import { runMultiAgentRecommendationSystem } from "@/lib/agents/service";
import {
  appendAgentValidationReport,
  readRecentAgentValidationReports,
} from "@/lib/agents/validationLogStore";
import { isAdminRequest, isAuthConfigured } from "@/lib/auth";
import {
  isGoogleSheetsConfigured,
  readPortfoliosFromSheets,
  readValidationRecords,
} from "@/lib/google-sheets";
import { buildMarketOverview } from "@/lib/market-overview";
import { identifySector, type PortfolioPosition } from "@/lib/portfolio";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const portfolioId = new URL(request.url).searchParams.get("portfolioId")?.trim() ?? "";
  const storedReports = await readRecentAgentValidationReports(50);
  const recentReports = portfolioId
    ? storedReports.filter((report) => report.portfolioId === portfolioId).slice(0, 10)
    : storedReports.slice(0, 10);
  const checks = [
    {
      id: "admin-auth",
      label: "Admin authentication",
      configured: isAuthConfigured(),
      requiredAccess: "A LiveUnloan admin session and the shared session secret",
      impact: "Admin-only shadow controls are not protected in a deployed environment.",
    },
    {
      id: "validation-store",
      label: "Google Sheets validation store",
      configured: isGoogleSheetsConfigured(),
      requiredAccess: "GOOGLE_SHEETS_SPREADSHEET_ID and Google service-account credentials",
      impact: "Shadow recommendations, validation runs, and horizon outcomes cannot be persisted.",
    },
    {
      id: "intelligence-feed",
      label: "Trusted market intelligence feed",
      configured: Boolean(process.env.MARKET_INTELLIGENCE_FEED_URL?.trim()),
      requiredAccess: "MARKET_INTELLIGENCE_FEED_URL pointing to a trusted portfolio-agnostic feed",
      impact: "Official filings, policy, macro, and attributed sentiment coverage will remain incomplete.",
    },
  ];
  return NextResponse.json({
    readyToRun: checks.find((check) => check.id === "validation-store")?.configured ?? false,
    readyForPromotionEvidence: checks.every((check) => check.configured),
    mode: "shadow",
    checks,
    report: recentReports[0] ?? null,
    recentReports,
  }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: Request) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json({ error: "Persistent validation storage is not configured." }, { status: 503 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    portfolioId?: string;
    positions?: PortfolioPosition[];
    costBasis?: Array<{ symbol?: string; buyPrice?: number }>;
  };
  const portfolioId = String(body.portfolioId ?? "").trim();
  if (!portfolioId) {
    return NextResponse.json({ error: "Portfolio ID is required." }, { status: 400 });
  }

  const portfolios = await readPortfoliosFromSheets();
  const storedPortfolio = portfolios.find((item) => item.id === portfolioId);
  if (!storedPortfolio) {
    return NextResponse.json({ error: "Portfolio not found." }, { status: 404 });
  }
  const postedPositions = Array.isArray(body.positions)
    ? body.positions.filter((position): position is PortfolioPosition =>
        Boolean(position && typeof position === "object"),
      )
    : [];
  const positions = storedPortfolio.inputs.flatMap((input) => {
    const posted = postedPositions.find(
      (position) => normalize(position.symbol) === normalize(input.stockCode),
    );
    if (!posted) return [];
    return [{
      list: input.list,
      stock: input.stock,
      symbol: normalize(input.stockCode),
      company: input.company,
      sector: identifySector(
        input.stockCode,
        input.company,
        cleanText(posted.sector, 80) || "Unclassified",
      ),
      quantity: input.quantity,
      currentPrice: finiteNumber(posted.currentPrice),
      previousClose: finiteNumber(posted.previousClose),
      volume: finiteNumber(posted.volume),
      bars: (Array.isArray(posted.bars) ? posted.bars : []).slice(-250).flatMap((bar) =>
        [bar.close, bar.high, bar.low, bar.volume].every(Number.isFinite)
          ? [{ close: bar.close, high: bar.high, low: bar.low, volume: bar.volume }]
          : [],
      ),
      newsHeadlines: (Array.isArray(posted.newsHeadlines) ? posted.newsHeadlines : [])
        .slice(0, 10)
        .map((headline) => cleanText(headline, 500))
        .filter(Boolean),
      currency: "INR" as const,
    }];
  });
  if (!positions.length) {
    return NextResponse.json(
      { error: "A current admin portfolio snapshot is required for shadow validation." },
      { status: 400 },
    );
  }
  const costBasis = Array.isArray(body.costBasis) ? body.costBasis : [];
  const portfolio = {
    ...storedPortfolio,
    inputs: storedPortfolio.inputs.map((input) => {
      const submitted = costBasis.find(
        (item) => normalize(item?.symbol) === normalize(input.stockCode),
      );
      return { ...input, buyPrice: finiteNumber(submitted?.buyPrice) || input.buyPrice };
    }),
    positions,
  };
  const [market, history] = await Promise.all([
    buildMarketOverview(),
    readValidationRecords(),
  ]);
  const output = await runMultiAgentRecommendationSystem({
    portfolio,
    market,
    history,
    persist: true,
  });
  const logs = (await readAgentRecommendationLogs()).filter(
    (log) => log.portfolioId === portfolioId,
  );
  const report = buildAgentValidationReport({
    output,
    portfolio,
    history: history.filter((record) => record.portfolioId === portfolioId),
    logs,
  });
  await appendAgentValidationReport(report);
  const recentReports = await readRecentAgentValidationReports(10);

  return NextResponse.json({ report, recentReports }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalize(symbol: unknown) {
  return String(symbol ?? "").trim().toUpperCase().replace(/\.(NS|BO)$/u, "");
}
