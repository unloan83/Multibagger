import { NextResponse } from "next/server";
import { getCurrentSessionUser, setSessionCookie } from "@/lib/auth";
import { readAuthUserOverridesFromSheets, saveAuthUserOverrideToSheets } from "@/lib/google-sheets";
import {
  createPasswordRecord,
  findSeedAccountBySeedEmail,
  normalizeEmail,
} from "@/lib/users";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json({
    user: {
      displayName: user.displayName,
      email: user.email,
      role: user.role,
      portfolioName: user.portfolioName,
    },
  });
}

export async function PATCH(request: Request) {
  const user = await getCurrentSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    displayName?: string;
    email?: string;
    password?: string;
  };
  const displayName = String(body.displayName ?? user.displayName).trim();
  const email = normalizeEmail(String(body.email ?? user.email));
  const password = String(body.password ?? "");
  const seedEmail = normalizeEmail(user.seedEmail ?? user.email);
  const seedAccount = findSeedAccountBySeedEmail(seedEmail);

  if (!seedAccount) {
    return NextResponse.json({ error: "Account profile was not found." }, { status: 400 });
  }

  if (!displayName) {
    return NextResponse.json({ error: "Display name is required." }, { status: 400 });
  }

  if (!/^\S+@\S+\.\S+$/u.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  if (password && password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const existingOverride = await findExistingOverride(seedAccount.email);
  const passwordRecord = password
    ? createPasswordRecord(password)
    : existingOverride
      ? { passwordHash: existingOverride.passwordHash, salt: existingOverride.salt }
      : { passwordHash: seedAccount.passwordHash, salt: seedAccount.salt };

  await saveAuthUserOverrideToSheets({
    displayName,
    email,
    passwordHash: passwordRecord.passwordHash,
    salt: passwordRecord.salt,
    seedEmail: seedAccount.email,
    updatedAt: new Date().toISOString(),
  });

  const updated = {
    displayName,
    email,
    portfolioName: seedAccount.portfolioName,
    role: seedAccount.role,
    seedEmail: seedAccount.email,
  };
  await setSessionCookie(updated);

  return NextResponse.json({
    ok: true,
    user: {
      displayName: updated.displayName,
      email: updated.email,
      role: updated.role,
      portfolioName: updated.portfolioName,
    },
  });
}

async function findExistingOverride(seedEmail: string) {
  const overrides = await readAuthUserOverridesFromSheets();
  return overrides.find((override) => override.seedEmail === seedEmail) ?? null;
}
