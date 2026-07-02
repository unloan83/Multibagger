import { NextResponse } from "next/server";
import { isRequestAuthenticated } from "@/lib/auth";
import {
  buildLearningRows,
  evaluateOutcome,
} from "@/lib/intelligence-validation";
import {
  isGoogleSheetsConfigured,
  readValidationRecords,
  updateValidationRecords,
  writeLearningRows,
} from "@/lib/google-sheets";
import { resolveQuotePositions } from "@/lib/quote-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await canRunValidation(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json({ error: "Google Sheets is not configured." }, { status: 503 });
  }

  const records = await readValidationRecords();
  const symbols = [...new Set(records.map((record) => record.symbol).filter(Boolean))];
  const positions = await resolveQuotePositions(
    symbols.map((symbol) => ({
      stockCode: symbol,
      company: symbol,
      stock: symbol,
      quantity: 0,
      list: "watchlist" as const,
    })),
  );
  const prices = Object.fromEntries(
    positions
      .filter((position) => position.currentPrice > 0)
      .map((position) => [position.symbol, position.currentPrice]),
  );
  const now = new Date();
  let updated = 0;
  const nextRecords = records.map((record) => {
    if (record.validationStatus === "Hit" || record.validationStatus === "Miss") {
      return record;
    }

    const currentPrice = prices[record.symbol] ?? record.actualPrice;
    const outcome = evaluateOutcome(record, currentPrice, now);
    updated += 1;

    return {
      ...record,
      actualPrice: currentPrice,
      validationStatus: outcome.status,
      validationDate: now.toISOString().slice(0, 10),
      returnPercent: outcome.returnPercent,
      hitTimestamp:
        outcome.status === "Hit" || outcome.status === "Miss"
          ? record.hitTimestamp || now.toISOString()
          : record.hitTimestamp,
    };
  });
  const learning = buildLearningRows(nextRecords, now);

  await updateValidationRecords(nextRecords);
  await writeLearningRows(learning);

  return NextResponse.json({
    ok: true,
    evaluated: updated,
    total: nextRecords.length,
    learningRows: learning.length,
    timestamp: now.toISOString(),
  });
}

async function canRunValidation(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") ?? "";
  if (cronSecret && authorization === `Bearer ${cronSecret}`) return true;
  if (!cronSecret && (request.headers.get("user-agent") ?? "").toLowerCase().includes("vercel-cron")) {
    return true;
  }
  return isRequestAuthenticated();
}
