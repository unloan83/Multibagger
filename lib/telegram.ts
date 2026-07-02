import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type { ValidationRecord } from "@/lib/intelligence-validation";

const passkeyPrefix = "scrypt";

export function getTelegramBotToken() {
  return process.env.TELEGRAM_TOKEN?.trim() || process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
}

export function isValidTelegramBotToken(value: string) {
  return /^\d{6,20}:[A-Za-z0-9_-]{20,}$/u.test(value.trim());
}

export function protectTelegramBotToken(token: string) {
  const value = token.trim();
  if (!isValidTelegramBotToken(value)) {
    throw new Error("Enter a valid Telegram bot token from BotFather.");
  }
  if (value.startsWith("enc$") || value.startsWith("plain$")) return value;

  const secret = getTokenEncryptionSecret();
  if (!secret) {
    return `plain$${Buffer.from(value, "utf8").toString("base64url")}`;
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "enc",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join("$");
}

export function revealTelegramBotToken(stored: string) {
  const value = stored.trim();
  if (!value) return "";
  if (isValidTelegramBotToken(value)) return value;
  if (value.startsWith("plain$")) {
    return Buffer.from(value.slice("plain$".length), "base64url").toString("utf8");
  }
  if (!value.startsWith("enc$")) return "";

  const [, ivValue, tagValue, encryptedValue] = value.split("$");
  const secret = getTokenEncryptionSecret();
  if (!secret || !ivValue || !tagValue || !encryptedValue) return "";

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(secret),
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return "";
  }
}

export function resolveTelegramBotToken(stored?: string) {
  return revealTelegramBotToken(stored ?? "") || getTelegramBotToken();
}

export function shouldAttemptDailyTelegram(settings: {
  telegramEnabled: boolean;
  telegramUserId: string;
  securePasskey?: string;
}) {
  return Boolean(
    settings.telegramEnabled &&
    settings.telegramUserId.trim() &&
    resolveTelegramBotToken(settings.securePasskey),
  );
}

export function wasTelegramDeliveredInCurrentIstSlot(lastSuccessfulDelivery: string, now = new Date()) {
  if (!lastSuccessfulDelivery) return false;
  const deliveredAt = new Date(lastSuccessfulDelivery);
  if (Number.isNaN(deliveredAt.getTime())) return false;
  return istDateKey(deliveredAt) === istDateKey(now) &&
    istDeliverySlot(deliveredAt) === istDeliverySlot(now);
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
  botToken: suppliedBotToken,
}: {
  chatId: string;
  text: string;
  botToken?: string;
}) {
  const botToken = suppliedBotToken?.trim() || getTelegramBotToken();
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

function getTokenEncryptionSecret() {
  return process.env.TELEGRAM_ENCRYPTION_SECRET?.trim() ||
    process.env.DASHBOARD_SESSION_SECRET?.trim() ||
    process.env.SHARED_SESSION_SECRET?.trim() ||
    "";
}

function encryptionKey(secret: string) {
  return createHash("sha256").update(secret).digest();
}

function istDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function istDeliverySlot(date: Date) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(date));
  return hour < 12 ? "morning" : "pre-close";
}

export function buildDailyTelegramDigest({
  portfolioName,
  portfolioRecords,
  marketRecords,
  dateLabel,
}: {
  portfolioName: string;
  portfolioRecords: ValidationRecord[];
  marketRecords: ValidationRecord[];
  dateLabel: string;
}) {
  const portfolioActions = latestBySymbol(portfolioRecords)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 12);
  const marketBuys = latestBySymbol(marketRecords.filter(isBuyRecommendation));
  const intradayBuys = marketBuys
    .filter(isIntradayRecommendation)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
  const longTermBuys = marketBuys
    .filter((record) => !isIntradayRecommendation(record))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);

  return [
    `UNLOAN Stock Planner — ${dateLabel}`,
    `Portfolio: ${portfolioName}`,
    "",
    "1. PORTFOLIO RECOMMENDED STOCK ACTIONS",
    ...formatRecommendationLines(
      portfolioActions,
      "• No new portfolio stock action is available today.",
    ),
    "",
    "2. MARKET RECOMMENDED STOCK ACTIONS",
    "Intraday Buy — Top 5",
    ...formatRecommendationLines(
      intradayBuys,
      "• No qualified intraday Buy is available today.",
    ),
    "",
    "Long-term Buy — Top 5",
    ...formatRecommendationLines(
      longTermBuys,
      "• No qualified long-term Buy is available today.",
    ),
    "",
    "AI-assisted market analysis, not certified investment advice. Please verify before acting.",
  ].join("\n");
}

function latestBySymbol(records: ValidationRecord[]) {
  const latest = new Map<string, ValidationRecord>();
  [...records]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .forEach((record) => {
      const symbol = record.symbol.trim().toUpperCase();
      if (symbol && !latest.has(symbol)) latest.set(symbol, record);
    });
  return [...latest.values()];
}

function isBuyRecommendation(record: ValidationRecord) {
  return /^(buy|accumulate)$/iu.test(record.action.trim());
}

function isIntradayRecommendation(record: ValidationRecord) {
  return /intraday|today|minute|hour/iu.test(`${record.section} ${record.horizon}`);
}

function formatRecommendationLines(records: ValidationRecord[], emptyMessage: string) {
  if (records.length === 0) return [emptyMessage];
  return records.map((record) =>
    `• ${record.symbol}: ${record.action} | ${record.horizon} | ${Math.round(record.confidence)}% confidence`,
  );
}
