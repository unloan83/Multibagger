import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { canAccessPortfolio } from "@/lib/auth";
import {
  appendNotificationHistoryToSheets,
  isGoogleSheetsConfigured,
  readCommunicationSettingsFromSheets,
  saveCommunicationSettingsToSheets,
} from "@/lib/google-sheets";
import {
  protectTelegramBotToken,
  resolveTelegramBotToken,
  sendTelegramMessage,
} from "@/lib/telegram";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    portfolioId?: string;
    securePasskey?: string;
  };
  const portfolioId = String(body.portfolioId ?? "").trim();
  if (!portfolioId) {
    return NextResponse.json(
      { ok: false, status: "Save settings before testing Telegram." },
      { status: 400 },
    );
  }
  if (!(await canAccessPortfolio(portfolioId))) {
    return NextResponse.json({ ok: false, status: "Forbidden" }, { status: 403 });
  }
  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json(
      { ok: false, status: "Google Sheets is not configured." },
      { status: 503 },
    );
  }
  const allSettings = await readCommunicationSettingsFromSheets();
  let settings = allSettings[portfolioId];
  if (!settings?.telegramUserId) {
    return NextResponse.json(
      { ok: false, status: "Telegram settings must be saved before testing." },
      { status: 400 },
    );
  }
  const suppliedToken = String(body.securePasskey ?? "").trim();
  if (suppliedToken) {
    try {
      settings = {
        ...settings,
        securePasskey: protectTelegramBotToken(suppliedToken),
        telegramConnected: false,
        connectionStatus: "Testing connection",
      };
      await saveCommunicationSettingsToSheets(settings);
    } catch (error) {
      return NextResponse.json(
        { ok: false, status: error instanceof Error ? error.message : "Invalid Telegram bot token." },
        { status: 400 },
      );
    }
  }
  const botToken = resolveTelegramBotToken(settings.securePasskey);
  if (!botToken) {
    return NextResponse.json(
      { ok: false, status: "Enter and save a Telegram bot token, or configure TELEGRAM_TOKEN in production." },
      { status: 400 },
    );
  }

  const attemptedAt = new Date().toISOString();
  let ok = false;
  let status = "Connected";
  try {
    await sendTelegramMessage({
      chatId: settings.telegramUserId,
      botToken,
      text: [
        "UNLOAN Stock Planner alerts are connected.",
        "Your weekday portfolio digest is scheduled for 10:15 AM IST.",
        "",
        "AI-assisted market analysis, not certified investment advice. Please verify before acting.",
      ].join("\n"),
    });
    ok = true;
  } catch (error) {
    status = error instanceof Error ? error.message : "Telegram connection failed.";
  }
  await saveCommunicationSettingsToSheets({
    ...settings,
    telegramConnected: ok,
    connectionStatus: ok ? "Connected" : status,
    lastNotification: attemptedAt,
    lastSuccessfulDelivery: ok ? attemptedAt : settings.lastSuccessfulDelivery,
    updatedAt: attemptedAt,
  });
  await appendNotificationHistoryToSheets({
    id: randomUUID(),
    portfolioId,
    createdAt: attemptedAt,
    alertType: "Telegram Connection Test",
    status: ok ? "Delivered" : "Failed",
    detail: ok ? "Connection test delivered." : status,
  });

  return NextResponse.json({ ok, status: ok ? "Connected" : status }, { status: ok ? 200 : 502 });
}
