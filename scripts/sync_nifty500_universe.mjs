import fs from "node:fs/promises";
import path from "node:path";

const outputPath = path.join(process.cwd(), "data", "market-universe.json");
const coreSource = {
  source: "NIFTY 500",
  url: "https://nsearchives.nseindia.com/content/indices/ind_nifty500list.csv",
};
const capBucketSources = [
  {
    capHint: "large",
    source: "NIFTY 200",
    url: "https://nsearchives.nseindia.com/content/indices/ind_nifty200list.csv",
    limit: 200,
  },
  {
    capHint: "mid",
    source: "NIFTY MidSmallcap 400",
    url: "https://nsearchives.nseindia.com/content/indices/ind_niftymidsmallcap400list.csv",
    limit: 200,
  },
  {
    capHint: "small",
    source: "NIFTY Smallcap 250",
    url: "https://nsearchives.nseindia.com/content/indices/ind_niftysmallcap250list.csv",
    limit: 200,
  },
  {
    capHint: "small",
    source: "NIFTY Microcap 250",
    url: "https://nsearchives.nseindia.com/content/indices/ind_niftymicrocap250_list.csv",
    limit: 200,
  },
];

const [coreRows, ...capRows] = await Promise.all([
  fetchIndexUniverse(coreSource),
  ...capBucketSources.map((source) => fetchCapBucketUniverse(source)),
]);
const universe = mergeUniverseRows(coreRows, capRows.flat());

if (universe.length < 450) {
  throw new Error(
    `Official blended universe is unexpectedly small (${universe.length}); refusing to overwrite the existing snapshot.`,
  );
}

await fs.writeFile(outputPath, `${JSON.stringify(universe, null, 2)}\n`, "utf8");
console.log(
  `Wrote ${universe.length} official NSE NIFTY 500 plus cap-bucket constituents to ${outputPath}`,
);

async function fetchCapBucketUniverse({ capHint, source, url, limit }) {
  return (await fetchIndexUniverse({ source, url, capHint })).slice(0, limit);
}

async function fetchIndexUniverse({ source, url, capHint = "mid" }) {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  if (!response.ok) {
    throw new Error(`Unable to download official ${source} constituents: ${response.status}`);
  }

  const csv = await response.text();
  const [headerLine, ...lines] = csv.split(/\r?\n/u).filter(Boolean);
  const headers = parseCsvLine(headerLine);
  const companyIndex = headers.indexOf("Company Name");
  const industryIndex = headers.indexOf("Industry");
  const symbolIndex = headers.indexOf("Symbol");
  const seriesIndex = headers.indexOf("Series");

  if ([companyIndex, industryIndex, symbolIndex, seriesIndex].some((index) => index < 0)) {
    throw new Error(`Official ${source} file does not contain the expected columns.`);
  }

  return lines
    .map(parseCsvLine)
    .filter((cells) => cells[seriesIndex] === "EQ")
    .map((cells) => ({
      symbol: cells[symbolIndex].trim(),
      company: cells[companyIndex].trim(),
      theme: cells[industryIndex].trim() || "Diversified",
      capHint,
      benchmark: benchmarkForIndustry(cells[industryIndex]),
      source,
      sources: [source],
    }))
    .filter((row) => row.symbol);
}

function mergeUniverseRows(coreRows, discoveryRows) {
  const bySymbol = new Map();

  for (const row of coreRows) {
    bySymbol.set(row.symbol, row);
  }

  for (const row of discoveryRows) {
    const existing = bySymbol.get(row.symbol);

    if (existing) {
      existing.capHint = row.capHint;
      existing.sources = [...new Set([...(existing.sources ?? [existing.source]), row.source])];
      existing.source = existing.sources.join(" + ");
    } else {
      bySymbol.set(row.symbol, row);
    }
  }

  return [...bySymbol.values()].sort((a, b) => {
    const bucketOrder = capBucketOrder(a.capHint) - capBucketOrder(b.capHint);
    return bucketOrder || a.symbol.localeCompare(b.symbol);
  });
}

function capBucketOrder(bucket) {
  if (bucket === "large") return 0;
  if (bucket === "mid") return 1;
  return 2;
}

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
