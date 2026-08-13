export const RECOMMENDATION_PUBLICATION = {
  enabled: true,
  legacyEnabled: false,
  status: "PAPER_ONLY" as const,
  reason: "Only fresh, qualifying broker-feed paper signals are published; NO_TRADE is the default.",
  allowedOutput: "BROKER_FEED_PAPER_SIGNALS_ONLY" as const,
  requirements: [
    "Fresh Breeze or Upstox one-minute data with bid/ask liquidity checks",
    "ORB or VWAP strategy qualification",
    "ATR-based risk levels and paper-only execution",
    "Out-of-sample walk-forward validation before live use",
  ],
};

export function isRecommendationPublicationEnabled() { return RECOMMENDATION_PUBLICATION.enabled; }

export function assertRecommendationPublicationEnabled(): void {
  throw new Error("Legacy recommendation engines are disabled; only validated broker-feed paper signals may publish.");
}
