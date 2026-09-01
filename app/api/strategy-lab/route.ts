import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OCI_TUNNEL_URL = process.env.OCI_TUNNEL_URL || "https://medical-editor-develop-toilet.trycloudflare.com";
const INTERNAL_TOKEN = process.env.INTERNAL_ENGINE_TOKEN || "3IiyWTTNW8jsRnDQrRcurSz9k1g_4aYmRMbpZ3XEUDipLQLJh";

export async function GET() {
  try {
    const tunnelUrl = OCI_TUNNEL_URL.replace(/\/$/, "");
    const url = `${tunnelUrl}/api/internal/strategy-lab/data`;
    
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${INTERNAL_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      cache: "no-store",
    });

    if (!resp.ok) {
      return NextResponse.json(
        { ok: false, error: `OCI Engine returned HTTP ${resp.status}` },
        { status: resp.status, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    const data = await resp.json();
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: `OCI engine unreachable via tunnel: ${error instanceof Error ? error.message : String(error)}` },
      { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const action = body.action || (body.callback_query ? "telegram-webhook" : "approve");
    
    if (action === "approve" && (!body.candidate_id || typeof body.candidate_id !== "string" || !body.candidate_id.trim())) {
      return NextResponse.json({ ok: false, error: "candidate_id is required and must be a non-empty string" }, { status: 400 });
    }

    const tunnelUrl = OCI_TUNNEL_URL.replace(/\/$/, "");
    
    const endpoint = action === "import-algoverse" 
      ? "/api/internal/strategy-lab/import-algoverse"
      : action === "telegram-webhook"
      ? "/api/internal/strategy-lab/telegram-webhook"
      : "/api/internal/strategy-lab/approve";

    const resp = await fetch(`${tunnelUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${INTERNAL_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const data = await resp.json();
    return NextResponse.json(data, { status: resp.status, headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: `OCI engine action failed: ${error instanceof Error ? error.message : String(error)}` },
      { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}
