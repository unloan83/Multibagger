import { GET as runTelegramDigest } from "@/app/api/communication/telegram/daily/route";

async function main() {
  const requiredEnvironment = [
    "GOOGLE_SHEETS_SPREADSHEET_ID",
    "GOOGLE_SERVICE_ACCOUNT_EMAIL",
    "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
    "TELEGRAM_TOKEN",
  ] as const;
  const missing = requiredEnvironment.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing GitHub Actions secrets: ${missing.join(", ")}.`);
  }

  const response = await runTelegramDigest(new Request(
    "http://github-actions.local/api/communication/telegram/daily",
    { headers: { "user-agent": "vercel-cron/1.0" } },
  ));
  const payload = await response.json() as {
    configured?: number;
    alreadyDelivered?: number;
    attempted?: number;
    delivered?: number;
    failed?: number;
    error?: string;
    results?: Array<{ detail?: string }>;
  };

  console.log(JSON.stringify({
    configured: payload.configured ?? 0,
    alreadyDelivered: payload.alreadyDelivered ?? 0,
    attempted: payload.attempted ?? 0,
    delivered: payload.delivered ?? 0,
    failed: payload.failed ?? 0,
  }));

  if (!response.ok || payload.error || (payload.failed ?? 0) > 0) {
    const reasons = [...new Set(
      (payload.results ?? []).map((result) => result.detail?.trim()).filter(Boolean),
    )];
    throw new Error(payload.error || reasons.join("; ") || "One or more Telegram digests failed.");
  }
}

main().catch((error) => {
  const message = redactSecrets(
    error instanceof Error ? error.message : "Telegram digest job failed.",
  );
  console.error(`::error title=Telegram digest job failed::${escapeWorkflowCommand(message)}`);
  process.exitCode = 1;
});

function redactSecrets(message: string): string {
  return [
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    process.env.TELEGRAM_TOKEN,
  ].filter((secret): secret is string => Boolean(secret)).reduce<string>(
    (safe, secret) => safe.replaceAll(secret, "[redacted]"),
    message,
  );
}

function escapeWorkflowCommand(message: string) {
  return message
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}
