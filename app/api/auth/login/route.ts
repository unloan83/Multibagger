import { NextResponse } from "next/server";
import { setSessionCookie, validateCredentials } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    username?: string;
    password?: string;
  };

  if (!validateCredentials(body.username ?? "", body.password ?? "")) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }

  await setSessionCookie(body.username ?? "dashboard");
  return NextResponse.json({ ok: true });
}
