import { access, readFile } from "node:fs/promises";
import path from "node:path";
import {
  parseQuantity,
  type InvestmentAppetite,
  type ManagedPortfolio,
  type PortfolioInputRow,
  type PortfolioList,
} from "@/lib/portfolio";

export const portfolioBackupDir = path.join(process.cwd(), "data", "portfolio-backups");

const portfoliosCsvPath = path.join(portfolioBackupDir, "portfolios.csv");
const holdingsCsvPath = path.join(portfolioBackupDir, "holdings.csv");
const appetiteValues = new Set<InvestmentAppetite>(["safe", "moderate", "aggressive"]);
const listValues = new Set<PortfolioList>(["current", "watchlist"]);

export function shouldUsePortfolioCsvBackup() {
  return process.env.PORTFOLIO_SOURCE === "csv-backup";
}

export async function hasPortfolioCsvBackup() {
  try {
    await Promise.all([access(portfoliosCsvPath), access(holdingsCsvPath)]);
    return true;
  } catch {
    return false;
  }
}

export async function readPortfoliosFromCsvBackup(): Promise<ManagedPortfolio[]> {
  if (!(await hasPortfolioCsvBackup())) return [];

  const [portfolioRows, holdingRows] = await Promise.all([
    readCsvFile(portfoliosCsvPath),
    readCsvFile(holdingsCsvPath),
  ]);
  const holdingsByPortfolio = new Map<string, PortfolioInputRow[]>();

  for (const row of holdingRows) {
    const portfolioId = row.portfolio_id?.trim();
    if (!portfolioId) continue;

    const quantity = parseQuantity(row.quantity);
    const list = listValues.has(row.list as PortfolioList)
      ? (row.list as PortfolioList)
      : quantity > 0
        ? "current"
        : "watchlist";
    const stockCode = row.stock_code?.trim().toUpperCase() ?? "";
    const company = row.company?.trim() ?? "";
    const holding: PortfolioInputRow = {
      buyPrice: undefined,
      company,
      list,
      quantity: quantity > 0 ? quantity : 0,
      stock: stockCode || company,
      stockCode,
    };

    holdingsByPortfolio.set(portfolioId, [
      ...(holdingsByPortfolio.get(portfolioId) ?? []),
      holding,
    ]);
  }

  return portfolioRows
    .map((row): ManagedPortfolio | null => {
      const id = row.id?.trim() ?? "";
      const name = row.name?.trim() ?? "";
      if (!id || !name) return null;

      const appetite = appetiteValues.has(row.appetite as InvestmentAppetite)
        ? (row.appetite as InvestmentAppetite)
        : "moderate";

      return {
        appetite,
        id,
        inputs: holdingsByPortfolio.get(id) ?? [],
        isMarketPortfolio: row.is_market_portfolio === "TRUE",
        name,
        positions: [],
        refreshedAt: row.refreshed_at ?? row.exported_at ?? "",
      };
    })
    .filter((portfolio): portfolio is ManagedPortfolio => Boolean(portfolio));
}

async function readCsvFile(filePath: string) {
  const csv = await readFile(filePath, "utf8");
  const [headerLine, ...lines] = csv.split(/\r?\n/u).filter(Boolean);
  if (!headerLine) return [];

  const headers = parseCsvLine(headerLine);
  return lines.map((line) => {
    const values = parseCsvLine(line);
    return headers.reduce<Record<string, string>>((row, header, index) => {
      row[header] = values[index] ?? "";
      return row;
    }, {});
  });
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}
