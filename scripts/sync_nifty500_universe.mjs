import fs from "node:fs/promises";
import path from "node:path";

const sourceUrl =
  "https://nsearchives.nseindia.com/content/indices/ind_nifty500list.csv";
const outputPath = path.join(process.cwd(), "data", "market-universe.json");

const response = await fetch(sourceUrl, {
  headers: { "User-Agent": "Mozilla/5.0" },
});

if (!response.ok) {
  throw new Error(
    `Unable to download official NIFTY 500 constituents: ${response.status}`,
  );
}

const csv = await response.text();
const [headerLine, ...lines] = csv.split(/\r?\n/u).filter(Boolean);
const headers = parseCsvLine(headerLine);
const companyIndex = headers.indexOf("Company Name");
const industryIndex = headers.indexOf("Industry");
const symbolIndex = headers.indexOf("Symbol");
const seriesIndex = headers.indexOf("Series");

if ([companyIndex, industryIndex, symbolIndex, seriesIndex].some((index) => index < 0)) {
  throw new Error("Official constituent file does not contain the expected columns.");
}

const universe = lines
  .map(parseCsvLine)
  .filter((cells) => cells[seriesIndex] === "EQ")
  .map((cells) => ({
    symbol: cells[symbolIndex].trim(),
    company: cells[companyIndex].trim(),
    theme: cells[industryIndex].trim() || "Diversified",
    capHint: "mid",
    benchmark: benchmarkForIndustry(cells[industryIndex]),
    source: "NIFTY 500",
  }))
  .filter((row) => row.symbol);

if (universe.length < 450) {
  throw new Error(
    `Official universe is unexpectedly small (${universe.length}); refusing to overwrite the existing snapshot.`,
  );
}

await fs.writeFile(outputPath, `${JSON.stringify(universe, null, 2)}\n`, "utf8");
console.log(`Wrote ${universe.length} official NIFTY 500 constituents to ${outputPath}`);

function benchmarkForIndustry(industry = "") {
  const normalized = industry.toLowerCase();

  if (normalized.includes("financial")) return "^CNXFIN";
  if (normalized.includes("information technology")) return "^CNXIT";
  if (
    normalized.includes("healthcare") ||
    normalized.includes("pharmaceutical")
  ) {
    return "^CNXPHARMA";
  }
  if (normalized.includes("automobile")) return "^CNXAUTO";
  if (normalized.includes("fast moving consumer")) return "^CNXFMCG";
  if (
    normalized.includes("consumer") ||
    normalized.includes("textile") ||
    normalized.includes("media")
  ) {
    return "^CNXCONSUM";
  }
  if (
    normalized.includes("power") ||
    normalized.includes("oil") ||
    normalized.includes("gas") ||
    normalized.includes("energy")
  ) {
    return "^CNXENERGY";
  }
  if (
    normalized.includes("metal") ||
    normalized.includes("mineral") ||
    normalized.includes("mining")
  ) {
    return "^CNXMETAL";
  }
  if (normalized.includes("realty")) return "^CNXREALTY";
  if (
    normalized.includes("construction") ||
    normalized.includes("capital goods") ||
    normalized.includes("services") ||
    normalized.includes("transport")
  ) {
    return "^CNXINFRA";
  }

  return "^NSEI";
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells;
}
