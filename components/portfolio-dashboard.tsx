"use client";

import Papa from "papaparse";
import {
  ChevronDown,
  ChevronRight,
  FileUp,
  Lock,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { ChangeDetection } from "@/components/change-detection";
import { MarketOverviewCollapsible } from "@/components/market-overview-collapsible";
import { PortfolioCoach } from "@/components/portfolio-coach";
import { PortfolioHub } from "@/components/portfolio-hub";
import { TodaysActionCenter } from "@/components/todays-action-center";
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
  buildDecisionIntelligence,
  type MarketOverview as DecisionMarketOverview,
} from "@/lib/decision-intelligence";
import { analyzePortfolioHealthScore } from "@/lib/portfolio-health";
import { analyzePortfolioRisk } from "@/lib/risk-engine";
import {
  InvestmentAppetite,
  ManagedPortfolio,
  PortfolioInputRow,
  PortfolioPosition,
  Recommendation,
  buildPortfolioInputRow,
  calculatePortfolioMetrics,
  formatCurrency,
  formatPercent,
  generateRecommendations,
  parseQuantity,
  samplePortfolio,
} from "@/lib/portfolio";
import { cn } from "@/lib/utils";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

const portfoliosStorageKey = "multibagger-portfolios";
const historyStorageKey = "multibagger-recommendation-history";
const pinStorageKey = "unloan-portfolio-pin-hashes";
const portfolioDashboardCollapseKey = "unloan-portfolio-dashboard-open";
const masterRecoveryPin = "1008";
const sectorBarColors = [
  "bg-emerald-300",
  "bg-sky-300",
  "bg-amber-300",
  "bg-cyan-300",
  "bg-violet-300",
  "bg-teal-300",
];

type CsvRow = {
  list?: string;
  type?: string;
  "stock code"?: string;
  stockCode?: string;
  symbol?: string;
  ticker?: string;
  code?: string;
  stock?: string;
  name?: string;
  company?: string;
  quantity?: string;
  qty?: string;
  "buy price"?: string;
  buyPrice?: string;
  purchasePrice?: string;
};

type MarketOverview = DecisionMarketOverview;

type ExpertMatrixQuote = {
  symbol: string;
  name: string;
  price: number;
  changePercent?: number;
  target: number;
  upside: number;
  volumeShock: number;
  score: number;
  action: "Accumulate" | "Urgent Sell";
  remark: string;
  caveats: string[];
};

type ExpertMatrixCategory = {
  key: string;
  title: string;
  longTermUpsides: ExpertMatrixQuote[];
  intradayBreakouts: ExpertMatrixQuote[];
};

type ExpertActionMatrix = {
  title: string;
  verified: string;
  source: string;
  asOf: string;
  refreshCycle?: string;
  caveat?: string;
  consecutivePicks?: Array<{
    symbol: string;
    name: string;
    appearances: number;
    categories: string[];
  }>;
  categories: ExpertMatrixCategory[];
};

