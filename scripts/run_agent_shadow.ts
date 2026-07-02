import { GET as runShadowAgents } from "@/app/api/agents/shadow/run/route";

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

if (!response.ok || !payload.ok) {
  const reasons = [...new Set((payload.failures ?? []).map((item) => item.error).filter(Boolean))];
  throw new Error(payload.error || reasons.join("; ") || "Agent shadow run failed.");
}

function cronRequest(path: string) {
  return new Request(`http://github-actions.local${path}`, {
    headers: { "user-agent": "vercel-cron/1.0" },
  });
}
