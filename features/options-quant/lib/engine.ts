import type { OptionChainRow, OptionContract, OptionsBroker } from "@/features/options-quant/brokers/types";
import { UpstoxOptionsBroker } from "@/features/options-quant/brokers/upstox";
import { getOptionsQuantConfig, type OptionsQuantConfig } from "@/features/options-quant/lib/config";
import { buildLiveDirectionEvidence } from "@/features/options-quant/lib/direction";
import { readOptionsQuantState, writeOptionsQuantState } from "@/features/options-quant/lib/store";
import type {
  DirectionEvidence,
  OptionLeg,
  OptionsOpportunity,
  OptionsPosition,
  OptionsQuantState,
  PerformanceMetrics,
  SpreadStrategy,
  StrategyEvaluation,
} from "@/features/options-quant/lib/types";

export async function ingestDirectionEvidence(input: unknown): Promise<OptionsQuantState> {
  const direction = validateDirection(input);
  const state = await readOptionsQuantState();
  state.direction = direction;
  state.noTradeReasons = direction.direction === "UNCLEAR" ? ["Live Upstox direction evidence is UNCLEAR."] : [];
  await writeOptionsQuantState(state);
  return state;
}

export async function runOptionsQuantCycle(
  broker: OptionsBroker = new UpstoxOptionsBroker(),
  now = new Date(),
): Promise<OptionsQuantState> {
  const config = getOptionsQuantConfig();
  const sessionReason = nseMarketDataRejection(now);
  if (sessionReason) return runOptionsQuantScan(broker, now);
  try {
    await ingestDirectionEvidence(await buildLiveDirectionEvidence(broker, now));
  } catch (error) {
    const state = await readOptionsQuantState();
    state.direction = null;
    return persistNoTrade(state, [error instanceof Error ? error.message : "Live Upstox direction cycle failed."], config);
  }
  return runOptionsQuantScan(broker, now);
}

export async function runOptionsRiskMonitor(
  broker: OptionsBroker = new UpstoxOptionsBroker(),
  now = new Date(),
): Promise<OptionsQuantState> {
  const config = getOptionsQuantConfig();
  const state = await readOptionsQuantState();
  state.configuration = {
    marketDataConfigured: Boolean(process.env.UPSTOX_ACCESS_TOKEN),
    sandboxConfigured: Boolean(process.env.UPSTOX_SANDBOX_ACCESS_TOKEN),
    portfolioCapitalConfigured: config.portfolioCapital > 0,
    sandboxOrderSubmissionEnabled: config.submitSandboxOrders,
    automaticCyclesEnabled: config.enabled,
    profitTargetRupees: config.profitTargetRupees,
    dailyProfitTargetRupees: config.dailyProfitTargetRupees,
  };
  const openPosition = state.positions.find((position) => position.status === "OPEN");
  if (!openPosition) {
    state.noTradeReasons = ["Risk monitor found no active Options Quant position."];
    state.metrics = calculateMetrics(state.positions, config.portfolioCapital);
    await writeOptionsQuantState(state);
    return state;
  }
  const sessionReason = nseMarketDataRejection(now);
  if (sessionReason) return persistNoTrade(state, [sessionReason], config);
  try {
    const chain = await broker.getOptionChain(config.underlyingKey, openPosition.expiry);
    if (!chain.length) return persistNoTrade(state, ["Upstox returned no chain for the active Options position."], config);
    await markOpenPositions(state, chain, broker, config);
    state.noTradeReasons = state.positions.some((position) => position.status === "OPEN")
      ? ["Active Options position monitored; no exit condition is currently met."]
      : ["Active Options position exit was processed by the risk monitor."];
    state.metrics = calculateMetrics(state.positions, config.portfolioCapital);
    state.evaluation = evaluateStrategy(state.positions, state.metrics, state.stage, config);
    await writeOptionsQuantState(state);
    return state;
  } catch (error) {
    return persistNoTrade(state, [error instanceof Error ? error.message : "Options risk monitor failed."], config);
  }
}

