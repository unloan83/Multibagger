import { google } from "googleapis";
import type {
  InvestmentAppetite,
  ManagedPortfolio,
  PortfolioInputRow,
} from "@/lib/portfolio";
import { buildPortfolioInputRow } from "@/lib/portfolio";
import type { MarketQuote } from "@/lib/market-overview";
import type {
  LearningRow,
  QualityFactors,
  QualityStatus,
  ValidationRecord,
} from "@/lib/intelligence-validation";

const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/gu, "\n");

const portfoliosSheet = "Portfolios";
const holdingsSheet = "Holdings";
const portfolioPinsSheet = "Portfolio PINs";
const communicationSettingsSheet = "Communication Settings";
const userRequestsSheet = "User Requests";
const requestMessagesSheet = "Request Messages";
const notificationHistorySheet = "Notification History";
const validationSheet = "Validation";
const learningSheet = "Learning";
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
  portfolioId: string;
  recommendationId: string;
  sector: string;
  stopLoss: number;
  qualityScore: number;
  qualityStatus: QualityStatus;
  validationTimestamp: string;
  validationDate: string;
  returnPercent: number;
  marketRegime: string;
  qualityFactors: QualityFactors;
};

export type MarketMoverRow = {
  timestamp: string;
  segment: string;
  category: "gainer" | "loser";
  quote: MarketQuote;
};

export type NotificationMode =
  | "Immediate Alerts"
  | "Daily Summary"
  | "Weekly Summary"
  | "Critical Alerts Only";

export type CommunicationSettings = {
  portfolioId: string;
  telegramEnabled: boolean;
  telegramUserId: string;
  securePasskey: string;
  notificationMode: NotificationMode;
  alertTypes: string[];
  telegramConnected: boolean;
  connectionStatus: string;
  lastNotification: string;
  lastSuccessfulDelivery: string;
  updatedAt: string;
};

export type UserRequestStatus = "Open" | "In Progress" | "Closed";
export type EmailDeliveryStatus = "Email Sent" | "Email Failed" | "Retry Pending";

export type UserRequestRow = {
  id: string;
  createdAt: string;
  portfolioId: string;
  portfolioName: string;
  user: string;
  requestType: string;
  priority: string;
  subject: string;
  message: string;
  status: UserRequestStatus;
  emailStatus: EmailDeliveryStatus;
  emailDetail: string;
  unread: boolean;
  updatedAt: string;
};

export type RequestMessageRow = {
  id: string;
  requestId: string;
  createdAt: string;
  sender: "User" | "Admin";
  message: string;
};

export type NotificationHistoryRow = {
  id: string;
  portfolioId: string;
  createdAt: string;
  alertType: string;
  status: string;
  detail: string;
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

export async function readPortfolioPinHashesFromSheets() {
  if (!isGoogleSheetsConfigured()) {
    return {};
  }

  const sheets = await getSheetsClient();
  await ensureSheets();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${portfolioPinsSheet}!A2:C`,
  });
  const rows = response.data.values ?? [];

  return rows.reduce<Record<string, { hash: string; updatedAt: string }>>((acc, row) => {
    const portfolioId = String(row[0] ?? "").trim();
    const hash = String(row[1] ?? "").trim();
    const updatedAt = String(row[2] ?? "").trim();

    if (portfolioId && hash) {
      acc[portfolioId] = { hash, updatedAt };
    }

    return acc;
  }, {});
}

export async function savePortfolioPinHashToSheets({
  portfolioId,
  pinHash,
}: {
  portfolioId: string;
  pinHash: string;
}) {
  if (!isGoogleSheetsConfigured()) {
    throw new Error("Google Sheets is not configured.");
  }

  const existing = await readPortfolioPinHashesFromSheets();
  const next = {
    ...existing,
    [portfolioId]: {
      hash: pinHash,
      updatedAt: new Date().toISOString(),
    },
  };

  await writePortfolioPinHashes(next);
}

export async function readCommunicationSettingsFromSheets() {
  if (!isGoogleSheetsConfigured()) {
    return {};
  }

  const sheets = await getSheetsClient();
  await ensureSheets();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${communicationSettingsSheet}!A2:K`,
  });

  return (response.data.values ?? []).reduce<Record<string, CommunicationSettings>>((acc, row) => {
    const portfolioId = String(row[0] ?? "").trim();

    if (!portfolioId) {
      return acc;
    }

    acc[portfolioId] = {
      portfolioId,
      telegramEnabled: String(row[1] ?? "") === "TRUE",
      telegramUserId: String(row[2] ?? ""),
      securePasskey: String(row[3] ?? ""),
      notificationMode: (String(row[4] ?? "Immediate Alerts") || "Immediate Alerts") as NotificationMode,
      alertTypes: String(row[5] ?? "").split("|").filter(Boolean),
      telegramConnected: String(row[6] ?? "") === "TRUE",
      connectionStatus: String(row[7] ?? "Not Connected"),
      lastNotification: String(row[8] ?? ""),
      lastSuccessfulDelivery: String(row[9] ?? ""),
      updatedAt: String(row[10] ?? ""),
    };

    return acc;
  }, {});
}

