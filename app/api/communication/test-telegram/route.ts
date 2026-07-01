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
  getTelegramBotToken,
  sendTelegramMessage,
  verifyTelegramPasskey,
} from "@/lib/telegram";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    portfolioId?: string;
    securePasskey?: string;
  };
  const portfolioId = String(body.portfolioId ?? "").trim();
  if (!portfolioId || !body.securePasskey) {
    return NextResponse.json(
      { ok: false, status: "Save settings, then enter the connection passkey to test." },
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
  if (!getTelegramBotToken()) {
    return NextResponse.json(
      { ok: false, status: "TELEGRAM_TOKEN is not configured in Multibagger production." },
      { status: 503 },
    );
  }

  const settings = (await readCommunicationSettingsFromSheets())[portfolioId];
  if (!settings?.telegramUserId || !settings.securePasskey) {
    return NextResponse.json(
      { ok: false, status: "Telegram settings must be saved before testing." },
      { status: 400 },
    );
  }
  if (!verifyTelegramPasskey(body.securePasskey, settings.securePasskey)) {
    return NextResponse.json(
      { ok: false, status: "Connection passkey is incorrect. Save a new passkey and retry." },
      { status: 403 },
    );
  }

  const attemptedAt = new Date().toISOString();
  let ok = false;
  let status = "Connected";
  try {
    await sendTelegramMessage({
      chatId: settings.telegramUserId,
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
