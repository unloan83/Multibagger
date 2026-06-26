import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

export type AccountRole = "admin" | "user";

export type AccountProfile = {
  email: string;
  displayName: string;
  role: AccountRole;
  portfolioName?: string;
  seedEmail?: string;
};

export type SeedAccount = AccountProfile & {
  salt: string;
  passwordHash: string;
};

const iterations = 120000;
const digest = "sha256";
const keyLength = 32;

export const seedAccounts: SeedAccount[] = [
  {
    email: "live.unloan@gmail.com",
    displayName: "Admin",
    role: "admin",
    salt: "8c39534f9012a9cc324980ee76347bcc",
    passwordHash: "f2304cf6a142c8cecf66c0702a2289dc4ddf60400e9d0cdff0c3bcf6161e8de3",
  },
  {
    email: "ragz_25hv@yahoo.co.in",
    displayName: "Raghu",
    role: "user",
    portfolioName: "Raghu",
    salt: "a37f91b45b77ac4e30dd140f9b81d81e",
    passwordHash: "6ea592709104d656119b9fc1e98d3556efca33da3c3157be4f28f59e1c0b62f6",
  },
  {
    email: "igsudhakar@gmail.com",
    displayName: "Sudhakar",
    role: "user",
    portfolioName: "Sudhakar",
    salt: "360ec5fee6101092e346470347075039",
    passwordHash: "7aa5afc054ddc1b12f2e6cf9584f0502f36eff06a786afbf0d29e537542d7fa7",
  },
  {
    email: "indra_siddhi@yahoo.co.in",
    displayName: "Suchi_icici",
    role: "user",
    portfolioName: "Suchi_icici",
    salt: "01186483c17daacdd7067dc62d15428d",
    passwordHash: "89f32511181424b40de823a87a0d777f1c98d2586873749b09d3b79085da0d33",
  },
  {
    email: "ravi.king3@gmail.com",
    displayName: "RS",
    role: "user",
    portfolioName: "RS",
    salt: "4612ddba47c968e02bb5c8ecdc88fb0f",
    passwordHash: "60eb17c3130200eeef283c6bd7567ec1f4216924e15b6e4a131ca969709c04b4",
  },
  {
    email: "visuras123@gmail.com",
    displayName: "Surendra",
    role: "user",
    portfolioName: "Surendra",
    salt: "cfe65dd244370846ddbda213504c5f0d",
    passwordHash: "41b1b6ca861210cf836b4f22f600bc84631fba7bb4951affdabcaeb7123a736a",
  },
  {
    email: "rohini2810@gmail.com",
    displayName: "RJ",
    role: "user",
    portfolioName: "RJ",
    salt: "99a569db57018e2b9c411fdd7ddda229",
    passwordHash: "acc8a2734702f5322cdfb7a96e172853dcc5c5f4b33cbc0e02fee94a23d7dde7",
  },
];

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function normalizePortfolioName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/gu, " ")
    .replace(/[^a-z0-9 ]+/gu, "")
    .replace(/\s+/gu, " ");
}

export function isAmolPortfolioName(value: string) {
  return normalizePortfolioName(value).includes("amol");
}

export function isActivePortfolioName(value: string) {
  return !isAmolPortfolioName(value);
}

export function findSeedAccount(email: string) {
  const normalized = normalizeEmail(email);
  return seedAccounts.find((account) => account.email === normalized) ?? null;
}

export function findSeedAccountBySeedEmail(seedEmail: string) {
  const normalized = normalizeEmail(seedEmail);
  return seedAccounts.find((account) => account.email === normalized || account.seedEmail === normalized) ?? null;
}

export function getAccountProfile(email: string): AccountProfile | null {
  const account = findSeedAccount(email);
  return account ? toPublicProfile(account) : null;
}

export function verifyAccountPassword(email: string, password: string) {
  const account = findSeedAccount(email);

  if (!account) {
    return null;
  }

  const hash = hashPassword(password, account.salt);

  if (!safeEqual(hash, account.passwordHash)) {
    return null;
  }

  return toPublicProfile(account);
}

export function hashPassword(password: string, salt: string) {
  return pbkdf2Sync(password, salt, iterations, keyLength, digest).toString("hex");
}

export function createPasswordRecord(password: string) {
  const salt = randomBytes(16).toString("hex");
  return {
    passwordHash: hashPassword(password, salt),
    salt,
  };
}

export function verifyPasswordRecord(password: string, salt: string, passwordHash: string) {
  return safeEqual(hashPassword(password, salt), passwordHash);
}

function toPublicProfile(account: SeedAccount): AccountProfile {
  return {
    displayName: account.displayName,
    email: account.email,
    portfolioName: account.portfolioName,
    role: account.role,
    seedEmail: account.email,
  };
}

function safeEqual(value: string, expected: string) {
  const valueBuffer = Buffer.from(value, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  if (valueBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(valueBuffer, expectedBuffer);
}
