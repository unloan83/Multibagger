const hiddenPinCharacters = /[\s\u00A0\u200B-\u200D\uFEFF]/gu;

export function normalizePinInput(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(hiddenPinCharacters, "")
    .replace(/\D/gu, "")
    .slice(0, 4);
}

export async function hashPortfolioPin(portfolioId: string, pin: unknown) {
  const normalizedPin = normalizePinInput(pin);
  const input = new TextEncoder().encode(`unloan:${portfolioId}:${normalizedPin}`);
  const digest = await window.crypto.subtle.digest("SHA-256", input);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function validatePortfolioPin({
  enteredPin,
  portfolioId,
  portfolioName,
  storedHash,
}: {
  enteredPin: unknown;
  portfolioId: string;
  portfolioName: string;
  storedHash?: string;
}) {
  const normalizedPin = normalizePinInput(enteredPin);
  const normalizedStoredHash = String(storedHash ?? "").trim();
  const enteredHash = normalizedStoredHash
    ? await hashPortfolioPin(portfolioId, normalizedPin)
    : "";
  const pinMatch = Boolean(normalizedStoredHash && enteredHash === normalizedStoredHash);

  logPinDebug({
    enteredPin,
    enteredHash,
    normalizedPin,
    pinMatch,
    portfolioId,
    portfolioName,
    storedHash: normalizedStoredHash,
  });

  return {
    enteredHash,
    normalizedPin,
    pinMatch,
    storedHash: normalizedStoredHash,
  };
}

function logPinDebug({
  enteredHash,
  enteredPin,
  normalizedPin,
  pinMatch,
  portfolioId,
  portfolioName,
  storedHash,
}: {
  enteredHash: string;
  enteredPin: unknown;
  normalizedPin: string;
  pinMatch: boolean;
  portfolioId: string;
  portfolioName: string;
  storedHash: string;
}) {
  console.groupCollapsed(`[PIN DEBUG] ${portfolioName}`);
  console.log("Portfolio Selected", { portfolioId, portfolioName });
  console.log("PIN Entered", enteredPin);
  console.log("PIN After Normalization", normalizedPin);
  console.log("Stored PIN", storedHash);
  console.log("Entered PIN Type", typeof normalizedPin);
  console.log("Stored PIN Type", typeof storedHash);
  console.log("Entered Hash", enteredHash);
  console.log("Comparison Result", pinMatch);
  console.log("Authentication Result", pinMatch ? "Success" : "Failure");
  console.groupEnd();
}