export async function runOptionsQuantScan(
  broker: OptionsBroker = new UpstoxOptionsBroker(),
  now = new Date(),
): Promise<OptionsQuantState> {
  const config = getOptionsQuantConfig();
  const state = await readOptionsQuantState();
  state.configuration = {
    marketDataConfigured: Boolean(process.env.UPSTOX_ACCESS_TOKEN),
    sandboxConfigured: Boolean(process.env.UPSTOX_SANDBOX_ACCESS_TOKEN),
    portfolioCapitalConfigured: config.portfolioCapital > 0,
    sandboxOrderSubmissionEnabled: config.submitSandboxOrders,
    automaticCyclesEnabled: config.enabled,
    profitTargetRupees: config.profitTargetRupees,
    dailyProfitTargetRupees: config.dailyProfitTargetRupees,
  };
  state.liveOpportunity = null;
  state.noTradeReasons = [];

  const sessionReason = nseMarketDataRejection(now);
  if (sessionReason) return persistNoTrade(state, [sessionReason], config);

  try {
    const contracts = await broker.getOptionContracts(config.underlyingKey);
    const openPosition = state.positions.find((position) => position.status === "OPEN");
    if (openPosition) {
      const activeChain = await broker.getOptionChain(config.underlyingKey, openPosition.expiry);
      await markOpenPositions(state, activeChain, broker, config);
      if (state.positions.some((position) => position.status === "OPEN")) {
        return persistNoTrade(state, ["An Options Quant position is already active."], config);
      }
    }

    const dailyNetPnl = netPnlForIstDay(state.positions, now);
    if (dailyNetPnl >= config.dailyProfitTargetRupees) {
      return persistNoTrade(state, [`Options daily net-profit target of ₹${config.dailyProfitTargetRupees} is reached; new entries are locked.`], config);
    }

    if (!config.enabled) return persistNoTrade(state, ["Options Quant automatic cycles are disabled; new entries are locked."], config);
    if (state.stage === "FAILED") return persistNoTrade(state, ["Strategy is FAILED; new entries are disabled."], config);
    const directionReasons = directionRejections(state.direction, config);
    if (directionReasons.length) return persistNoTrade(state, directionReasons, config);
    const entryReason = nseEntryRejection(now);
    if (entryReason) return persistNoTrade(state, [entryReason], config);
    if (config.portfolioCapital <= 0) return persistNoTrade(state, ["OPTIONS_QUANT_PORTFOLIO_CAPITAL is not configured."], config);

    const expiry = chooseExpiry(contracts, now, config);
    if (!expiry) return persistNoTrade(state, ["No eligible liquid NIFTY expiry is within the configured DTE window."], config);
    const chain = await broker.getOptionChain(config.underlyingKey, expiry.expiry);
    if (chain.length === 0) return persistNoTrade(state, ["Upstox returned an empty NIFTY option chain."], config);

    const candidate = await buildOpportunity(state.direction!, chain, expiry.lotSize, broker, config);
    if (!candidate.opportunity) return persistNoTrade(state, candidate.reasons, config);

    state.liveOpportunity = candidate.opportunity;
    const sandboxOrderIds = config.submitSandboxOrders
      ? await broker.submitSandboxSpread({
          quantity: candidate.opportunity.quantity,
          longInstrumentKey: candidate.opportunity.longLeg.instrumentKey,
          shortInstrumentKey: candidate.opportunity.shortLeg.instrumentKey,
          longLimitPrice: candidate.opportunity.longLeg.ask,
          shortLimitPrice: candidate.opportunity.shortLeg.bid,
          tag: `oq_${candidate.opportunity.id}`,
        })
      : [];
    state.positions.push({
      ...candidate.opportunity,
      status: "OPEN",
      mode: sandboxOrderIds.length ? "UPSTOX_SANDBOX" : "SHADOW",
      openedAt: candidate.opportunity.observedAt,
      closedAt: null,
      exitCreditPerUnit: null,
      currentExitCreditPerUnit: round(candidate.opportunity.longLeg.bid - candidate.opportunity.shortLeg.ask),
      unrealizedGrossPnl: round((candidate.opportunity.longLeg.bid - candidate.opportunity.shortLeg.ask - candidate.opportunity.entryDebitPerUnit) * candidate.opportunity.quantity),
      unrealizedNetPnl: round((candidate.opportunity.longLeg.bid - candidate.opportunity.shortLeg.ask - candidate.opportunity.entryDebitPerUnit) * candidate.opportunity.quantity - candidate.opportunity.estimatedCharges - candidate.opportunity.estimatedSlippage),
      lastMarkedAt: candidate.opportunity.observedAt,
      underlyingExitSpot: null,
      signalCorrect: null,
      grossPnl: 0,
      netPnl: 0,
      actualCosts: candidate.opportunity.estimatedCharges,
      slippageCost: candidate.opportunity.estimatedSlippage,
      exitReason: null,
      sandboxOrderIds,
    });
    state.metrics = calculateMetrics(state.positions, config.portfolioCapital);
    state.evaluation = evaluateStrategy(state.positions, state.metrics, state.stage, config);
    await writeOptionsQuantState(state);
    return state;
  } catch (error) {
    return persistNoTrade(state, [error instanceof Error ? error.message : "Upstox scan failed."], config);
  }
}

