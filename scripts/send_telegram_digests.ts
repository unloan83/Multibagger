import { GET as runTelegramDigest } from "@/app/api/communication/telegram/daily/route";

async function main() {
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
  };

  console.log(JSON.stringify({
    configured: payload.configured ?? 0,
    alreadyDelivered: payload.alreadyDelivered ?? 0,
    attempted: payload.attempted ?? 0,
    delivered: payload.delivered ?? 0,
    failed: payload.failed ?? 0,
  }));

  if (!response.ok || payload.error || (payload.failed ?? 0) > 0) {
    throw new Error(payload.error ?? "One or more Telegram digests failed.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Telegram digest job failed.");
  process.exitCode = 1;
});
