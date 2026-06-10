import { google } from "googleapis";
import type {
  InvestmentAppetite,
  ManagedPortfolio,
  PortfolioInputRow,
} from "@/lib/portfolio";
import { buildPortfolioInputRow } from "@/lib/portfolio";
import type { MarketQuote } from "@/lib/market-overview";

const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/gu, "\n");

const portfoliosSheet = "Portfolios";
const holdingsSheet = "Holdings";
const validationSheet = "Validation";
const marketMoversSheet = "Market Movers";

export type ValidationSource =
  | "expert-insight"
  | "portfolio-recommendation"
  | "watchlist"
  | "market-recommendation";

export type ValidationRow = {
  timestamp: string;
  source: ValidationSource;
  portfolioName: string;
  section: string;
  symbol: string;
  company: string;
  action: string;
  horizon: string;
  predictedPrice: number;
  targetPrice: number;
  predictedUpsidePercent: number;
  score: number;
  confidence: number;
  caveat: string;
  rationale: string;
};

export type MarketMoverRow = {
  timestamp: string;
  segment: string;
  category: "gainer" | "loser";
  quote: MarketQuote;
};

export function isGoogleSheetsConfigured() {
  return Boolean(spreadsheetId && clientEmail && privateKey);
}

export function getGoogleSheetsConfigStatus() {
  return {
    spreadsheetId: Boolean(spreadsheetId),
    clientEmail: Boolean(clientEmail),
    privateKey: Boolean(privateKey),
    configured: isGoogleSheetsConfigured(),
  };
}

export async function testGoogleSheetsConnection() {
  if (!isGoogleSheetsConfigured()) {
    return {
      ok: false,
      status: getGoogleSheetsConfigStatus(),
      message: "Google Sheets environment variables are incomplete.",
    };
  }

  try {
    const sheets = await getSheetsClient();
    await sheets.spreadsheets.get({ spreadsheetId });
    return {
      ok: true,
      status: getGoogleSheetsConfigStatus(),
      message: "Google Sheets connection is working.",
    };
  } catch (error) {
    return {
      ok: false,
      status: getGoogleSheetsConfigStatus(),
      message: getSafeGoogleError(error),
    };
  }
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

export async function appendValidationRows(rows: ValidationRow[]) {
  if (!isGoogleSheetsConfigured()) {
    throw new Error("Google Sheets is not configured.");
  }

  if (rows.length === 0) {
    return;
  }

  const sheets = await getSheetsClient();
  await ensureSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: rangeFor(validationSheet, "A:S"),
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: rows.map((row) => {
        const date = toIstDate(row.timestamp);

        return [
          toIstTimestamp(row.timestamp),
          date,
          row.source,
          row.portfolioName,
          row.section,
          row.symbol,
          row.company,
          row.action,
          row.horizon,
          row.predictedPrice,
          row.targetPrice,
          row.predictedUpsidePercent,
          row.score,
          row.confidence,
          "NA",
          "",
          "",
          row.caveat,
          row.rationale,
        ];
      }),
    },
  });
}

export async function appendMarketMoverRows(rows: MarketMoverRow[]) {
  if (!isGoogleSheetsConfigured()) {
    throw new Error("Google Sheets is not configured.");
  }

  if (rows.length === 0) {
    return;
  }

  const sheets = await getSheetsClient();
  await ensureSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: rangeFor(marketMoversSheet, "A:N"),
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: rows.map((row) => {
        const date = toIstDate(row.timestamp);

        return [
          toIstTimestamp(row.timestamp),
          date,
          row.segment,
          row.category,
          row.quote.symbol,
          row.quote.name,
          row.quote.price,
          row.quote.previousClose,
          row.quote.change,
          row.quote.changePercent,
          row.quote.volume,
          "NA",
          "",
          "",
        ];
      }),
    },
  });
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
  const portfolioSheetNames = portfolios
    .filter((portfolio) => !portfolio.isMarketPortfolio)
    .map((portfolio) => getPortfolioSheetName(portfolio.name));
  await ensureSheets(portfolioSheetNames);
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
      ranges: [rangeFor(portfoliosSheet, "A2:E"), rangeFor(holdingsSheet, "A2:F")],
    },
  });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        {
          range: rangeFor(portfoliosSheet, "A2:E"),
          values: portfolioValues,
        },
        {
          range: rangeFor(holdingsSheet, "A2:F"),
          values: holdingValues,
        },
      ],
    },
  });

  await Promise.all(
    portfolios
      .filter((portfolio) => !portfolio.isMarketPortfolio)
      .map((portfolio) => writePortfolioTab(sheets, portfolio)),
  );
}

