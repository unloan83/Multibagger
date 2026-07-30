import crypto from "node:crypto";

const authUrl = "https://oauth2.googleapis.com/token";
const sheetsApiBase = "https://sheets.googleapis.com/v4/spreadsheets";

let cachedToken: { value: string; expiresAt: number } | null = null;

function getServiceAccountKey(): { clientEmail: string; privateKey: string } {
  const privateKey = process.env.GOOGLE_SHEET_PRIVATE_KEY;
  const clientEmail = process.env.GOOGLE_SHEET_CLIENT_EMAIL;
  if (!privateKey || !clientEmail) {
    throw new Error("GOOGLE_SHEET_PRIVATE_KEY and GOOGLE_SHEET_CLIENT_EMAIL must be set");
  }
  return {
    clientEmail,
    privateKey: privateKey.replace(/\\n/g, "\n"),
  };
}

function getSheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error("GOOGLE_SHEET_ID must be set");
  return id;
}

function createJwt(clientEmail: string, privateKey: string): string {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: authUrl,
    exp: now + 3600,
    iat: now,
  };

  const base64Encode = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

  const signatureInput = `${base64Encode(header)}.${base64Encode(payload)}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signatureInput);
  signer.end();
  const signature = signer
    .sign(privateKey)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${signatureInput}.${signature}`;
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.value;
  }

  const { clientEmail, privateKey } = getServiceAccountKey();
  const assertion = createJwt(clientEmail, privateKey);

  const response = await fetch(authUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google OAuth failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  const expiresInMs = (data.expires_in - 60) * 1000;
  cachedToken = { value: data.access_token, expiresAt: Date.now() + expiresInMs };
  return data.access_token;
}

async function sheetsApi(method: string, path: string, body?: unknown) {
  const token = await getAccessToken();
  const url = `${sheetsApiBase}/${path}`;

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Sheets API error: ${response.status} ${text}`);
  }

  return response.json();
}

type SheetRecommendation = {
  source: string;
  category: string;
  type: "longTerm" | "intraday";
  symbol: string;
  name: string;
  action: string;
  score: number;
  price: number;
  target: number;
  upside: number;
  sector: string;
  marketRegime?: string;
};

const HEADERS = [
  "Timestamp",
  "Source",
  "Category",
  "Type",
  "Symbol",
  "Name",
  "Action",
  "Score",
  "Price",
  "Target",
  "Upside%",
  "Sector",
  "MarketRegime",
];

function guessSheetExists(sheets: Array<{ properties?: { title?: string } }>) {
  return sheets.some((s) => s.properties?.title === "Recommendations");
}

export async function logRecommendationsToSheet(
  recommendations: SheetRecommendation[],
): Promise<void> {
  const sheetId = getSheetId();

  try {
    const metadata = (await sheetsApi(
      "GET",
      `${sheetId}?fields=sheets.properties.title,sheets.properties.gridProperties.rowCount`,
    )) as {
      sheets?: Array<{
        properties?: { title?: string; gridProperties?: { rowCount?: number } };
      }>;
    };

    if (!guessSheetExists(metadata.sheets ?? [])) {
      await sheetsApi("POST", `${sheetId}:batchUpdate`, {
        requests: [{ addSheet: { properties: { title: "Recommendations" } } }],
      });
      await sheetsApi("PUT", `${sheetId}/values/Recommendations!A1?valueInputOption=RAW`, {
        values: [HEADERS],
      });
    }
  } catch {
    await sheetsApi("PUT", `${sheetId}/values/A1?valueInputOption=RAW`, {
      values: [HEADERS],
    });
  }

  const now = new Date().toISOString();
  const rows = recommendations.map((r) => [
    now,
    r.source,
    r.category,
    r.type,
    r.symbol,
    r.name,
    r.action,
    String(r.score),
    String(r.price),
    String(r.target),
    String(r.upside),
    r.sector,
    r.marketRegime ?? "",
  ]);

  try {
    await sheetsApi(
      "POST",
      `${sheetId}/values/Recommendations!A:M:append?valueInputOption=RAW`,
      { values: rows },
    );
  } catch {
    console.warn("Google Sheets log: append failed (sheet may not exist yet — skipped)");
  }
}
