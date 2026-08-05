import { NextResponse } from "next/server";
import { readTermRecommendations } from "@/lib/term-agent-analysis";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await readTermRecommendations();
    return NextResponse.json(
      { ok: true, ...data },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err), picks: [] },
      { status: 500 }
    );
  }
}
