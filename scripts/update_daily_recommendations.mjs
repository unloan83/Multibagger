import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const outputPath = path.join(repoRoot, "data", "daily_recommendations.csv");
const portfolioCsvPath = path.join(repoRoot, "public", "portfolio.csv");
<<<<<<< Updated upstream
const wealthSnapshotPath = path.join(repoRoot, "data", "wealth_recommendations.json");
=======
const universePath = path.join(repoRoot, "data", "market-universe.json");
const discoveryUniverse = JSON.parse(await fs.readFile(universePath, "utf8"));
>>>>>>> Stashed changes

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

<<<<<<< Updated upstream
=======
const expertGroups = {
  "Large-Cap Quality Compounders": discoveryUniverse
    .filter((row) => row.capHint === "large")
    .map((row) => row.symbol),
  "Mid-Cap Growth Leaders": discoveryUniverse
    .filter((row) => row.capHint === "mid")
    .map((row) => row.symbol),
  "Small-Cap Wealth Candidates": discoveryUniverse
    .filter((row) => row.capHint === "small")
    .map((row) => row.symbol),
};

>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
          segment: category.title,
          action: quote.action,
          notes: `Safety-gated long-term candidate | ${quote.reasons.join(" ")}`,
          decisionScore: quote.score,
          dataQuality: quote.dataQuality,
          factorSummary: formatFactorSummary(quote.factorScores),
=======
          segment,
          action: "Accumulate",
          notes: "Expanded thematic universe long-term candidate; live page applies full multi-factor scoring",
