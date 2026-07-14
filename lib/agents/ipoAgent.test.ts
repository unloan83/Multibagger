import assert from "node:assert/strict";
import test from "node:test";
import { analyzeGmp, analyzeIpo, type IpoCandidate } from "@/lib/agents/ipoAgent";
import { parseIpoNotifyCandidates } from "@/lib/agents/ipoNotify";

const base: IpoCandidate = {
  id: "quality-ipo",
  company: "Quality IPO Ltd",
  exchange: "NSE",
  status: "open",
  openDate: "2026-07-10",
  closeDate: "2026-07-14",
  priceBandLow: 95,
  priceBandHigh: 100,
  lotSize: 150,
  freshIssuePercent: 80,
  revenueGrowthPercent: 25,
  profitGrowthPercent: 30,
  returnOnEquityPercent: 22,
  debtToEquity: 0.2,
  priceToEarnings: 20,
  industryPe: 30,
  subscription: { total: 12, qib: 8, nii: 10, retail: 5 },
  gmpHistory: [
    { observedAt: "2026-07-10T00:00:00Z", premium: 10 },
    { observedAt: "2026-07-12T00:00:00Z", premium: 22 },
  ],
  dataAsOf: "2026-07-12T00:00:00Z",
};

test("recommends a fresh, strong and reasonably valued IPO", () => {
  const result = analyzeIpo(base, new Date("2026-07-12T06:00:00Z"));
  assert.equal(result.recommendation, "BUY");
  assert.equal(result.gmp.trend, "rising");
  assert.equal(result.gmp.indicationPercent, 22);
});

test("serious disclosed risk blocks a buy recommendation", () => {
  const result = analyzeIpo(
    { ...base, riskFlags: ["Qualified audit opinion remains unresolved"] },
    new Date("2026-07-12T06:00:00Z"),
  );
  assert.equal(result.recommendation, "AVOID");
});

test("detects falling GMP without treating it as official evidence", () => {
  const result = analyzeGmp([
    { observedAt: "2026-07-10T00:00:00Z", premium: 25 },
    { observedAt: "2026-07-11T00:00:00Z", premium: 15 },
  ], 100);
  assert.equal(result.trend, "falling");
  assert.equal(result.estimatedListingPrice, 115);
});

test("normalizes IPO Notify open-issue responses", () => {
  const rows = parseIpoNotifyCandidates({
    ipos: [{
      searchId: "sample-ipo",
      companyName: "Sample Limited",
      symbol: "SAMPLE",
      isSme: false,
      minPrice: 95,
      maxPrice: 100,
      issueSize: 1_000_000_000,
      lotSize: 150,
      startDate: "2026-07-15",
      endDate: "2026-07-17",
      listing: { listedOn: ["NSE", "BSE"] },
      subscriptionRates: [
        { category: "QIB", subscriptionRate: 4.5 },
        { category: "TOTAL", subscriptionRate: 3.2 },
      ],
      cons: ["Customer concentration risk."],
      documentUrl: "https://www.sebi.gov.in/sample.pdf",
    }],
  }, "open", "2026-07-12T00:00:00Z");

  assert.equal(rows.length, 1);
  assert.equal(rows[0].exchange, "NSE");
  assert.equal(rows[0].issueSizeCr, 100);
  assert.equal(rows[0].subscription?.qib, 4.5);
  assert.equal(rows[0].gmpHistory?.length, 0);
});
