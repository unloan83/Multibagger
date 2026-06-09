import { google } from "googleapis";
import type {
  InvestmentAppetite,
  ManagedPortfolio,
  PortfolioInputRow,
} from "@/lib/portfolio";
import { buildPortfolioInputRow } from "@/lib/portfolio";

const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/gu, "\n");

const portfoliosSheet = "Portfolios";
const holdingsSheet = "Holdings";

export function isGoogleSheetsConfigured() {
  return Boolean(spreadsheetId && clientEmail && privateKey);
}

export async function readPortfoliosFromSheets(): Promise<ManagedPortfolio[]> {
  if (!isGoogleSheetsConfigured()) {
    return [];
  }

  const sheets = await getSheetsClient();
  await ensureSheets();
  const [portfolioResponse, holdingResponse] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${portfoliosSheet}!A2:E`,
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${holdingsSheet}!A2:F`,
    }),
  ]);
  const portfolioRows = portfolioResponse.data.values ?? [];
  const holdingRows = holdingResponse.data.values ?? [];

  return portfolioRows.map((row) => {
    const id = String(row[0] ?? "");
    const inputs = holdingRows
      .filter((holding) => String(holding[0] ?? "") === id)
      .map((holding) =>
        buildPortfolioInputRow({
          stockCode: String(holding[1] ?? ""),
          company: String(holding[2] ?? ""),
          quantity: Number(holding[3] ?? 0),
        }),
      );

    return {
      id,
      name: String(row[1] ?? "Portfolio"),
      appetite: (String(row[2] ?? "moderate") || "moderate") as InvestmentAppetite,
      isMarketPortfolio: String(row[3] ?? "") === "TRUE",
      refreshedAt: String(row[4] ?? ""),
      inputs,
      positions: [],
    };
  });
}

export async function savePortfolioToSheets(portfolio: ManagedPortfolio) {
  if (!isGoogleSheetsConfigured()) {
    throw new Error("Google Sheets is not configured.");
  }

  const portfolios = await readPortfoliosFromSheets();
  const nextPortfolios = [
    ...portfolios.filter((item) => item.id !== portfolio.id),
    {
      ...portfolio,
      inputs: portfolio.inputs,
      positions: [],
    },
  ];

  await writePortfolios(nextPortfolios);
}

export async function deletePortfolioFromSheets(id: string) {
  if (!isGoogleSheetsConfigured()) {
    throw new Error("Google Sheets is not configured.");
  }

  const portfolios = await readPortfoliosFromSheets();
  await writePortfolios(portfolios.filter((portfolio) => portfolio.id !== id));
}

async function writePortfolios(portfolios: ManagedPortfolio[]) {
  const sheets = await getSheetsClient();
  await ensureSheets();
  const portfolioValues = portfolios.map((portfolio) => [
    portfolio.id,
    portfolio.name,
    portfolio.appetite,
    portfolio.isMarketPortfolio ? "TRUE" : "FALSE",
    portfolio.refreshedAt ?? new Date().toISOString(),
  ]);
  const holdingValues = portfolios.flatMap((portfolio) =>
    portfolio.inputs.map((row: PortfolioInputRow) => [
      portfolio.id,
      row.stockCode,
      row.company,
      row.quantity,
      row.list,
      new Date().toISOString(),
    ]),
  );

  await sheets.spreadsheets.values.batchClear({
    spreadsheetId,
    requestBody: {
      ranges: [`${portfoliosSheet}!A2:E`, `${holdingsSheet}!A2:F`],
    },
  });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        {
          range: `${portfoliosSheet}!A2:E`,
          values: portfolioValues,
        },
        {
          range: `${holdingsSheet}!A2:F`,
          values: holdingValues,
        },
      ],
    },
  });
}

async function ensureSheets() {
  const sheets = await getSheetsClient();
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const names =
    spreadsheet.data.sheets?.map((sheet) => sheet.properties?.title).filter(Boolean) ??
    [];
  const requests = [portfoliosSheet, holdingsSheet]
    .filter((title) => !names.includes(title))
    .map((title) => ({
      addSheet: {
        properties: { title },
      },
    }));

  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        {
          range: `${portfoliosSheet}!A1:E1`,
          values: [["id", "name", "appetite", "is_market_portfolio", "refreshed_at"]],
        },
        {
          range: `${holdingsSheet}!A1:F1`,
          values: [["portfolio_id", "stock_code", "company", "quantity", "list", "updated_at"]],
        },
      ],
    },
  });
}

async function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}
