import { NextResponse } from "next/server";
import { canAccessPortfolio, isRequestAuthenticated } from "@/lib/auth";
import { buildIntelligenceSummary } from "@/lib/intelligence-validation";
import { buildExpertActionMatrix } from "@/lib/expert-insights";
import {
  isGoogleSheetsConfigured,
  readValidationRecords,
} from "@/lib/google-sheets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json({ error: "Google Sheets is not configured." }, { status: 503 });
  }

  const url = new URL(request.url);
  const portfolioId = url.searchParams.get("portfolioId")?.trim() ?? "";
  const isAdmin = await isRequestAuthenticated();

  if (!isAdmin) {
    if (!portfolioId || !(await canAccessPortfolio(portfolioId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const records = await readValidationRecords();
  const summary = buildIntelligenceSummary(records, isAdmin && !portfolioId ? undefined : portfolioId);

  if (!isAdmin) {
    return NextResponse.json({
      role: "user",
      portfolioId,
      summary: {
        last7Days: summary.last7Days,
        last30Days: summary.last30Days,
        recent: summary.recent.map((record) => ({
          recommendationId: record.recommendationId,
          timestamp: record.timestamp,
          symbol: record.symbol,
          action: record.action,
          predictedPrice: record.predictedPrice,
          targetPrice: record.targetPrice,
          actualPrice: record.actualPrice,
          validationStatus: record.validationStatus,
          returnPercent: record.returnPercent,
        })),
      },
    });
  }

  const matrix = await buildExpertActionMatrix();

  return NextResponse.json({
    role: "admin",
    portfolioId: portfolioId || null,
    summary,
    recommendationIntelligence: {
      review: matrix.intelligenceReview ?? null,
      recommendations: matrix.categories.flatMap((category) =>
        [...category.longTermUpsides, ...category.intradayBreakouts].map(
          (quote) => ({
            symbol: quote.symbol,
            category: category.title,
            action: quote.action,
            score: quote.score,
            explanation: quote.intelligence?.reasons ?? quote.reasons,
            factorWeights: quote.intelligence?.factorWeights ?? null,
            factorContributions: quote.intelligence?.contributions ?? null,
            sectorScore: quote.intelligence?.sectorDirectionScore ?? null,
            sectorPolicyScore: quote.intelligence?.sectorPolicyScore ?? null,
            learningAdjustment: quote.intelligence?.learningAdjustment ?? null,
            sentimentScore: quote.intelligence?.sentimentScore ?? null,
            expertFocusCount: quote.intelligence?.expertFocusCount ?? 0,
          }),
        ),
      ),
    },
  });
}
