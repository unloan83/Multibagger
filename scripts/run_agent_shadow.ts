import { GET as runShadowAgents } from "@/app/api/agents/shadow/run/route";

async function main() {
  const response = await runShadowAgents(cronRequest("/api/agents/shadow/run"));
  const payload = await response.json() as {
  ok?: boolean;
  portfoliosAttempted?: number;
  portfoliosCompleted?: number;
  failures?: Array<{ error?: string }>;
  error?: string;
  };

  console.log(JSON.stringify({
    mode: "shadow",
    attempted: payload.portfoliosAttempted ?? 0,
    completed: payload.portfoliosCompleted ?? 0,
    failed: payload.failures?.length ?? 0,
  }));

  if ((payload.portfoliosCompleted ?? 0) === 0) {
    const reasons = [...new Set((payload.failures ?? []).map((item) => item.error).filter(Boolean))];
    throw new Error(payload.error || reasons.join("; ") || "Agent shadow run failed.");
  }
  if (!payload.ok) {
    console.warn("Shadow run completed partially; failed portfolios remain visible in the workflow counts.");
  }
}

main().catch(fail);

function cronRequest(path: string) {
  return new Request(`http://github-actions.local${path}`, {
    headers: { "user-agent": "vercel-cron/1.0" },
  });
}

function fail(error: unknown) {
  console.error(error instanceof Error ? error.message : "Agent shadow run failed.");
  process.exitCode = 1;
}
