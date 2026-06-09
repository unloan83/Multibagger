import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const sessionCookieName = "unloan_dashboard_session";

const oneWeekInSeconds = 60 * 60 * 24 * 7;

export function getAuthConfig() {
  return {
    username: process.env.DASHBOARD_USERNAME ?? "",
    password: process.env.DASHBOARD_PASSWORD ?? "",
    secret:
      process.env.DASHBOARD_SESSION_SECRET ??
      process.env.DASHBOARD_PASSWORD ??
      "change-this-secret",
  };
}

export function isAuthConfigured() {
  const config = getAuthConfig();
  return Boolean(config.username && config.password && config.secret);
}

export function createSessionValue(username: string) {
  const config = getAuthConfig();
  const issuedAt = Date.now();
  const payload = `${username}:${issuedAt}`;
  const signature = sign(payload, config.secret);

  return `${payload}:${signature}`;
}

export function verifySessionValue(value?: string) {
  if (!value || !isAuthConfigured()) {
    return false;
  }

  const [username, issuedAt, signature] = value.split(":");
  const config = getAuthConfig();

  if (!username || !issuedAt || !signature || username !== config.username) {
    return false;
  }

  const age = Date.now() - Number(issuedAt);

  if (!Number.isFinite(age) || age < 0 || age > oneWeekInSeconds * 1000) {
    return false;
  }

  const expected = sign(`${username}:${issuedAt}`, config.secret);

  return safeEqual(signature, expected);
}

export async function isRequestAuthenticated() {
  if (!isAuthConfigured()) {
    return true;
  }

  const cookieStore = await cookies();
  return verifySessionValue(cookieStore.get(sessionCookieName)?.value);
}

export async function setSessionCookie(username: string) {
  const cookieStore = await cookies();

  cookieStore.set(sessionCookieName, createSessionValue(username), {
    httpOnly: true,
    maxAge: oneWeekInSeconds,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(sessionCookieName);
}

export function validateCredentials(username: string, password: string) {
  const config = getAuthConfig();

  if (!isAuthConfigured()) {
    return true;
  }

  return safeEqual(username, config.username) && safeEqual(password, config.password);
}

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function safeEqual(value: string, expected: string) {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);

  if (valueBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(valueBuffer, expectedBuffer);
}
