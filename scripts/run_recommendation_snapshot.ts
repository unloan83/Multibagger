import { GET as refreshRecommendations } from "@/app/api/snapshots/recommendations/route";

const response = await refreshRecommendations(cronRequest("/api/snapshots/recommendations"));
const payload = await response.json() as {
  ok?: boolean;
  appended?: number;
  portfolioRows?: number;
  marketRecommendationRows?: number;
  error?: string;
};

console.log(JSON.stringify({
  appended: payload.appended ?? 0,
  portfolioRows: payload.portfolioRows ?? 0,
  marketRows: payload.marketRecommendationRows ?? 0,
}));

if (!response.ok || !payload.ok) {
  throw new Error(payload.error || "Recommendation snapshot failed.");
}

function cronRequest(path: string) {
  return new Request(`http://github-actions.local${path}`, {
    headers: { "user-agent": "vercel-cron/1.0" },
  });
}