export async function buildOpportunity(
  direction: DirectionEvidence,
  chain: OptionChainRow[],
  lotSize: number,
  broker: OptionsBroker,
  config: OptionsQuantConfig,
): Promise<{ opportunity: OptionsOpportunity | null; reasons: string[] }> {
  if (direction.direction === "UNCLEAR") return { opportunity: null, reasons: ["Direction is UNCLEAR."] };
  const spot = chain[0]?.spot || 0;
  const optionType = direction.direction === "BULLISH" ? "CE" : "PE";
  const eligible = chain
    .map((row) => optionType === "CE" ? row.call : row.put)
    .filter((leg): leg is OptionLeg => Boolean(leg))
    .filter((leg) => leg.oi >= config.minimumOiPerLeg && leg.volume >= config.minimumVolumePerLeg)
    .filter((leg) => leg.bidAskSpreadPercent <= config.maximumBidAskSpreadPercent);

  const longLeg = eligible
    .filter((leg) => Math.abs(leg.delta) >= 0.45 && Math.abs(leg.delta) <= 0.65)
    .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))[0];
  const shortLeg = eligible
    .filter((leg) => direction.direction === "BULLISH" ? leg.strike > (longLeg?.strike || Infinity) : leg.strike < (longLeg?.strike || -Infinity))
    .filter((leg) => Math.abs(leg.delta) >= 0.2 && Math.abs(leg.delta) <= 0.4)
    .sort((a, b) => Math.abs(a.strike - (longLeg?.strike || spot)) - Math.abs(b.strike - (longLeg?.strike || spot)))[0];
  if (!longLeg || !shortLeg) return { opportunity: null, reasons: ["No option pair passed delta, OI, volume, and bid-ask liquidity gates."] };

  longLeg.side = "BUY";
  shortLeg.side = "SELL";
  const debit = round(longLeg.ask - shortLeg.bid);
  const width = Math.abs(shortLeg.strike - longLeg.strike);
  if (!(debit > 0 && debit < width)) return { opportunity: null, reasons: ["Executable spread debit is invalid relative to strike width."] };

  const quantity = lotSize;
  const charges = await broker.estimateCharges([
    { instrumentKey: longLeg.instrumentKey, quantity, transactionType: "BUY", price: longLeg.ask },
    { instrumentKey: shortLeg.instrumentKey, quantity, transactionType: "SELL", price: shortLeg.bid },
    { instrumentKey: longLeg.instrumentKey, quantity, transactionType: "SELL", price: longLeg.bid },
    { instrumentKey: shortLeg.instrumentKey, quantity, transactionType: "BUY", price: shortLeg.ask },
  ]);
  const slippage = round((longLeg.ask + shortLeg.bid + longLeg.bid + shortLeg.ask) * quantity * config.slippageBpsPerLeg / 10_000);
  const maxLoss = round(debit * quantity + charges + slippage);
  const maxProfit = round((width - debit) * quantity - charges - slippage);
  const riskReward = round(maxProfit / maxLoss);
  const allowedRisk = config.portfolioCapital * config.riskPerTradePercent / 100;
  const reasons: string[] = [];
  if (maxLoss > allowedRisk) reasons.push(`Maximum loss ₹${maxLoss} exceeds configured risk budget ₹${round(allowedRisk)}.`);
  if (riskReward < config.minimumRiskReward) reasons.push(`Risk/reward ${riskReward} is below ${config.minimumRiskReward}.`);
  if (maxProfit < config.profitTargetRupees) reasons.push(`Maximum net profit ₹${maxProfit} cannot reach the configured ₹${config.profitTargetRupees} per-trade target.`);
  if (reasons.length) return { opportunity: null, reasons };

  const observedAt = new Date().toISOString();
  const expiry = chain[0].expiry;
  const strategy: SpreadStrategy = direction.direction === "BULLISH" ? "BULL_CALL_SPREAD" : "BEAR_PUT_SPREAD";
  return {
    opportunity: {
      id: `${Date.now()}-${strategy}`,
      observedAt,
      underlying: "NIFTY 50",
      underlyingSpot: spot,
      direction: direction.direction,
      strategy,
      expiry,
      daysToExpiry: daysBetween(new Date(), new Date(`${expiry}T15:30:00+05:30`)),
      lotSize,
      quantity,
      longLeg,
      shortLeg,
      entryDebitPerUnit: debit,
      maxProfit,
      maxLoss,
      profitTargetRupees: config.profitTargetRupees,
      breakeven: round(direction.direction === "BULLISH" ? longLeg.strike + debit : longLeg.strike - debit),
      riskReward,
      averageIv: round((longLeg.iv + shortLeg.iv) / 2),
      netDelta: round(longLeg.delta - shortLeg.delta),
      totalOi: longLeg.oi + shortLeg.oi,
      totalVolume: longLeg.volume + shortLeg.volume,
      worstBidAskSpreadPercent: Math.max(longLeg.bidAskSpreadPercent, shortLeg.bidAskSpreadPercent),
      estimatedCharges: charges,
      estimatedSlippage: slippage,
      confidence: Math.min(100, Math.round(direction.confidence * 0.8 + liquidityQuality(longLeg, shortLeg, config) * 0.2)),
      exitRules: [
        "Exit when executable spread value loses 50% of entry debit.",
        `Take profit when estimated net P&L reaches ₹${config.profitTargetRupees}.`,
        "Exit before 15:15 IST on the session preceding expiry or on direction invalidation.",
        "Never average down; one active NIFTY spread maximum.",
      ],
      directionModelVersion: direction.modelVersion,
      directionSourceIds: direction.sourceIds,
      dataSource: "UPSTOX_LIVE_OPTION_CHAIN",
    },
    reasons: [],
  };
}

