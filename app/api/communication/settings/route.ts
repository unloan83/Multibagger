import { NextResponse } from "next/server";
import {
  isGoogleSheetsConfigured,
  readCommunicationSettingsFromSheets,
  saveCommunicationSettingsToSheets,
  type CommunicationSettings,
  type NotificationMode,
} from "@/lib/google-sheets";
import { canAccessPortfolio } from "@/lib/auth";
import {
  hashTelegramPasskey,
  isValidTelegramChatId,
} from "@/lib/telegram";

export const runtime = "nodejs";

const notificationModes = new Set<NotificationMode>([
  "Immediate Alerts",
  "Daily Summary",
  "Weekly Summary",
  "Critical Alerts Only",
]);

export async function GET(request: Request) {
  const portfolioId = new URL(request.url).searchParams.get("portfolioId")?.trim() ?? "";
  if (!portfolioId) {
    return NextResponse.json({ error: "Portfolio ID is required." }, { status: 400 });
  }
  if (!(await canAccessPortfolio(portfolioId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json({ configured: false, settings: {} });
  }

  const stored = (await readCommunicationSettingsFromSheets())[portfolioId];
  if (!stored) {
    return NextResponse.json({ configured: true, settings: {} });
  }
  return NextResponse.json({
    configured: true,
    settings: {
      [portfolioId]: {
        ...stored,
        securePasskey: "",
        hasSecurePasskey: Boolean(stored.securePasskey),
      },
    },
  }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function PUT(request: Request) {
  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json({ error: "Google Sheets is not configured." }, { status: 503 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    settings?: Partial<CommunicationSettings>;
  };
  const portfolioId = String(body.settings?.portfolioId ?? "").trim();
  if (!portfolioId) {
    return NextResponse.json({ error: "Portfolio settings are required." }, { status: 400 });
  }
  if (!(await canAccessPortfolio(portfolioId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const allSettings = await readCommunicationSettingsFromSheets();
  const existing = allSettings[portfolioId];
  const telegramUserId = String(body.settings?.telegramUserId ?? "").trim();
  const suppliedPasskey = String(body.settings?.securePasskey ?? "").trim();
  if (telegramUserId && !isValidTelegramChatId(telegramUserId)) {
    return NextResponse.json(
      { error: "Enter the numeric Telegram chat ID, not a Telegram username." },
      { status: 400 },
    );
  }
  let securePasskey = existing?.securePasskey ?? "";
  try {
    if (suppliedPasskey) {
      securePasskey = hashTelegramPasskey(suppliedPasskey);
    } else if (securePasskey && !securePasskey.startsWith("scrypt$")) {
      securePasskey = hashTelegramPasskey(securePasskey);
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid connection passkey." },
      { status: 400 },
    );
  }
  const connectionChanged =
    telegramUserId !== (existing?.telegramUserId ?? "") ||
    Boolean(suppliedPasskey);
  const mode = body.settings?.notificationMode;
  const settings: CommunicationSettings = {
    portfolioId,
    telegramEnabled: Boolean(body.settings?.telegramEnabled),
    telegramUserId,
    securePasskey,
    notificationMode: mode && notificationModes.has(mode) ? mode : "Daily Summary",
    alertTypes: Array.isArray(body.settings?.alertTypes)
      ? body.settings.alertTypes.map(String).slice(0, 10)
      : [],
    telegramConnected: connectionChanged ? false : Boolean(existing?.telegramConnected),
    connectionStatus: connectionChanged
      ? "Saved — test connection required"
      : existing?.connectionStatus ?? "Not Connected",
    lastNotification: existing?.lastNotification ?? "",
    lastSuccessfulDelivery: existing?.lastSuccessfulDelivery ?? "",
    updatedAt: new Date().toISOString(),
  };

  await saveCommunicationSettingsToSheets(settings);
  return NextResponse.json({
    ok: true,
    settings: {
      ...settings,
      securePasskey: "",
      hasSecurePasskey: Boolean(settings.securePasskey),
    },
  });
}
