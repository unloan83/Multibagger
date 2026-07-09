import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const csvPath = path.join(repoRoot, "data", "daily_recommendations.csv");

const csv = await fs.readFile(csvPath, "utf8");
const rows = parseCsvRows(csv);
const rowsByDate = groupBy(rows, (row) => row.date);
const dates = [...rowsByDate.keys()].sort();

const dailyComparisons = dates
  .map((date) => {
    const dayRows = rowsByDate.get(date) ?? [];
    const topGainers = dayRows.filter(
      (row) =>
        row.source === "market-movers" &&
        row.category === "gainer" &&
        Number(row.change_percent) > 0,
    );
    const expertIntraday = dayRows.filter(
      (row) =>
        row.source === "expert-action-matrix" &&
        row.category === "expert-intraday",
    );
    const portfolioTracks = dayRows.filter(
      (row) =>
        row.source === "portfolio-analysis" &&
        row.category === "portfolio-short-term" &&
        row.action === "Track" &&
        Number(row.change_percent) > 0,
    );

    if (topGainers.length === 0) return null;

    return {
      date,
      topGainers,
      expertIntraday,
      portfolioTracks,
      expertOverlap: overlapSymbols(expertIntraday, topGainers),
      portfolioOverlap: overlapSymbols(portfolioTracks, topGainers),
    };
  })
  .filter(Boolean);

const expertRows = dailyComparisons.flatMap((day) => day.expertIntraday);
const topGainerRows = dailyComparisons.flatMap((day) => day.topGainers);
const portfolioRows = dailyComparisons.flatMap((day) => day.portfolioTracks);
const expertOverlap = dailyComparisons.flatMap((day) => day.expertOverlap);
const portfolioOverlap = dailyComparisons.flatMap((day) => day.portfolioOverlap);
const missedTopGainers = dailyComparisons.flatMap((day) => {
  const expertSymbols = new Set(day.expertIntraday.map((row) => row.symbol));
  return day.topGainers.filter((row) => !expertSymbols.has(row.symbol));
});
const expertFalsePositives = dailyComparisons.flatMap((day) => {
  const gainerSymbols = new Set(day.topGainers.map((row) => row.symbol));
  return day.expertIntraday.filter((row) => !gainerSymbols.has(row.symbol));
});

const report = {
  csv: path.relative(repoRoot, csvPath),
  datesAnalyzed: dailyComparisons.length,
  expertIntradayRows: expertRows.length,
  topGainerRows: topGainerRows.length,
  portfolioTrackRows: portfolioRows.length,
  expertTopGainerOverlap: {
    count: expertOverlap.length,
    rate: percent(expertOverlap.length, topGainerRows.length),
  },
  portfolioTopGainerOverlap: {
    count: portfolioOverlap.length,
    rate: percent(portfolioOverlap.length, topGainerRows.length),
  },
  averages: {
    topGainers: summarizeMetrics(topGainerRows),
    expertIntraday: summarizeMetrics(expertRows),
    portfolioTracks: summarizeMetrics(portfolioRows),
  },
  topMissedGainers: summarizeSymbols(missedTopGainers).slice(0, 12),
  expertFalsePositives: summarizeSymbols(expertFalsePositives).slice(0, 12),
  daily: dailyComparisons.map((day) => ({
    date: day.date,
    expert: day.expertIntraday.map((row) => row.symbol),
    topGainers: day.topGainers.map((row) => row.symbol),
    expertOverlap: day.expertOverlap.map((row) => row.symbol),
    portfolioOverlap: day.portfolioOverlap.map((row) => row.symbol),
  })),
};

console.log(JSON.stringify(report, null, 2));

function parseCsvRows(input) {
  const [headerLine, ...lines] = input.split(/\r?\n/u).filter(Boolean);
  const headers = parseCsvLine(headerLine);

  return lines.map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(
      headers.map((header, index) => [header, cells[index] ?? ""]),
    );
  });
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

function groupBy(items, keyFn) {
  return items.reduce((map, item) => {
    const key = keyFn(item);
    const group = map.get(key) ?? [];
    group.push(item);
    map.set(key, group);
    return map;
  }, new Map());
}

function overlapSymbols(leftRows, rightRows) {
  const rightSymbols = new Set(rightRows.map((row) => row.symbol));
  return leftRows.filter((row) => rightSymbols.has(row.symbol));
}

function summarizeMetrics(items) {
  return {
    changePercent: average(items.map((row) => Number(row.change_percent))),
    volumeShock: average(items.map((row) => Number(row.volume_shock))),
    decisionScore: average(items.map((row) => Number(row.decision_score))),
  };
}

function summarizeSymbols(items) {
  const summary = items.reduce((acc, row) => {
    const current =
      acc[row.symbol] ??
      {
        symbol: row.symbol,
        name: row.stock_name || row.symbol,
        appearances: 0,
        segments: new Set(),
        averageChangePercent: 0,
        averageVolumeShock: 0,
      };
    current.appearances += 1;
    current.segments.add(row.segment);
    current.averageChangePercent += Number(row.change_percent) || 0;
    current.averageVolumeShock += Number(row.volume_shock) || 0;
    acc[row.symbol] = current;
    return acc;
  }, {});

  return Object.values(summary)
    .map((item) => ({
      symbol: item.symbol,
      name: item.name,
      appearances: item.appearances,
      segments: [...item.segments],
      averageChangePercent: round(item.averageChangePercent / item.appearances),
      averageVolumeShock: round(item.averageVolumeShock / item.appearances),
    }))
    .sort(
      (a, b) =>
        b.appearances - a.appearances ||
        b.averageChangePercent - a.averageChangePercent,
    );
}

function average(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length === 0) return null;
  return round(clean.reduce((sum, value) => sum + value, 0) / clean.length);
}

function percent(count, total) {
  if (total === 0) return 0;
  return round((count / total) * 100);
}

function round(value) {
  return Math.round(value * 100) / 100;
}
