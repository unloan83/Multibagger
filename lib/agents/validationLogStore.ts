import { google } from "googleapis";
import type { AgentValidationReport } from "@/lib/agents/validationTypes";

const sheetName = "Agent Validation Runs";
const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/gu, "\n");

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
        JSON.stringify(report),
      ]],
    },
  });
  return true;
}

export async function readRecentAgentValidationReports(limit = 20): Promise<AgentValidationReport[]> {
  if (!configured()) return [];
  try {
    const sheets = await client();
    await ensureSheet(sheets);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A2:K`,
    });
    return (response.data.values ?? [])
      .slice(-Math.max(1, limit))
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
