"use client";

import Papa from "papaparse";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import {
  Download,
  FileUp,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
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
  InvestmentAppetite,
  ManagedPortfolio,
  PortfolioInputRow,
  PortfolioPosition,
  Recommendation,
  RecommendationStatus,
  buildPortfolioInputRow,
  calculatePortfolioMetrics,
  formatCurrency,
  formatPercent,
  generateRecommendations,
  marketRecommendationPortfolio,
  parseQuantity,
  samplePortfolio,
} from "@/lib/portfolio";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

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

const portfoliosStorageKey = "multibagger-portfolios";
const historyStorageKey = "multibagger-recommendation-history";

type CsvRow = {
  list?: string;
  type?: string;
  "stock code"?: string;
  stockCode?: string;
  code?: string;
  stock?: string;
  name?: string;
  company?: string;
  quantity?: string;
  qty?: string;
};

type MarketQuote = {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
};

type MarketOverview = {
  sentiment: "Positive" | "Negative" | "Neutral";
  averageMove: number;
  indices: MarketQuote[];
  gainers: MarketQuote[];
  losers: MarketQuote[];
  refreshedAt: string;
};

export function PortfolioDashboard() {
  const [portfolios, setPortfolios] = useState<ManagedPortfolio[]>([
    marketRecommendationPortfolio,
    samplePortfolio,
  ]);
  const [history, setHistory] = useState<Recommendation[]>([]);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [portfolioName, setPortfolioName] = useState("");
  const [investmentAppetite, setInvestmentAppetite] =
    useState<InvestmentAppetite>("moderate");
  const [draftRows, setDraftRows] = useState<PortfolioInputRow[]>([
    buildPortfolioInputRow({}),
  ]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [marketOverview, setMarketOverview] = useState<MarketOverview | null>(null);
  const [isMarketLoading, setIsMarketLoading] = useState(false);
  const [expandedPortfolioId, setExpandedPortfolioId] = useState<string | null>(null);
  const [hasRepricedSavedPortfolios, setHasRepricedSavedPortfolios] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchQuotePositions = useCallback(async (rows: PortfolioInputRow[]) => {
    const response = await fetch("/api/quotes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ rows }),
    });
    const payload = (await response.json()) as {
      positions?: PortfolioPosition[];
      error?: string;
    };

    if (!response.ok || !payload.positions) {
      throw new Error(payload.error ?? "Unable to fetch quote details.");
    }

    return payload.positions;
  }, []);

  const repriceSavedPortfolios = useCallback(async () => {
    const portfoliosToRefresh = portfolios.filter(
      (portfolio) => portfolio.inputs.length > 0,
    );

    if (portfoliosToRefresh.length === 0) {
      return;
    }

    try {
      const refreshedPortfolios = await Promise.all(
        portfoliosToRefresh.map(async (portfolio) => ({
          ...portfolio,
          positions: await fetchQuotePositions(portfolio.inputs),
          refreshedAt: new Date().toISOString(),
        })),
      );

      setPortfolios((items) =>
        items.map(
          (item) =>
            refreshedPortfolios.find((portfolio) => portfolio.id === item.id) ?? item,
        ),
      );
    } catch {
      setError("Some saved portfolios could not be repriced. Use refresh on the portfolio card.");
    }
  }, [fetchQuotePositions, portfolios]);

  useEffect(() => {
    const savedPortfolios = window.localStorage.getItem(portfoliosStorageKey);
    const savedHistory = window.localStorage.getItem(historyStorageKey);

    if (savedPortfolios) {
      const parsedPortfolios = JSON.parse(savedPortfolios) as ManagedPortfolio[];
      const hasMarketPortfolio = parsedPortfolios.some(
        (portfolio) => portfolio.id === marketRecommendationPortfolio.id,
      );

      setPortfolios(
        [
          ...(hasMarketPortfolio ? [] : [marketRecommendationPortfolio]),
          ...parsedPortfolios,
        ].map((portfolio) => ({
          ...portfolio,
          appetite: portfolio.appetite ?? "moderate",
          isMarketPortfolio:
            portfolio.isMarketPortfolio ??
            portfolio.id === marketRecommendationPortfolio.id,
          inputs: portfolio.inputs.map((row) => ({
            ...buildPortfolioInputRow({
              stockCode: row.stockCode || row.stock,
              company: row.company,
              quantity: row.quantity,
            }),
            list: row.list,
          })),
        })),
      );
    }

    if (savedHistory) {
      setHistory(JSON.parse(savedHistory) as Recommendation[]);
    }

    setHydrated(true);
  }, []);

  useEffect(() => {
    refreshMarketOverview();
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    window.localStorage.setItem(portfoliosStorageKey, JSON.stringify(portfolios));
    window.localStorage.setItem(historyStorageKey, JSON.stringify(history));
  }, [hydrated, portfolios, history]);

  useEffect(() => {
    if (!hydrated || hasRepricedSavedPortfolios) {
      return;
    }

    setHasRepricedSavedPortfolios(true);
    repriceSavedPortfolios();
  }, [hydrated, hasRepricedSavedPortfolios, repriceSavedPortfolios]);

  function updateDraftRow(index: number, nextRow: Partial<PortfolioInputRow>) {
    setDraftRows((rows) =>
      rows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...nextRow } : row,
      ),
    );
  }

  async function refreshMarketOverview() {
    setIsMarketLoading(true);

    try {
      const response = await fetch("/api/market");
      const payload = (await response.json()) as MarketOverview;

      if (response.ok) {
        setMarketOverview(payload);
      }
    } finally {
      setIsMarketLoading(false);
    }
  }

  function parseCsvRows(file: File) {
    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const parsed = result.data
          .map((row) => {
            const stockCode = getCsvValue(row, ["stock code", "stockCode", "code"])
              .trim()
              .toUpperCase();
            const company = getCsvValue(row, ["company", "stock", "name"]).trim();
            const quantity = parseQuantity(getCsvValue(row, ["quantity", "qty"]));
            const listValue = getCsvValue(row, ["list", "type"])
              .trim()
              .toLowerCase();
            const list: PortfolioInputRow["list"] =
              listValue.includes("watch") || quantity <= 0
                ? "watchlist"
                : "current";

            return buildPortfolioInputRow({
              stockCode,
              company,
              quantity: list === "watchlist" ? 0 : quantity,
            });
          })
          .filter(
            (row) =>
              row.stock &&
              (row.list === "watchlist" ||
                (Number.isFinite(row.quantity) && row.quantity > 0)),
          );

        if (parsed.length === 0) {
          setError("CSV needs stock code, company, quantity columns.");
          return;
        }

        setDraftRows(parsed);
        setError(null);
      },
      error: (parseError) => setError(parseError.message),
    });
  }

  async function addPortfolio() {
    const cleanName = portfolioName.trim();
    const cleanRows = draftRows.filter(
      (row) =>
        row.stock.trim() &&
        (row.list === "watchlist" ||
          (Number.isFinite(row.quantity) && row.quantity > 0)),
    );

    if (!cleanName) {
      setError("Add a portfolio name.");
      return;
    }

    if (cleanRows.length === 0) {
      setError("Add at least one current holding or watchlist stock.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const positions = await fetchQuotePositions(cleanRows);
      const portfolio: ManagedPortfolio = {
        id: `${Date.now()}-${cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        name: cleanName,
        appetite: investmentAppetite,
        inputs: cleanRows,
        positions,
        refreshedAt: new Date().toISOString(),
      };

      setPortfolios((items) => [...items, portfolio]);
      setHistory((items) => [
        ...generateRecommendationList(portfolio, items),
        ...items,
      ]);
      setPortfolioName("");
      setInvestmentAppetite("moderate");
      setDraftRows([buildPortfolioInputRow({})]);
      setIsAddOpen(false);
    } catch (fetchError) {
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "Unable to fetch quote details.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshPortfolio(portfolio: ManagedPortfolio) {
    setIsLoading(true);
    setError(null);

    try {
      const positions = await fetchQuotePositions(portfolio.inputs);
      const refreshed = {
        ...portfolio,
        positions,
        refreshedAt: new Date().toISOString(),
      };

      setPortfolios((items) =>
        items.map((item) => (item.id === portfolio.id ? refreshed : item)),
      );
      setHistory((items) => [
        ...generateRecommendationList(refreshed, items),
        ...items,
      ]);
    } catch (fetchError) {
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "Unable to refresh quote details.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function updatePortfolioInputs(
    portfolio: ManagedPortfolio,
    rows: PortfolioInputRow[],
  ) {
    const cleanRows = rows.filter((row) => row.stockCode || row.company);
    setIsLoading(true);
    setError(null);

    try {
      const positions = await fetchQuotePositions(cleanRows);
      const updated = {
        ...portfolio,
        inputs: cleanRows,
        positions,
        refreshedAt: new Date().toISOString(),
      };

      setPortfolios((items) =>
        items.map((item) => (item.id === portfolio.id ? updated : item)),
      );
      setHistory((items) => [
        ...generateRecommendationList(updated, items),
        ...items,
      ]);
    } catch (fetchError) {
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "Unable to update portfolio details.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  function updateHistoryStatus(id: string, status: RecommendationStatus) {
    setHistory((items) =>
      items.map((item) => (item.id === id ? { ...item, status } : item)),
    );
  }

  function removePortfolio(id: string) {
    setPortfolios((items) => items.filter((item) => item.id !== id));
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f6fafb_0%,#eef3f3_46%,#f7f8f5_100%)]">
      <section className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <p className="text-sm font-semibold text-primary">
              unloan stock portfolio dashboard
            </p>
            <h1 className="text-3xl font-semibold tracking-normal text-foreground sm:text-4xl">
              unloan stock portfolio dashboard
            </h1>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              Track market mood first, then review added portfolios in columns with
              short-term and long-term buy/sell insights.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button type="button" variant="outline" onClick={downloadHistoryCsv}>
              <Download className="h-4 w-4" aria-hidden="true" />
              Download History
            </Button>
            <Button type="button" onClick={() => setIsAddOpen((value) => !value)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add Portfolio
            </Button>
          </div>
        </header>

        <MarketOverviewSection
          market={marketOverview}
          isLoading={isMarketLoading}
          onRefresh={refreshMarketOverview}
        />

        {isAddOpen ? (
          <AddPortfolioPanel
            draftRows={draftRows}
            error={error}
            fileInputRef={fileInputRef}
            isLoading={isLoading}
            investmentAppetite={investmentAppetite}
            portfolioName={portfolioName}
            setInvestmentAppetite={setInvestmentAppetite}
            setPortfolioName={setPortfolioName}
            parseCsvRows={parseCsvRows}
            updateDraftRow={updateDraftRow}
            addDraftRow={() =>
              setDraftRows((rows) => [
                ...rows,
                buildPortfolioInputRow({}),
              ])
            }
            removeDraftRow={(index) =>
              setDraftRows((rows) => rows.filter((_, rowIndex) => rowIndex !== index))
            }
            addPortfolio={addPortfolio}
          />
        ) : null}

        {error && !isAddOpen ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <section className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
          {portfolios.map((portfolio) => (
            <PortfolioColumn
              key={portfolio.id}
              history={history}
              portfolio={portfolio}
              isLoading={isLoading}
              onRefresh={() => refreshPortfolio(portfolio)}
              onRemove={() => removePortfolio(portfolio.id)}
              onStatusChange={updateHistoryStatus}
              onUpdateInputs={(rows) => updatePortfolioInputs(portfolio, rows)}
              isValueExpanded={expandedPortfolioId === portfolio.id}
              onToggleValue={() =>
                setExpandedPortfolioId((current) =>
                  current === portfolio.id ? null : portfolio.id,
                )
              }
            />
          ))}
        </section>
      </section>
    </main>
  );

  function downloadHistoryCsv() {
    const rows = [
      [
        "date",
        "portfolio",
        "section",
        "symbol",
        "company",
        "action",
        "horizon",
        "confidence",
        "status",
        "rationale",
      ],
      ...history.map((item) => [
        item.createdAt,
        item.portfolioName,
        item.section,
        item.symbol,
        item.company,
        item.action,
        item.horizon,
        String(item.confidence),
        item.status,
        item.rationale,
      ]),
    ];
    const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "recommendation-history.csv";
    link.click();
    URL.revokeObjectURL(url);
  }
}

function AddPortfolioPanel({
  draftRows,
  error,
  fileInputRef,
  isLoading,
  investmentAppetite,
  portfolioName,
  setInvestmentAppetite,
  setPortfolioName,
  parseCsvRows,
  updateDraftRow,
  addDraftRow,
  removeDraftRow,
  addPortfolio,
}: {
  draftRows: PortfolioInputRow[];
  error: string | null;
  fileInputRef: RefObject<HTMLInputElement | null>;
  isLoading: boolean;
  investmentAppetite: InvestmentAppetite;
  portfolioName: string;
  setInvestmentAppetite: (value: InvestmentAppetite) => void;
  setPortfolioName: (value: string) => void;
  parseCsvRows: (file: File) => void;
  updateDraftRow: (index: number, row: Partial<PortfolioInputRow>) => void;
  addDraftRow: () => void;
  removeDraftRow: (index: number) => void;
  addPortfolio: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Add Portfolio</CardTitle>
        <CardDescription>
          Enter stocks manually or upload CSV with columns: stock code, company, quantity.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <input
          value={portfolioName}
          onChange={(event) => setPortfolioName(event.target.value)}
          placeholder="Portfolio name"
          className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        />

        <select
          value={investmentAppetite}
          onChange={(event) =>
            setInvestmentAppetite(event.target.value as InvestmentAppetite)
          }
          className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="safe">Safe - lower churn and capital protection</option>
          <option value="moderate">Moderate - balanced growth and risk</option>
          <option value="aggressive">Aggressive - higher growth and volatility</option>
        </select>

        <div className="space-y-2">
          {draftRows.map((row, index) => (
            <div key={`${row.stock}-${index}`} className="grid gap-2 md:grid-cols-[150px_1fr_120px_40px]">
              <input
                value={row.stockCode}
                onChange={(event) => {
                  const stockCode = event.target.value.toUpperCase();
                  updateDraftRow(index, {
                    stockCode,
                    stock: stockCode || row.company,
                  });
                }}
                placeholder="Stock code"
                className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <input
                value={row.company}
                onChange={(event) =>
                  updateDraftRow(index, {
                    company: event.target.value,
                    stock: row.stockCode || event.target.value,
                  })
                }
                placeholder="Company"
                className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <input
                value={row.quantity || ""}
                onChange={(event) =>
                  updateDraftRow(index, {
                    list: Number(event.target.value) > 0 ? "current" : "watchlist",
                    quantity: Number(event.target.value),
                  })
                }
                placeholder="Qty"
                type="number"
                className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:bg-muted"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => removeDraftRow(index)}
                disabled={draftRows.length === 1}
                aria-label="Remove row"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              parseCsvRows(file);
            }
          }}
        />

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={addDraftRow}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add Row
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileUp className="h-4 w-4" aria-hidden="true" />
            Upload CSV
          </Button>
          <Button type="button" onClick={addPortfolio} disabled={isLoading}>
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            {isLoading ? "Fetching quotes" : "Create Portfolio"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MarketOverviewSection({
  market,
  isLoading,
  onRefresh,
}: {
  market: MarketOverview | null;
  isLoading: boolean;
  onRefresh: () => void;
}) {
  const sentimentClass =
    market?.sentiment === "Positive"
      ? "text-emerald-700"
      : market?.sentiment === "Negative"
        ? "text-destructive"
        : "text-muted-foreground";

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Market Overview Today</CardTitle>
          <CardDescription>
            Live market sentiment, index tickers, and daily movers from a broad Indian-stock universe.
          </CardDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onRefresh}
          disabled={isLoading}
          aria-label="Refresh market overview"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-[220px_1fr]">
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="text-xs uppercase text-muted-foreground">
              Market Sentiment
            </div>
            <div className={cn("mt-1 text-2xl font-semibold", sentimentClass)}>
              {market?.sentiment ?? "Loading"}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              Index average: {formatPercent(market?.averageMove ?? 0)}
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            {(market?.indices ?? []).map((index) => (
              <MarketTicker key={index.symbol} quote={index} />
            ))}
            {!market ? (
              <>
                <TickerSkeleton />
                <TickerSkeleton />
                <TickerSkeleton />
              </>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <MoverTable title="Top 10 Gainers" quotes={market?.gainers ?? []} />
          <MoverTable title="Top 10 Losers" quotes={market?.losers ?? []} />
        </div>
      </CardContent>
    </Card>
  );
}

function MarketTicker({ quote }: { quote: MarketQuote }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-sm font-semibold">{quote.name}</div>
      <div className="mt-1 text-xl font-semibold">{quote.price.toLocaleString("en-IN")}</div>
      <div
        className={cn(
          "text-sm font-medium",
          quote.change >= 0 ? "text-emerald-700" : "text-destructive",
        )}
      >
        {quote.change >= 0 ? "+" : ""}
        {quote.change.toFixed(2)} ({formatPercent(quote.changePercent)})
      </div>
    </div>
  );
}

function TickerSkeleton() {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="h-4 w-24 rounded bg-muted" />
      <div className="mt-3 h-6 w-20 rounded bg-muted" />
      <div className="mt-2 h-4 w-28 rounded bg-muted" />
    </div>
  );
}

function MoverTable({ title, quotes }: { title: string; quotes: MarketQuote[] }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Stock</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead className="text-right">Move</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {quotes.map((quote) => (
            <TableRow key={`${title}-${quote.symbol}`}>
              <TableCell>
                <div className="font-medium">{quote.symbol}</div>
                <div className="max-w-48 truncate text-xs text-muted-foreground">
                  {quote.name}
                </div>
              </TableCell>
              <TableCell className="text-right">
                {quote.price.toLocaleString("en-IN")}
              </TableCell>
              <TableCell
                className={cn(
                  "text-right font-medium",
                  quote.change >= 0 ? "text-emerald-700" : "text-destructive",
                )}
              >
                {formatPercent(quote.changePercent)}
              </TableCell>
            </TableRow>
          ))}
          {quotes.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="text-sm text-muted-foreground">
                Loading market movers.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </section>
  );
}

function PortfolioColumn({
  portfolio,
  history,
  isLoading,
  onRefresh,
  onRemove,
  onStatusChange,
  onUpdateInputs,
  isValueExpanded,
  onToggleValue,
}: {
  portfolio: ManagedPortfolio;
  history: Recommendation[];
  isLoading: boolean;
  onRefresh: () => void;
  onRemove: () => void;
  onStatusChange: (id: string, status: RecommendationStatus) => void;
  onUpdateInputs: (rows: PortfolioInputRow[]) => void;
  isValueExpanded: boolean;
  onToggleValue: () => void;
}) {
  const metrics = calculatePortfolioMetrics(portfolio.positions);
  const recommendations = generateRecommendations(portfolio, history);
  const portfolioHistory = history.filter(
    (item) => item.portfolioId === portfolio.id,
  );
  const quoteScore = getQuoteScore(portfolio.positions);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{portfolio.name}</CardTitle>
            <CardDescription>
              {portfolio.appetite ?? "moderate"} appetite | {metrics.holdings.length} holdings
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={onRefresh}
              disabled={isLoading}
              aria-label="Refresh quotes and recommendations"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={onRemove}
              disabled={portfolio.isMarketPortfolio}
              aria-label="Remove portfolio"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        <div className="grid dashboard-grid gap-2">
          <SummaryCard
            title="Portfolio Value"
            value={formatCurrency(metrics.totalValue)}
            detail={
              portfolio.isMarketPortfolio
                ? "Market idea board"
                : `${metrics.holdings.length} active holdings`
            }
            onClick={portfolio.isMarketPortfolio ? undefined : onToggleValue}
          />
          <SummaryCard
            title="Recommendation History"
            value={`${portfolioHistory.length} records`}
            detail="Portfolio-specific feedback loop"
          />
          <SummaryCard
            title="Live Quote Score"
            value={`${quoteScore}%`}
            detail="CMP, previous close, volume, headlines"
          />
        </div>
        {isValueExpanded ? (
          <PortfolioDetailsEditor
            portfolio={portfolio}
            isLoading={isLoading}
            positions={portfolio.positions}
            onSave={onUpdateInputs}
          />
        ) : null}
        <PortfolioMiniSummary metrics={metrics} />

        <RecommendationBlock
          title="1. Short-term Buy/Sell Analysis"
          items={recommendations.intraday}
        />
        <RecommendationBlock
          title="2. Long-term Buy/Sell Plan"
          items={recommendations.longTermPlan}
        />
        <RecommendationBlock
          title="3. Potential Multibagger Stocks"
          items={recommendations.multibaggerCandidates}
        />
        <RecommendationBlock
          title="4. ETF Recommendations"
          items={recommendations.etfs}
        />
        <SectorAllocationBlock metrics={metrics} />
        <HistoryBlock
          history={portfolioHistory}
          onStatusChange={onStatusChange}
        />
      </CardContent>
    </Card>
  );
}

function PortfolioMiniSummary({
  metrics,
}: {
  metrics: ReturnType<typeof calculatePortfolioMetrics>;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 text-sm">
      <div className="rounded-md border bg-muted/40 p-3">
        <div className="text-muted-foreground">Day Change</div>
        <div
          className={cn(
            "font-semibold",
            metrics.dayChange >= 0 ? "text-emerald-700" : "text-destructive",
          )}
        >
          {formatCurrency(metrics.dayChange)}
        </div>
      </div>
      <div className="rounded-md border bg-muted/40 p-3">
        <div className="text-muted-foreground">Move</div>
        <div
          className={cn(
            "font-semibold",
            metrics.dayChange >= 0 ? "text-emerald-700" : "text-destructive",
          )}
        >
          {formatPercent(metrics.dayChangePercent)}
        </div>
      </div>
    </div>
  );
}

function PortfolioDetailsEditor({
  portfolio,
  isLoading,
  positions,
  onSave,
}: {
  portfolio: ManagedPortfolio;
  isLoading: boolean;
  positions: PortfolioPosition[];
  onSave: (rows: PortfolioInputRow[]) => void;
}) {
  const [rows, setRows] = useState<PortfolioInputRow[]>(portfolio.inputs);

  useEffect(() => {
    setRows(portfolio.inputs);
  }, [portfolio.inputs]);

  function updateRow(index: number, nextRow: Partial<PortfolioInputRow>) {
    setRows((items) =>
      items.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...nextRow } : row,
      ),
    );
  }

  return (
    <section className="space-y-3 rounded-md border bg-background p-3">
      <div>
        <h2 className="text-sm font-semibold">Portfolio Value Details</h2>
        <p className="text-xs text-muted-foreground">
          Edit stock code, company, or quantity. Value is quantity multiplied by CMP.
        </p>
      </div>
      <div className="space-y-2">
        {rows.map((row, index) => (
          <PortfolioDetailRow
            key={`${row.stockCode}-${row.company}-${index}`}
            index={index}
            positions={positions}
            row={row}
            updateRow={updateRow}
            deleteRow={() =>
              setRows((items) => items.filter((_, rowIndex) => rowIndex !== index))
            }
          />
        ))}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant="outline"
          onClick={() => setRows((items) => [...items, buildPortfolioInputRow({})])}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add Stock
        </Button>
        <Button type="button" onClick={() => onSave(rows)} disabled={isLoading}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {isLoading ? "Updating" : "Update Portfolio"}
        </Button>
      </div>
    </section>
  );
}

function PortfolioDetailRow({
  row,
  index,
  positions,
  updateRow,
  deleteRow,
}: {
  row: PortfolioInputRow;
  index: number;
  positions: PortfolioPosition[];
  updateRow: (index: number, nextRow: Partial<PortfolioInputRow>) => void;
  deleteRow: () => void;
}) {
  const position = positions.find(
    (item) =>
      item.symbol === row.stockCode ||
      item.company.toLowerCase() === row.company.toLowerCase(),
  );
  const currentPrice = position?.currentPrice ?? 0;
  const marketValue = row.quantity * currentPrice;

  return (
    <div className="rounded-md border bg-muted/20 p-2">
      <div className="grid gap-2 md:grid-cols-[120px_1fr_100px_40px]">
        <input
          value={row.stockCode}
          onChange={(event) => {
            const stockCode = event.target.value.toUpperCase();
            updateRow(index, {
              stockCode,
              stock: stockCode || row.company,
            });
          }}
          placeholder="Stock code"
          className="h-9 rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <input
          value={row.company}
          onChange={(event) =>
            updateRow(index, {
              company: event.target.value,
              stock: row.stockCode || event.target.value,
            })
          }
          placeholder="Company"
          className="h-9 rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <input
          value={row.quantity || ""}
          onChange={(event) => {
            const quantity = parseQuantity(event.target.value);
            updateRow(index, {
              list: quantity > 0 ? "current" : "watchlist",
              quantity,
            });
          }}
          placeholder="Qty"
          type="number"
          className="h-9 rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={deleteRow}
          aria-label="Delete holding"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        <span>CMP: {formatCurrency(currentPrice)}</span>
        <span>Value: {formatCurrency(marketValue)}</span>
        <span>Sector: {position?.sector ?? "Pending refresh"}</span>
      </div>
    </div>
  );
}

function RecommendationBlock({
  title,
  items,
}: {
  title: string;
  items: Recommendation[];
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="rounded-md border bg-background p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">
                  {item.symbol} | {item.action}
                </div>
                <div className="text-xs text-muted-foreground">
                  {item.company} | {item.horizon}
                </div>
              </div>
              <div className="rounded-md bg-accent px-2 py-1 text-xs font-semibold text-accent-foreground">
                {item.confidence}%
              </div>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {item.action === "Urgent Sell"
                ? "Urgent Sell means the model expects significant near-term downside risk and weak recovery probability. "
                : "Accumulate means the model sees future growth potential and supports staged buying. "}
              {item.rationale}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function SectorAllocationBlock({
  metrics,
}: {
  metrics: ReturnType<typeof calculatePortfolioMetrics>;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">5. Sector Allocation</h2>
      <div className="grid gap-3 md:grid-cols-[130px_1fr]">
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={metrics.sectorAllocations}
                dataKey="value"
                nameKey="sector"
                innerRadius={30}
                outerRadius={58}
                paddingAngle={2}
              >
                {metrics.sectorAllocations.map((entry, index) => (
                  <Cell
                    key={entry.sector}
                    fill={sectorColors[index % sectorColors.length]}
                  />
                ))}
              </Pie>
              <Tooltip formatter={(value) => formatCurrency(Number(value))} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-1">
          {metrics.sectorAllocations.map((sector) => (
            <div
              key={sector.sector}
              className="flex justify-between gap-3 text-xs"
            >
              <span className="truncate text-muted-foreground">{sector.sector}</span>
              <span className="font-semibold">{sector.percentage.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HistoryBlock({
  history,
  onStatusChange,
}: {
  history: Recommendation[];
  onStatusChange: (id: string, status: RecommendationStatus) => void;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">6. Recommendation Performance</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Section</TableHead>
            <TableHead>Stock</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {history.slice(0, 8).map((item) => (
            <TableRow key={item.id}>
              <TableCell className="text-xs">
                {new Date(item.createdAt).toLocaleDateString()}
              </TableCell>
              <TableCell className="text-xs">{item.section}</TableCell>
              <TableCell className="font-medium">{item.symbol}</TableCell>
              <TableCell>
                <select
                  value={item.status}
                  onChange={(event) =>
                    onStatusChange(
                      item.id,
                      event.target.value as RecommendationStatus,
                    )
                  }
                  className="h-8 rounded-md border bg-background px-2 text-xs"
                >
                  <option value="NA">NA</option>
                  <option value="Hit">Hit</option>
                  <option value="Miss">Miss</option>
                </select>
              </TableCell>
            </TableRow>
          ))}
          {history.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-sm text-muted-foreground">
                Refresh recommendations to start tracking performance.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </section>
  );
}

function SummaryCard({
  title,
  value,
  detail,
  onClick,
}: {
  title: string;
  value: string;
  detail: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <CardHeader className="pb-3">
        <CardDescription>{title}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="truncate text-2xl font-semibold">{value}</div>
        <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
      </CardContent>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="rounded-lg text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Card>{content}</Card>
      </button>
    );
  }

  return (
    <Card>{content}</Card>
  );
}

function generateRecommendationList(
  portfolio: ManagedPortfolio,
  history: Recommendation[],
) {
  const recommendations = generateRecommendations(portfolio, history);

  return [
    ...recommendations.intraday,
    ...recommendations.longTermPlan,
    ...recommendations.multibaggerCandidates,
    ...recommendations.etfs,
  ];
}

function csvEscape(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function getQuoteScore(positions: PortfolioPosition[]) {
  if (positions.length === 0) {
    return 0;
  }

  const totalSignals = positions.length * 4;
  const availableSignals = positions.reduce((score, position) => {
    return (
      score +
      Number(position.currentPrice > 0) +
      Number(position.previousClose > 0) +
      Number((position.volume ?? 0) > 0) +
      Number((position.newsHeadlines?.length ?? 0) > 0)
    );
  }, 0);

  return Math.round((availableSignals / totalSignals) * 100);
}

function getCsvValue(row: CsvRow, keys: string[]) {
  const looseRow = row as Record<string, string | undefined>;
  const normalizedLookup = Object.entries(looseRow).reduce<Record<string, string>>(
    (acc, [key, value]) => {
      acc[key.trim().toLowerCase()] = value ?? "";
      return acc;
    },
    {},
  );

  for (const key of keys) {
    const value = normalizedLookup[key.trim().toLowerCase()];
    if (value) {
      return value;
    }
  }

  return "";
}
