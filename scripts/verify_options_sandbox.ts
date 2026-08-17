import { loadEnvConfig } from "@next/env";
import { UpstoxOptionsBroker } from "@/features/options-quant/brokers/upstox";
import type { OptionLeg } from "@/features/options-quant/lib/types";

async function main() {
  loadEnvConfig(process.cwd());
  if (!process.argv.includes("--execute")) throw new Error("Refusing sandbox mutation without --execute.");
  if (process.env.UPSTOX_MODE !== "SANDBOX" || process.env.LIVE_TRADING_ENABLED !== "false") {
    throw new Error("Sandbox safety flags are not set.");
  }

  const broker = new UpstoxOptionsBroker();
  const now = new Date();
  const contracts = await broker.getOptionContracts("NSE_INDEX|Nifty 50");
  const expiry = [...new Set(contracts.map((contract) => contract.expiry))]
    .map((value) => ({ value, days: Math.ceil((Date.parse(`${value}T15:30:00+05:30`) - now.getTime()) / 86_400_000) }))
    .filter(({ days }) => days >= 2 && days <= 10)
    .sort((left, right) => left.value.localeCompare(right.value))[0]?.value;
  if (!expiry) throw new Error("No 2–10 DTE NIFTY expiry is available for sandbox verification.");

  const chain = await broker.getOptionChain("NSE_INDEX|Nifty 50", expiry);
  const calls = chain.map((row) => row.call).filter((leg): leg is OptionLeg => Boolean(leg))
    .sort((left, right) => left.strike - right.strike);
  const long = calls.filter((leg) => Math.abs(leg.delta) >= 0.45 && Math.abs(leg.delta) <= 0.65)
    .sort((left, right) => Math.abs(left.delta - 0.5) - Math.abs(right.delta - 0.5))[0];
  const short = calls.filter((leg) => long && leg.strike > long.strike && Math.abs(leg.delta) >= 0.2 && Math.abs(leg.delta) <= 0.4)
    .sort((left, right) => left.strike - right.strike)[0];
  if (!long || !short) throw new Error("No executable NIFTY call pair is available for sandbox verification.");
  const contract = contracts.find((item) => item.instrumentKey === long.instrumentKey);
  if (!contract?.lotSize) throw new Error("Could not resolve the current NIFTY lot size.");

  const tag = `oq_verify_${Date.now()}`.slice(0, 40);
  const entryOrderIds = await broker.submitSandboxSpread({
    quantity: contract.lotSize,
    longInstrumentKey: long.instrumentKey,
    shortInstrumentKey: short.instrumentKey,
    longLimitPrice: long.ask,
    shortLimitPrice: short.bid,
    tag,
  });
  const exitOrderIds = await broker.submitSandboxExit({
    quantity: contract.lotSize,
    longInstrumentKey: long.instrumentKey,
    shortInstrumentKey: short.instrumentKey,
    longLimitPrice: long.bid,
    shortLimitPrice: short.ask,
    tag: `${tag}_exit`.slice(0, 40),
  });

  console.log(JSON.stringify({
    mode: "UPSTOX_SANDBOX",
    expiry,
    lotSize: contract.lotSize,
    longInstrumentKey: long.instrumentKey,
    shortInstrumentKey: short.instrumentKey,
    entryOrderIds,
    exitOrderIds,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
