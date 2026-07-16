import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const csvPath = path.join(repoRoot, "data", "daily_recommendations.csv");
const backupDir = path.join(repoRoot, "data", "history-backups");
const apply = process.argv.includes("--apply");
const csv = await fs.readFile(csvPath, "utf8");
const lines = csv.trimEnd().split(/\r?\n/u);
const headers = parseCsvLine(lines[0]);
const rows = lines.slice(1).map((line) => {
  const cells = parseCsvLine(line);
  return { line, values: Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])) };
});

const marketDates = [...new Set(rows
  .filter(({ values }) => values.source === "market-movers" && values.date)
  .map(({ values }) => values.date))]
  .sort()
  .slice(-10);
const retainedDates = new Set(marketDates);
const retained = rows.filter(({ values }) => retainedDates.has(values.date));
const summary = {
  apply,
  originalRows: rows.length,
  retainedRows: retained.length,
  removedRows: rows.length - retained.length,
  retainedFrom: marketDates[0] ?? null,
  retainedThrough: marketDates.at(-1) ?? null,
};

if (apply && retained.length < rows.length) {
  await fs.mkdir(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, "daily_recommendations.pre-cleanup.csv");
  await fs.writeFile(backupPath, csv, "utf8");
  await fs.writeFile(csvPath, `${lines[0]}\n${retained.map(({ line }) => line).join("\n")}\n`, "utf8");
  Object.assign(summary, { backupPath });
}

console.log(JSON.stringify(summary, null, 2));

function parseCsvLine(line) {
  const cells = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      cells.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  cells.push(value);
  return cells;
}