export async function saveCommunicationSettingsToSheets(settings: CommunicationSettings) {
  if (!isGoogleSheetsConfigured()) {
    throw new Error("Google Sheets is not configured.");
  }

  const existing = await readCommunicationSettingsFromSheets();
  await writeCommunicationSettings({
    ...existing,
    [settings.portfolioId]: {
      ...settings,
      updatedAt: new Date().toISOString(),
    },
  });
}

export async function readUserRequestsFromSheets() {
  if (!isGoogleSheetsConfigured()) {
    return [];
  }

  const sheets = await getSheetsClient();
  await ensureSheets();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${userRequestsSheet}!A2:N`,
  });

  return (response.data.values ?? []).map((row): UserRequestRow => ({
    id: String(row[0] ?? ""),
    createdAt: String(row[1] ?? ""),
    portfolioId: String(row[2] ?? ""),
    portfolioName: String(row[3] ?? ""),
    user: String(row[4] ?? ""),
    requestType: String(row[5] ?? "General"),
    priority: String(row[6] ?? "Medium"),
    subject: String(row[7] ?? ""),
    message: String(row[8] ?? ""),
    status: (String(row[9] ?? "Open") || "Open") as UserRequestStatus,
    emailStatus: (String(row[10] ?? "Retry Pending") || "Retry Pending") as EmailDeliveryStatus,
    emailDetail: String(row[11] ?? ""),
    unread: String(row[12] ?? "TRUE") !== "FALSE",
    updatedAt: String(row[13] ?? ""),
  }));
}

export async function saveUserRequestsToSheets(requests: UserRequestRow[]) {
  const sheets = await getSheetsClient();
  await ensureSheets();
  const values = requests.map((request) => [
    request.id,
    request.createdAt,
    request.portfolioId,
    request.portfolioName,
    request.user,
    request.requestType,
    request.priority,
    request.subject,
    request.message,
    request.status,
    request.emailStatus,
    request.emailDetail,
    request.unread ? "TRUE" : "FALSE",
    request.updatedAt,
  ]);

  await sheets.spreadsheets.values.batchClear({
    spreadsheetId,
    requestBody: { ranges: [rangeFor(userRequestsSheet, "A2:N")] },
  });

  if (values.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: rangeFor(userRequestsSheet, "A2:N"),
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });
  }
}

export async function appendRequestMessageToSheets(message: RequestMessageRow) {
  const sheets = await getSheetsClient();
  await ensureSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: rangeFor(requestMessagesSheet, "A:E"),
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[message.id, message.requestId, message.createdAt, message.sender, message.message]],
    },
  });
}

export async function readRequestMessagesFromSheets() {
  if (!isGoogleSheetsConfigured()) {
    return [];
  }

  const sheets = await getSheetsClient();
  await ensureSheets();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${requestMessagesSheet}!A2:E`,
  });

  return (response.data.values ?? []).map((row): RequestMessageRow => ({
    id: String(row[0] ?? ""),
    requestId: String(row[1] ?? ""),
    createdAt: String(row[2] ?? ""),
    sender: (String(row[3] ?? "User") || "User") as "User" | "Admin",
    message: String(row[4] ?? ""),
  }));
}

