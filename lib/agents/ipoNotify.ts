import type { IpoCandidate } from "@/lib/agents/ipoAgent";

type IpoNotifyRow = {
  searchId?: string;
  companyName?: string;
  symbol?: string | null;
  isSme?: boolean;
  minPrice?: number;
  maxPrice?: number;
  issuePrice?: number | null;
  issueSize?: number;
  lotSize?: number;
  minBidQuantity?: number;
  startDate?: string;
  endDate?: string;
  subscriptionRates?: Array<{ category?: string; subscriptionRate?: number }> | null;
  listing?: { listedOn?: string[] };
  cons?: string[];
  documentUrl?: string | null;
};

export function parseIpoNotifyCandidates(
  payload: unknown,
  requestedStatus: "open" | "upcoming",
  dataAsOf = new Date().toISOString(),
): IpoCandidate[] {
  const container = payload && typeof payload === "object" ? payload as {
    ipos?: unknown;
    data?: unknown;
    searchId?: unknown;
  } : {};
  const values = Array.isArray(container.ipos)
    ? container.ipos
    : Array.isArray(container.data)
      ? container.data
      : container.searchId
        ? [payload]
        : [];

  return values.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const row = value as IpoNotifyRow;
    const priceHigh = positiveNumber(row.maxPrice) || positiveNumber(row.issuePrice);
    const priceLow = positiveNumber(row.minPrice) || priceHigh;
    const lotSize = positiveNumber(row.lotSize) || positiveNumber(row.minBidQuantity);
    if (!row.searchId || !row.companyName || !row.startDate || !row.endDate || !priceHigh || !lotSize) return [];
    const subscriptions = Object.fromEntries(
      (row.subscriptionRates ?? [])
        .filter((item) => item.category && Number.isFinite(item.subscriptionRate))
        .map((item) => [item.category!.toUpperCase(), Number(item.subscriptionRate)]),
    );
    const listedOn = row.listing?.listedOn ?? [];
    const primaryExchange = listedOn.includes("NSE") ? "NSE" : "BSE";

    return [{
      id: row.searchId,
      company: row.companyName,
      symbol: row.symbol || undefined,
      exchange: (row.isSme ? `${primaryExchange} SME` : primaryExchange) as IpoCandidate["exchange"],
      status: requestedStatus,
      openDate: row.startDate,
      closeDate: row.endDate,
      priceBandLow: priceLow,
      priceBandHigh: priceHigh,
      lotSize,
      issueSizeCr: positiveNumber(row.issueSize) ? row.issueSize! / 10_000_000 : undefined,
      subscription: {
        total: subscriptions.TOTAL,
        qib: subscriptions.QIB,
        nii: subscriptions.NII,
        retail: subscriptions.RETAIL,
      },
      gmpHistory: [],
      riskFlags: row.cons?.slice(0, 8) ?? [],
      officialUrl: row.documentUrl || undefined,
      dataAsOf,
    }];
  });
}

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}
