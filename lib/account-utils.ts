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
