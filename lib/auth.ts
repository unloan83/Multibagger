import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import {
  isGoogleSheetsConfigured,
  readAuthUserOverridesFromSheets,
  readPortfoliosFromSheets,
  type AuthUserOverrideRow,
} from "@/lib/google-sheets";
import { readPortfoliosFromCsvBackup, shouldUsePortfolioCsvBackup } from "@/lib/portfolio-backup";
import {
  findSeedAccountBySeedEmail,
  getAccountProfile,
  normalizeEmail,
  normalizePortfolioName,
  verifyAccountPassword,
  verifyPasswordRecord,
  type AccountProfile,
} from "@/lib/users";

export const sessionCookieName = "unloan_dashboard_session";
export const portfolioAccessCookieName = "unloan_portfolio_access";

const oneWeekInSeconds = 60 * 60 * 24 * 7;

type SessionPayload = AccountProfile & { issuedAt: number };

export function getAuthConfig() {
  const secret = process.env.DASHBOARD_SESSION_SECRET ?? process.env.SHARED_SESSION_SECRET ?? "";
  return {
    secret,
    transitionSecret: process.env.SHARED_SESSION_SECRET ?? secret,
  };
}

export function isAuthConfigured() {
  return Boolean(getAuthConfig().secret);
}

export function createSessionValue(profile: AccountProfile) {
  const payload = encodePayload({ ...profile, issuedAt: Date.now() });
  return `${payload}.${sign(payload, getRequiredSecret())}`;
}

export function verifySessionValue(value?: string): AccountProfile | null {
  if (!value || !isAuthConfigured()) return null;
  return verifyAppSessionValue(value) ?? verifyTransitionSessionValue(value);
}

export async function getCurrentSessionUser() {
  const cookieStore = await cookies();
  return verifySessionValue(cookieStore.get(sessionCookieName)?.value);
}

export async function isRequestAuthenticated() {
  return Boolean(await getCurrentSessionUser());
}

export async function isAdminRequest() {
  return (await getCurrentSessionUser())?.role === "admin";
}

export function createPortfolioAccessValue(portfolioId: string) {
  const issuedAt = Date.now();
  const payload = `${encodeURIComponent(portfolioId)}:${issuedAt}`;
  return `${payload}:${sign(payload, getRequiredSecret())}`;
}

export function verifyPortfolioAccessValue(value: string | undefined, portfolioId: string) {
  if (!value || !isAuthConfigured()) return false;
  const [encodedPortfolioId, issuedAt, signature] = value.split(":");
  const decodedPortfolioId = decodeURIComponent(encodedPortfolioId ?? "");
  const age = Date.now() - Number(issuedAt);

  if (decodedPortfolioId !== portfolioId || !Number.isFinite(age) || age < 0 || age > oneWeekInSeconds * 1000) {
    return false;
  }

  return safeEqual(signature ?? "", sign(`${encodedPortfolioId}:${issuedAt}`, getRequiredSecret()));
}

export async function canAccessPortfolio(portfolioId: string) {
  const user = await getCurrentSessionUser();
  if (user?.role === "admin") return true;
  if (await isMappedSessionPortfolio(portfolioId, user?.portfolioName)) return true;

  const cookieStore = await cookies();
  return verifyPortfolioAccessValue(cookieStore.get(portfolioAccessCookieName)?.value, portfolioId);
}

