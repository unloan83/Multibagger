import { runTermAgentAnalysis } from "../lib/term-agent-analysis";

async function main() {
  console.log("🤖 Running Multibagger End-of-Day Term Analysis Agent...");
  const result = await runTermAgentAnalysis();
  console.log(`✅ Term Analysis complete as of ${result.asOf}`);
  console.log(`📊 Total Curated Picks: ${result.totalPicks}`);
  console.log(` - 1 Week Duration: ${result.byDuration["1week"].length} stocks`);
  console.log(` - 1 Month Duration: ${result.byDuration["1month"].length} stocks`);
  console.log(` - 3 Months Duration: ${result.byDuration["3months"].length} stocks`);
  console.log(` - 6 Months Duration: ${result.byDuration["6months"].length} stocks`);
  console.log("💾 Term snapshot saved successfully.");
}

main().catch((err) => {
  console.error("❌ Term Analysis Agent failed:", err);
  process.exit(1);
});
