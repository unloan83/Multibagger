import type {
  AgentRecommendationLog,
  BayesianAdjustment,
  BayesianAgentBelief,
  BayesianOutput,
  BayesianState,
  OrchestratorWeights,
} from "@/lib/agents/types";

const PRIOR_ALPHA = 1;
const PRIOR_BETA = 1;
const MIN_OBSERVATIONS = 3;
const MAX_MULTIPLIER = 1.5;
const MIN_MULTIPLIER = 0.5;

const AGENTS: (keyof OrchestratorWeights)[] = [
  "existingLogic",
  "info",
  "macroPolicy",
  "sentiment",
  "portfolio",
  "riskValidation",
  "fundamental",
  "technical",
  "intraday",
  "swing",
  "longTerm",
  "earningsQuality",
  "rebalance",
];

function timeframeGroup(timeframe: string): string {
  if (timeframe === "Intraday") return "intraday";
  if (timeframe === "Short term" || timeframe === "3-6 months") return "swing";
  return "longTerm";
}

function posteriorMean(alpha: number, beta: number): number {
  return alpha / (alpha + beta);
}

function posteriorVariance(alpha: number, beta: number): number {
  const total = alpha + beta;
  return (alpha * beta) / (total * total * (total + 1));
}

function computeBelief(hits: number, misses: number): BayesianAgentBelief {
  return {
    alpha: PRIOR_ALPHA + hits,
    beta: PRIOR_BETA + misses,
    totalObservations: hits + misses,
  };
}

function computeUncertainty(belief: BayesianAgentBelief): number {
  const variance = posteriorVariance(belief.alpha, belief.beta);
  const maxVariance = 0.08333;
  return Math.round(Math.min(variance / maxVariance, 1) * 100);
}

function computeMultiplier(reliability: number, observations: number): number {
  if (observations < MIN_OBSERVATIONS) return 1.0;
  const ratio = reliability / 50;
  return Math.round(Math.max(MIN_MULTIPLIER, Math.min(MAX_MULTIPLIER, ratio)) * 100) / 100;
}

function buildState(
  logs: AgentRecommendationLog[],
): BayesianState {
  const grouped = new Map<string, Map<string, { hits: number; misses: number }>>();

  for (const log of logs) {
    if (log.status === "pending") continue;
    const tfGroup = timeframeGroup(log.timeframe);

    const contributors = [
      ...log.positiveContributors.map((a) => ({ agent: a, positive: true })),
      ...log.negativeContributors.map((a) => ({ agent: a, positive: false })),
    ];

    for (const { agent, positive } of contributors) {
      const aligned = log.finalAction === "Sell" ? !positive : positive;
      const correct = log.status === "hit" ? aligned : !aligned;

      if (!grouped.has(agent)) {
        grouped.set(agent, new Map());
      }
      const tfEntry = grouped.get(agent)!.get(tfGroup);
      if (!tfEntry) {
        grouped.get(agent)!.set(tfGroup, { hits: 0, misses: 0 });
      }
      if (correct) {
        grouped.get(agent)!.get(tfGroup)!.hits++;
      } else {
        grouped.get(agent)!.get(tfGroup)!.misses++;
      }
    }
  }

  const byAgent: Record<string, Record<string, BayesianAgentBelief>> = {};
  for (const [agent, tfMap] of grouped) {
    byAgent[agent] = {};
    for (const [tf, counts] of tfMap) {
      byAgent[agent][tf] = computeBelief(counts.hits, counts.misses);
    }
  }

  return {
    byAgent,
    lastUpdated: new Date().toISOString(),
  };
}

function buildAdjustments(
  state: BayesianState,
): BayesianAdjustment[] {
  return AGENTS.map((agent) => {
    const agentState = state.byAgent[agent];
    if (!agentState || Object.keys(agentState).length === 0) {
      return {
        agent,
        reliability: 50,
        uncertainty: 100,
        weightMultiplier: 1.0,
        observations: 0,
      };
    }

    const beliefs = Object.values(agentState);
    const totalObs = beliefs.reduce((s, b) => s + b.totalObservations, 0);
    const avgReliability = Math.round(
      beliefs.reduce((s, b) => s + posteriorMean(b.alpha, b.beta) * b.totalObservations, 0) /
        Math.max(totalObs, 1) *
        100,
    );
    const avgUncertainty = Math.round(
      beliefs.reduce((s, b) => s + computeUncertainty(b), 0) / beliefs.length,
    );

    return {
      agent,
      reliability: avgReliability,
      uncertainty: avgUncertainty,
      weightMultiplier: computeMultiplier(avgReliability, totalObs),
      observations: totalObs,
    };
  });
}

export function computeBayesianAdjustments(
  logs: AgentRecommendationLog[],
  _weights: OrchestratorWeights,
): BayesianOutput {
  try {
    const state = buildState(logs);
    const adjustments = buildAdjustments(state);

    const reliable = adjustments.filter((a) => a.reliability >= 60 && a.observations >= MIN_OBSERVATIONS);
    const unreliable = adjustments.filter((a) => a.reliability < 45 && a.observations >= MIN_OBSERVATIONS);
    const insufficient = adjustments.filter((a) => a.observations < MIN_OBSERVATIONS);

    const parts: string[] = [];
    if (reliable.length) {
      parts.push(`${reliable.length} agent(s) showing above-average reliability (${reliable.map((a) => `${a.agent} ${a.reliability}%`).join(", ")})`);
    }
    if (unreliable.length) {
      parts.push(`${unreliable.length} agent(s) below reliability threshold (${unreliable.map((a) => `${a.agent} ${a.reliability}%`).join(", ")})`);
    }
    if (insufficient.length) {
      parts.push(`${insufficient.length} agent(s) still gathering data`);
    }

    return {
      adjustments,
      state,
      summary: parts.length
        ? parts.join("; ") + "."
        : "No outcome data yet — all agents at neutral prior.",
    };
  } catch {
    return {
      adjustments: AGENTS.map((agent) => ({
        agent,
        reliability: 50,
        uncertainty: 100,
        weightMultiplier: 1.0,
        observations: 0,
      })),
      state: { byAgent: {}, lastUpdated: new Date().toISOString() },
      summary: "Bayesian computation failed — all agents at default weights.",
    };
  }
}

export { AGENTS as BAYESIAN_AGENTS };
