import { NextRequest, NextResponse } from "next/server";

const sessionCookieName = "unloan_dashboard_session";
const oneWeekInMs = 60 * 60 * 24 * 7 * 1000;

export async function middleware(request: NextRequest) {
  if (!isAuthConfigured()) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  const isLoginPage = pathname === "/login";
  const isPublicAsset =
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.match(/\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js)$/u);
  const isAuthApi = pathname.startsWith("/api/auth");
  const isSnapshotApi = pathname.startsWith("/api/snapshots");
  const isAuthenticated = await verifySessionValue(
    request.cookies.get(sessionCookieName)?.value,
  );

  if (isPublicAsset || isAuthApi || isSnapshotApi) {
    return NextResponse.next();
  }

  if (isLoginPage && isAuthenticated) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (!isLoginPage && !isAuthenticated) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};

function isAuthConfigured() {
  return Boolean(
    process.env.DASHBOARD_USERNAME &&
      process.env.DASHBOARD_PASSWORD &&
      (process.env.DASHBOARD_SESSION_SECRET || process.env.DASHBOARD_PASSWORD),
  );
}

async function verifySessionValue(value?: string) {
  if (!value || !isAuthConfigured()) {
    return false;
  }

  const [username, issuedAt, signature] = value.split(":");
  const expectedUsername = process.env.DASHBOARD_USERNAME;
  const secret =
    process.env.DASHBOARD_SESSION_SECRET ?? process.env.DASHBOARD_PASSWORD ?? "";

  if (!username || !issuedAt || !signature || username !== expectedUsername) {
    return false;
  }

  const age = Date.now() - Number(issuedAt);

  if (!Number.isFinite(age) || age < 0 || age > oneWeekInMs) {
    return false;
  }

  const expected = await sign(`${username}:${issuedAt}`, secret);

  return signature === expected;
}

async function sign(payload: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));

  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
