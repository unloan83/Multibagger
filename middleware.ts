import { NextRequest, NextResponse } from "next/server";

const sessionCookieName = "unloan_dashboard_session";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Exclude public assets and specific Next.js internals
  const isPublicAsset =
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/api/health") ||
    pathname.match(/\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js)$/u);

  if (isPublicAsset) {
    return NextResponse.next();
  }

  const secret = process.env.SHARED_SESSION_SECRET || "fallback_secret_for_local_dev";

  // 2. Check for token transition in URL query params
  const token = request.nextUrl.searchParams.get("token");
  if (token) {
    const isValid = await verifyTransitionToken(token, secret);
    if (isValid) {
      // Redirect to the clean requested URL (removing 'token' query param)
      const url = new URL(pathname, request.url);
      request.nextUrl.searchParams.delete("token");
      url.search = request.nextUrl.searchParams.toString();
      
      const response = NextResponse.redirect(url);
      response.cookies.set(sessionCookieName, token, {
        path: "/",
        maxAge: 60 * 60 * 24, // 1 day
        httpOnly: true,
        secure: request.url.startsWith("https:"),
        sameSite: "lax",
      });
      return response;
    } else {
      // Invalid token, redirect to login
      return redirectToLogin(request);
    }
  }

  // 3. Verify session cookie
  const cookieValue = request.cookies.get(sessionCookieName)?.value;
  const isAuthenticated = cookieValue ? await verifyTransitionToken(cookieValue, secret) : false;

  if (isAuthenticated) {
    return NextResponse.next();
  }

  // 4. Fallback: If not authenticated, redirect to liveunloan login portal
  return redirectToLogin(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};

function redirectToLogin(request: NextRequest) {
  const host = request.headers.get("host") || "";
  const isDev = host.includes("localhost") || host.includes("127.0.0.1");
  const loginUrl = isDev ? "http://localhost:5173" : "https://liveunloan.vercel.app";
  return NextResponse.redirect(`${loginUrl}/?error=unauthorized`);
}

async function verifyTransitionToken(value: string, secret: string) {
  const parts = value.split(":");
  if (parts.length !== 3) {
    return false;
  }
  const [username, timestamp, signature] = parts;
  
  // Verify timestamp is within 5 minutes (300000ms)
  const age = Date.now() - Number(timestamp);
  if (!Number.isFinite(age) || Math.abs(age) > 5 * 60 * 1000) {
    return false;
  }

  const expected = await sign(`${username}:${timestamp}`, secret);
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
