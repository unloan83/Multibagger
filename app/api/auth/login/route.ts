import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    { error: "Login is managed by LiveUnloan." },
    { status: 410 },
  );
}
