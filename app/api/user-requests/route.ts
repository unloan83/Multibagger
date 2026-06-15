import { NextResponse } from "next/server";
import { isRequestAuthenticated } from "@/lib/auth";
import { sendAdminRequestEmail } from "@/lib/admin-email";
import {
  appendRequestMessageToSheets,
  isGoogleSheetsConfigured,
  readRequestMessagesFromSheets,
  readUserRequestsFromSheets,
  saveUserRequestsToSheets,
  type UserRequestRow,
  type UserRequestStatus,
} from "@/lib/google-sheets";

export const runtime = "nodejs";

export async function GET() {
  if (!(await isRequestAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json({ configured: false, requests: [], messages: [] });
  }

  const [requests, messages] = await Promise.all([
    readUserRequestsFromSheets(),
    readRequestMessagesFromSheets(),
  ]);

  return NextResponse.json({ configured: true, requests, messages });
}

export async function POST(request: Request) {
  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json({ error: "Google Sheets is not configured." }, { status: 503 });
  }

  const body = (await request.json()) as Partial<UserRequestRow>;
  const now = new Date().toISOString();
  const newRequest: UserRequestRow = {
    id: `REQ-${Date.now()}`,
    createdAt: now,
    portfolioId: String(body.portfolioId ?? ""),
    portfolioName: String(body.portfolioName ?? "Portfolio"),
    user: String(body.user ?? "Portfolio User"),
    requestType: String(body.requestType ?? "General"),
    priority: String(body.priority ?? "Medium"),
    subject: String(body.subject ?? ""),
    message: String(body.message ?? ""),
    status: "Open",
    emailStatus: "Retry Pending",
    emailDetail: "",
    unread: true,
    updatedAt: now,
  };

  const email = await sendAdminRequestEmail(newRequest);
  const requestWithEmail = {
    ...newRequest,
    emailStatus: email.status,
    emailDetail: email.detail,
  };
  const requests = await readUserRequestsFromSheets();
  await saveUserRequestsToSheets([requestWithEmail, ...requests]);
  await appendRequestMessageToSheets({
    id: `MSG-${Date.now()}`,
    requestId: newRequest.id,
    createdAt: now,
    sender: "User",
    message: newRequest.message,
  });

  return NextResponse.json({ ok: true, request: requestWithEmail });
}

export async function PATCH(request: Request) {
  if (!(await isRequestAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    id?: string;
    status?: UserRequestStatus;
    unread?: boolean;
  };
  const requests = await readUserRequestsFromSheets();
  const target = requests.find((item) => item.id === body.id);
  const email = target
    ? await sendAdminRequestEmail({
        ...target,
        status: body.status ?? target.status,
        unread: body.unread ?? target.unread,
        updatedAt: new Date().toISOString(),
      })
    : null;

  await saveUserRequestsToSheets(
    requests.map((item) =>
      item.id === body.id
        ? {
            ...item,
            status: body.status ?? item.status,
            unread: body.unread ?? item.unread,
            emailStatus: email?.status ?? item.emailStatus,
            emailDetail: email?.detail ?? item.emailDetail,
            updatedAt: new Date().toISOString(),
          }
        : item,
    ),
  );

  return NextResponse.json({ ok: true });
}
