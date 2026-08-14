import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { getTelegramBotToken } from "@/lib/telegram";

const execAsync = promisify(exec);

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DATA_FILE_PATH = path.join(process.cwd(), "data", "upstox_recommendations.json");

type UpstoxItem = {
  id: string;
  symbol: string;
  name: string;
  instrumentKey: string;
  cmp: number;
  target: number;
  stopLoss: number;
  signal: "BUY" | "SELL";
  score: number;
  executionMode: "AUTOMATIC" | "USER_DRIVEN";
  status: string;
  orderId?: string | null;
  remark: string;
  timestamp: string;
};

type StoreData = {
  recommendations?: UpstoxItem[];
};

function readData(): StoreData {
  if (!fs.existsSync(DATA_FILE_PATH)) return { recommendations: [] };
  return JSON.parse(fs.readFileSync(DATA_FILE_PATH, "utf-8"));
}

function writeData(data: StoreData) {
  fs.mkdirSync(path.dirname(DATA_FILE_PATH), { recursive: true });
  fs.writeFileSync(DATA_FILE_PATH, JSON.stringify(data, null, 2), "utf-8");
}

async function answerTelegramCallbackQuery(callbackQueryId: string, text: string) {
  const token = getTelegramBotToken();
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      text: text.slice(0, 200),
      show_alert: true,
    }),
  }).catch(() => {});
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Handle Telegram Webhook CallbackQuery
    if (body.callback_query) {
      const callbackQuery = body.callback_query;
      const callbackData = callbackQuery.data || ""; // e.g., "upstox:buy:upstox-rec-001"
      const callbackQueryId = callbackQuery.id;

      if (callbackData.startsWith("upstox:")) {
        const parts = callbackData.split(":");
        const actionType = parts[1]; // "buy", "sell", "skip"
        const recId = parts[2];

        const store = readData();
        const item = (store.recommendations || []).find((r: UpstoxItem) => r.id === recId);

        if (!item) {
          await answerTelegramCallbackQuery(callbackQueryId, "Recommendation not found.");
          return NextResponse.json({ ok: true });
        }

        if (actionType === "skip") {
          item.status = "SKIPPED";
          writeData(store);
          await answerTelegramCallbackQuery(callbackQueryId, `Trade skipped for ${item.symbol}.`);
          return NextResponse.json({ ok: true });
        }

        if (actionType === "buy" || actionType === "sell") {
          const transactionType = actionType.toUpperCase();
          const pythonCmd = `PYTHONPATH=.python-packages python3 -c "
from engine.upstox_sandbox import place_sandbox_order
res = place_sandbox_order(
    symbol='${item.symbol}',
    instrument_key='${item.instrumentKey}',
    quantity=1,
    price=${item.cmp},
    transaction_type='${transactionType}',
    tag='telegram_callback'
)
import json
print(json.dumps({'order_id': res.get('order_id')}))
"`;

          try {
            const { stdout } = await execAsync(pythonCmd, { cwd: process.cwd() });
            const parsed = JSON.parse(stdout.trim().split("\n").pop() || "{}");
            const orderId = parsed.order_id || `SANDBOX-${Date.now()}`;

            item.status = transactionType === "BUY" ? "BUY_EXECUTED" : "SELL_EXECUTED";
            item.orderId = orderId;
            writeData(store);

            await answerTelegramCallbackQuery(
              callbackQueryId,
              `✅ Upstox Sandbox ${transactionType} order placed for ${item.symbol}! (Order ID: ${orderId})`
            );
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : "Execution failed.";
            await answerTelegramCallbackQuery(callbackQueryId, `❌ Execution failed: ${errMsg}`);
          }
          return NextResponse.json({ ok: true });
        }
      }
    }

    return NextResponse.json({ ok: true, message: "Webhook received." });
  } catch {
    return NextResponse.json({ ok: false, error: "Webhook error." }, { status: 500 });
  }
}

