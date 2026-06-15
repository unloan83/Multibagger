import { createHash, timingSafeEqual } from "node:crypto";
import { masterRecoveryPin, normalizePinInput } from "@/lib/portfolio-pin";

export function hashPortfolioPinServer(portfolioId: string, pin: unknown) {
  const normalizedPin = normalizePinInput(pin);

  return createHash("sha256")
    .update(`unloan:${portfolioId}:${normalizedPin}`)
    .digest("hex");
}

export function validatePortfolioPinHash({
  enteredPin,
  portfolioId,
  storedHash,
}: {
  enteredPin: unknown;
  portfolioId: string;
  storedHash?: string;
}) {
  const normalizedPin = normalizePinInput(enteredPin);
  const normalizedStoredHash = String(storedHash ?? "").trim();

  if (normalizedPin === masterRecoveryPin) {
    return {
      normalizedPin,
      pinMatch: true,
      usedMasterPin: true,
    };
  }

  if (!normalizedStoredHash) {
    return {
      normalizedPin,
      pinMatch: false,
      usedMasterPin: false,
    };
  }

  const enteredHash = hashPortfolioPinServer(portfolioId, normalizedPin);

  return {
    normalizedPin,
    pinMatch: safeHashEqual(enteredHash, normalizedStoredHash),
    usedMasterPin: false,
  };
}

function safeHashEqual(value: string, expected: string) {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);

  if (valueBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(valueBuffer, expectedBuffer);
}
