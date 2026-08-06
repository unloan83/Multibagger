import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const outputPath = path.join(repoRoot, "data", "daily_recommendations.csv");
const snapshotPath = path.join(repoRoot, "data", "wealth_recommendations.json");
const headers = ["date", "run_time_ist", "run_slot", "stock_name", "symbol", "category", "source", "segment", "action", "cmp", "previous_close", "change_percent", "target", "upside_percent", "volume", "volume_shock", "portfolio", "notes", "decision_score", "data_quality", "factor_summary"];
const slot = process.argv.includes("--slot") ? process.argv[process.argv.indexOf("--slot") + 1] : "scheduled";
const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
const ageHours = (Date.now() - Date.parse(snapshot.asOf)) / 3_600_000;
if (!Number.isFinite(ageHours) || ageHours < 0 || ageHours > 36 || snapshot.abstained || !String(snapshot.source || "").includes("Yahoo")) {
  throw new Error("No fresh validated wealth snapshot is available; zero recommendation rows were written.");
}
const now = new Date();
const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
const runTime = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "medium" }).format(now);
const rows = snapshot.categories.flatMap((category) => category.longTermUpsides
  .filter((quote) => quote.action === "Accumulate" && quote.dataQuality >= 80 && quote.price >= 150 && quote.price <= 3000)
  .map((quote) => [date, runTime, slot, quote.name, quote.symbol, "expert-long-term", "live-wealth-snapshot", category.title, "Accumulate", quote.price, quote.previousClose, quote.changePercent, quote.target, quote.upside, quote.volume, quote.volumeShock, "", quote.remark, quote.score, quote.dataQuality, JSON.stringify(quote.factorScores)]));
let existing = "";
try { existing = await fs.readFile(outputPath, "utf8"); } catch { /* first run */ }
const safeExistingRows = existing.split(/\r?\n/).filter((line, index) => index === 0 || (!/seed|portfolio-analysis/i.test(line) && line.trim()));
const output = [safeExistingRows[0] || headers.join(","), ...safeExistingRows.slice(1), ...rows.map((row) => row.map(csv).join(","))].join("\n") + "\n";
await fs.writeFile(outputPath, output, "utf8");
console.log(`Wrote ${rows.length} validated live recommendation rows.`);
function csv(value) { const text = String(value ?? ""); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
