import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type { ValidationRecord } from "@/lib/intelligence-validation";

const passkeyPrefix = "scrypt";

export function getTelegramBotToken() {
  return process.env.TELEGRAM_TOKEN?.trim() || process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
}

export function isValidTelegramChatId(value: string) {
  return /^-?\d{5,20}$/u.test(value.trim());
}

export function hashTelegramPasskey(passkey: string) {
  const value = passkey.trim();
  if (value.length < 8) throw new Error("Connection passkey must be at least 8 characters.");
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(value, salt, 32).toString("hex");
  return `${passkeyPrefix}$${salt}$${hash}`;
}

export function verifyTelegramPasskey(passkey: string, stored: string) {
  const [prefix, salt, expectedHex] = stored.split("$");
  if (prefix !== passkeyPrefix || !salt || !expectedHex) return false;
  const supplied = scryptSync(passkey.trim(), salt, 32);
  const expected = Buffer.from(expectedHex, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function sendTelegramMessage({
  chatId,
  text,
}: {
  chatId: string;
  text: string;
}) {
  const botToken = getTelegramBotToken();
  if (!botToken) throw new Error("Telegram bot token is not configured.");
  if (!isValidTelegramChatId(chatId)) throw new Error("Telegram chat ID is invalid.");

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId.trim(),
      text: text.slice(0, 4_000),
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({})) as {
    description?: string;
    ok?: boolean;
  };
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.description || `Telegram returned HTTP ${response.status}.`);
  }
}

export function buildDailyTelegramDigest({
  portfolioName,
  records,
  dateLabel,
}: {
  portfolioName: string;
  records: ValidationRecord[];
  dateLabel: string;
}) {
  const latestBySymbol = new Map<string, ValidationRecord>();
  [...records]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .forEach((record) => {
      if (!latestBySymbol.has(record.symbol)) latestBySymbol.set(record.symbol, record);
    });
  const recommendations = [...latestBySymbol.values()]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
  const lines = recommendations.length
    ? recommendations.map((record) =>
      `• ${record.symbol}: ${record.action} | ${record.horizon} | confidence ${Math.round(record.confidence)}%`,
    )
    : ["• No new qualified portfolio action was published today."];

  return [
    `UNLOAN Stock Planner — ${dateLabel}`,
    `Portfolio: ${portfolioName}`,
    "",
    ...lines,
    "",
    "AI-assisted market analysis, not certified investment advice. Please verify before acting.",
  ].join("\n");
}
