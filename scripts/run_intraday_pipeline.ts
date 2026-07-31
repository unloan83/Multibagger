import { runIntradayPipeline, type IntradaySlot } from "../lib/intraday-engine";

async function main() {
  const slotArg = process.argv.find((arg) => arg.startsWith("--slot="))?.split("=")[1] as IntradaySlot | undefined;
  const slot: IntradaySlot = slotArg && ["09:08", "10:45", "13:45"].includes(slotArg) ? slotArg : "09:08";

  console.log(`\n🚀 [INTRADAY PIPELINE] Running Real-Time Engine for Slot: ${slot} IST...`);
  const snapshot = await runIntradayPipeline(slot);

  console.log(`✅ Completed Intraday Pipeline Execution:`);
  console.log(`   As Of: ${snapshot.asOf}`);
  console.log(`   Slot Label: ${snapshot.slotLabel}`);
  console.log(`   Market Breadth: ${snapshot.marketBreadth.advancers} Adv / ${snapshot.marketBreadth.decliners} Dec (Ratio: ${snapshot.marketBreadth.advanceDeclineRatio})`);
  console.log(`   Index Trend: Nifty50 (${snapshot.indexTrend.nifty50ChangePercent}%), BankNifty (${snapshot.indexTrend.bankNiftyChangePercent}%) - ${snapshot.indexTrend.trend}`);
  console.log(`   Top Intraday Breakout Picks (${snapshot.picks.length}):`);
  
  for (const pick of snapshot.picks) {
    console.log(`   • ${pick.symbol} (${pick.name}): ₹${pick.price} | Target: ₹${pick.target} (+${pick.upside}%) | RVOL: ${pick.rvol}x | VWAP: ₹${pick.vwap} | Status: ${pick.orbStatus}`);
  }
}

main().catch((err) => {
  console.error("❌ Intraday Pipeline Error:", err);
  process.exit(1);
});
