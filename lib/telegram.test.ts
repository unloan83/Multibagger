import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDailyTelegramDigest,
  hashTelegramPasskey,
  isValidTelegramChatId,
  verifyTelegramPasskey,
} from "@/lib/telegram";
import type { ValidationRecord } from "@/lib/intelligence-validation";

test("Telegram connection passkeys are hashed and verified", () => {
  const stored = hashTelegramPasskey("strong-passkey");
  assert.notEqual(stored, "strong-passkey");
  assert.equal(verifyTelegramPasskey("strong-passkey", stored), true);
  assert.equal(verifyTelegramPasskey("wrong-passkey", stored), false);
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
