export function normalizeGooglePrivateKey(input?: string) {
  const value = input?.trim() ?? "";
  if (!value) return "";

  let candidate = value;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed === "string") {
      candidate = parsed;
    } else if (parsed && typeof parsed === "object" && "private_key" in parsed) {
      candidate = String((parsed as { private_key?: unknown }).private_key ?? "");
    }
  } catch {
    // A raw PEM or Base64 value is expected to be non-JSON.
  }

  candidate = candidate.trim().replace(/\\n/gu, "\n");
  if (!candidate.includes("BEGIN PRIVATE KEY")) {
    try {
      const decoded = Buffer.from(candidate, "base64").toString("utf8").trim();
      if (decoded.includes("BEGIN PRIVATE KEY")) candidate = decoded;
    } catch {
      // Leave the original value for the Google client to validate.
    }
  }

  return candidate;
}
