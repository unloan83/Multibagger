export type OptionsQuantConfig = {
  underlyingKey: "NSE_INDEX|Nifty 50";
  portfolioCapital: number;
  riskPerTradePercent: number;
  minimumDirectionConfidence: number;
  maximumDirectionAgeMinutes: number;
  minimumDaysToExpiry: number;
  maximumDaysToExpiry: number;
  minimumOiPerLeg: number;
  minimumVolumePerLeg: number;
  maximumBidAskSpreadPercent: number;
  minimumRiskReward: number;
  profitTargetRupees: number;
  dailyProfitTargetRupees: number;
  slippageBpsPerLeg: number;
  maximumDrawdownPercent: number;
  minimumShadowTrades: number;
  minimumRealTrades: number;
  submitSandboxOrders: boolean;
  enabled: boolean;
};

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function positiveNumberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function getOptionsQuantConfig(): OptionsQuantConfig {
  return {
    underlyingKey: "NSE_INDEX|Nifty 50",
    portfolioCapital: numberFromEnv("OPTIONS_QUANT_PORTFOLIO_CAPITAL", 0),
    riskPerTradePercent: numberFromEnv("OPTIONS_QUANT_RISK_PER_TRADE_PERCENT", 1),
    minimumDirectionConfidence: numberFromEnv("OPTIONS_QUANT_MIN_DIRECTION_CONFIDENCE", 70),
    maximumDirectionAgeMinutes: numberFromEnv("OPTIONS_QUANT_MAX_DIRECTION_AGE_MINUTES", 15),
    minimumDaysToExpiry: numberFromEnv("OPTIONS_QUANT_MIN_DTE", 2),
    maximumDaysToExpiry: numberFromEnv("OPTIONS_QUANT_MAX_DTE", 10),
    minimumOiPerLeg: numberFromEnv("OPTIONS_QUANT_MIN_OI", 10_000),
    minimumVolumePerLeg: numberFromEnv("OPTIONS_QUANT_MIN_VOLUME", 1_000),
    maximumBidAskSpreadPercent: numberFromEnv("OPTIONS_QUANT_MAX_BID_ASK_PERCENT", 8),
    minimumRiskReward: numberFromEnv("OPTIONS_QUANT_MIN_RISK_REWARD", 1.2),
    profitTargetRupees: positiveNumberFromEnv("OPTIONS_QUANT_PROFIT_TARGET_RUPEES", 3_000),
    dailyProfitTargetRupees: positiveNumberFromEnv("OPTIONS_QUANT_DAILY_PROFIT_TARGET_RUPEES", 3_000),
    slippageBpsPerLeg: numberFromEnv("OPTIONS_QUANT_SLIPPAGE_BPS_PER_LEG", 10),
    maximumDrawdownPercent: numberFromEnv("OPTIONS_QUANT_MAX_DRAWDOWN_PERCENT", 8),
    minimumShadowTrades: numberFromEnv("OPTIONS_QUANT_MIN_SHADOW_TRADES", 30),
    minimumRealTrades: numberFromEnv("OPTIONS_QUANT_MIN_REAL_TRADES", 50),
    submitSandboxOrders: process.env.OPTIONS_QUANT_SUBMIT_SANDBOX_ORDERS === "true",
    enabled: process.env.OPTIONS_QUANT_ENABLED === "true",
  };
}
