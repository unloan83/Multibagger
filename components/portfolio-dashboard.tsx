"use client";

import Papa from "papaparse";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, FileUp, PieChart as PieChartIcon, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  PortfolioHolding,
  calculatePortfolioMetrics,
  formatCurrency,
  formatPercent,
  identifySector,
  sampleHoldings,
} from "@/lib/portfolio";
import { cn } from "@/lib/utils";
import { useMemo, useRef, useState, type ReactNode } from "react";

const sectorColors = [
  "#0f8b8d",
  "#f4a261",
  "#4f7cac",
  "#d1495b",
  "#2a9d8f",
  "#6d597a",
  "#8ab17d",
  "#e76f51",
];

type CsvRow = {
  symbol?: string;
  company?: string;
  sector?: string;
  quantity?: string;
  averagePrice?: string;
  currentPrice?: string;
  previousClose?: string;
};

export function PortfolioDashboard() {
  const [holdings, setHoldings] = useState<PortfolioHolding[]>(sampleHoldings);
  const [fileName, setFileName] = useState("sample data");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const metrics = useMemo(() => calculatePortfolioMetrics(holdings), [holdings]);

  function handleCsvUpload(file: File) {
    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const parsed = result.data
          .map((row) => {
            const symbol = row.symbol?.trim().toUpperCase() ?? "";
            const company = row.company?.trim() ?? "";
            const suppliedSector = row.sector?.trim();

            return {
              symbol,
              company,
              sector: suppliedSector || identifySector(symbol, company),
              quantity: Number(row.quantity),
              averagePrice: Number(row.averagePrice),
              currentPrice: Number(row.currentPrice),
              previousClose: Number(row.previousClose),
            };
          })
          .filter(
            (row) =>
              row.symbol &&
              row.company &&
              Number.isFinite(row.quantity) &&
              Number.isFinite(row.averagePrice) &&
              Number.isFinite(row.currentPrice) &&
              Number.isFinite(row.previousClose),
          );

        if (parsed.length === 0) {
          setError(
            "No valid rows found. Use columns: symbol, company, quantity, averagePrice, currentPrice, previousClose. Sector is optional.",
          );
          return;
        }

        setHoldings(parsed);
        setFileName(file.name);
        setError(null);
      },
      error: (parseError) => {
        setError(parseError.message);
      },
    });
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f6fafb_0%,#eef3f3_46%,#f7f8f5_100%)]">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <p className="text-sm font-semibold text-primary">OpenStock-style dashboard</p>
            <h1 className="text-3xl font-semibold tracking-normal text-foreground sm:text-4xl">
              Portfolio Command Center
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Upload a holdings CSV to refresh INR valuation, sector allocation, growth, and concentration analytics.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  handleCsvUpload(file);
                }
              }}
            />
            <Button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="w-full sm:w-auto"
            >
              <FileUp className="h-4 w-4" aria-hidden="true" />
              Upload CSV
            </Button>
            <Button variant="outline" asChild className="w-full sm:w-auto">
              <a href="/portfolio.csv" download>
                Sample CSV
              </a>
            </Button>
          </div>
        </div>

        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="grid dashboard-grid gap-4">
          <SummaryCard
            title="Portfolio Value"
            value={formatCurrency(metrics.totalValue)}
            detail={`${holdings.length} holdings from ${fileName}`}
            icon={<BarChart3 className="h-5 w-5" aria-hidden="true" />}
          />
          <SummaryCard
            title="Total Return"
            value={formatCurrency(metrics.totalGainLoss)}
            detail={formatPercent(metrics.totalGainLossPercent)}
            positive={metrics.totalGainLoss >= 0}
            icon={<TrendingUp className="h-5 w-5" aria-hidden="true" />}
          />
          <SummaryCard
            title="Day Change"
            value={formatCurrency(metrics.dayChange)}
            detail={formatPercent(metrics.dayChangePercent)}
            positive={metrics.dayChange >= 0}
            icon={<TrendingUp className="h-5 w-5" aria-hidden="true" />}
          />
          <SummaryCard
            title="Top Sector"
            value={metrics.sectorAllocations[0]?.sector ?? "N/A"}
            detail={`${metrics.sectorAllocations[0]?.percentage.toFixed(1) ?? "0.0"}% allocation`}
            icon={<PieChartIcon className="h-5 w-5" aria-hidden="true" />}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.35fr_0.9fr]">
          <Card>
            <CardHeader>
              <CardTitle>Portfolio Growth</CardTitle>
              <CardDescription>Estimated trend from cost basis to current value</CardDescription>
            </CardHeader>
            <CardContent className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={metrics.growth}>
                  <defs>
                    <linearGradient id="growthFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0f8b8d" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#0f8b8d" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d8e1e2" />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} tickFormatter={formatAxisInr} />
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="#0f8b8d"
                    strokeWidth={3}
                    fill="url(#growthFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sector Allocation</CardTitle>
              <CardDescription>Market value grouped by sector</CardDescription>
            </CardHeader>
            <CardContent className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={metrics.sectorAllocations}
                    dataKey="value"
                    nameKey="sector"
                    innerRadius={58}
                    outerRadius={105}
                    paddingAngle={3}
                  >
                    {metrics.sectorAllocations.map((entry, index) => (
                      <Cell
                        key={entry.sector}
                        fill={sectorColors[index % sectorColors.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value, _name, item) => [
                      formatCurrency(Number(value)),
                      item.payload.sector,
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_0.8fr]">
          <HoldingsTable metrics={metrics} />
          <Heatmap metrics={metrics} />
        </div>
      </section>
    </main>
  );
}

function formatAxisInr(value: number) {
  if (Math.abs(value) >= 10000000) {
    return `₹${(value / 10000000).toFixed(1)}Cr`;
  }

  if (Math.abs(value) >= 100000) {
    return `₹${(value / 100000).toFixed(1)}L`;
  }

  return `₹${Math.round(value / 1000)}k`;
}

function SummaryCard({
  title,
  value,
  detail,
  positive,
  icon,
}: {
  title: string;
  value: string;
  detail: string;
  positive?: boolean;
  icon: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
        <CardDescription>{title}</CardDescription>
        <div className="rounded-md bg-accent p-2 text-accent-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="truncate text-2xl font-semibold">{value}</div>
        <p
          className={cn(
            "mt-1 text-sm text-muted-foreground",
            positive === true && "text-emerald-700",
            positive === false && "text-destructive",
          )}
        >
          {detail}
        </p>
      </CardContent>
    </Card>
  );
}

function HoldingsTable({
  metrics,
}: {
  metrics: ReturnType<typeof calculatePortfolioMetrics>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Holdings</CardTitle>
        <CardDescription>Position-level return, weight, and daily movement</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ticker</TableHead>
              <TableHead>Sector</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead className="text-right">Return</TableHead>
              <TableHead className="text-right">Weight</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {metrics.holdings.map((holding) => (
              <TableRow key={holding.symbol}>
                <TableCell>
                  <div className="font-semibold">{holding.symbol}</div>
                  <div className="max-w-44 truncate text-xs text-muted-foreground">
                    {holding.company}
                  </div>
                </TableCell>
                <TableCell>{holding.sector}</TableCell>
                <TableCell className="text-right font-medium">
                  {formatCurrency(holding.marketValue)}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-medium",
                    holding.gainLoss >= 0 ? "text-emerald-700" : "text-destructive",
                  )}
                >
                  {formatPercent(holding.gainLossPercent)}
                </TableCell>
                <TableCell className="text-right">
                  {holding.portfolioWeight.toFixed(1)}%
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function Heatmap({
  metrics,
}: {
  metrics: ReturnType<typeof calculatePortfolioMetrics>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Portfolio Heatmap</CardTitle>
        <CardDescription>Tile size follows portfolio weight, color follows return</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {metrics.holdings.map((holding) => {
            const intensity = Math.min(Math.abs(holding.gainLossPercent) / 40, 1);
            const background =
              holding.gainLoss >= 0
                ? `rgba(15, 139, 141, ${0.18 + intensity * 0.55})`
                : `rgba(209, 73, 91, ${0.18 + intensity * 0.55})`;

            return (
              <div
                key={holding.symbol}
                className="flex min-h-28 flex-col justify-between rounded-md border p-3"
                style={{
                  background,
                  gridRow: holding.portfolioWeight > 14 ? "span 2" : undefined,
                }}
              >
                <div>
                  <div className="text-base font-semibold">{holding.symbol}</div>
                  <div className="text-xs text-muted-foreground">
                    {holding.portfolioWeight.toFixed(1)}% weight
                  </div>
                </div>
                <div
                  className={cn(
                    "text-sm font-semibold",
                    holding.gainLoss >= 0 ? "text-teal-950" : "text-red-950",
                  )}
                >
                  {formatPercent(holding.gainLossPercent)}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
