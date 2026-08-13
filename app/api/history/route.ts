import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { readUsMarketSnapshot } from "@/lib/us-market-engine";
import { RECOMMENDATION_PUBLICATION } from "@/lib/recommendation-publication";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type HistoryRecord = {
  date: string;
  stockName: string;
  symbol: string;
  termType: string; // "Intraday" | "1 Week" | "1 Month" | "3 Months" | "6 Months"
  cmp: number; // Recommended CMP
  target: number; // Recommended Target
  hitOrMiss: "HIT" | "MISS" | "IN PROGRESS";
  hitTimeDetails: string;
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

/** Helper to derive clean Term Type string */
function deriveTermType(category: string, segment: string, source: string, notes: string): string {
  const text = `${category} ${segment} ${source} ${notes}`.toLowerCase();
  if (text.includes("intraday") || text.includes("breakout") || text.includes("morning")) {
    return "Intraday";
  }
  if (text.includes("1week") || text.includes("1-week") || text.includes("short-term")) {
    return "1 Week";
  }
  if (text.includes("1month") || text.includes("1-month")) {
    return "1 Month";
  }
  if (text.includes("3months") || text.includes("3-month")) {
    return "3 Months";
  }
  if (text.includes("6months") || text.includes("6-month") || text.includes("long-term") || text.includes("multibagger")) {
    return "6 Months";
  }
  return "Swing / Positional";
}

/** Helper to evaluate Hit/Miss status and generate Hit Time Details */
function evaluateHitStatus(
  rawTarget: number,
): { target: number; hitOrMiss: "HIT" | "MISS" | "IN PROGRESS"; hitTimeDetails: string } {
  return { target: rawTarget > 0 ? rawTarget : 0, hitOrMiss: "IN PROGRESS", hitTimeDetails: "Outcome not independently verified against live historical candles." };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const selectedMonth = searchParams.get("month") || "all";
    const download = searchParams.get("download") === "true";
    const market = searchParams.get("market")?.toLowerCase() === "us" ? "us" : "india";
    if (!RECOMMENDATION_PUBLICATION.legacyEnabled) {
      if (download) return new Response("Date,Stock Name,Symbol,Term Type,Recommended CMP,Target Price,Status,Details\n", { headers: { "Content-Type": "text/csv; charset=utf-8" } });
      return NextResponse.json({ ok: true, publication: RECOMMENDATION_PUBLICATION, months: [], records: [] });
    }

    if (market === "us") {
      const snapshot = await readUsMarketSnapshot();
      const date = snapshot.asOf.slice(0, 10);
      const month = date.slice(0, 7);
      const label = new Date(snapshot.asOf).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "America/New_York" });
      const records: HistoryRecord[] = snapshot.termPicks.map((pick) => ({
        date,
        stockName: pick.name,
        symbol: pick.symbol,
        termType: pick.durationLabel,
        cmp: pick.price,
        target: pick.target,
        hitOrMiss: "IN PROGRESS",
        hitTimeDetails: `Current US model snapshot • Score ${pick.score}/100`,
      }));
      const filtered = selectedMonth === "all" || selectedMonth === month ? records : [];
      if (download) {
        let csv = "Date,Stock Name,Symbol,Term Type,Recommended CMP (USD),Target Price (USD),Status,Details\n";
        for (const record of filtered) csv += `"${record.date}","${record.stockName}","${record.symbol}","${record.termType}",${record.cmp},${record.target},"${record.hitOrMiss}","${record.hitTimeDetails}"\n`;
        return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="us_recommendations_history.csv"` } });
      }
      return NextResponse.json({ ok: true, months: [{ value: month, label }], records: filtered });
    }

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
    const nameIdx = header.indexOf("stock_name");
    const symbolIdx = header.indexOf("symbol");
    const categoryIdx = header.indexOf("category");
    const sourceIdx = header.indexOf("source");
    const segmentIdx = header.indexOf("segment");
    const cmpIdx = header.indexOf("cmp");
    const targetIdx = header.indexOf("target");
    const notesIdx = header.indexOf("notes");

    const rawRecords: HistoryRecord[] = [];
    const monthMap = new Map<string, string>(); // YYYY-MM -> Label

    for (let i = 1; i < lines.length; i++) {
      const row = parseCsvLine(lines[i]);
      if (row.length < 4) continue;

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

      const category = row[categoryIdx] || "";
      const source = row[sourceIdx] || "";
      const segment = row[segmentIdx] || "";
      const notes = row[notesIdx] || "";
      if (/seed|portfolio-analysis/i.test(`${source} ${notes}`)) continue;
      const stockName = row[nameIdx] || "";
      const symbol = row[symbolIdx] || "";
      const cmp = parseFloat(row[cmpIdx]) || 0;
      const rawTarget = parseFloat(row[targetIdx]) || 0;
      const termType = deriveTermType(category, segment, source, notes);
      const { target, hitOrMiss, hitTimeDetails } = evaluateHitStatus(rawTarget);

      rawRecords.push({
        date: dateStr,
        stockName: stockName || symbol,
        symbol: symbol || stockName,
        termType,
        cmp,
        target,
        hitOrMiss,
        hitTimeDetails,
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
      // Build clean CSV content for download matching simplified schema
      let csvOutput = "Date,Stock Name,Symbol,Term Type,Recommended CMP (INR),Target Price (INR),Status,Hit Time Details\n";
      for (const r of filteredRecords) {
        csvOutput += `"${r.date}","${r.stockName}","${r.symbol}","${r.termType}",${r.cmp},${r.target},"${r.hitOrMiss}","${r.hitTimeDetails}"\n`;
      }

      const filename = selectedMonth === "all"
        ? "recommendations_history_all.csv"
        : `recommendations_history_${selectedMonth}.csv`;

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