>>>>>>> Stashed changes
        }),
      ),
      ...category.intradayBreakouts.map((quote) =>
        toCsvRow(quote, {
          runSlot: "morning",
          category: "expert-intraday",
          source: "expert-action-matrix",
<<<<<<< Updated upstream
          segment: category.title,
          action: quote.action === "Accumulate" ? "Track Breakout" : "Watchlist",
          notes: `Safety-gated momentum candidate | ${quote.reasons.join(" ")}`,
          decisionScore: quote.score,
          dataQuality: quote.dataQuality,
          factorSummary: formatFactorSummary(quote.factorScores),
=======
          segment,
          action: "Track Breakout",
          notes: "Expanded thematic universe momentum candidate; live page applies full multi-factor scoring",
>>>>>>> Stashed changes
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
    .map(classifyLongTermPortfolioQuote)
    .filter((quote) => quote.action)
    .sort((a, b) =>
      a.action === b.action
        ? b.signalStrength - a.signalStrength
        : a.action === "Urgent Sell"
          ? -1
          : 1,
    )
    .slice(0, 5);

  return [
    ...shortTerm.map((quote) =>
      toCsvRow(quote, {
        runSlot: "morning",
        category: "portfolio-short-term",
        source: "portfolio-analysis",
        segment: "Short-Term Buy/Sell Analysis",
        action: quote.changePercent >= 0 ? "Track" : "Watchlist",
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
        action: quote.action,
        portfolio: "public/portfolio.csv",
        notes:
          quote.action === "Urgent Sell"
            ? `Persistent decline confirmed across 5, 20, 60 and 120 sessions with EMA50 below EMA200; decline score ${quote.persistentDeclineScore}/100`
            : `High-conviction long-term trend; evidence-derived potential ${quote.longTermPotentialPercent.toFixed(1)}%`,
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
    )}?range=1y&interval=1d`,
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
  const chart = data.chart?.result?.[0]?.indicators?.quote?.[0];
  const bars = (chart?.close ?? [])
    .map((close, index) => ({
      close: close ?? 0,
      high: chart?.high?.[index] ?? close ?? 0,
      low: chart?.low?.[index] ?? close ?? 0,
      volume: chart?.volume?.[index] ?? 0,
    }))
    .filter((bar) => bar.close > 0);

  return {
    ...emptyQuote(normalizedSymbol, fallbackName),
    name: meta?.shortName ?? meta?.longName ?? fallbackName,
    price,
    previousClose,
    changePercent,
    volume,
    volumeShock: buildVolumeShock(normalizedSymbol, volume, changePercent),
    bars,
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
    bars: [],
    target: 0,
    upside: 0,
    quantity: 0,
  };
}

<<<<<<< Updated upstream
function classifyLongTermPortfolioQuote(quote) {
  const closes = quote.bars.map((bar) => bar.close);
  const ema20 = calculateEma(closes, 20) || quote.price;
  const ema50 = calculateEma(closes, 50) || quote.price;
  const ema200 = calculateEma(closes, 200) || quote.price;
  const return5 = periodReturn(closes, quote.price, 5);
  const return20 = periodReturn(closes, quote.price, 20);
  const return60 = periodReturn(closes, quote.price, 60);
  const return120 = periodReturn(closes, quote.price, 120);
  const high60 = Math.max(0, ...quote.bars.slice(-60).map((bar) => bar.high));
  const drawdown = high60 > 0 ? ((quote.price - high60) / high60) * 100 : 0;
  const persistentDeclineScore = Math.min(
    100,
    (quote.price < ema20 ? 18 : 0) +
      (ema20 < ema50 ? 20 : 0) +
      (ema50 < ema200 ? 15 : 0) +
      (return5 <= -2 ? 12 : 0) +
      (return20 <= -8 ? 18 : 0) +
      (return60 <= -12 ? 18 : 0) +
      (return120 <= -18 ? 15 : 0) +
      (drawdown <= -20 ? 12 : 0),
=======
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
>>>>>>> Stashed changes
  );
  const expectedDownsidePercent = Math.min(
    35,
    Math.max(0, -return5) * 0.3 +
      Math.max(0, -return20) * 0.35 +
      Math.max(0, -return60) * 0.15 +
      Math.max(0, -return120) * 0.1 +
      Math.max(0, -drawdown) * 0.2,
  );
  const longTermPotentialPercent = Math.max(
    0,
    Math.min(
      60,
      Math.max(0, return120) * 0.25 +
        Math.max(0, return60) * 0.3 +
        Math.max(0, return20) * 0.3 +
        Math.max(0, return5) * 0.15 +
        (quote.price >= ema20 && ema20 >= ema50 && ema50 >= ema200 ? 8 : 0) -
        Math.abs(Math.min(0, drawdown)) * 0.1,
    ),
  );
  const isPersistentSell =
    closes.length >= 180 &&
    persistentDeclineScore >= 80 &&
    expectedDownsidePercent >= 10 &&
    return5 < 0 &&
    return20 <= -8 &&
    return60 <= -12 &&
    return120 <= -18 &&
    ema20 < ema50 &&
    ema50 < ema200;
  const isLongTermBuy =
    closes.length >= 180 &&
    longTermPotentialPercent >= 15 &&
    return20 > 0 &&
    return60 >= 5 &&
    return120 >= 10 &&
    ema20 >= ema50 &&
    ema50 >= ema200;
  const action = isPersistentSell
    ? "Urgent Sell"
    : isLongTermBuy
      ? "Accumulate"
      : "";
  const potential = isPersistentSell
    ? -expectedDownsidePercent
    : longTermPotentialPercent;

  return {
    ...quote,
    action,
    persistentDeclineScore,
    longTermPotentialPercent,
    signalStrength: isPersistentSell
      ? persistentDeclineScore
      : longTermPotentialPercent,
    target: quote.price * (1 + potential / 100),
    upside: potential,
  };
}

function calculateEma(values, period) {
  if (!values.length) return 0;
  const multiplier = 2 / (period + 1);
  const seed =
    values.slice(0, period).reduce((sum, value) => sum + value, 0) /
    Math.min(period, values.length);
  return values.slice(period).reduce(
    (ema, value) => (value - ema) * multiplier + ema,
    seed,
  );
}

function periodReturn(values, price, periods) {
  const base = values.at(-(periods + 1)) ?? 0;
  return base > 0 && price > 0 ? ((price - base) / base) * 100 : 0;
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
