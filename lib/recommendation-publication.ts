export const RECOMMENDATION_PUBLICATION = {
  enabled: false,
  status: "WITHHELD" as const,
  reason: "Recommendation publishing is disabled because the current data coverage, point-in-time validation and out-of-sample evidence do not meet the required standard.",
  allowedOutput: "LIVE_MARKET_DATA_ONLY" as const,
  requirements: [
    "Reliable current market data with measured coverage and latency",
    "Point-in-time historical data without survivorship leakage",
    "Reproducible horizon-specific rules and transaction-cost modelling",
    "Out-of-sample validation and a sufficient shadow-trading sample",
  ],
};

export function isRecommendationPublicationEnabled() { return RECOMMENDATION_PUBLICATION.enabled; }

export function assertRecommendationPublicationEnabled(): void {
  if (!RECOMMENDATION_PUBLICATION.enabled) {
    throw new Error(RECOMMENDATION_PUBLICATION.reason);
  }
}