async function markOpenPositions(state: OptionsQuantState, chain: OptionChainRow[], broker: OptionsBroker, config: OptionsQuantConfig) {
  for (const position of state.positions.filter((item) => item.status === "OPEN")) {
    const legs = chain.flatMap((row) => [row.call, row.put]).filter((leg): leg is OptionLeg => Boolean(leg));
    const long = legs.find((leg) => leg.instrumentKey === position.longLeg.instrumentKey);
    const short = legs.find((leg) => leg.instrumentKey === position.shortLeg.instrumentKey);
    if (!long || !short) continue;
    const exitCredit = round(long.bid - short.ask);
    position.currentExitCreditPerUnit = exitCredit;
    position.unrealizedGrossPnl = round((exitCredit - position.entryDebitPerUnit) * position.quantity);
    position.unrealizedNetPnl = round(position.unrealizedGrossPnl - position.estimatedCharges - position.estimatedSlippage);
    position.lastMarkedAt = new Date().toISOString();
    const stopCredit = position.entryDebitPerUnit * 0.5;
    let exitReason: string | null = null;
    if (position.unrealizedNetPnl >= (position.profitTargetRupees ?? config.profitTargetRupees)) exitReason = "PROFIT_TARGET";
    else if (exitCredit <= stopCredit) exitReason = "MAX_DEBIT_LOSS_STOP";
    else if (isFreshDirectionInvalidation(state.direction, position.direction, config)) exitReason = "DIRECTION_INVALIDATED";
    else if (daysBetween(new Date(), new Date(`${position.expiry}T15:30:00+05:30`)) <= 2 && istMinutes(new Date()) >= 15 * 60 + 10) exitReason = "EXPIRY_RISK_EXIT";
    if (!exitReason) continue;
    if (position.mode === "UPSTOX_SANDBOX") {
      const exitIds = await broker.submitSandboxExit({
        quantity: position.quantity,
        longInstrumentKey: long.instrumentKey,
        shortInstrumentKey: short.instrumentKey,
        longLimitPrice: long.bid,
        shortLimitPrice: short.ask,
        tag: `oq_exit_${position.id}`,
      });
      position.sandboxOrderIds.push(...exitIds);
    }
    position.status = "CLOSED";
    position.closedAt = new Date().toISOString();
    position.exitCreditPerUnit = exitCredit;
    position.underlyingExitSpot = chain[0]?.spot || null;
    position.signalCorrect = position.underlyingExitSpot === null
      ? null
      : position.direction === "BULLISH"
        ? position.underlyingExitSpot > position.underlyingSpot
        : position.underlyingExitSpot < position.underlyingSpot;
    position.exitReason = exitReason;
    position.grossPnl = round((exitCredit - position.entryDebitPerUnit) * position.quantity);
    position.actualCosts = position.estimatedCharges;
    position.netPnl = round(position.grossPnl - position.actualCosts - position.slippageCost);
  }
}

