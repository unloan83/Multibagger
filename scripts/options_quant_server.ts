import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { runOptionsQuantCycle, runOptionsRiskMonitor } from "@/features/options-quant/lib/engine";
import { readOptionsQuantState } from "@/features/options-quant/lib/store";

const host = process.env.OPTIONS_QUANT_HOST?.trim() || "127.0.0.1";
const port = Number(process.env.OPTIONS_QUANT_PORT || 8787);
const token = (process.env.OPTIONS_QUANT_INGEST_TOKEN || "").trim();

if (!token) throw new Error("OPTIONS_QUANT_INGEST_TOKEN is required.");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("OPTIONS_QUANT_PORT is invalid.");

let cycleRunning = false;

function authorized(request: IncomingMessage): boolean {
  const supplied = (request.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!supplied) return false;
  const expectedBuffer = Buffer.from(token);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function respond(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    respond(response, 200, { ok: true, service: "options-quant" });
    return;
  }
  if (!authorized(request)) {
    respond(response, 401, { ok: false, error: "Unauthorized." });
    return;
  }
  try {
    if (request.method === "GET" && request.url === "/state") {
      respond(response, 200, { ok: true, state: await readOptionsQuantState() });
      return;
    }
    if (request.method === "POST" && (request.url === "/scan" || request.url === "/monitor")) {
      if (cycleRunning) {
        respond(response, 409, { ok: false, error: "An Options Quant cycle is already running." });
        return;
      }
      cycleRunning = true;
      try {
        const state = request.url === "/scan"
          ? await runOptionsQuantCycle()
          : await runOptionsRiskMonitor();
        respond(response, 200, { ok: true, state });
      } finally {
        cycleRunning = false;
      }
      return;
    }
    respond(response, 404, { ok: false, error: "Not found." });
  } catch (error) {
    respond(response, 503, {
      ok: false,
      error: error instanceof Error ? error.message : "Options Quant service failed.",
    });
  }
});

server.listen(port, host, () => {
  console.log(JSON.stringify({ service: "options-quant", status: "LISTENING", host, port }));
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
