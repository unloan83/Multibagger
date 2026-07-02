import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDailyTelegramDigest,
  isValidTelegramBotToken,
  isValidTelegramChatId,
  protectTelegramBotToken,
  revealTelegramBotToken,
  shouldAttemptDailyTelegram,
  wasTelegramDeliveredInCurrentIstSlot,
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

test("daily delivery retries a configured account after a previous connection failure", () => {
  const token = "123456789:abcdefghijklmnopqrstuvwxyzABCDE";
  assert.equal(shouldAttemptDailyTelegram({
    telegramEnabled: true,
    telegramUserId: "123456789",
    securePasskey: protectTelegramBotToken(token),
  }), true);
});

test("daily delivery is idempotent per morning and pre-close IST slot", () => {
  const morning = new Date("2026-07-02T05:00:00.000Z");
  const preClose = new Date("2026-07-02T09:05:00.000Z");
  assert.equal(wasTelegramDeliveredInCurrentIstSlot("2026-07-02T04:45:00.000Z", morning), true);
  assert.equal(wasTelegramDeliveredInCurrentIstSlot("2026-07-02T04:45:00.000Z", preClose), false);
  assert.equal(wasTelegramDeliveredInCurrentIstSlot("2026-07-02T09:00:00.000Z", preClose), true);
  assert.equal(wasTelegramDeliveredInCurrentIstSlot("2026-07-01T09:00:00.000Z", preClose), false);
});