export function calculateMetrics(positions: OptionsPosition[], capital: number): PerformanceMetrics {
  const closed = positions.filter((position) => position.status === "CLOSED");
  const wins = closed.filter((position) => position.netPnl > 0);
  const losses = closed.filter((position) => position.netPnl <= 0);
  const grossProfit = wins.reduce((sum, position) => sum + position.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, position) => sum + position.netPnl, 0));
  let equity = 0;
  let peak = 0;
  let maximumDrawdown = 0;
  for (const position of [...closed].sort((a, b) => a.openedAt.localeCompare(b.openedAt))) {
    equity += position.netPnl;
    peak = Math.max(peak, equity);
    maximumDrawdown = Math.max(maximumDrawdown, peak - equity);
  }
  const strategyPerformance = (["BULL_CALL_SPREAD", "BEAR_PUT_SPREAD"] as SpreadStrategy[]).reduce((result, strategy) => {
    const trades = closed.filter((position) => position.strategy === strategy);
    result[strategy] = {
      trades: trades.length,
      netPnl: round(trades.reduce((sum, position) => sum + position.netPnl, 0)),
      winRate: trades.length ? round(trades.filter((position) => position.netPnl > 0).length / trades.length * 100) : 0,
    };
    return result;
  }, {} as PerformanceMetrics["strategyPerformance"]);
  const maxCapitalUsed = positions.reduce((max, position) => Math.max(max, position.maxLoss), 0);
  return {
    closedTrades: closed.length,
    grossPnl: round(closed.reduce((sum, position) => sum + position.grossPnl, 0)),
    netPnl: round(closed.reduce((sum, position) => sum + position.netPnl, 0)),
    winRate: closed.length ? round(wins.length / closed.length * 100) : 0,
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : (grossProfit > 0 ? null : 0),
    expectancyPerTrade: closed.length ? round(closed.reduce((sum, position) => sum + position.netPnl, 0) / closed.length) : 0,
    maximumDrawdown: round(maximumDrawdown),
    averageWin: wins.length ? round(grossProfit / wins.length) : 0,
    averageLoss: losses.length ? round(losses.reduce((sum, position) => sum + position.netPnl, 0) / losses.length) : 0,
    costs: round(closed.reduce((sum, position) => sum + position.actualCosts, 0)),
    slippage: round(closed.reduce((sum, position) => sum + position.slippageCost, 0)),
    signalAccuracy: closed.some((position) => position.signalCorrect !== null)
      ? round(closed.filter((position) => position.signalCorrect === true).length / closed.filter((position) => position.signalCorrect !== null).length * 100)
      : 0,
    capitalUtilisation: capital > 0 ? round(maxCapitalUsed / capital * 100) : 0,
    strategyPerformance,
  };
}

