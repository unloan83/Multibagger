import { NextResponse } from "next/server";
import { isRequestAuthenticated } from "@/lib/auth";
import { testGoogleSheetsConnection } from "@/lib/google-sheets";

export const runtime = "nodejs";

export async function GET() {
  if (!(await isRequestAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = await testGoogleSheetsConnection();
  return NextResponse.json(status, { status: status.ok ? 200 : 503 });
}
