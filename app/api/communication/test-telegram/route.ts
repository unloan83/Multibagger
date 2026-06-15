import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    telegramUserId?: string;
    securePasskey?: string;
  };
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!body.telegramUserId || !body.securePasskey) {
    return NextResponse.json(
      { ok: false, status: "Missing Telegram User ID or secure passkey." },
      { status: 400 },
    );
  }

  if (!botToken) {
    return NextResponse.json({
      ok: false,
      status: "Telegram bot token not configured.",
    });
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: body.telegramUserId,
      text: "UNLOAN Telegram alerts are connected.",
    }),
  });

  return NextResponse.json({
    ok: response.ok,
    status: response.ok ? "Connected" : `Telegram returned ${response.status}.`,
  });
}
