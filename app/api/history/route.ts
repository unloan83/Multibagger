import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type HistoryRecord = {
  date: string;
  runTimeIst: string;
  runSlot: string;
  stockName: string;
  symbol: string;
  category: string;
  segment: string;
  action: string;
  cmp: number;
  previousClose: number;
  changePercent: number;
  target: number;
  upsidePercent: number;
  notes: string;
  factorSummary: string;
};

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const selectedMonth = searchParams.get("month") || "all";
    const download = searchParams.get("download") === "true";

    const csvPath = path.join(process.cwd(), "data", "daily_recommendations.csv");
    let rawContent = "";
    try {
      rawContent = await fs.readFile(csvPath, "utf8");
    } catch {
      return NextResponse.json({ ok: false, error: "History log file not found." }, { status: 404 });
    }

    const lines = rawContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length <= 1) {
      return NextResponse.json({ ok: true, months: [], records: [] });
    }

    const header = parseCsvLine(lines[0]);
    const dateIdx = header.indexOf("date");
    const runTimeIdx = header.indexOf("run_time_ist");
    const runSlotIdx = header.indexOf("run_slot");
    const nameIdx = header.indexOf("stock_name");
    const symbolIdx = header.indexOf("symbol");
    const categoryIdx = header.indexOf("category");
    const segmentIdx = header.indexOf("segment");
    const actionIdx = header.indexOf("action");
    const cmpIdx = header.indexOf("cmp");
    const prevCloseIdx = header.indexOf("previous_close");
    const changeIdx = header.indexOf("change_percent");
    const targetIdx = header.indexOf("target");
    const upsideIdx = header.indexOf("upside_percent");
    const notesIdx = header.indexOf("notes");
    const factorIdx = header.indexOf("factor_summary");

    const rawRecords: HistoryRecord[] = [];
    const monthMap = new Map<string, string>(); // YYYY-MM -> Label

    for (let i = 1; i < lines.length; i++) {
      const row = parseCsvLine(lines[i]);
      if (row.length < 5) continue;

      const dateStr = row[dateIdx] || "";
      if (dateStr) {
        const parts = dateStr.split("-");
        if (parts.length === 3) {
          const year = parts[0];
          const monthNum = parseInt(parts[1], 10);
          const monthKey = `${year}-${parts[1]}`;
          const monthNames = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
          ];
          const monthName = monthNames[monthNum - 1] || parts[1];
          monthMap.set(monthKey, `${monthName} ${year}`);
        }
      }

      rawRecords.push({
        date: dateStr,
        runTimeIst: row[runTimeIdx] || "",
        runSlot: row[runSlotIdx] || "",
        stockName: row[nameIdx] || "",
        symbol: row[symbolIdx] || "",
        category: row[categoryIdx] || "",
        segment: row[segmentIdx] || "",
        action: row[actionIdx] || "",
        cmp: parseFloat(row[cmpIdx]) || 0,
        previousClose: parseFloat(row[prevCloseIdx]) || 0,
        changePercent: parseFloat(row[changeIdx]) || 0,
        target: parseFloat(row[targetIdx]) || 0,
        upsidePercent: parseFloat(row[upsideIdx]) || 0,
        notes: row[notesIdx] || "",
        factorSummary: row[factorIdx] || "",
      });
    }

    const availableMonths = Array.from(monthMap.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => b.value.localeCompare(a.value));

    // Filter by selected month if requested
    const filteredRecords = selectedMonth === "all"
      ? rawRecords
      : rawRecords.filter((r) => r.date.startsWith(selectedMonth));

    if (download) {
      // Build CSV content for download
      let csvOutput = lines[0] + "\n";
      for (let i = 1; i < lines.length; i++) {
        const row = parseCsvLine(lines[i]);
        const d = row[dateIdx] || "";
        if (selectedMonth === "all" || d.startsWith(selectedMonth)) {
          csvOutput += lines[i] + "\n";
        }
      }

      const filename = selectedMonth === "all"
        ? "daily_recommendations_all.csv"
        : `daily_recommendations_${selectedMonth}.csv`;

      return new Response(csvOutput, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      months: availableMonths,
      records: filteredRecords.reverse(),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err), months: [], records: [] },
      { status: 500 }
    );
  }
}