export function evaluateStrategy(positions: OptionsPosition[], metrics: PerformanceMetrics, stage: OptionsQuantState["stage"], config: OptionsQuantConfig): StrategyEvaluation {
  const shadowTrades = positions.filter((position) => position.status === "CLOSED" && position.mode === "SHADOW").length;
  // Sandbox fills validate integration but are not real-money performance evidence.
  const realTrades = 0;
  const drawdownLimit = config.portfolioCapital * config.maximumDrawdownPercent / 100;
  const reasons: string[] = [];
  let decision: StrategyEvaluation["decision"] = "CONTINUE";
  if (stage === "FAILED" || (metrics.closedTrades >= config.minimumShadowTrades && (metrics.expectancyPerTrade <= 0 || (metrics.profitFactor ?? 0) < 1 || metrics.maximumDrawdown > drawdownLimit))) {
    decision = "STOP";
    reasons.push("Measured edge is absent or drawdown breached the configured limit; disable new entries.");
  } else if (stage === "SMALL_LIVE" && realTrades >= config.minimumRealTrades && metrics.expectancyPerTrade > 0 && (metrics.profitFactor ?? 0) >= 1.2 && metrics.maximumDrawdown <= drawdownLimit) {
    decision = "SCALE";
    reasons.push("Minimum real-trade evidence and risk-adjusted thresholds are satisfied.");
  } else if (shadowTrades === 0) {
    decision = "GO";
    reasons.push("Begin or continue Phase 1 shadow collection; no profitability claim is available yet.");
  } else {
    reasons.push(`${shadowTrades}/${config.minimumShadowTrades} minimum shadow trades completed; continue without scaling.`);
  }
  return { decision, evaluatedAt: new Date().toISOString(), reasons, minimumShadowTrades: config.minimumShadowTrades, minimumRealTrades: config.minimumRealTrades };
}

function validateDirection(input: unknown): DirectionEvidence {
  if (!input || typeof input !== "object") throw new Error("Direction evidence must be an object.");
  const raw = input as Partial<DirectionEvidence>;
  if (!raw.asOf || !Number.isFinite(Date.parse(raw.asOf))) throw new Error("Direction evidence requires a valid asOf timestamp.");
  if (!raw.direction || !["BULLISH", "BEARISH", "UNCLEAR"].includes(raw.direction)) throw new Error("Invalid NIFTY direction.");
  for (const key of ["confidence", "trendStrength", "bankNiftyConfirmation", "optionChainConfirmation"] as const) {
    if (!Number.isFinite(raw[key]) || Number(raw[key]) < 0 || Number(raw[key]) > 100) throw new Error(`${key} must be between 0 and 100.`);
  }
  if (!raw.marketRegime || !raw.modelVersion || !raw.observations || !Array.isArray(raw.sourceIds) || raw.sourceIds.length < 3) throw new Error("Direction provenance is incomplete.");
  return raw as DirectionEvidence;
}

