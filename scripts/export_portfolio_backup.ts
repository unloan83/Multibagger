import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const backupDir = path.join(repoRoot, "data", "portfolio-backups");

await loadEnvFile(path.join(repoRoot, ".env"));
await loadEnvFile(path.join(repoRoot, ".env.local"));

const { getGoogleSheetsConfigStatus, readPortfoliosFromSheets } = await import("../lib/google-sheets");

const status = getGoogleSheetsConfigStatus();
if (!status.configured) {
  console.error("Google Sheets credentials are not configured in this environment.");
  console.error(JSON.stringify(status, null, 2));
  process.exit(1);
}

const portfolios = await readPortfoliosFromSheets();
if (portfolios.length === 0) {
  console.error("No portfolios were returned from Google Sheets. Export stopped without writing backups.");
  process.exit(1);
}

const timestamp = new Date().toISOString();
const portfolioRows = portfolios.map((portfolio) => ({
  id: portfolio.id,
  name: portfolio.name,
  appetite: portfolio.appetite,
  is_market_portfolio: portfolio.isMarketPortfolio ? "TRUE" : "FALSE",
  refreshed_at: portfolio.refreshedAt ?? "",
  exported_at: timestamp,
}));
const holdingRows = portfolios.flatMap((portfolio) =>
  portfolio.inputs.map((holding) => ({
    portfolio_id: portfolio.id,
    portfolio_name: portfolio.name,
    stock_code: holding.stockCode,
    company: holding.company,
    quantity: String(holding.quantity),
    list: holding.list,
    exported_at: timestamp,
  })),
);

await mkdir(backupDir, { recursive: true });
await writeCsv(path.join(backupDir, "portfolios.csv"), portfolioRows);
await writeCsv(path.join(backupDir, "holdings.csv"), holdingRows);

console.log(
  JSON.stringify(
    {
      ok: true,
      backupDir,
      portfolioCount: portfolios.length,
      holdingCount: holdingRows.length,
      portfolios: portfolios.map((portfolio) => portfolio.name),
    },
    null,
    2,
  ),
);

async function loadEnvFile(filePath: string) {
  let content = "";
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    return;
  }

  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/gu, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

async function writeCsv(filePath: string, rows: Array<Record<string, string>>) {
  const headers = rows[0] ? Object.keys(rows[0]) : [];
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header] ?? "")).join(",")),
  ].join("\n");
  await writeFile(filePath, `${csv}\n`, "utf8");
}

function csvEscape(value: string) {
  if (!/[",\n\r]/u.test(value)) return value;
  return `"${value.replace(/"/gu, '""')}"`;
}
