import { NextResponse } from "next/server";
import {
  isGoogleSheetsConfigured,
  readCommunicationSettingsFromSheets,
  saveCommunicationSettingsToSheets,
  type CommunicationSettings,
} from "@/lib/google-sheets";

export const runtime = "nodejs";

export async function GET() {
  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json({ configured: false, settings: {} });
  }

  const settings = await readCommunicationSettingsFromSheets();
  return NextResponse.json({ configured: true, settings });
}

export async function PUT(request: Request) {
  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json({ error: "Google Sheets is not configured." }, { status: 503 });
  }

  const body = (await request.json()) as { settings?: CommunicationSettings };

  if (!body.settings?.portfolioId) {
    return NextResponse.json({ error: "Portfolio settings are required." }, { status: 400 });
  }

  await saveCommunicationSettingsToSheets(body.settings);
  return NextResponse.json({ ok: true });
}