async function writePortfolioTab(
  sheets: Awaited<ReturnType<typeof getSheetsClient>>,
  portfolio: ManagedPortfolio,
) {
  const title = getPortfolioSheetName(portfolio.name);
  const updatedAt = new Date().toISOString();

  await sheets.spreadsheets.values.batchClear({
    spreadsheetId,
    requestBody: {
      ranges: [rangeFor(title, "A2:F")],
    },
  });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        {
          range: rangeFor(title, "A1:F1"),
          values: [["stock_code", "company", "quantity", "list", "appetite", "updated_at"]],
        },
        {
          range: rangeFor(title, "A2:F"),
          values: portfolio.inputs.map((row) => [
            row.stockCode,
            row.company,
            row.quantity,
            row.list,
            portfolio.appetite,
            updatedAt,
          ]),
        },
      ],
    },
  });
}

async function ensureSheets(additionalTitles: string[] = []) {
  const sheets = await getSheetsClient();
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const names =
    spreadsheet.data.sheets?.map((sheet) => sheet.properties?.title).filter(Boolean) ??
    [];
  const requests = [
    portfoliosSheet,
    holdingsSheet,
    validationSheet,
    marketMoversSheet,
    ...additionalTitles,
  ]
    .filter((title, index, titles) => titles.indexOf(title) === index)
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
          range: rangeFor(portfoliosSheet, "A1:E1"),
          values: [["id", "name", "appetite", "is_market_portfolio", "refreshed_at"]],
        },
        {
          range: rangeFor(holdingsSheet, "A1:F1"),
          values: [["portfolio_id", "stock_code", "company", "quantity", "list", "updated_at"]],
        },
        {
          range: rangeFor(validationSheet, "A1:S1"),
          values: [[
            "timestamp_ist",
            "date",
            "source",
            "portfolio",
            "section",
            "symbol",
            "company",
            "action",
            "horizon",
            "predicted_price",
            "target_price",
            "predicted_upside_percent",
            "score",
            "confidence",
            "validation_status",
            "hit_timestamp",
            "actual_price",
            "caveat",
            "rationale",
          ]],
        },
        {
          range: rangeFor(marketMoversSheet, "A1:N1"),
          values: [[
            "timestamp_ist",
            "date",
            "segment",
            "category",
            "symbol",
            "company",
            "price",
            "previous_close",
            "change",
            "change_percent",
            "volume",
            "validation_status",
            "hit_timestamp",
            "actual_price",
          ]],
        },
      ],
    },
  });
}

function getPortfolioSheetName(name: string) {
  const cleanName =
    name
      .trim()
      .replace(/[\[\]:*?/\\]/gu, " ")
      .replace(/\s+/gu, " ")
      .slice(0, 88) || "Portfolio";

  return `Portfolio - ${cleanName}`;
}

function rangeFor(sheet: string, range: string) {
  return `'${sheet.replace(/'/gu, "''")}'!${range}`;
}

function toIstDate(timestamp: string) {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Kolkata",
    year: "numeric",
  }).format(new Date(timestamp));
}

function toIstTimestamp(timestamp: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Asia/Kolkata",
  }).format(new Date(timestamp));
}

async function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

function getSafeGoogleError(error: unknown) {
  const maybeError = error as {
    code?: number;
    message?: string;
    errors?: Array<{ reason?: string; message?: string }>;
  };
  const reason = maybeError.errors?.[0]?.reason;

  if (maybeError.code === 403) {
    return "Google returned 403. Share the Sheet with the service account email as Editor and confirm the Google Sheets API is enabled.";
  }

  if (maybeError.code === 404) {
    return "Google returned 404. Check GOOGLE_SHEETS_SPREADSHEET_ID and confirm the service account has access to that Sheet.";
  }

  if (reason === "authError" || maybeError.code === 401) {
    return "Google authentication failed. Check GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY formatting.";
  }

  return maybeError.message
    ? `Google Sheets error: ${maybeError.message}`
    : "Unknown Google Sheets error.";
}