export async function setSessionCookie(profile: AccountProfile) {
  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName, createSessionValue(profile), {
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
  cookieStore.delete(portfolioAccessCookieName);
}

export async function validateCredentials(email: string, password: string) {
  const normalizedEmail = normalizeEmail(email);
  const overrides = await readAuthOverridesSafely();
  if (!overrides) return null;

  const override = overrides.find((item) => normalizeEmail(item.email) === normalizedEmail) ?? null;

  if (override) {
    return verifyOverrideCredentials(override, password);
  }

  const seedAccount = findSeedAccountBySeedEmail(normalizedEmail);
  const seedOverride = seedAccount
    ? overrides.find((item) => item.seedEmail === seedAccount.email)
    : null;
  if (seedOverride) return null;

  return verifyAccountPassword(normalizedEmail, password);
}

async function readAuthOverridesSafely() {
  try {
    return await readAuthUserOverridesFromSheets();
  } catch {
    return isGoogleSheetsConfigured() ? null : [];
  }
}

function verifyOverrideCredentials(override: AuthUserOverrideRow, password: string) {
  if (!verifyPasswordRecord(password, override.salt, override.passwordHash)) return null;

  const seedAccount = findSeedAccountBySeedEmail(override.seedEmail);
  if (!seedAccount) return null;

  return {
    displayName: override.displayName,
    email: override.email,
    portfolioName: seedAccount.portfolioName,
    role: seedAccount.role,
    seedEmail: seedAccount.email,
  } satisfies AccountProfile;
}

async function isMappedSessionPortfolio(portfolioId: string, portfolioName?: string) {
  const normalizedName = normalizePortfolioName(portfolioName ?? "");
  if (!normalizedName) return false;
  if (normalizePortfolioName(portfolioId) === normalizedName) return true;

  if (shouldUsePortfolioCsvBackup()) {
    const backupMatch = (await readPortfoliosFromCsvBackup()).some(
      (portfolio) =>
        portfolio.id === portfolioId &&
        normalizePortfolioName(portfolio.name) === normalizedName,
    );
    if (backupMatch) return true;
  }

  if (!isGoogleSheetsConfigured()) return false;

  try {
    const portfolios = await readPortfoliosFromSheets();
    return portfolios.some(
      (portfolio) =>
        portfolio.id === portfolioId &&
        normalizePortfolioName(portfolio.name) === normalizedName,
    );
  } catch {
    return false;
  }
}

function verifyAppSessionValue(value: string): AccountProfile | null {
  const [encodedPayload, signature] = value.split(".");
  if (!encodedPayload || !signature) return null;
  if (!safeEqual(signature, sign(encodedPayload, getRequiredSecret()))) return null;

  const payload = decodePayload(encodedPayload);
  if (!payload) return null;

  const age = Date.now() - Number(payload.issuedAt);
  if (!Number.isFinite(age) || age < 0 || age > oneWeekInSeconds * 1000) return null;

  return {
    displayName: payload.displayName,
    email: normalizeEmail(payload.email),
    portfolioName: payload.portfolioName,
    role: payload.role,
    seedEmail: normalizeEmail(payload.seedEmail ?? payload.email),
  };
}

function verifyTransitionSessionValue(value: string): AccountProfile | null {
  const portalProfile = verifyPortalHandoffValue(value);
  if (portalProfile) return portalProfile;

  const [username, timestamp, signature] = value.split(":");
  const transitionSecret = getAuthConfig().transitionSecret;
  if (!username || !timestamp || !signature || !transitionSecret) return null;

  const age = Date.now() - Number(timestamp);
  if (!Number.isFinite(age) || Math.abs(age) > 24 * 60 * 60 * 1000) return null;
  if (!safeEqual(signature, sign(`${username}:${timestamp}`, transitionSecret))) return null;

  return getAccountProfile(username) ?? {
    displayName: username,
    email: normalizeEmail(username),
    role: "user",
  };
}

function verifyPortalHandoffValue(value: string): AccountProfile | null {
  const [version, encodedPayload, signature] = value.split(".");
  const transitionSecret = getAuthConfig().transitionSecret;
  if (version !== "v1" || !encodedPayload || !signature || !transitionSecret) return null;
  if (!safeEqual(signature, sign(encodedPayload, transitionSecret))) return null;

  const payload = decodePayload(encodedPayload);
  if (!payload) return null;

  const age = Date.now() - Number(payload.issuedAt);
  if (!Number.isFinite(age) || age < 0 || age > 24 * 60 * 60 * 1000) return null;

  return {
    displayName: payload.displayName,
    email: normalizeEmail(payload.email),
    portfolioName: payload.portfolioName,
    role: payload.role,
    seedEmail: normalizeEmail(payload.seedEmail ?? payload.email),
  };
}

function encodePayload(payload: SessionPayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(value: string): SessionPayload | null {
  try {
    const payload = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<SessionPayload>;
    if (!payload.email || !payload.displayName || !payload.issuedAt || (payload.role !== "admin" && payload.role !== "user")) return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

function getRequiredSecret() {
  const secret = getAuthConfig().secret;
  if (!secret) throw new Error("DASHBOARD_SESSION_SECRET or SHARED_SESSION_SECRET must be configured.");
  return secret;
}

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function safeEqual(value: string, expected: string) {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  if (valueBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(valueBuffer, expectedBuffer);
}
