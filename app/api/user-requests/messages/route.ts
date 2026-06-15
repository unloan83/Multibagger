import { NextResponse } from "next/server";
import { isRequestAuthenticated } from "@/lib/auth";
import {
  appendRequestMessageToSheets,
  readUserRequestsFromSheets,
  saveUserRequestsToSheets,
} from "@/lib/google-sheets";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await isRequestAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    requestId?: string;
    message?: string;
  };

  if (!body.requestId || !body.message) {
    return NextResponse.json({ error: "Request ID and message are required." }, { status: 400 });
  }

  await appendRequestMessageToSheets({
    id: `MSG-${Date.now()}`,
    requestId: body.requestId,
    createdAt: new Date().toISOString(),
    sender: "Admin",
    message: body.message,
  });

  const requests = await readUserRequestsFromSheets();
  await saveUserRequestsToSheets(
    requests.map((item) =>
      item.id === body.requestId
        ? { ...item, status: "In Progress", unread: false, updatedAt: new Date().toISOString() }
        : item,
    ),
  );

  return NextResponse.json({ ok: true });
}
