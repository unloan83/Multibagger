import { NextResponse } from "next/server";
import { buildExpertActionMatrix } from "@/lib/expert-insights";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await buildExpertActionMatrix());
}