export function PortfolioDashboard({
  adminMode = false,
  initialPortfolioId,
}: {
  adminMode?: boolean;
  initialPortfolioId?: string;
}) {
  const [portfolios, setPortfolios] = useState<ManagedPortfolio[]>([
    samplePortfolio,
  ]);
  const [history, setHistory] = useState<Recommendation[]>([]);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [portfolioName, setPortfolioName] = useState("");
  const [portfolioPin, setPortfolioPin] = useState("");
  const [investmentAppetite, setInvestmentAppetite] =
    useState<InvestmentAppetite>("moderate");
  const [draftRows, setDraftRows] = useState<PortfolioInputRow[]>([
    buildPortfolioInputRow({}),
  ]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [marketOverview, setMarketOverview] = useState<MarketOverview | null>(null);
  const [isMarketLoading, setIsMarketLoading] = useState(false);
  const [, setExpertMatrix] = useState<ExpertActionMatrix | null>(null);
  const [, setIsExpertLoading] = useState(false);
  const [isPortfolioDashboardOpen, setIsPortfolioDashboardOpen] = useState(true);
  const [selectedPortfolioId, setSelectedPortfolioId] = useState(
    initialPortfolioId ?? samplePortfolio.id,
  );
  const [pinHashes, setPinHashes] = useState<Record<string, string>>({});
  const [pinChallengePortfolio, setPinChallengePortfolio] =
    useState<ManagedPortfolio | null>(null);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [expandedPortfolioId, setExpandedPortfolioId] = useState<string | null>(null);
  const [hasRepricedSavedPortfolios, setHasRepricedSavedPortfolios] = useState(false);
  const [isSheetsStorage, setIsSheetsStorage] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchQuotePositions = useCallback(async (rows: PortfolioInputRow[]) => {
    const normalizedRows = normalizePortfolioRows(rows);
    const response = await fetch("/api/quotes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ rows: normalizedRows }),
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

  const repricePortfolioList = useCallback(
    async (items: ManagedPortfolio[]) => {
      return Promise.all(
        items.map(async (portfolio) => {
          if (portfolio.inputs.length === 0) {
            return portfolio;
          }

          return {
            ...portfolio,
            positions: await fetchQuotePositions(portfolio.inputs),
            refreshedAt: new Date().toISOString(),
          };
        }),
      );
    },
    [fetchQuotePositions],
  );

  useEffect(() => {
    async function hydratePortfolios() {
      const savedHistory = window.localStorage.getItem(historyStorageKey);

      if (savedHistory) {
        setHistory(JSON.parse(savedHistory) as Recommendation[]);
      }

      const savedPins = window.localStorage.getItem(pinStorageKey);

      if (savedPins) {
        setPinHashes(JSON.parse(savedPins) as Record<string, string>);
      }

      const savedDashboardOpen = window.sessionStorage.getItem(
        portfolioDashboardCollapseKey,
      );

      if (savedDashboardOpen) {
        setIsPortfolioDashboardOpen(savedDashboardOpen !== "false");
      }

      try {
        const response = await fetch("/api/portfolios");
        const payload = (await response.json()) as {
          configured?: boolean;
          portfolios?: ManagedPortfolio[];
          error?: string;
        };

        if (response.ok && payload.configured) {
          setIsSheetsStorage(true);
          const loadedPortfolios = normalizeManagedPortfolios(
            payload.portfolios ?? [],
          );
          const refreshed = await repricePortfolioList(loadedPortfolios);
          setPortfolios(filterHomepagePortfolios(refreshed));
          setHydrated(true);
          return;
        }

        if (payload.configured && payload.error) {
          setError(payload.error);
        }
      } catch {
        setError("Google Sheets storage unavailable. Using this browser's local portfolio cache.");
      }

      const savedPortfolios = window.localStorage.getItem(portfoliosStorageKey);

      if (savedPortfolios) {
        const parsedPortfolios = JSON.parse(savedPortfolios) as ManagedPortfolio[];
        setPortfolios(filterHomepagePortfolios(normalizeManagedPortfolios(parsedPortfolios)));
      }

      setHydrated(true);
    }

    hydratePortfolios();
  }, [fetchQuotePositions, repricePortfolioList]);

  useEffect(() => {
    refreshMarketOverview();
    refreshExpertMatrix();

    const marketInterval = window.setInterval(refreshMarketOverview, 5 * 60 * 1000);
    const expertInterval = window.setInterval(refreshExpertMatrix, 15 * 60 * 1000);

    return () => {
      window.clearInterval(marketInterval);
      window.clearInterval(expertInterval);
    };
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    const portfolioInterval = window.setInterval(() => {
      repriceSavedPortfolios();
    }, 15 * 60 * 1000);

    return () => window.clearInterval(portfolioInterval);
  }, [hydrated, repriceSavedPortfolios]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    if (!isSheetsStorage) {
      window.localStorage.setItem(portfoliosStorageKey, JSON.stringify(portfolios));
    }

    window.localStorage.setItem(historyStorageKey, JSON.stringify(history));
  }, [hydrated, isSheetsStorage, portfolios, history]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    window.localStorage.setItem(pinStorageKey, JSON.stringify(pinHashes));
  }, [hydrated, pinHashes]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    window.sessionStorage.setItem(
      portfolioDashboardCollapseKey,
      String(isPortfolioDashboardOpen),
    );
  }, [hydrated, isPortfolioDashboardOpen]);

  useEffect(() => {
    if (portfolios.length === 0) {
      setSelectedPortfolioId("");
      return;
    }

    if (!portfolios.some((portfolio) => portfolio.id === selectedPortfolioId)) {
      setSelectedPortfolioId(portfolios[0].id);
    }
  }, [portfolios, selectedPortfolioId]);

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

  async function refreshExpertMatrix() {
    setIsExpertLoading(true);

    try {
      const response = await fetch("/api/expert-action-matrix");
      const payload = (await response.json()) as ExpertActionMatrix;

      if (response.ok) {
        setExpertMatrix(payload);
      }
    } finally {
      setIsExpertLoading(false);
    }
  }

  function parseCsvRows(file: File) {
    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const parsed = result.data
          .map((row) => {
            const stockCode = getCsvValue(row, [
              "stock code",
              "stockCode",
              "symbol",
              "ticker",
              "code",
            ])
              .trim()
              .toUpperCase();
            const company = getCsvValue(row, ["company", "stock", "name"]).trim();
            const quantity = parseQuantity(getCsvValue(row, ["quantity", "qty"]));
            const buyPrice = parseQuantity(
              getCsvValue(row, ["buy price", "buyPrice", "purchasePrice"]),
            );
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
              buyPrice,
            });
          })
          .filter(
            (row) =>
              row.stock &&
              (row.list === "watchlist" ||
                (Number.isFinite(row.quantity) && row.quantity > 0)),
          );

        if (parsed.length === 0) {
          setError("CSV needs stock code or symbol, company, quantity columns.");
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
    const cleanRows = normalizePortfolioRows(draftRows).filter(
      (row) =>
        row.stock.trim() &&
        (row.list === "watchlist" ||
          (Number.isFinite(row.quantity) && row.quantity > 0)),
    );

    if (!cleanName) {
      setError("Add a portfolio name.");
      return;
    }

    if (!/^\d{4}$/u.test(portfolioPin)) {
      setError("Set a 4 digit portfolio PIN.");
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

      await persistPortfolio(portfolio);
      const pinHash = await hashPortfolioPin(portfolio.id, portfolioPin);
      setPortfolios((items) => [...items, portfolio]);
      setPinHashes((items) => ({ ...items, [portfolio.id]: pinHash }));
      setSelectedPortfolioId(portfolio.id);
      setHistory((items) => [
        ...generateRecommendationList(portfolio, items),
        ...items,
      ]);
      setPortfolioName("");
      setPortfolioPin("");
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

      await persistPortfolio(refreshed);
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
    const cleanRows = normalizePortfolioRows(rows).filter((row) => row.stockCode || row.company);
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

      await persistPortfolio(updated);
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

  async function persistPortfolio(portfolio: ManagedPortfolio) {
    if (!isSheetsStorage || portfolio.isMarketPortfolio) {
      return;
    }

    const method = portfolio.id ? "PUT" : "POST";
    const url =
      method === "PUT"
        ? `/api/portfolios/${encodeURIComponent(portfolio.id)}`
        : "/api/portfolios";

    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        portfolio: {
          ...portfolio,
          inputs: normalizePortfolioRows(portfolio.inputs),
          positions: [],
        },
      }),
    });

    if (!response.ok) {
      throw new Error("Unable to save portfolio to Google Sheets.");
    }
  }

  async function removePortfolio(id: string) {
    if (isSheetsStorage) {
      await fetch(`/api/portfolios/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    }

    setPortfolios((items) => items.filter((item) => item.id !== id));
    setPinHashes((items) => {
      const next = { ...items };
      delete next[id];
      return next;
    });
  }

  async function updatePortfolioMetadata(portfolio: ManagedPortfolio) {
    const nextName = window.prompt("Portfolio name", portfolio.name)?.trim();

    if (!nextName || nextName === portfolio.name) {
      return;
    }

    const updated = { ...portfolio, name: nextName };
    await persistPortfolio(updated);
    setPortfolios((items) =>
      items.map((item) => (item.id === portfolio.id ? updated : item)),
    );
  }

  async function resetPortfolioPin(portfolio: ManagedPortfolio) {
    const nextPin = window.prompt(`Set new 4 digit PIN for ${portfolio.name}`)?.trim();

    if (!nextPin || !/^\d{4}$/u.test(nextPin)) {
      setError("Reset PIN needs a 4 digit value.");
      return;
    }

    const pinHash = await hashPortfolioPin(portfolio.id, nextPin);
    setPinHashes((items) => ({ ...items, [portfolio.id]: pinHash }));
    setError(null);
  }

  function requestPortfolioOpen(portfolio: ManagedPortfolio) {
    setPinChallengePortfolio(portfolio);
    setPinInput("");
    setPinError(null);
  }

  async function unlockPortfolio() {
    if (!pinChallengePortfolio) {
      return;
    }

    const savedHash = pinHashes[pinChallengePortfolio.id];
    const enteredMasterPin = pinInput === masterRecoveryPin;
    const enteredPortfolioPin =
      savedHash &&
      (await hashPortfolioPin(pinChallengePortfolio.id, pinInput)) === savedHash;

    if (!enteredMasterPin && !enteredPortfolioPin) {
      setPinError("Invalid PIN. Use the portfolio PIN or master recovery PIN.");
      return;
    }

    setSelectedPortfolioId(pinChallengePortfolio.id);
    setPinChallengePortfolio(null);
    setPinInput("");
    setPinError(null);
  }

  const selectedPortfolio =
    portfolios.find((portfolio) => portfolio.id === selectedPortfolioId) ??
    portfolios[0];
  const decisionIntelligence = useMemo(
    () =>
      buildDecisionIntelligence({
        portfolio: selectedPortfolio,
        market: marketOverview,
        history,
      }),
    [history, marketOverview, selectedPortfolio],
  );

  return (
    <main className="min-h-screen bg-background">
      <section className="mx-auto flex w-full max-w-[1680px] flex-col gap-7 px-4 py-6 sm:px-6 lg:px-8">
        <header className="terminal-panel flex flex-col gap-5 rounded-2xl border border-sky-400/20 px-5 py-5 shadow-[0_24px_80px_rgba(0,0,0,0.34)] lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-start gap-3">
            <Image
              src="/unloan-logo.svg"
              alt="Unloan"
              width={48}
              height={48}
              className="rounded-lg shadow-sm"
              priority
            />
            <div className="space-y-2">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">
                Unloan
              </p>
              <h1 className="text-3xl font-semibold tracking-normal text-white sm:text-4xl">
                UNLOAN INVESTOR COMMAND CENTER
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-slate-300">
                Market Intelligence. Portfolio Insights. Smarter Decisions.
              </p>
            </div>
          </div>
        </header>

        {adminMode ? (
          <div className="rounded-2xl border border-amber-300/30 bg-amber-300/10 px-5 py-4 text-sm font-semibold text-amber-100">
            Admin Master Access Active. Admin can open portfolios using master passcode 1008.
          </div>
        ) : null}

        <MarketOverviewCollapsible
          market={marketOverview}
          isLoading={isMarketLoading}
          onRefresh={refreshMarketOverview}
        />

        <PortfolioHub
          portfolios={portfolios}
          selectedPortfolioId={selectedPortfolio?.id}
          pinProtectedIds={Object.keys(pinHashes)}
          onAddPortfolio={() => setIsAddOpen(true)}
          onOpenPortfolio={(portfolio) =>
            adminMode ? setSelectedPortfolioId(portfolio.id) : requestPortfolioOpen(portfolio)
          }
        />

        {adminMode ? (
          <AdminControlPanel
            portfolios={portfolios}
            onOpen={(portfolio) => setSelectedPortfolioId(portfolio.id)}
            onEdit={updatePortfolioMetadata}
            onDelete={(portfolio) => removePortfolio(portfolio.id)}
            onResetPin={resetPortfolioPin}
          />
        ) : null}

        {isAddOpen ? (
          <AddPortfolioModal
            onClose={() => setIsAddOpen(false)}
            panel={
              <AddPortfolioPanel
                draftRows={draftRows}
                error={error}
                fileInputRef={fileInputRef}
                isLoading={isLoading}
                investmentAppetite={investmentAppetite}
                portfolioName={portfolioName}
                portfolioPin={portfolioPin}
                setInvestmentAppetite={setInvestmentAppetite}
                setPortfolioName={setPortfolioName}
                setPortfolioPin={setPortfolioPin}
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
            }
          />
        ) : null}

        {pinChallengePortfolio ? (
          <PinChallengeModal
            error={pinError}
            pin={pinInput}
            portfolioName={pinChallengePortfolio.name}
            setPin={setPinInput}
            onClose={() => setPinChallengePortfolio(null)}
            onUnlock={unlockPortfolio}
          />
        ) : null}

        {error && !isAddOpen ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {selectedPortfolio ? (
          <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#0F1B2D] shadow-xl">
            <div className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">Portfolio Dashboard</h2>
                <p className="text-sm text-slate-400">
                  {selectedPortfolio.name} is unlocked for review.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsPortfolioDashboardOpen((value) => !value)}
                className="flex h-12 w-12 items-center justify-center self-end rounded-xl border border-cyan-300/30 bg-cyan-300/10 text-cyan-200 shadow-sm transition hover:border-cyan-200/60 hover:bg-cyan-300/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 lg:self-auto"
                aria-expanded={isPortfolioDashboardOpen}
                aria-label={
                  isPortfolioDashboardOpen
                    ? "Collapse Portfolio Dashboard"
                    : "Expand Portfolio Dashboard"
                }
              >
                <ChevronRight
                  className={cn(
                    "h-8 w-8 transition-transform",
                    isPortfolioDashboardOpen ? "rotate-90" : "",
                  )}
                  aria-hidden="true"
                />
              </button>
            </div>
            {isPortfolioDashboardOpen ? (
              <div className="space-y-5 border-t border-white/10 p-5">
                <PortfolioSummarySection portfolios={[selectedPortfolio]} />
                <PortfolioCard
                  key={selectedPortfolio.id}
                  portfolio={selectedPortfolio}
                  isLoading={isLoading}
                  onRefresh={() => refreshPortfolio(selectedPortfolio)}
                  onRemove={() => removePortfolio(selectedPortfolio.id)}
                  onUpdateInputs={(rows) => updatePortfolioInputs(selectedPortfolio, rows)}
                  isValueExpanded={expandedPortfolioId === selectedPortfolio.id}
                  onToggleValue={() =>
                    setExpandedPortfolioId((current) =>
                      current === selectedPortfolio.id ? null : selectedPortfolio.id,
                    )
                  }
                />
                <PortfolioDiagnostics portfolio={selectedPortfolio} />
                <TodaysActionCenter intelligence={decisionIntelligence} />
                <ChangeDetection snapshot={decisionIntelligence?.snapshot} />
                <PortfolioHoldingsAndSectors portfolio={selectedPortfolio} />
              </div>
            ) : null}
          </section>
        ) : null}

        <RoadmapSection />

        <GlossarySection />
      </section>
    </main>
  );

}

function AddPortfolioModal({
  panel,
  onClose,
}: {
  panel: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-8 backdrop-blur-sm">
      <div className="w-full max-w-5xl">
        <div className="mb-3 flex justify-end">
          <Button type="button" variant="outline" size="icon" onClick={onClose}>
            <X className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Close add portfolio</span>
          </Button>
        </div>
        {panel}
      </div>
    </div>
  );
}

function PinChallengeModal({
  error,
  pin,
  portfolioName,
  setPin,
  onClose,
  onUnlock,
}: {
  error: string | null;
  pin: string;
  portfolioName: string;
  setPin: (pin: string) => void;
  onClose: () => void;
  onUnlock: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
      <Card className="w-full max-w-md border-cyan-300/20 bg-[#0F1B2D] text-slate-100">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            Unlock {portfolioName}
          </CardTitle>
          <CardDescription>
            Enter the 4 digit portfolio PIN. Master recovery PIN is currently
            1008 and should be moved to an environment variable later.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <div className="rounded-md border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
              {error}
            </div>
          ) : null}
          <input
            value={pin}
            onChange={(event) =>
              setPin(event.target.value.replace(/\D/gu, "").slice(0, 4))
            }
            placeholder="4 digit PIN"
            inputMode="numeric"
            className="h-11 w-full rounded-md border border-white/10 bg-[#08121F] px-3 text-center text-lg tracking-[0.35em] text-white outline-none focus:ring-2 focus:ring-cyan-300"
          />
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" onClick={onUnlock} className="flex-1">
              Unlock Portfolio
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AdminControlPanel({
  portfolios,
  onOpen,
  onEdit,
  onDelete,
  onResetPin,
}: {
  portfolios: ManagedPortfolio[];
  onOpen: (portfolio: ManagedPortfolio) => void;
  onEdit: (portfolio: ManagedPortfolio) => void;
  onDelete: (portfolio: ManagedPortfolio) => void;
  onResetPin: (portfolio: ManagedPortfolio) => void;
}) {
  return (
    <section className="space-y-4 rounded-2xl border border-violet-300/20 bg-[#0F1B2D] p-5 shadow-xl">
      <SectionTitle
        title="Admin Control Panel"
        subtitle="View, open, edit, delete, and reset portfolio access."
        badge="LIVE"
        accent="purple"
      />
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Portfolio Name</TableHead>
              <TableHead>Portfolio ID</TableHead>
              <TableHead>Holdings</TableHead>
              <TableHead>Last Updated</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {portfolios.map((portfolio) => {
              const metrics = calculatePortfolioMetrics(portfolio.positions);

              return (
                <TableRow key={portfolio.id}>
                  <TableCell className="font-semibold">{portfolio.name}</TableCell>
                  <TableCell className="max-w-56 truncate text-xs text-slate-400">
                    {portfolio.id}
                  </TableCell>
                  <TableCell>{metrics.holdings.length}</TableCell>
                  <TableCell>
                    {portfolio.refreshedAt
                      ? new Date(portfolio.refreshedAt).toLocaleString("en-IN", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })
                      : "Pending"}
                  </TableCell>
                  <TableCell>
                    <span className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-2 py-0.5 text-xs font-semibold text-emerald-200">
                      Active
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => onOpen(portfolio)}>
                        Open
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => onEdit(portfolio)}>
                        Edit
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => onResetPin(portfolio)}>
                        Reset PIN
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => onDelete(portfolio)}>
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <SectionFooter text="Admin operations use the existing authenticated session and portfolio persistence." />
    </section>
  );
}

function AddPortfolioPanel({
  draftRows,
  error,
  fileInputRef,
  isLoading,
  investmentAppetite,
  portfolioName,
  portfolioPin,
  setInvestmentAppetite,
  setPortfolioName,
  setPortfolioPin,
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
  portfolioPin: string;
  setInvestmentAppetite: (value: InvestmentAppetite) => void;
  setPortfolioName: (value: string) => void;
  setPortfolioPin: (value: string) => void;
  parseCsvRows: (file: File) => void;
  updateDraftRow: (index: number, row: Partial<PortfolioInputRow>) => void;
  addDraftRow: () => void;
  removeDraftRow: (index: number) => void;
  addPortfolio: () => void;
}) {
  return (
    <Card className="border-cyan-300/20 bg-[#0F1B2D] text-slate-100 shadow-2xl">
      <CardHeader>
        <CardTitle>Add Portfolio</CardTitle>
        <CardDescription>
          Enter stocks manually or upload CSV with columns: stock code or symbol, company, quantity.
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

        <input
          value={portfolioPin}
          onChange={(event) =>
            setPortfolioPin(event.target.value.replace(/\D/gu, "").slice(0, 4))
          }
          placeholder="4 digit portfolio PIN"
          inputMode="numeric"
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
            <div key={`draft-row-${index}`} className="grid gap-2 md:grid-cols-[150px_1fr_120px_120px_40px]">
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
              <input
                value={row.buyPrice ?? ""}
                onChange={(event) =>
                  updateDraftRow(index, {
                    buyPrice: Number(event.target.value) || undefined,
                  })
                }
                placeholder="Buy price"
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

function PortfolioSummarySection({
  portfolios,
}: {
  portfolios: ManagedPortfolio[];
}) {
  const positions = portfolios.flatMap((portfolio) => portfolio.positions);
  const metrics = calculatePortfolioMetrics(positions);
  const activePortfolios = portfolios.filter((portfolio) => !portfolio.isMarketPortfolio);
  const totalHoldings = metrics.holdings.length;
  const dayTone = metrics.dayChange >= 0 ? "text-secondary" : "text-destructive";

  return (
    <section className="grid gap-3 md:grid-cols-4">
      <SummaryTile
        label="Portfolio Value"
        value={formatCurrency(metrics.totalValue)}
        detail={`${activePortfolios.length} portfolios tracked`}
        accent="blue"
      />
      <SummaryTile
        label="Day Change"
        value={formatCurrency(metrics.dayChange)}
        detail={formatPercent(metrics.dayChangePercent)}
        valueClassName={dayTone}
        accent="gold"
      />
      <SummaryTile
        label="Holdings"
        value={String(totalHoldings)}
        detail="Active current holdings"
        accent="brown"
      />
      <SummaryTile
        label="Top Sector"
        value={metrics.sectorAllocations[0]?.sector ?? "NA"}
        detail={
          metrics.sectorAllocations[0]
            ? `${metrics.sectorAllocations[0].percentage.toFixed(1)}% allocation`
            : "Awaiting holdings"
        }
        accent="blue"
      />
    </section>
  );
}

function SummaryTile({
  label,
  value,
  detail,
  accent,
  valueClassName,
}: {
  label: string;
  value: string;
  detail: string;
  accent: "blue" | "gold" | "brown";
  valueClassName?: string;
}) {
  const accentClass = {
    blue: "border-l-[#1E3A5F]",
    gold: "border-l-[#D9A441]",
    brown: "border-l-[#8A6A52]",
  }[accent];

  return (
    <div className={cn("wealth-card min-h-32 border-l-4 p-4", accentClass)}>
      <div className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
        {label}
      </div>
      <div className={cn("mt-3 truncate text-2xl font-semibold text-primary", valueClassName)}>
        {value}
      </div>
      <div className="mt-2 text-sm text-muted-foreground">{detail}</div>
    </div>
  );
}

function PortfolioDiagnostics({
  portfolio,
}: {
  portfolio: ManagedPortfolio;
}) {
  const health = analyzePortfolioHealthScore(portfolio);
  const risk = analyzePortfolioRisk(portfolio);
  const component = (label: string) =>
    health.components.find((item) => item.label === label)?.score ?? 0;

  return (
    <section className="space-y-4 rounded-2xl border border-amber-300/20 bg-[#0F1B2D] p-5 shadow-xl">
      <SectionTitle
        title="Portfolio Diagnostics"
        subtitle="Unified health and risk intelligence for the selected portfolio."
        badge="CALCULATED"
        accent="gold"
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <DiagnosticMetric label="Portfolio Score" value={`${health.healthScore}/100`} detail={health.grade} tone={health.healthScore >= 75 ? "up" : health.healthScore >= 60 ? "flat" : "down"} />
        <DiagnosticMetric label="Risk Status" value={risk.riskStatus} detail={`${risk.riskScore}/100 risk score`} tone={risk.riskStatus === "GREEN" ? "up" : risk.riskStatus === "RED" ? "down" : "flat"} />
        <DiagnosticMetric label="Diversification" value={`${component("Diversification")}/100`} detail="Position spread" tone="flat" />
        <DiagnosticMetric label="Sector Balance" value={`${component("Sector Balance")}/100`} detail="Concentration control" tone="flat" />
        <DiagnosticMetric label="Momentum" value={`${component("Momentum")}/100`} detail="Relative strength proxy" tone="up" />
        <DiagnosticMetric label="Cash Management" value={`${component("Cash Management")}/100`} detail="Liquidity buffer" tone="flat" />
        <DiagnosticMetric label="Largest Risk" value={risk.risks[0] ?? "None"} detail="Primary construction issue" tone={risk.riskStatus === "RED" ? "down" : "flat"} compact />
        <DiagnosticMetric label="Largest Strength" value={health.strengths[0] ?? "Data ready"} detail={health.opportunities[0] ?? "Maintain discipline"} tone="up" compact />
      </div>
      <div className="rounded-xl border border-white/10 bg-[#16263D] px-4 py-3 text-sm text-slate-300">
        <span className="font-semibold text-amber-200">Improvement Opportunity:</span>{" "}
        {health.opportunities[0] ?? risk.recommendations[0] ?? "Maintain current allocation discipline."}
      </div>
    </section>
  );
}

function PortfolioHoldingsAndSectors({
  portfolio,
}: {
  portfolio: ManagedPortfolio;
}) {
  const metrics = calculatePortfolioMetrics(portfolio.positions);

  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <CurrentHoldingsCard portfolio={portfolio} metrics={metrics} />
      <SectorAllocationCard metrics={metrics} />
    </section>
  );
}

function CurrentHoldingsCard({
  portfolio,
  metrics,
}: {
  portfolio: ManagedPortfolio;
  metrics: ReturnType<typeof calculatePortfolioMetrics>;
}) {
  const holdings = metrics.holdings
    .sort((a, b) => b.marketValue - a.marketValue)
    .slice(0, 5);

  return (
    <section className="space-y-3 rounded-2xl border border-sky-300/20 bg-[#0F1B2D] p-5 shadow-xl">
      <div className="flex items-start justify-between gap-3">
        <SectionTitle
          title="Current Holdings"
          subtitle="Top 5 positions by current value."
          badge="LIVE"
          accent="blue"
        />
        <Button type="button" variant="outline" size="sm">
          View All
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead>Qty</TableHead>
              <TableHead>Avg</TableHead>
              <TableHead>CMP</TableHead>
              <TableHead>P/L</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {holdings.map((holding) => {
              const profitLoss = getProfitLossPercent(portfolio, holding.symbol, holding.currentPrice);

              return (
                <TableRow key={`${portfolio.id}-${holding.symbol}`}>
                  <TableCell className="font-medium">{holding.symbol}</TableCell>
                  <TableCell>{holding.quantity}</TableCell>
                  <TableCell>{formatCurrency(getAveragePrice(portfolio, holding.symbol))}</TableCell>
                  <TableCell>{formatCurrency(holding.currentPrice)}</TableCell>
                  <TableCell className={cn("font-semibold", profitLoss >= 0 ? "text-emerald-300" : "text-rose-300")}>
                    {formatPercent(profitLoss)}
                  </TableCell>
                </TableRow>
              );
            })}
            {holdings.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-sm text-muted-foreground">
                  Add a portfolio to see holdings.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
      <SectionFooter text="Prices update through the existing quote refresh cycle." />
    </section>
  );
}

function SectorAllocationCard({
  metrics,
}: {
  metrics: ReturnType<typeof calculatePortfolioMetrics>;
}) {
  const sectors = [...metrics.sectorAllocations].sort((a, b) => b.percentage - a.percentage);

  return (
    <section className="space-y-3 rounded-2xl border border-emerald-300/20 bg-[#0F1B2D] p-5 shadow-xl">
      <SectionTitle
        title="Sector Allocation"
        subtitle="Sector weight sorted by largest exposure."
        badge="CALCULATED"
        accent="green"
      />
      <div className="space-y-3">
        {sectors.map((sector, index) => (
          <div key={sector.sector} className="space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate font-medium text-slate-100">{sector.sector}</span>
              <span className="font-semibold text-emerald-200">{sector.percentage.toFixed(1)}%</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
              <div
                className={cn("h-full rounded-full", sectorBarColors[index % sectorBarColors.length])}
                style={{ width: `${Math.min(100, Math.max(0, sector.percentage))}%` }}
              />
            </div>
            <div className="text-xs text-slate-500">Weight: {formatCurrency(sector.value)}</div>
          </div>
        ))}
        {sectors.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-[#16263D] p-3 text-sm text-slate-400">
            Add holdings to calculate sector allocation.
          </div>
        ) : null}
      </div>
      <SectionFooter text="Allocation is calculated from current holding value." />
    </section>
  );
}

function SectionTitle({
  title,
  subtitle,
  badge,
  accent,
}: {
  title: string;
  subtitle: string;
  badge: "LIVE" | "CALCULATED";
  accent: "blue" | "gold" | "cyan" | "green" | "purple";
}) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-semibold text-white">{title}</h2>
        <SourceBadge label={badge} accent={accent} />
      </div>
      <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
    </div>
  );
}

function SourceBadge({
  label,
  accent,
}: {
  label: "LIVE" | "CALCULATED";
  accent: "blue" | "gold" | "cyan" | "green" | "purple";
}) {
  const classes = {
    blue: "border-sky-300/30 bg-sky-300/10 text-sky-200",
    gold: "border-amber-300/30 bg-amber-300/10 text-amber-200",
    cyan: "border-cyan-300/30 bg-cyan-300/10 text-cyan-200",
    green: "border-emerald-300/30 bg-emerald-300/10 text-emerald-200",
    purple: "border-violet-300/30 bg-violet-300/10 text-violet-200",
  }[accent];

  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-[0.14em]", classes)}>
      {label}
    </span>
  );
}

function SectionFooter({ text }: { text: string }) {
  return <p className="border-t border-white/10 pt-3 text-xs text-slate-500">{text}</p>;
}

function DiagnosticMetric({
  label,
  value,
  detail,
  tone,
  compact = false,
}: {
  label: string;
  value: string;
  detail: string;
  tone: "up" | "down" | "flat";
  compact?: boolean;
}) {
  return (
    <article className="min-h-28 rounded-xl border border-white/10 bg-[#16263D] p-4">
      <div className="text-xs uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div
        className={cn(
          "mt-2 font-semibold",
          compact ? "line-clamp-2 text-base" : "text-2xl",
          tone === "up" ? "text-emerald-300" : tone === "down" ? "text-rose-300" : "text-amber-300",
        )}
      >
        {value}
      </div>
      <div className="mt-1 text-xs leading-5 text-slate-400">{detail}</div>
    </article>
  );
}

function PortfolioCard({
  portfolio,
  isLoading,
  onRefresh,
  onRemove,
  onUpdateInputs,
  isValueExpanded,
  onToggleValue,
}: {
  portfolio: ManagedPortfolio;
  isLoading: boolean;
  onRefresh: () => void;
  onRemove: () => void;
  onUpdateInputs: (rows: PortfolioInputRow[]) => void;
  isValueExpanded: boolean;
  onToggleValue: () => void;
}) {
  const metrics = calculatePortfolioMetrics(portfolio.positions);

  return (
    <Card className="portfolio-shell overflow-hidden">
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
              size="sm"
              onClick={onToggleValue}
              disabled={portfolio.isMarketPortfolio}
            >
              {isValueExpanded ? "Close Edit" : "Edit Holdings"}
            </Button>
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
        {isValueExpanded ? (
          <PortfolioDetailsEditor
            portfolio={portfolio}
            isLoading={isLoading}
            positions={portfolio.positions}
            onSave={onUpdateInputs}
          />
        ) : null}
        <PortfolioCoach portfolio={portfolio} />
      </CardContent>
    </Card>
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
            key={`portfolio-detail-row-${index}`}
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

function GlossarySection() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <section className="rounded-2xl border border-white/10 bg-[#0F1B2D] shadow-xl">
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
        aria-expanded={isOpen}
      >
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-white">Glossary / Help</h2>
            <SourceBadge label="CALCULATED" accent="purple" />
          </div>
          <p className="text-sm text-slate-400">
            Market terms explained for faster decision-making.
          </p>
        </div>
        <ChevronDown
          className={cn("h-5 w-5 text-cyan-300 transition-transform", isOpen ? "rotate-180" : "")}
          aria-hidden="true"
        />
      </button>
      {isOpen ? (
        <div className="grid gap-3 border-t border-white/10 p-5 md:grid-cols-2 xl:grid-cols-4">
          {glossaryItems.map((item) => (
            <article
              key={item.term}
              className="rounded-xl border border-white/10 bg-[#16263D] p-4 shadow-sm"
            >
              <h3 className="text-sm font-semibold text-cyan-200">{item.term}</h3>
              <p className="mt-2 text-xs leading-5 text-slate-300">{item.meaning}</p>
              <p className="mt-2 text-xs leading-5 text-amber-100">{item.interpretation}</p>
              <p className="mt-2 text-xs leading-5 text-slate-400">{item.why}</p>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function RoadmapSection() {
  return (
    <section className="space-y-4 rounded-2xl border border-white/10 bg-[#0F1B2D] p-5 shadow-xl">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-white">Roadmap</h2>
          <SourceBadge label="CALCULATED" accent="purple" />
        </div>
        <p className="text-sm text-slate-400">
          Coming soon modules for a stronger investor intelligence platform.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {futurePlaceholderItems.map((item) => (
          <article
            key={item}
            className="rounded-xl border border-dashed border-white/15 bg-white/[0.03] p-4"
          >
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
              Coming Soon
            </div>
            <h3 className="mt-2 text-sm font-semibold text-white">{item}</h3>
          </article>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {roadmapItems.map((item, index) => (
          <article
            key={item}
            className="rounded-xl border border-white/10 bg-[#16263D] p-4 transition hover:-translate-y-0.5 hover:border-cyan-300/40"
          >
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">
              {index < 2 ? "In Progress" : "Planned"}
            </div>
            <h3 className="mt-2 text-sm font-semibold text-white">{item}</h3>
            <p className="mt-2 text-xs text-slate-400">Coming Soon</p>
          </article>
        ))}
      </div>
    </section>
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

function getAveragePrice(portfolio: ManagedPortfolio, symbol: string) {
  const input = portfolio.inputs.find(
    (row) => row.stockCode === symbol || row.stock === symbol,
  );

  return input?.buyPrice && input.buyPrice > 0 ? input.buyPrice : 0;
}

function getProfitLossPercent(
  portfolio: ManagedPortfolio,
  symbol: string,
  currentPrice: number,
) {
  const averagePrice = getAveragePrice(portfolio, symbol);

  if (averagePrice <= 0) {
    return 0;
  }

  return ((currentPrice - averagePrice) / averagePrice) * 100;
}

function normalizePortfolioRows(rows: Array<Partial<PortfolioInputRow>>) {
  const merged = rows.reduce<Record<string, PortfolioInputRow>>((acc, row) => {
    const stockCode = String(row.stockCode || "")
      .trim()
      .toUpperCase()
      .replace(/\.NS$|\.BO$/u, "");
    const company = String(row.company || row.stock || "").trim();
    const quantity = parseQuantity(row.quantity);
    const buyPrice = parseQuantity(row.buyPrice);
    const key = stockCode || company.toLowerCase();

    if (!key) {
      return acc;
    }

    const normalized = buildPortfolioInputRow({
      stockCode,
      company,
      quantity,
      buyPrice,
    });
    const existing = acc[key];

    if (!existing) {
      acc[key] = normalized;
      return acc;
    }

    const nextQuantity = existing.quantity + normalized.quantity;
      acc[key] = {
        ...existing,
        company: existing.company || normalized.company,
        stock: existing.stockCode || existing.company || normalized.stock,
        list: nextQuantity > 0 ? "current" : "watchlist",
        quantity: nextQuantity,
        buyPrice: existing.buyPrice ?? normalized.buyPrice,
      };

    return acc;
  }, {});

  return Object.values(merged);
}

function normalizeManagedPortfolios(portfolios: ManagedPortfolio[]) {
  return portfolios.map((portfolio) => ({
    ...portfolio,
    appetite: portfolio.appetite ?? "moderate",
    isMarketPortfolio:
      portfolio.isMarketPortfolio ??
      portfolio.id === "market-recommendations",
    inputs: normalizePortfolioRows(portfolio.inputs ?? []),
    positions: portfolio.positions ?? [],
  }));
}

function filterHomepagePortfolios(portfolios: ManagedPortfolio[]) {
  return portfolios
    .filter(
      (portfolio) =>
        !portfolio.isMarketPortfolio &&
        portfolio.id !== "market-recommendations" &&
        portfolio.name.toLowerCase() !== "market recommendation",
    )
    .sort((a, b) => {
      const aIsSuchi = a.name.toLowerCase().includes("suchi icici");
      const bIsSuchi = b.name.toLowerCase().includes("suchi icici");

      if (aIsSuchi !== bIsSuchi) {
        return aIsSuchi ? -1 : 1;
      }

      return a.name.localeCompare(b.name);
    });
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

async function hashPortfolioPin(portfolioId: string, pin: string) {
  const input = new TextEncoder().encode(`unloan:${portfolioId}:${pin}`);
  const digest = await window.crypto.subtle.digest("SHA-256", input);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const glossaryItems = [
  {
    term: "Advance Decline Ratio",
    meaning: "Compares the number of advancing stocks with declining stocks.",
    interpretation: "Above 1 shows broad participation; below 1 shows weak breadth.",
    why: "Breadth helps confirm whether an index move is supported by many stocks.",
  },
  {
    term: "Fear & Greed Index",
    meaning: "A sentiment gauge combining volatility, momentum, breadth, and demand signals.",
    interpretation: "Extreme greed can warn of crowding; extreme fear can reveal opportunity.",
    why: "It prevents decisions based only on price movement.",
  },
  {
    term: "News Shock",
    meaning: "Measures whether fresh news may alter short-term stock or sector behavior.",
    interpretation: "High shock requires tighter risk checks and confirmation.",
    why: "News can invalidate technical setups quickly.",
  },
  {
    term: "India VIX",
    meaning: "Expected near-term volatility for the Indian market.",
    interpretation: "Rising VIX means uncertainty and wider price swings.",
    why: "Position size and stop-loss discipline should adapt to volatility.",
  },
  {
    term: "Market Sentiment",
    meaning: "A combined read of price action, breadth, and index movement.",
    interpretation: "Positive supports risk-on decisions; negative favors caution.",
    why: "Portfolio action is stronger when aligned with market regime.",
  },
  {
    term: "Sector Heatmap",
    meaning: "Shows which sectors are leading or lagging today.",
    interpretation: "Green clusters show leadership; amber or red clusters show fatigue.",
    why: "Sector rotation often drives stock outperformance.",
  },
  {
    term: "Top Movers",
    meaning: "Stocks with the strongest positive or negative daily moves.",
    interpretation: "Useful for momentum watchlists, but should be confirmed with volume.",
    why: "Large moves can reveal institutional interest or risk events.",
  },
];

const roadmapItems = [
  "Portfolio Doctor",
  "Decision Journal",
  "Risk Engine",
  "Opportunity Cost Analyzer",
  "Drawdown Simulator",
  "Stress Testing",
  "Intraday Command Center",
  "Trade Journal",
  "Multibagger Discovery Engine",
  "Adaptive Learning Engine",
  "Recommendation Reliability Score",
];

const futurePlaceholderItems = [
  "Decision Journal",
  "Risk Alerts",
];
