import { runSwingPipeline } from "../lib/swing-engine";

async function main() {
  console.log(`\n📊 [SWING/POSITIONAL PIPELINE] Running EOD Engine (7:00 PM IST)...`);
  const snapshot = await runSwingPipeline();

  console.log(`✅ Completed Swing EOD Pipeline Execution:`);
  console.log(`   As Of: ${snapshot.asOf}`);
  console.log(`   Execution Time: ${snapshot.runTimeIST}`);
  console.log(`   Market Regime: ${snapshot.marketRegime}`);
  console.log(`   Total Positional Picks: ${snapshot.picks.length}`);
  
  for (const pick of snapshot.picks) {
    const mbTag = pick.isMultibagger ? " 🚀 MULTIBAGGER" : "";
    console.log(`   • ${pick.symbol} (${pick.name}): ₹${pick.price} -> Target: ₹${pick.target} (+${pick.upside}%) | Horizon: ${pick.horizonLabel} | D/E: ${pick.debtToEquity} | CFO/NI: ${pick.cfoNetIncomeRatio}x${mbTag}`);
  }
}

main().catch((err) => {
  console.error("❌ Swing EOD Pipeline Error:", err);
  process.exit(1);
});
