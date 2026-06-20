import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const outputPath = path.join(repoRoot, "data", "daily_recommendations.csv");
const portfolioCsvPath = path.join(repoRoot, "public", "portfolio.csv");
const wealthSnapshotPath = path.join(repoRoot, "data", "wealth_recommendations.json");

const headers = [
  "date",
  "run_time_ist",
  "run_slot",
  "stock_name",
  "symbol",
  "category",
  "source",
  "segment",
  "action",
  "cmp",
  "previous_close",
  "change_percent",
  "target",
  "upside_percent",
  "volume",
  "volume_shock",
  "portfolio",
  "notes",
  "decision_score",
  "data_quality",
  "factor_summary",
];

const marketMoverGroups = {
  "Large Cap": [
    "RELIANCE",
    "TCS",
    "HDFCBANK",
    "ICICIBANK",
    "INFY",
    "ITC",
    "LT",
    "SBIN",
    "BHARTIARTL",
    "AXISBANK",
    "KOTAKBANK",
    "MARUTI",
    "SUNPHARMA",
    "TITAN",
    "BAJFINANCE",
    "NTPC",
  ],
  "Mid Cap": [
    "MAXHEALTH",
    "POLYCAB",
    "DIXON",
    "PERSISTENT",
    "CUMMINSIND",
    "RECLTD",
    "VBL",
    "AUBANK",
    "FEDERALBNK",
    "INDHOTEL",
    "ASHOKLEY",
    "MPHASIS",
    "COFORGE",
    "BALKRISIND",
    "LUPIN",
    "IDEA",
  ],
  "Small Cap": [
    "GIPCL",
    "NUCLEUS",
    "TEXRAIL",
    "RAMASTEEL",
    "DWARKESH",
    "MOREPENLAB",
    "SUZLON",
    "IREDA",
    "RVNL",
    "BEML",
    "MTARTECH",
    "GRAVITA",
    "KPEL",
    "JWL",
    "SENCO",
    "HBLPOWER",
  ],
};

const slot = getArgValue("--slot") ?? "all";
const now = new Date();
const date = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(now);
const runTimeIst = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  dateStyle: "medium",
  timeStyle: "medium",
}).format(now);

await fs.mkdir(path.dirname(outputPath), { recursive: true });

const rows = [];

if (slot === "market-close" || slot === "all") {
  rows.push(...await buildMarketRows());
}

if (slot === "morning" || slot === "all") {
  rows.push(...await buildExpertRows());
  rows.push(...await buildPortfolioRows());
}

await writeRows(rows);
console.log(`Wrote ${rows.length} ${slot} rows to ${path.relative(repoRoot, outputPath)}`);

async function buildMarketRows() {
  const rows = [];

  for (const [segment, symbols] of Object.entries(marketMoverGroups)) {
    const quotes = (await Promise.all(symbols.map(fetchQuote))).filter(
      (quote) => quote.price > 0,
    );
    const gainers = [...quotes]
      .sort((a, b) => b.changePercent - a.changePercent)
      .slice(0, 4);
    const losers = [...quotes]
      .sort((a, b) => a.changePercent - b.changePercent)
      .slice(0, 4);

    rows.push(
      ...gainers.map((quote) =>
        toCsvRow(quote, {
          runSlot: "market-close",
          category: "gainer",
          source: "market-movers",
          segment: `${segment} Top Gainers`,
          action: "Track",
          notes: "Post-close segmented top gainer by daily change percent",
        }),
      ),
      ...losers.map((quote) =>
        toCsvRow(quote, {
          runSlot: "market-close",
          category: "loser",
          source: "market-movers",
          segment: `${segment} Top Losers`,
          action: "Review Risk",
          notes: "Post-close segmented top loser by daily change percent",
        }),
      ),
    );
  }

  return rows;
}

