export type IpoStatus = "upcoming" | "open" | "closed" | "listed";
export type IpoRecommendation = "BUY" | "WATCH" | "AVOID";
export type GmpTrend = "rising" | "flat" | "falling" | "volatile" | "unavailable";

export type GmpObservation = {
  observedAt: string;
  premium: number;
};

export type IpoCandidate = {
  id: string;
  company: string;
  symbol?: string;
  exchange: "NSE" | "BSE" | "NSE SME" | "BSE SME";
  status: IpoStatus;
  openDate: string;
  closeDate: string;
  listingDate?: string;
  priceBandLow: number;
  priceBandHigh: number;
  lotSize: number;
  issueSizeCr?: number;
  freshIssuePercent?: number;
  revenueGrowthPercent?: number;
  profitGrowthPercent?: number;
  returnOnEquityPercent?: number;
  debtToEquity?: number;
  priceToEarnings?: number;
  industryPe?: number;
  subscription?: {
    total?: number;
    qib?: number;
    nii?: number;
    retail?: number;
  };
  gmpHistory?: GmpObservation[];
  riskFlags?: string[];
  officialUrl?: string;
  gmpSourceUrl?: string;
  dataAsOf: string;
};

export type IpoAnalysis = IpoCandidate & {
  recommendation: IpoRecommendation;
  score: number;
  confidence: number;
  gmp: {
    latest: number | null;
    indicationPercent: number | null;
    estimatedListingPrice: number | null;
    trend: GmpTrend;
    change: number | null;
  };
  factorScores: {
    fundamentals: number;
    valuation: number;
    demand: number;
    issueStructure: number;
    greyMarket: number;
    risk: number;
  };
  reasons: string[];
  concerns: string[];
};

const seriousRiskTerms = [
  "fraud",
  "insolvency",
  "auditor resignation",
  "qualified audit",
  "sebi action",
  "promoter criminal",
];

export function analyzeIpos(candidates: IpoCandidate[], now = new Date()) {
  return candidates
    .filter((candidate) => ["upcoming", "open"].includes(candidate.status))
    .map((candidate) => analyzeIpo(candidate, now))
    .sort((a, b) => {
      const actionRank = { BUY: 0, WATCH: 1, AVOID: 2 };
      return actionRank[a.recommendation] - actionRank[b.recommendation] || b.score - a.score;
    });
}

export function analyzeIpo(candidate: IpoCandidate, now = new Date()): IpoAnalysis {
  const fundamentals = scoreFundamentals(candidate);
  const valuation = scoreValuation(candidate);
  const demand = scoreDemand(candidate);
  const issueStructure = scoreIssueStructure(candidate);
  const gmp = analyzeGmp(candidate.gmpHistory ?? [], candidate.priceBandHigh);
  const greyMarket = scoreGreyMarket(gmp.indicationPercent, gmp.trend);
  const risk = scoreRisk(candidate.riskFlags ?? []);
  const score = Math.round(
    fundamentals * 0.3 + valuation * 0.2 + demand * 0.2 +
    issueStructure * 0.1 + greyMarket * 0.1 + risk * 0.1,
  );
  const seriousRisk = (candidate.riskFlags ?? []).some((flag) =>
    seriousRiskTerms.some((term) => flag.toLowerCase().includes(term)),
  );
  const freshHours = (now.getTime() - Date.parse(candidate.dataAsOf)) / 3_600_000;
  const stale = !Number.isFinite(freshHours) || freshHours > 24;
  const recommendation: IpoRecommendation = seriousRisk || score < 48
    ? "AVOID"
    : score >= 70 && !stale && fundamentals >= 55 && valuation >= 45
      ? "BUY"
      : "WATCH";
  const availableInputs = [
    candidate.revenueGrowthPercent,
    candidate.profitGrowthPercent,
    candidate.returnOnEquityPercent,
    candidate.debtToEquity,
    candidate.priceToEarnings,
    candidate.subscription?.total,
    gmp.latest,
  ].filter((value) => value != null).length;
  const confidence = Math.round(Math.min(95, 40 + availableInputs * 7 - (stale ? 20 : 0)));

  const reasons = [
    fundamentals >= 60 ? `Fundamental score is ${fundamentals}/100.` : "Fundamental evidence is mixed or incomplete.",
    valuation >= 60 ? `Valuation compares reasonably with the stated industry benchmark.` : "Valuation does not provide a strong margin of safety.",
    demand >= 60 ? `Subscription demand score is ${demand}/100.` : "Subscription demand is unconfirmed or moderate.",
    gmp.latest == null
      ? "No current grey-market observation is available."
      : `Unofficial GMP is ₹${gmp.latest.toFixed(0)} (${gmp.indicationPercent?.toFixed(1)}%) with a ${gmp.trend} trend.`,
  ];
  const concerns = [
    ...(candidate.riskFlags ?? []),
    ...(stale ? ["IPO data is older than 24 hours; refresh before acting."] : []),
    ...(gmp.latest != null ? ["GMP is unofficial, unregulated, and can change sharply before listing."] : []),
  ];

  return {
    ...candidate,
    recommendation,
    score,
    confidence,
    gmp,
    factorScores: { fundamentals, valuation, demand, issueStructure, greyMarket, risk },
    reasons,
    concerns,
  };
}

