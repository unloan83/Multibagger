import fs from "node:fs/promises";
import path from "node:path";

const outputPath = path.join(process.cwd(), "data", "multibagger-universe.json");
const headers = {
  "User-Agent": "Mozilla/5.0",
  Accept: "application/json,text/csv,*/*",
};

const [nseEquityCsv, nseEtfCsv, bseResponse] = await Promise.all([
  fetchText("https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv"),
  fetchText("https://nsearchives.nseindia.com/content/equities/eq_etfseclist.csv"),
  fetch("https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w?Group=&Scripcode=&industry=&segment=Equity&status=Active", {
    headers: { ...headers, Origin: "https://www.bseindia.com", Referer: "https://www.bseindia.com/" },
  }),
]);

if (!bseResponse.ok) throw new Error(`Official BSE active-equities API returned ${bseResponse.status}.`);

const nseEquities = parseCsv(nseEquityCsv).filter((row) => row.SERIES === "EQ").map((row) => ({
  symbol: row.SYMBOL,
  company: row["NAME OF COMPANY"],
  kind: "STOCK",
  exchange: "NSE",
  isin: row["ISIN NUMBER"],
  yahooSymbol: `${row.SYMBOL}.NS`,
  source: "Official NSE EQUITY_L",
}));
const nseEtfs = parseCsv(nseEtfCsv).map((row) => ({
  symbol: row.Symbol,
  company: row.SecurityName,
  kind: "ETF",
  exchange: "NSE",
  isin: row.ISINNumber,
  yahooSymbol: `${row.Symbol}.NS`,
  underlying: row.Underlying,
  source: "Official NSE ETF security list",
}));
const bseRows = await bseResponse.json();
const bseEquities = bseRows.filter((row) => row.Status === "Active" && row.Segment === "Equity").map((row) => ({
  symbol: row.scrip_id || row.SCRIP_CD,
  company: row.Issuer_Name || row.Scrip_Name,
  kind: "STOCK",
  exchange: "BSE",
  isin: row.ISIN_NUMBER,
  bseCode: row.SCRIP_CD,
  yahooSymbol: `${row.SCRIP_CD}.BO`,
  marketCapCr: Number(row.Mktcap) || null,
  source: "Official BSE active-equities API",
}));

if (nseEquities.length < 1_500 || bseEquities.length < 1_500 || nseEtfs.length < 50) {
  throw new Error(`Refusing incomplete universe: NSE equities ${nseEquities.length}, BSE equities ${bseEquities.length}, ETFs ${nseEtfs.length}.`);
}

const byKey = new Map();
for (const security of [...nseEquities, ...bseEquities, ...nseEtfs]) {
  const key = `${security.kind}:${security.isin || `${security.exchange}:${security.symbol}`}`;
  const existing = byKey.get(key);
  if (existing && existing.kind === "STOCK") {
    existing.exchange = "NSE/BSE";
    existing.bseCode = security.bseCode || existing.bseCode;
    existing.sources = [...new Set([...(existing.sources || [existing.source]), security.source])];
  } else {
    byKey.set(key, { ...security, sources: [security.source] });
  }
}

const securities = [...byKey.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.symbol.localeCompare(b.symbol));
const snapshot = {
  asOf: new Date().toISOString(),
  scope: "All active NSE and BSE equities plus all NSE-listed ETFs; price eligibility is applied from the latest market quote at scan time.",
  sources: [
    "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv",
    "https://nsearchives.nseindia.com/content/equities/eq_etfseclist.csv",
    "https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w",
  ],
  counts: {
    uniqueSecurities: securities.length,
    stocks: securities.filter((row) => row.kind === "STOCK").length,
    etfs: securities.filter((row) => row.kind === "ETF").length,
    nseRows: nseEquities.length,
    bseRows: bseEquities.length,
  },
  securities,
};

try {
  const existing = JSON.parse(await fs.readFile(outputPath, "utf8"));
  if (JSON.stringify(existing.securities) === JSON.stringify(snapshot.securities)) {
    console.log(JSON.stringify({ ...snapshot.counts, unchanged: true }));
    process.exit(0);
  }
} catch {
  // First run or invalid prior snapshot: write the verified registry below.
}

await fs.writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(JSON.stringify(snapshot.counts));

async function fetchText(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${url} returned ${response.status}.`);
  return response.text();
}

function parseCsv(csv) {
  const [headerLine, ...lines] = csv.split(/\r?\n/u).filter(Boolean);
  const names = parseCsvLine(headerLine).map((name) => name.trim());
  return lines.map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(names.map((name, index) => [name, (cells[index] || "").trim()]));
  });
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') { current += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { cells.push(current); current = ""; }
    else current += char;
  }
  cells.push(current);
  return cells;
}