async function buildExpertRows() {
  const snapshot = JSON.parse(await fs.readFile(wealthSnapshotPath, "utf8"));
  const ageHours = (Date.now() - Date.parse(snapshot.asOf)) / 3_600_000;

  if (!Number.isFinite(ageHours) || ageHours > 36 || snapshot.universeSize < 450) {
    throw new Error("Wealth recommendation snapshot is stale or incomplete.");
  }

  return snapshot.categories.flatMap((category) => [
      ...category.longTermUpsides.map((quote) =>
        toCsvRow(quote, {
          runSlot: "morning",
          category: "expert-long-term",
          source: "expert-action-matrix",
          segment: category.title,
          action: quote.action,
          notes: `Safety-gated long-term candidate | ${quote.reasons.join(" ")}`,
          decisionScore: quote.score,
          dataQuality: quote.dataQuality,
          factorSummary: formatFactorSummary(quote.factorScores),
        }),
      ),
      ...category.intradayBreakouts.map((quote) =>
        toCsvRow(quote, {
          runSlot: "morning",
          category: "expert-intraday",
          source: "expert-action-matrix",
          segment: category.title,
          action: quote.action === "Accumulate" ? "Track Breakout" : "Watchlist",
          notes: `Safety-gated momentum candidate | ${quote.reasons.join(" ")}`,
          decisionScore: quote.score,
          dataQuality: quote.dataQuality,
          factorSummary: formatFactorSummary(quote.factorScores),
        }),
      ),
    ]);
}

async function buildPortfolioRows() {
  const inputs = await readPortfolioInputs();
  const quotes = (
    await Promise.all(
      inputs.map(async (input) => ({
        ...await fetchQuote(input.symbol, input.company),
        quantity: input.quantity,
      })),
    )
  ).filter((quote) => quote.price > 0);
  const current = quotes.filter((quote) => quote.quantity > 0);

  const shortTerm = [...quotes]
    .sort((a, b) => b.changePercent + b.volumeShock - (a.changePercent + a.volumeShock))
    .slice(0, 5);
  const longTerm = [...current]
    .map((quote) => addTarget(quote, "Portfolio Analysis"))
    .sort((a, b) => b.upside - a.upside)
    .slice(0, 5);

  return [
    ...shortTerm.map((quote) =>
      toCsvRow(quote, {
        runSlot: "morning",
        category: "portfolio-short-term",
        source: "portfolio-analysis",
        segment: "Short-Term Buy/Sell Analysis",
        action: quote.changePercent < -2 ? "Urgent Sell" : "Accumulate",
        portfolio: "public/portfolio.csv",
        notes: "Repo portfolio management signal from uploaded-format seed file",
      }),
    ),
    ...longTerm.map((quote) =>
      toCsvRow(quote, {
        runSlot: "morning",
        category: "portfolio-long-term",
        source: "portfolio-analysis",
        segment: "Long-Term Buy/Sell Plan",
        action: quote.upside > 10 ? "Accumulate" : "Urgent Sell",
        portfolio: "public/portfolio.csv",
        notes: "Repo portfolio management signal from uploaded-format seed file",
      }),
    ),
  ];
}

async function readPortfolioInputs() {
  const csv = await fs.readFile(portfolioCsvPath, "utf8");
  const [headerLine, ...lines] = csv.split(/\r?\n/u).filter(Boolean);
  const header = headerLine.split(",").map((item) => item.trim().toLowerCase());
  const codeIndex = header.indexOf("stock code");
  const companyIndex = header.indexOf("company");
  const quantityIndex = header.indexOf("quantity");

  return lines
    .map((line) => parseCsvLine(line))
    .map((cells) => ({
      symbol: (cells[codeIndex] ?? "").trim().toUpperCase(),
      company: (cells[companyIndex] ?? "").trim(),
      quantity: Number((cells[quantityIndex] ?? "").replace(/,/gu, "")) || 0,
    }))
    .filter((row) => row.symbol);
}