export async function appendNotificationHistoryToSheets(row: NotificationHistoryRow) {
  const sheets = await getSheetsClient();
  await ensureSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: rangeFor(notificationHistorySheet, "A:F"),
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[row.id, row.portfolioId, row.createdAt, row.alertType, row.status, row.detail]],
    },
  });
}

export async function readNotificationHistoryFromSheets(portfolioId?: string) {
  if (!isGoogleSheetsConfigured()) {
    return [];
  }

  const sheets = await getSheetsClient();
  await ensureSheets();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${notificationHistorySheet}!A2:F`,
  });

  return (response.data.values ?? [])
    .map((row): NotificationHistoryRow => ({
      id: String(row[0] ?? ""),
      portfolioId: String(row[1] ?? ""),
      createdAt: String(row[2] ?? ""),
      alertType: String(row[3] ?? ""),
      status: String(row[4] ?? ""),
      detail: String(row[5] ?? ""),
    }))
    .filter((row) => !portfolioId || row.portfolioId === portfolioId);
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
    range: rangeFor(validationSheet, "A:AJ"),
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
          "Active",
          "",
          "",
          row.caveat,
          row.rationale,
          row.portfolioId,
          row.recommendationId,
          row.sector,
          row.stopLoss,
          row.qualityScore,
          row.qualityStatus,
          row.validationTimestamp,
          row.validationDate,
          row.returnPercent,
          row.marketRegime,
          row.qualityFactors.marketRegimeAvailable ? "PASS" : "FAIL",
          row.qualityFactors.sectorStrengthAvailable ? "PASS" : "FAIL",
          row.qualityFactors.trendConfirmationAvailable ? "PASS" : "FAIL",
          row.qualityFactors.riskScoreAssigned ? "PASS" : "FAIL",
          row.qualityFactors.confidenceCalculated ? "PASS" : "FAIL",
          row.qualityFactors.portfolioFitChecked ? "PASS" : "FAIL",
          row.qualityFactors.recommendationHorizonAssigned ? "PASS" : "FAIL",
        ];
      }),
    },
  });
}

export async function readValidationRecords(): Promise<ValidationRecord[]> {
  if (!isGoogleSheetsConfigured()) {
    return [];
  }

  const sheets = await getSheetsClient();
  await ensureSheets();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: rangeFor(validationSheet, "A2:AJ"),
  });

  return (response.data.values ?? []).map(parseValidationRecord);
}

export async function updateValidationRecords(records: ValidationRecord[]) {
  if (!isGoogleSheetsConfigured()) {
    throw new Error("Google Sheets is not configured.");
  }

  if (records.length === 0) {
    return;
  }

  const sheets = await getSheetsClient();
  await ensureSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: rangeFor(validationSheet, `A2:AJ${records.length + 1}`),
    valueInputOption: "USER_ENTERED",
    requestBody: { values: records.map(validationRecordValues) },
  });
}

export async function writeLearningRows(rows: LearningRow[]) {
  if (!isGoogleSheetsConfigured()) {
    throw new Error("Google Sheets is not configured.");
  }

  const sheets = await getSheetsClient();
  await ensureSheets();
  await sheets.spreadsheets.values.batchClear({
    spreadsheetId,
    requestBody: { ranges: [rangeFor(learningSheet, "A2:J")] },
  });

  if (rows.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: rangeFor(learningSheet, "A2:J"),
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: rows.map((row) => [
          toIstTimestamp(row.calculatedAt),
          row.dimension,
          row.label,
          row.hits,
          row.misses,
          row.expired,
          row.active,
          row.sampleSize,
          row.successRate,
          row.weightMultiplier,
        ]),
      },
    });
  }
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
  const pinHashes = await readPortfolioPinHashesFromSheets();
  const nextPinHashes = { ...pinHashes };
  delete nextPinHashes[id];
  await writePortfolioPinHashes(nextPinHashes);
}

async function writePortfolioPinHashes(
  pinHashes: Record<string, { hash: string; updatedAt: string }>,
) {
  const sheets = await getSheetsClient();
  await ensureSheets();
  const values = Object.entries(pinHashes).map(([portfolioId, item]) => [
    portfolioId,
    item.hash,
    item.updatedAt,
  ]);

  await sheets.spreadsheets.values.batchClear({
    spreadsheetId,
    requestBody: {
      ranges: [rangeFor(portfolioPinsSheet, "A2:C")],
    },
  });

  if (values.length === 0) {
    return;
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: rangeFor(portfolioPinsSheet, "A2:C"),
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values,
    },
  });
}

async function writeCommunicationSettings(settings: Record<string, CommunicationSettings>) {
  const sheets = await getSheetsClient();
  await ensureSheets();
  const values = Object.values(settings).map((item) => [
    item.portfolioId,
    item.telegramEnabled ? "TRUE" : "FALSE",
    item.telegramUserId,
    item.securePasskey,
    item.notificationMode,
    item.alertTypes.join("|"),
    item.telegramConnected ? "TRUE" : "FALSE",
    item.connectionStatus,
    item.lastNotification,
    item.lastSuccessfulDelivery,
    item.updatedAt,
  ]);

  await sheets.spreadsheets.values.batchClear({
    spreadsheetId,
    requestBody: { ranges: [rangeFor(communicationSettingsSheet, "A2:K")] },
  });

  if (values.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: rangeFor(communicationSettingsSheet, "A2:K"),
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });
  }
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
    portfolioPinsSheet,
    communicationSettingsSheet,
    userRequestsSheet,
    requestMessagesSheet,
    notificationHistorySheet,
    validationSheet,
    learningSheet,
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
          range: rangeFor(portfolioPinsSheet, "A1:C1"),
          values: [["portfolio_id", "pin_hash", "updated_at"]],
        },
        {
          range: rangeFor(communicationSettingsSheet, "A1:K1"),
          values: [["portfolio_id", "telegram_enabled", "telegram_user_id", "secure_passkey", "notification_mode", "alert_types", "telegram_connected", "connection_status", "last_notification", "last_successful_delivery", "updated_at"]],
        },
        {
          range: rangeFor(userRequestsSheet, "A1:N1"),
          values: [["id", "created_at", "portfolio_id", "portfolio_name", "user", "request_type", "priority", "subject", "message", "status", "email_status", "email_detail", "unread", "updated_at"]],
        },
        {
          range: rangeFor(requestMessagesSheet, "A1:E1"),
          values: [["id", "request_id", "created_at", "sender", "message"]],
        },
        {
          range: rangeFor(notificationHistorySheet, "A1:F1"),
          values: [["id", "portfolio_id", "created_at", "alert_type", "status", "detail"]],
        },
        {
          range: rangeFor(validationSheet, "A1:AJ1"),
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
            "portfolio_id",
            "recommendation_id",
            "sector",
            "stop_loss",
            "quality_score",
            "quality_status",
            "validation_timestamp",
            "validation_date",
            "return_percent",
            "market_regime",
            "market_regime_available",
            "sector_strength_available",
            "trend_confirmation_available",
            "risk_score_assigned",
            "confidence_calculated",
            "portfolio_fit_checked",
            "recommendation_horizon_assigned",
          ]],
        },
        {
          range: rangeFor(learningSheet, "A1:J1"),
          values: [[
            "calculated_at",
            "dimension",
            "label",
            "hits",
            "misses",
            "expired",
            "active",
            "sample_size",
            "success_rate",
            "weight_multiplier",
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

function parseValidationRecord(row: unknown[]): ValidationRecord {
  const qualityFactors: QualityFactors = {
    marketRegimeAvailable: String(row[29] ?? "") === "PASS",
    sectorStrengthAvailable: String(row[30] ?? "") === "PASS",
    trendConfirmationAvailable: String(row[31] ?? "") === "PASS",
    riskScoreAssigned: String(row[32] ?? "") === "PASS",
    confidenceCalculated: String(row[33] ?? "") === "PASS",
    portfolioFitChecked: String(row[34] ?? "") === "PASS",
    recommendationHorizonAssigned: String(row[35] ?? "") === "PASS",
  };

  return {
    timestamp: String(row[25] ?? row[0] ?? ""),
    date: String(row[1] ?? ""),
    source: String(row[2] ?? ""),
    portfolioName: String(row[3] ?? ""),
    section: String(row[4] ?? ""),
    symbol: String(row[5] ?? ""),
    company: String(row[6] ?? ""),
    action: String(row[7] ?? ""),
    horizon: String(row[8] ?? ""),
    predictedPrice: Number(row[9] ?? 0),
    targetPrice: Number(row[10] ?? 0),
    predictedUpsidePercent: Number(row[11] ?? 0),
    score: Number(row[12] ?? 0),
    confidence: Number(row[13] ?? 0),
    validationStatus: normalizeOutcomeStatus(row[14]),
    hitTimestamp: String(row[15] ?? ""),
    actualPrice: Number(row[16] ?? 0),
    caveat: String(row[17] ?? ""),
    rationale: String(row[18] ?? ""),
    portfolioId: String(row[19] ?? ""),
    recommendationId: String(row[20] ?? ""),
    sector: String(row[21] ?? "Unclassified"),
    stopLoss: Number(row[22] ?? 0),
    qualityScore: Number(row[23] ?? 0),
    qualityStatus: String(row[24] ?? "") === "PASS" ? "PASS" : "FAIL",
    validationTimestamp: String(row[25] ?? ""),
    validationDate: String(row[26] ?? ""),
    returnPercent: Number(row[27] ?? 0),
    marketRegime: String(row[28] ?? ""),
    qualityFactors,
  };
}

function validationRecordValues(row: ValidationRecord) {
  return [
    row.timestamp,
    row.date,
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
    row.validationStatus,
    row.hitTimestamp,
    row.actualPrice,
    row.caveat,
    row.rationale,
    row.portfolioId,
    row.recommendationId,
    row.sector,
    row.stopLoss,
    row.qualityScore,
    row.qualityStatus,
    row.validationTimestamp,
    row.validationDate,
    row.returnPercent,
    row.marketRegime,
    row.qualityFactors.marketRegimeAvailable ? "PASS" : "FAIL",
    row.qualityFactors.sectorStrengthAvailable ? "PASS" : "FAIL",
    row.qualityFactors.trendConfirmationAvailable ? "PASS" : "FAIL",
    row.qualityFactors.riskScoreAssigned ? "PASS" : "FAIL",
    row.qualityFactors.confidenceCalculated ? "PASS" : "FAIL",
    row.qualityFactors.portfolioFitChecked ? "PASS" : "FAIL",
    row.qualityFactors.recommendationHorizonAssigned ? "PASS" : "FAIL",
  ];
}

function normalizeOutcomeStatus(value: unknown): ValidationRecord["validationStatus"] {
  const status = String(value ?? "");
  return status === "Hit" || status === "Miss" || status === "Expired"
    ? status
    : "Active";
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
