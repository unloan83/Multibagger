import { runOptionsQuantScan } from "@/features/options-quant/lib/engine";

const state = await runOptionsQuantScan();
console.log(JSON.stringify({
  asOf: state.asOf,
  stage: state.stage,
  opportunity: state.liveOpportunity?.id || null,
  openPositions: state.positions.filter((position) => position.status === "OPEN").length,
  noTradeReasons: state.noTradeReasons,
  evaluation: state.evaluation.decision,
}));
