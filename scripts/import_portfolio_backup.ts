await loadEnvFile(".env");
await loadEnvFile(".env.local");

const confirmed = process.argv.includes("--confirm");
if (!confirmed) {
  console.error("This command writes CSV backup portfolios back to Google Sheets.");
  console.error("Run with --confirm after verifying data/portfolio-backups/*.csv.");
  process.exit(1);
}

const { isGoogleSheetsConfigured, savePortfolioToSheets } = await import("../lib/google-sheets");
const { readPortfoliosFromCsvBackup } = await import("../lib/portfolio-backup");
const { isActivePortfolioName } = await import("../lib/users");

if (!isGoogleSheetsConfigured()) {
  console.error("Google Sheets credentials are not configured in this environment.");
  process.exit(1);
}

const portfolios = (await readPortfoliosFromCsvBackup()).filter((portfolio) =>
  isActivePortfolioName(portfolio.name),
);

if (portfolios.length === 0) {
  console.error("No CSV backup portfolios found. Nothing was written.");
  process.exit(1);
}

for (const portfolio of portfolios) {
  await savePortfolioToSheets(portfolio);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      importedPortfolioCount: portfolios.length,
      importedHoldingCount: portfolios.reduce((sum, portfolio) => sum + portfolio.inputs.length, 0),
      portfolios: portfolios.map((portfolio) => portfolio.name),
    },
    null,
    2,
  ),
);

async function loadEnvFile(filePath: string) {
  const { readFile } = await import("node:fs/promises");
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