export function analyzeGmp(history: GmpObservation[], issuePrice: number) {
  const valid = history
    .filter((item) => Number.isFinite(item.premium) && Number.isFinite(Date.parse(item.observedAt)))
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  if (!valid.length || issuePrice <= 0) {
    return { latest: null, indicationPercent: null, estimatedListingPrice: null, trend: "unavailable" as const, change: null };
  }
  const latest = valid.at(-1)!.premium;
  const first = valid[0].premium;
  const change = latest - first;
  const moves = valid.slice(1).map((item, index) => item.premium - valid[index].premium);
  const reversals = moves.slice(1).filter((move, index) => move !== 0 && moves[index] !== 0 && Math.sign(move) !== Math.sign(moves[index])).length;
  const threshold = Math.max(2, issuePrice * 0.01);
  const trend: GmpTrend = reversals >= 2
    ? "volatile"
    : change > threshold
      ? "rising"
      : change < -threshold
        ? "falling"
        : "flat";
  return {
    latest,
    indicationPercent: (latest / issuePrice) * 100,
    estimatedListingPrice: issuePrice + latest,
    trend,
    change,
  };
}

function scoreFundamentals(candidate: IpoCandidate) {
  let score = 50;
  if (candidate.revenueGrowthPercent != null) score += candidate.revenueGrowthPercent >= 20 ? 18 : candidate.revenueGrowthPercent >= 8 ? 8 : -12;
  if (candidate.profitGrowthPercent != null) score += candidate.profitGrowthPercent >= 20 ? 18 : candidate.profitGrowthPercent > 0 ? 8 : -18;
  if (candidate.returnOnEquityPercent != null) score += candidate.returnOnEquityPercent >= 18 ? 14 : candidate.returnOnEquityPercent >= 10 ? 5 : -10;
  if (candidate.debtToEquity != null) score += candidate.debtToEquity <= 0.5 ? 8 : candidate.debtToEquity <= 1.5 ? 0 : -15;
  return clamp(score);
}

function scoreValuation(candidate: IpoCandidate) {
  if (!candidate.priceToEarnings || candidate.priceToEarnings <= 0) return 35;
  if (!candidate.industryPe || candidate.industryPe <= 0) return candidate.priceToEarnings <= 30 ? 60 : candidate.priceToEarnings <= 50 ? 45 : 25;
  const ratio = candidate.priceToEarnings / candidate.industryPe;
  return ratio <= 0.8 ? 85 : ratio <= 1 ? 70 : ratio <= 1.25 ? 50 : ratio <= 1.6 ? 30 : 15;
}

function scoreDemand(candidate: IpoCandidate) {
  const total = candidate.subscription?.total;
  if (total == null) return candidate.status === "upcoming" ? 50 : 35;
  const qib = candidate.subscription?.qib ?? 0;
  return clamp((total >= 10 ? 65 : total >= 3 ? 55 : total >= 1 ? 45 : 20) + (qib >= 5 ? 20 : qib >= 1 ? 8 : 0));
}

function scoreIssueStructure(candidate: IpoCandidate) {
  if (candidate.freshIssuePercent == null) return 50;
  return candidate.freshIssuePercent >= 70 ? 80 : candidate.freshIssuePercent >= 40 ? 65 : candidate.freshIssuePercent >= 20 ? 45 : 25;
}

function scoreGreyMarket(indication: number | null, trend: GmpTrend) {
  if (indication == null) return 50;
  const base = indication >= 20 ? 80 : indication >= 10 ? 68 : indication >= 3 ? 58 : indication >= 0 ? 48 : 25;
  return clamp(base + (trend === "rising" ? 8 : trend === "falling" ? -12 : trend === "volatile" ? -8 : 0));
}

function scoreRisk(flags: string[]) {
  if (!flags.length) return 75;
  const serious = flags.filter((flag) => seriousRiskTerms.some((term) => flag.toLowerCase().includes(term))).length;
  return clamp(70 - flags.length * 10 - serious * 30);
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
