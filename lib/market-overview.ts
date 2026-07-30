/**
 * Simplified market overview — fetches NIFTY 50 to gauge market sentiment.
 */

type MarketOverview = {
  sentiment: "Positive" | "Negative" | "Neutral";
  averageMove: number;
};

export async function buildMarketOverview(): Promise<MarketOverview> {
  try {
    const response = await fetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?range=5d&interval=1d",
      { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) return { sentiment: "Neutral", averageMove: 0 };

    const data = (await response.json()) as {
      chart?: {
        result?: Array<{
          meta?: { regularMarketPrice?: number; previousClose?: number };
        }>;
      };
    };
    const meta = data.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice ?? 0;
    const previousClose = meta?.previousClose ?? 0;
    const changePercent =
      previousClose > 0 ? ((price - previousClose) / previousClose) * 100 : 0;

    return {
      sentiment:
        changePercent > 0.3
          ? "Positive"
          : changePercent < -0.3
            ? "Negative"
            : "Neutral",
      averageMove: Number(changePercent.toFixed(2)),
    };
  } catch {
    return { sentiment: "Neutral", averageMove: 0 };
  }
}