function directionRejections(direction: DirectionEvidence | null, config: OptionsQuantConfig): string[] {
  if (!direction) return ["No market-intelligence direction evidence is available."];
  if (direction.direction === "UNCLEAR") return ["Live Upstox direction is UNCLEAR."];
  const age = (Date.now() - Date.parse(direction.asOf)) / 60_000;
  const reasons: string[] = [];
  if (age < 0 || age > config.maximumDirectionAgeMinutes) reasons.push("Market-intelligence direction is stale.");
  if (direction.confidence < config.minimumDirectionConfidence) reasons.push("Underlying direction confidence is insufficient.");
  if (direction.trendStrength < 60) reasons.push("NIFTY intraday trend strength does not confirm direction.");
  if (direction.bankNiftyConfirmation < 50) reasons.push("Bank NIFTY does not confirm direction.");
  if (direction.optionChainConfirmation < 45) reasons.push("NIFTY option-chain OI does not confirm direction.");
  return reasons;
}

function chooseExpiry(contracts: OptionContract[], now: Date, config: OptionsQuantConfig): { expiry: string; lotSize: number } | null {
  const candidates = contracts.map((contract) => ({ expiry: contract.expiry, lotSize: contract.lotSize, dte: daysBetween(now, new Date(`${contract.expiry}T15:30:00+05:30`)) }))
    .filter((item) => item.dte >= config.minimumDaysToExpiry && item.dte <= config.maximumDaysToExpiry)
    .sort((a, b) => a.expiry.localeCompare(b.expiry));
  return candidates[0] || null;
}

function nseMarketDataRejection(date: Date): string | null {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (["Sat", "Sun"].includes(value.weekday)) return "NSE is closed; executable live bid/ask validation is unavailable.";
  const minutes = Number(value.hour) * 60 + Number(value.minute);
  return minutes < 9 * 60 + 15 || minutes > 15 * 60 + 25 ? "Outside the NSE live quote monitoring window (09:15–15:25 IST)." : null;
}

function nseEntryRejection(date: Date): string | null {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const minutes = Number(value.hour) * 60 + Number(value.minute);
  return minutes < 9 * 60 + 20 || minutes > 14 * 60 + 45 ? "Outside the configured new-entry window (09:20–14:45 IST)." : null;
}

function isFreshDirectionInvalidation(direction: DirectionEvidence | null, original: "BULLISH" | "BEARISH", config: OptionsQuantConfig): boolean {
  if (!direction) return false;
  const age = (Date.now() - Date.parse(direction.asOf)) / 60_000;
  return age >= 0 && age <= config.maximumDirectionAgeMinutes && direction.direction !== original;
}

function istMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(value.hour) * 60 + Number(value.minute);
}

async function persistNoTrade(state: OptionsQuantState, reasons: string[], config: OptionsQuantConfig): Promise<OptionsQuantState> {
  state.liveOpportunity = null;
  state.noTradeReasons = reasons;
  state.metrics = calculateMetrics(state.positions, config.portfolioCapital);
  state.evaluation = evaluateStrategy(state.positions, state.metrics, state.stage, config);
  if (state.evaluation.decision === "STOP") state.stage = "FAILED";
  await writeOptionsQuantState(state);
  return state;
}

function liquidityQuality(longLeg: OptionLeg, shortLeg: OptionLeg, config: OptionsQuantConfig): number {
  const worstSpread = Math.max(longLeg.bidAskSpreadPercent, shortLeg.bidAskSpreadPercent);
  return Math.max(0, Math.min(100, 100 - (worstSpread / config.maximumBidAskSpreadPercent) * 50));
}

function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / 86_400_000);
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

export function netPnlForIstDay(positions: OptionsPosition[], now: Date): number {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return round(positions
    .filter((position) => position.status === "CLOSED" && position.closedAt)
    .filter((position) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(position.closedAt!)) === day)
    .reduce((sum, position) => sum + position.netPnl, 0));
}
