import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDailyTelegramDigest,
  isValidTelegramBotToken,
  isValidTelegramChatId,
  protectTelegramBotToken,
  revealTelegramBotToken,
} from "@/lib/telegram";
import type { ValidationRecord } from "@/lib/intelligence-validation";

test("Telegram bot tokens are validated, protected, and recoverable for delivery", () => {
  const previousSecret = process.env.TELEGRAM_ENCRYPTION_SECRET;
  process.env.TELEGRAM_ENCRYPTION_SECRET = "test-secret";
  const token = "123456789:abcdefghijklmnopqrstuvwxyzABCDE";
  const stored = protectTelegramBotToken(token);
  assert.equal(isValidTelegramBotToken(token), true);
  assert.equal(isValidTelegramBotToken("not-a-token"), false);
  assert.notEqual(stored, token);
  assert.equal(revealTelegramBotToken(stored), token);
  if (previousSecret === undefined) {
    delete process.env.TELEGRAM_ENCRYPTION_SECRET;
  } else {
    process.env.TELEGRAM_ENCRYPTION_SECRET = previousSecret;
  }
});

test("Telegram chat IDs and daily digest are constrained", () => {
  assert.equal(isValidTelegramChatId("123456789"), true);
  assert.equal(isValidTelegramChatId("-1001234567890"), true);
  assert.equal(isValidTelegramChatId("@username"), false);
  const record = {
    symbol: "TEST",
    action: "Accumulate",
    horizon: "6-12 months",
    confidence: 72,
    timestamp: "2026-07-01T04:30:00.000Z",
  } as ValidationRecord;
  const digest = buildDailyTelegramDigest({
    portfolioName: "Private",
    records: [record],
    dateLabel: "1 Jul 2026",
  });
  assert.match(digest, /TEST: Accumulate/u);
  assert.match(digest, /not certified investment advice/u);
});
