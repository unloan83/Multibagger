import { GET as validateRecommendations } from "@/app/api/validation/run/route";

const response = await validateRecommendations(cronRequest("/api/validation/run"));
const payload = await response.json() as {
  ok?: boolean;
  evaluated?: number;
  total?: number;
  learningRows?: number;
  error?: string;
};

console.log(JSON.stringify({
  evaluated: payload.evaluated ?? 0,
  total: payload.total ?? 0,
  learningRows: payload.learningRows ?? 0,
}));

if (!response.ok || !payload.ok) {
  throw new Error(payload.error || "Recommendation validation failed.");
}

function cronRequest(path: string) {
  return new Request(`http://github-actions.local${path}`, {
    headers: { "user-agent": "vercel-cron/1.0" },
  });
}
