import { google } from "googleapis";
import type { AgentRecommendationLog } from "@/lib/agents/types";

const sheetName = "Agent Recommendation Logs";
const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/gu, "\n");

export async function readAgentRecommendationLogs(): Promise<AgentRecommendationLog[]> {
  if (!configured()) return [];
  try {
    const sheets = await client();
    await ensureSheet(sheets);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A2:U`,
    });
    return (response.data.values ?? []).flatMap((row) => {
      try {
        return [{
          id: String(row[0] ?? ""),
          timestamp: String(row[1] ?? ""),
          portfolioId: String(row[2] ?? ""),
          stock: String(row[3] ?? ""),
          agentScores: JSON.parse(String(row[4] ?? "{}")) as AgentRecommendationLog["agentScores"],
          finalAction: String(row[5] ?? "Watch") as AgentRecommendationLog["finalAction"],
          timeframe: String(row[6] ?? "Short term") as AgentRecommendationLog["timeframe"],
          target: optionalNumber(row[7]),
          stopLoss: optionalNumber(row[8]),
          confidence: Number(row[9] ?? 0),
          reason: String(row[10] ?? ""),
          status: String(row[11] ?? "pending") as AgentRecommendationLog["status"],
          positiveContributors: parseList(row[12]),
          negativeContributors: parseList(row[13]),
          entryPrice: Number(row[14] ?? 0),
          currentLogicAction: String(row[15] ?? "Watch") as AgentRecommendationLog["currentLogicAction"],
          currentLogicConfidence: Number(row[16] ?? 0),
          sourceTypes: parseList(row[17]),
          outcomes: parseOutcomes(row[18], String(row[1] ?? "")),
          outcomeReason: String(row[19] ?? "Pending evaluation."),
          shadowMode: true,
        }];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

export async function appendAgentRecommendationLogs(logs: AgentRecommendationLog[]) {
  if (!configured() || !logs.length) return 0;
  const sheets = await client();
  await ensureSheet(sheets);
  const existing = await readAgentRecommendationLogs();
  const ids = new Set(existing.map((log) => log.id));
  const additions = logs.filter((log) => !ids.has(log.id));
  if (!additions.length) return 0;
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${sheetName}'!A:U`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: additions.map((log) => [
        log.id,
        log.timestamp,
        log.portfolioId,
        log.stock,
        JSON.stringify(log.agentScores),
        log.finalAction,
        log.timeframe,
        log.target ?? "",
        log.stopLoss ?? "",
        log.confidence,
        log.reason,
        log.status,
        JSON.stringify(log.positiveContributors),
        JSON.stringify(log.negativeContributors),
        log.entryPrice,
        log.currentLogicAction,
        log.currentLogicConfidence,
        JSON.stringify(log.sourceTypes),
        JSON.stringify(log.outcomes),
        log.outcomeReason,
        "TRUE",
      ]),
    },
  });
  return additions.length;
}

export async function writeAgentRecommendationLogs(logs: AgentRecommendationLog[]) {
  if (!configured() || !logs.length) return;
  const sheets = await client();
  await ensureSheet(sheets);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetName}'!A2:U${logs.length + 1}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: logs.map((log) => [
        log.id,
        log.timestamp,
        log.portfolioId,
        log.stock,
        JSON.stringify(log.agentScores),
        log.finalAction,
        log.timeframe,
        log.target ?? "",
        log.stopLoss ?? "",
        log.confidence,
        log.reason,
        log.status,
        JSON.stringify(log.positiveContributors),
        JSON.stringify(log.negativeContributors),
        log.entryPrice,
        log.currentLogicAction,
        log.currentLogicConfidence,
        JSON.stringify(log.sourceTypes),
        JSON.stringify(log.outcomes),
        log.outcomeReason,
        "TRUE",
      ]),
    },
  });
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
    range: `'${sheetName}'!A1:U1`,
    valueInputOption: "RAW",
    requestBody: { values: [[
      "id", "timestamp", "portfolio_id", "stock", "agent_scores_json", "final_action",
      "timeframe", "target", "stop_loss", "confidence", "reason", "status",
      "positive_contributors", "negative_contributors",
      "entry_price", "current_logic_action", "current_logic_confidence",
      "source_types", "horizon_outcomes", "outcome_reason", "shadow_mode",
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

function optionalNumber(value: unknown) {
  const number = Number(value);
  return value === "" || !Number.isFinite(number) ? undefined : number;
}

function parseList(value: unknown) {
  try {
    const parsed = JSON.parse(String(value ?? "[]")) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseOutcomes(value: unknown, timestamp: string): AgentRecommendationLog["outcomes"] {
  try {
    const parsed = JSON.parse(String(value ?? "[]")) as AgentRecommendationLog["outcomes"];
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {
    // Fall through to backward-compatible pending outcomes.
  }
  const start = Number.isFinite(Date.parse(timestamp)) ? Date.parse(timestamp) : Date.now();
  return [
    { horizon: "1 day" as const, days: 1 },
    { horizon: "1 week" as const, days: 7 },
    { horizon: "1 month" as const, days: 30 },
  ].map(({ horizon, days }) => ({
    horizon,
    dueAt: new Date(start + days * 86_400_000).toISOString(),
    evaluatedAt: null,
    price: null,
    returnPercent: null,
    status: "pending" as const,
    reason: "Evaluation window has not closed.",
  }));
}
