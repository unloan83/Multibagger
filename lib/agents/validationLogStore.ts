import { google } from "googleapis";
import type { AgentValidationReport } from "@/lib/agents/validationTypes";
import { normalizeGooglePrivateKey } from "@/lib/google-credentials";

const sheetName = "Agent Validation Runs";
const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = normalizeGooglePrivateKey(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
let reportCache: { expiresAt: number; value: AgentValidationReport[] } | null = null;
let reportRead: Promise<AgentValidationReport[]> | null = null;
let sheetEnsuredUntil = 0;
let sheetEnsure: Promise<void> | null = null;

export async function appendAgentValidationReport(report: AgentValidationReport) {
  if (!configured()) return false;
  const sheets = await client();
  await ensureSheet(sheets);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${sheetName}'!A:K`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[
        report.runId,
        report.generatedAt,
        report.portfolioId,
        report.mode,
        report.agentHealth.filter((item) => item.health === "healthy").length,
        report.agentHealth.filter((item) => item.health === "degraded").length,
        report.agentHealth.filter((item) => item.health === "blocked").length,
        report.sourceCoverage.filter((item) => item.status === "missing").length,
        report.performance.agentLogic.accuracy ?? "",
        report.promotionGate.status,
        serializeReport(report),
      ]],
    },
  });
  reportCache = null;
  return true;
}

function serializeReport(report: AgentValidationReport) {
  const compact = compactReport(report, 25);
  const serialized = JSON.stringify(compact, truncateLongStrings);
  if (serialized.length <= 45_000) return serialized;
  const reduced = JSON.stringify(compactReport(report, 10), truncateLongStrings);
  if (reduced.length <= 45_000) return reduced;
  return JSON.stringify({
    ...report,
    agentHealth: report.agentHealth.slice(0, 8),
    sourceCoverage: report.sourceCoverage.slice(0, 8),
    missingSourceAlerts: report.missingSourceAlerts.slice(0, 8),
    staleDataAlerts: report.staleDataAlerts.slice(0, 8),
    accessGaps: report.accessGaps.slice(0, 8),
    orchestratorValidation: [],
    shadowComparison: [],
    performance: {
      ...report.performance,
      agentContribution: report.performance.agentContribution.slice(0, 8),
      sourceReliability: report.performance.sourceReliability.slice(0, 8),
      horizonAccuracy: report.performance.horizonAccuracy.slice(0, 3),
      recentOutcomes: [],
    },
  }, truncateLongStrings);
}

function compactReport(report: AgentValidationReport, detailLimit: number): AgentValidationReport {
  return {
    ...report,
    missingSourceAlerts: report.missingSourceAlerts.slice(0, 20),
    staleDataAlerts: report.staleDataAlerts.slice(0, 20),
    accessGaps: report.accessGaps.slice(0, 20),
    orchestratorValidation: report.orchestratorValidation.slice(0, detailLimit),
    shadowComparison: report.shadowComparison.slice(0, detailLimit),
    performance: {
      ...report.performance,
      recentOutcomes: report.performance.recentOutcomes.slice(0, detailLimit),
    },
  };
}

function truncateLongStrings(_key: string, value: unknown) {
  return typeof value === "string" && value.length > 500
    ? `${value.slice(0, 497)}...`
    : value;
}

export async function readRecentAgentValidationReports(limit = 20): Promise<AgentValidationReport[]> {
  const reports = await readCachedReports();
  return reports.slice(0, Math.max(1, limit));
}

async function readCachedReports(): Promise<AgentValidationReport[]> {
  if (!configured()) return [];
  if (reportCache && reportCache.expiresAt > Date.now()) return reportCache.value;
  if (reportRead) return reportRead;
  reportRead = readReportsNow();
  try {
    const value = await reportRead;
    reportCache = { expiresAt: Date.now() + 15_000, value };
    return value;
  } finally {
    reportRead = null;
  }
}

async function readReportsNow(): Promise<AgentValidationReport[]> {
  if (!configured()) return [];
  try {
    const sheets = await client();
    await ensureSheet(sheets);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A2:K`,
    });
    return (response.data.values ?? [])
      .slice(-50)
      .reverse()
      .flatMap((row) => {
        try {
          return [JSON.parse(String(row[10] ?? "{}")) as AgentValidationReport];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

async function ensureSheet(sheets: Awaited<ReturnType<typeof client>>) {
  if (sheetEnsuredUntil > Date.now()) return;
  if (sheetEnsure) return sheetEnsure;
  sheetEnsure = ensureSheetNow(sheets).finally(() => { sheetEnsure = null; });
  await sheetEnsure;
  sheetEnsuredUntil = Date.now() + 5 * 60_000;
}

async function ensureSheetNow(sheets: Awaited<ReturnType<typeof client>>) {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = spreadsheet.data.sheets?.some((sheet) => sheet.properties?.title === sheetName);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
    });
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetName}'!A1:K1`,
    valueInputOption: "RAW",
    requestBody: { values: [[
      "run_id", "generated_at", "portfolio_id", "mode", "healthy_agents",
      "degraded_agents", "blocked_agents", "missing_coverage", "agent_accuracy",
      "promotion_status", "report_json",
    ]] },
  });
}

function configured() {
  return Boolean(spreadsheetId && clientEmail && privateKey);
}

async function client() {
  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}
