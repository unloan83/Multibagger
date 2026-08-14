import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { sendTelegramInteractiveAlert, getTelegramBotToken, getTelegramChatId } from "@/lib/telegram";

const execAsync = promisify(exec);

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DATA_FILE_PATH = path.join(process.cwd(), "data", "upstox_recommendations.json");

export type UpstoxRec = {
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
  status: "PENDING" | "BUY_EXECUTED" | "SELL_EXECUTED" | "SKIPPED" | "TELEGRAM_SENT";
  orderId?: string | null;
  remark: string;
  timestamp: string;
};

function readData(): { asOf: string; sandboxMode: boolean; defaultExecutionMode: string; recommendations: UpstoxRec[] } {
  if (!fs.existsSync(DATA_FILE_PATH)) {
    return {
      asOf: new Date().toISOString(),
      sandboxMode: true,
      defaultExecutionMode: "USER_DRIVEN",
      recommendations: [],
    };
  }
  const content = fs.readFileSync(DATA_FILE_PATH, "utf-8");
  return JSON.parse(content);
}

type RecommendationsStore = {
  asOf: string;
  sandboxMode: boolean;
  defaultExecutionMode: string;
  recommendations: UpstoxRec[];
};

function writeData(data: RecommendationsStore) {
  fs.mkdirSync(path.dirname(DATA_FILE_PATH), { recursive: true });
  fs.writeFileSync(DATA_FILE_PATH, JSON.stringify(data, null, 2), "utf-8");
}


export async function GET() {
  try {
    const data = readData();
    const now = Date.now();
    let modified = false;

    // Check for 5-minute auto-execution timer on pending USER_DRIVEN recommendations
    for (const rec of data.recommendations) {
      if (rec.executionMode === "USER_DRIVEN" && (rec.status === "PENDING" || rec.status === "TELEGRAM_SENT")) {
        const recTime = new Date(rec.timestamp).getTime();
        const elapsedMinutes = (now - recTime) / (1000 * 60);

        if (elapsedMinutes >= 5) {
          rec.status = rec.signal === "BUY" ? "BUY_EXECUTED" : "SELL_EXECUTED";
          rec.orderId = rec.orderId || `SANDBOX-AUTO-5MIN-${Date.now()}`;
          modified = true;
        }
      }
    }

    if (modified) {
      writeData(data);
    }

    const botToken = getTelegramBotToken();
    const chatId = getTelegramChatId();
    const telegramConfigured = Boolean(botToken && chatId);

    return NextResponse.json({ ok: true, data, telegramConfigured });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load Upstox recommendations." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, id, mode, decision } = body;
    const store = readData();
    const item = store.recommendations.find((r) => r.id === id);

    if (!item && action !== "toggle_default_mode") {
      return NextResponse.json({ ok: false, error: "Recommendation not found." }, { status: 404 });
    }

    if (action === "update_mode") {
      if (item && (mode === "AUTOMATIC" || mode === "USER_DRIVEN")) {
        item.executionMode = mode;
        writeData(store);
        return NextResponse.json({ ok: true, message: `Updated execution mode to ${mode} for ${item.symbol}.`, data: store });
      }
    }

    if (action === "send_telegram") {
      const chatId = getTelegramChatId();
      if (!chatId) {
        return NextResponse.json({ ok: false, error: "TELEGRAM_CHAT_ID is not configured in environment or .env.local." }, { status: 400 });
      }

      const msg = [
        `🎯 Upstox Sandbox Signal: ${item!.symbol}`,
        `Company: ${item!.name}`,
        `Signal: ${item!.signal} @ ₹${item!.cmp.toFixed(2)}`,
        `Target: ₹${item!.target.toFixed(2)} | Stop Loss: ₹${item!.stopLoss.toFixed(2)}`,
        `Score: ${item!.score}/100`,
        `Mode: USER DRIVEN (Auto-executes in 5 mins if no action)`,
        `Remark: ${item!.remark}`,
        ``,
        `Choose action below:`
      ].join("\n");

      await sendTelegramInteractiveAlert({
        chatId,
        text: msg,
        recommendationId: item!.id,
        symbol: item!.symbol,
      });

      item!.status = "TELEGRAM_SENT";

      writeData(store);
      return NextResponse.json({ ok: true, message: `Telegram interactive alert sent for ${item!.symbol}.`, data: store });
    }

    if (action === "execute_auto" || action === "manual_action") {
      const targetAction = action === "execute_auto" ? item!.signal : decision;

      if (targetAction === "SKIP") {
        item!.status = "SKIPPED";
        writeData(store);
        return NextResponse.json({ ok: true, message: `Trade skipped for ${item!.symbol}.`, data: store });
      }

      if (targetAction === "BUY" || targetAction === "SELL") {
        // Execute Sandbox Order via Python runner
        const pythonCmd = `PYTHONPATH=.python-packages python3 -c "
from engine.upstox_sandbox import place_sandbox_order
res = place_sandbox_order(
    symbol='${item!.symbol}',
    instrument_key='${item!.instrumentKey}',
    quantity=1,
    price=${item!.cmp},
    transaction_type='${targetAction}',
    tag='portal_${action}'
)
import json
print(json.dumps({'order_id': res.get('order_id')}))
"`;

        try {
          const { stdout } = await execAsync(pythonCmd, { cwd: process.cwd() });
          const parsed = JSON.parse(stdout.trim().split("\n").pop() || "{}");
          const orderId = parsed.order_id || `SANDBOX-${Date.now()}`;
          
          item!.status = targetAction === "BUY" ? "BUY_EXECUTED" : "SELL_EXECUTED";
          item!.orderId = orderId;
          writeData(store);

          return NextResponse.json({
            ok: true,
            message: `Sandbox ${targetAction} order executed successfully for ${item!.symbol} (Order ID: ${orderId}).`,
            data: store,
          });
        } catch (execErr: unknown) {
          const errMsg = execErr instanceof Error ? execErr.message : "Failed to execute sandbox order.";
          return NextResponse.json({
            ok: false,
            error: errMsg,
          }, { status: 500 });
        }

      }
    }

    return NextResponse.json({ ok: false, error: "Invalid action requested." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Request processing failed." },
      { status: 500 }
    );
  }
}
