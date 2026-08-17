export type MarketDirection = "BULLISH" | "BEARISH" | "UNCLEAR";
export type SpreadStrategy = "BULL_CALL_SPREAD" | "BEAR_PUT_SPREAD";
export type StrategyStage = "SHADOW" | "SMALL_LIVE" | "SCALE" | "FAILED";
export type EvaluationDecision = "GO" | "CONTINUE" | "STOP" | "SCALE";

export type DirectionEvidence = {
  asOf: string;
  direction: MarketDirection;
  confidence: number;
  marketRegime: string;
  trendStrength: number;
  bankNiftyConfirmation: number;
  optionChainConfirmation: number;
  observations: {
    niftyReturnFromOpenBps: number;
    niftyFastSlowGapBps: number;
    bankNiftyReturnFromOpenBps: number;
    bankNiftyFastSlowGapBps: number;
    putCallOiRatio: number;
    optionExpiry: string;
    latestMarketTimestamp: string;
  };
  sourceIds: string[];
  modelVersion: string;
};

export type OptionLeg = {
  instrumentKey: string;
  tradingSymbol: string;
  side: "BUY" | "SELL";
  optionType: "CE" | "PE";
  strike: number;
  bid: number;
  ask: number;
  ltp: number;
  iv: number;
  delta: number;
  oi: number;
  volume: number;
  bidAskSpreadPercent: number;
};

export type OptionsOpportunity = {
  id: string;
  observedAt: string;
  underlying: "NIFTY 50";
  underlyingSpot: number;
  direction: Exclude<MarketDirection, "UNCLEAR">;
  strategy: SpreadStrategy;
  expiry: string;
  daysToExpiry: number;
  lotSize: number;
  quantity: number;
  longLeg: OptionLeg;
  shortLeg: OptionLeg;
  entryDebitPerUnit: number;
  maxProfit: number;
  maxLoss: number;
  profitTargetRupees: number;
  breakeven: number;
  riskReward: number;
  averageIv: number;
  netDelta: number;
  totalOi: number;
  totalVolume: number;
  worstBidAskSpreadPercent: number;
  estimatedCharges: number;
  estimatedSlippage: number;
  confidence: number;
  exitRules: string[];
  directionModelVersion: string;
  directionSourceIds: string[];
  dataSource: "UPSTOX_LIVE_OPTION_CHAIN";
};

export type OptionsPosition = OptionsOpportunity & {
  status: "OPEN" | "CLOSED";
  mode: "SHADOW" | "UPSTOX_SANDBOX";
  openedAt: string;
  closedAt: string | null;
  exitCreditPerUnit: number | null;
  currentExitCreditPerUnit: number;
  unrealizedGrossPnl: number;
  unrealizedNetPnl: number;
  lastMarkedAt: string;
  underlyingExitSpot: number | null;
  signalCorrect: boolean | null;
  grossPnl: number;
  netPnl: number;
  actualCosts: number;
  slippageCost: number;
  exitReason: string | null;
  sandboxOrderIds: string[];
};

export type PerformanceMetrics = {
  closedTrades: number;
  grossPnl: number;
  netPnl: number;
  winRate: number;
  profitFactor: number | null;
  expectancyPerTrade: number;
  maximumDrawdown: number;
  averageWin: number;
  averageLoss: number;
  costs: number;
  slippage: number;
  signalAccuracy: number;
  capitalUtilisation: number;
  strategyPerformance: Record<SpreadStrategy, { trades: number; netPnl: number; winRate: number }>;
};

export type StrategyEvaluation = {
  decision: EvaluationDecision;
  evaluatedAt: string;
  reasons: string[];
  minimumShadowTrades: number;
  minimumRealTrades: number;
};

export type OptionsQuantState = {
  schemaVersion: 1;
  asOf: string;
  stage: StrategyStage;
  broker: "UPSTOX";
  executionCapability: "SHADOW_AND_SANDBOX_ONLY";
  direction: DirectionEvidence | null;
  liveOpportunity: OptionsOpportunity | null;
  positions: OptionsPosition[];
  noTradeReasons: string[];
  metrics: PerformanceMetrics;
  evaluation: StrategyEvaluation;
  configuration: {
    marketDataConfigured: boolean;
    sandboxConfigured: boolean;
    portfolioCapitalConfigured: boolean;
    sandboxOrderSubmissionEnabled: boolean;
    automaticCyclesEnabled: boolean;
    profitTargetRupees: number;
    dailyProfitTargetRupees: number;
  };
};
