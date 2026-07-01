import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  appendNotificationHistoryToSheets,
  isGoogleSheetsConfigured,
  readCommunicationSettingsFromSheets,
  readPortfoliosFromSheets,
  readValidationRecords,
  saveCommunicationSettingsToSheets,
} from "@/lib/google-sheets";
import {
  buildDailyTelegramDigest,
  getTelegramBotToken,
  sendTelegramMessage,
} from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!canRunCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json({ error: "Google Sheets is not configured." }, { status: 503 });
  }
  if (!getTelegramBotToken()) {
    return NextResponse.json({ error: "TELEGRAM_TOKEN is not configured." }, { status: 503 });
  }

  const [settingsByPortfolio, portfolios, validation] = await Promise.all([
    readCommunicationSettingsFromSheets(),
    readPortfoliosFromSheets(),
    readValidationRecords(),
  ]);
  const enabled = Object.values(settingsByPortfolio).filter(
    (settings) =>
      settings.telegramEnabled &&
      settings.telegramConnected &&
      settings.telegramUserId,
  );
  const now = new Date();
  const timestamp = now.toISOString();
  const date = istDateKey(now);
  const dateLabel = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeZone: "Asia/Kolkata",
  }).format(now);
  const results: Array<{ portfolioId: string; status: "delivered" | "failed"; detail: string }> = [];

  for (const settings of enabled) {
    const portfolio = portfolios.find((item) => item.id === settings.portfolioId);
    const records = validation.filter(
      (record) =>
        record.portfolioId === settings.portfolioId &&
        record.date === date,
    );
    let status: "delivered" | "failed" = "delivered";
    let detail = "Daily portfolio digest delivered.";
    try {
      await sendTelegramMessage({
        chatId: settings.telegramUserId,
        text: buildDailyTelegramDigest({
          portfolioName: portfolio?.name ?? settings.portfolioId,
          records,
          dateLabel,
        }),
      });
    } catch (error) {
      status = "failed";
      detail = error instanceof Error ? error.message : "Telegram delivery failed.";
    }
    await saveCommunicationSettingsToSheets({
      ...settings,
      connectionStatus: status === "delivered" ? "Connected" : `Delivery failed: ${detail}`,
      lastNotification: timestamp,
      lastSuccessfulDelivery:
        status === "delivered" ? timestamp : settings.lastSuccessfulDelivery,
      updatedAt: timestamp,
    });
    await appendNotificationHistoryToSheets({
      id: randomUUID(),
      portfolioId: settings.portfolioId,
      createdAt: timestamp,
      alertType: "Daily Portfolio Digest",
      status: status === "delivered" ? "Delivered" : "Failed",
      detail,
    });
    results.push({ portfolioId: settings.portfolioId, status, detail });
  }

  return NextResponse.json({
    ok: results.every((result) => result.status === "delivered"),
    date,
    attempted: enabled.length,
    delivered: results.filter((result) => result.status === "delivered").length,
    failed: results.filter((result) => result.status === "failed").length,
    results,
  });
}

function canRunCron(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") ?? "";
  if (secret) return authorization === `Bearer ${secret}`;
  return (request.headers.get("user-agent") ?? "").toLowerCase().includes("vercel-cron");
}

function istDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
