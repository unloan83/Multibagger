import { NextResponse } from "next/server";
import { isRequestAuthenticated } from "@/lib/auth";
import { testGoogleSheetsConnection } from "@/lib/google-sheets";
import { getSnapshotStorageStatus } from "@/lib/snapshot-storage";

export const runtime = "nodejs";

export async function GET() {
  if (!(await isRequestAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [sheets, storage] = await Promise.all([
    testGoogleSheetsConnection(),
    Promise.resolve(getSnapshotStorageStatus()),
  ]);

  return NextResponse.json(
    { sheets, storage },
    { status: sheets.ok ? 200 : 503 },
  );
}