async function fetchQuote(symbol, fallbackName = symbol) {
  const normalizedSymbol = symbol.replace(/\.NS$/u, "");
  const response = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      `${normalizedSymbol}.NS`,
    )}?range=1d&interval=1d`,
    { headers: { "User-Agent": "Mozilla/5.0" } },
  );

  if (!response.ok) {
    return emptyQuote(normalizedSymbol, fallbackName);
  }

  const data = await response.json();
  const meta = data.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice ?? 0;
  const previousClose = meta?.previousClose ?? meta?.chartPreviousClose ?? 0;
  const changePercent =
    previousClose === 0 ? 0 : ((price - previousClose) / previousClose) * 100;
  const volume = meta?.regularMarketVolume ?? 0;

  return {
    ...emptyQuote(normalizedSymbol, fallbackName),
    name: meta?.shortName ?? meta?.longName ?? fallbackName,
    price,
    previousClose,
    changePercent,
    volume,
    volumeShock: buildVolumeShock(normalizedSymbol, volume, changePercent),
  };
}

function emptyQuote(symbol, fallbackName) {
  return {
    symbol,
    name: fallbackName,
    price: 0,
    previousClose: 0,
    changePercent: 0,
    volume: 0,
    volumeShock: 0,
    target: 0,
    upside: 0,
    quantity: 0,
  };
}

function addTarget(quote, segment) {
  const [floor, ceiling] =
    segment.includes("Small-Cap")
      ? [1.15, 2.35]
      : segment.includes("Mid-Cap")
          ? [1.12, 1.32]
          : [1.15, 1.45];
  const multiplier = Math.min(
    ceiling,
    floor + quote.volumeShock * 0.08 + Math.max(quote.changePercent, 0) / 100,
  );
  const target = quote.price * multiplier;

  return {
    ...quote,
    target,
    upside: quote.price === 0 ? 0 : ((target - quote.price) / quote.price) * 100,
  };
}

function buildVolumeShock(symbol, volume, changePercent) {
  const symbolSeed = [...symbol].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const liquidityScore = Math.min(Math.log10(volume + 1) / 7, 1.4);
  const momentumScore = Math.max(changePercent, 0) / 8;
  const stableNoise = (symbolSeed % 19) / 100;

  return Number(Math.max(0.15, liquidityScore + momentumScore + stableNoise).toFixed(2));
}

function toCsvRow(
  quote,
  {
    runSlot,
    category,
    source,
    segment,
    action,
    portfolio = "",
    notes = "",
    decisionScore = "",
    dataQuality = "",
    factorSummary = "",
  },
) {
  return {
    date,
    run_time_ist: runTimeIst,
    run_slot: runSlot,
    stock_name: quote.name,
    symbol: quote.symbol,
    category,
    source,
    segment,
    action,
    cmp: round(quote.price),
    previous_close: round(quote.previousClose),
    change_percent: round(quote.changePercent),
    target: round(quote.target),
    upside_percent: round(quote.upside),
    volume: quote.volume,
    volume_shock: quote.volumeShock,
    portfolio,
    notes,
    decision_score: decisionScore,
    data_quality: dataQuality,
    factor_summary: factorSummary,
  };
}

async function writeRows(rows) {
  const existing = await readExistingCsv();
  const filtered = existing.filter(
    (row) => !(row.date === date && row.run_slot === (slot === "all" ? row.run_slot : slot)),
  );
  const nextRows = [...filtered, ...rows];
  const csv = [
    headers.join(","),
    ...nextRows.map((row) => headers.map((header) => csvEscape(row[header] ?? "")).join(",")),
  ].join("\n");

  await fs.writeFile(outputPath, `${csv}\n`, "utf8");
}

async function readExistingCsv() {
  try {
    const csv = await fs.readFile(outputPath, "utf8");
    const [, ...lines] = csv.split(/\r?\n/u).filter(Boolean);
    return lines.map((line) => {
      const cells = parseCsvLine(line);
      return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
    });
  } catch {
    return [];
  }
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

function csvEscape(value) {
  const text = String(value);
  return /[",\n\r]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

function round(value) {
  return Number(Number(value || 0).toFixed(2));
}

function formatFactorSummary(factors = {}) {
  return [
    `Growth ${factors.growth ?? 0}/20`,
    `Quality ${factors.quality ?? 0}/20`,
    `Valuation ${factors.valuation ?? 0}/15`,
    `Momentum ${factors.momentum ?? 0}/15`,
    `Sector ${factors.sectorStrength ?? 0}/10`,
    `Liquidity ${factors.liquidity ?? 0}/10`,
    `Risk ${factors.risk ?? 0}/10`,
  ].join(" | ");
}

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}
