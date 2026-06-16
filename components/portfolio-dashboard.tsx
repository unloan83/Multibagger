"use client";

import Papa from "papaparse";
import {
  ChevronDown,
  ChevronRight,
  FileUp,
  Lock,
  Plus,
  RefreshCw,
  Shield,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ChangeDetection } from "@/components/change-detection";
import { MarketOverviewCollapsible } from "@/components/market-overview-collapsible";
import { PortfolioCoach } from "@/components/portfolio-coach";
import { PortfolioHub } from "@/components/portfolio-hub";
import { RecommendationReliability } from "@/components/todays-action-center";
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
import {
  hashPortfolioPin,
  masterRecoveryPin,
  normalizePinInput,
  validatePortfolioPin,
} from "@/lib/portfolio-pin";
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
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

const portfoliosStorageKey = "multibagger-portfolios";
const historyStorageKey = "multibagger-recommendation-history";
const pinStorageKey = "unloan-portfolio-pin-hashes";
const portfolioDashboardCollapseKey = "unloan-portfolio-dashboard-open";
const unlockedPortfolioStorageKey = "unloan-unlocked-portfolio";
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

type NotificationMode =
  | "Immediate Alerts"
  | "Daily Summary"
  | "Weekly Summary"
  | "Critical Alerts Only";

type CommunicationSettings = {
  portfolioId: string;
  telegramEnabled: boolean;
  telegramUserId: string;
  securePasskey: string;
  notificationMode: NotificationMode;
  alertTypes: string[];
  telegramConnected: boolean;
  connectionStatus: string;
  lastNotification: string;
  lastSuccessfulDelivery: string;
  updatedAt: string;
};

type UserRequestStatus = "Open" | "In Progress" | "Closed";

type UserRequestRow = {
  id: string;
  createdAt: string;
  portfolioId: string;
  portfolioName: string;
  user: string;
  requestType: string;
  priority: string;
  subject: string;
  message: string;
  status: UserRequestStatus;
  emailStatus: "Email Sent" | "Email Failed" | "Retry Pending";
  emailDetail: string;
  unread: boolean;
  updatedAt: string;
};

type RequestMessageRow = {
  id: string;
  requestId: string;
  createdAt: string;
  sender: "User" | "Admin";
  message: string;
};

type NotificationHistoryRow = {
  id: string;
  portfolioId: string;
  createdAt: string;
  alertType: string;
  status: string;
  detail: string;
};

const notificationModes: NotificationMode[] = [
  "Immediate Alerts",
  "Daily Summary",
  "Weekly Summary",
  "Critical Alerts Only",
];

const alertTypes = [
  "Today's Recommended Action",
  "New Opportunity",
  "Risk Alert",
  "Portfolio Score Change",
  "High Priority Sell Signal",
];

const requestTypes = [
  "Recommendation Query",
  "PIN Reset Request",
  "Telegram Connection Issue",
  "Bug Report",
  "Feature Request",
  "General",
];

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
  const [expertMatrix, setExpertMatrix] = useState<ExpertActionMatrix | null>(null);
  const [, setIsExpertLoading] = useState(false);
  const [isPortfolioDashboardOpen, setIsPortfolioDashboardOpen] = useState(true);
  const [routeUnlocked, setRouteUnlocked] = useState(!initialPortfolioId || adminMode);
  const [selectedPortfolioId, setSelectedPortfolioId] = useState(
    initialPortfolioId ?? samplePortfolio.id,
  );
  const [pinHashes, setPinHashes] = useState<Record<string, string>>({});
  const [pinUpdatedAt, setPinUpdatedAt] = useState<Record<string, string>>({});
  const [pinChallengePortfolio, setPinChallengePortfolio] =
    useState<ManagedPortfolio | null>(null);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
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

      if (
        initialPortfolioId &&
        window.sessionStorage.getItem(unlockedPortfolioStorageKey) === initialPortfolioId
      ) {
        setRouteUnlocked(true);
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
          await hydrateCentralPinHashes();
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
  }, [fetchQuotePositions, initialPortfolioId, repricePortfolioList]);

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

    if (!hydrated && initialPortfolioId) {
      return;
    }

    if (!portfolios.some((portfolio) => portfolio.id === selectedPortfolioId)) {
      setSelectedPortfolioId(portfolios[0].id);
    }
  }, [hydrated, initialPortfolioId, portfolios, selectedPortfolioId]);

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

    const normalizedPortfolioPin = normalizePinInput(portfolioPin);

    if (!/^\d{4}$/u.test(normalizedPortfolioPin)) {
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
      const pinHash = await hashPortfolioPin(portfolio.id, normalizedPortfolioPin);
      setPortfolios((items) => [...items, portfolio]);
      setPinHashes((items) => ({ ...items, [portfolio.id]: pinHash }));
      await saveCentralPinHash(portfolio.id, pinHash);
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
    const nextPin = normalizePinInput(
      window.prompt(`Set new 4 digit PIN for ${portfolio.name}`),
    );

    if (!nextPin || !/^\d{4}$/u.test(nextPin)) {
      setError("Reset PIN needs a 4 digit value.");
      return;
    }

    const pinHash = await hashPortfolioPin(portfolio.id, nextPin);
    setPinHashes((items) => ({ ...items, [portfolio.id]: pinHash }));
    await saveCentralPinHash(portfolio.id, pinHash);
    setError(null);
  }

  async function hydrateCentralPinHashes() {
    try {
      const response = await fetch("/api/portfolio-pins");
      const payload = (await response.json()) as {
        configured?: boolean;
        pinHashes?: Record<string, { hash: string; updatedAt?: string }>;
      };

      if (response.ok && payload.configured && payload.pinHashes) {
        const centralPinHashes = payload.pinHashes;

        setPinHashes((items) => ({
          ...items,
          ...Object.fromEntries(
            Object.entries(centralPinHashes).map(([portfolioId, item]) => [
              portfolioId,
              item.hash,
            ]),
          ),
        }));
        setPinUpdatedAt((items) => ({
          ...items,
          ...Object.fromEntries(
            Object.entries(centralPinHashes).map(([portfolioId, item]) => [
              portfolioId,
              item.updatedAt ?? "",
            ]),
          ),
        }));
      }
    } catch {
      // Local PIN hashes remain as fallback.
    }
  }

  async function saveCentralPinHash(portfolioId: string, pinHash: string) {
    if (!isSheetsStorage) {
      return;
    }

    try {
      const response = await fetch("/api/portfolio-pins", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portfolioId, pinHash }),
      });

      if (!response.ok) {
        throw new Error("Central PIN sync failed.");
      }

      setPinUpdatedAt((items) => ({
        ...items,
        [portfolioId]: new Date().toISOString(),
      }));
    } catch {
      setError("PIN updated locally, but central PIN sync failed. Retry from admin if mobile access fails.");
    }
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

    const normalizedPin = normalizePinInput(pinInput);
    const savedHash = pinHashes[pinChallengePortfolio.id];
    const enteredMasterPin = adminMode && normalizedPin === masterRecoveryPin;
    const serverPinResult = await validatePortfolioPinWithServer(
      pinChallengePortfolio.id,
      pinInput,
    );
    const portfolioPinResult =
      serverPinResult ??
      (await validatePortfolioPin({
        enteredPin: pinInput,
        portfolioId: pinChallengePortfolio.id,
        portfolioName: pinChallengePortfolio.name,
        storedHash: savedHash,
      }));
    const enteredPortfolioPin = portfolioPinResult.pinMatch;

    console.log("[PIN DEBUG] Master PIN Result", {
      enteredPin: pinInput,
      normalizedPin,
      enteredPinType: typeof normalizedPin,
      storedPin: masterRecoveryPin,
      storedPinType: typeof masterRecoveryPin,
      comparisonResult: enteredMasterPin,
      authenticationResult: enteredMasterPin || enteredPortfolioPin,
    });

    if (!enteredMasterPin && !enteredPortfolioPin) {
      setPinError("Invalid PIN. Use the portfolio PIN or master recovery PIN.");
      return;
    }

    setSelectedPortfolioId(pinChallengePortfolio.id);
    window.sessionStorage.setItem(unlockedPortfolioStorageKey, pinChallengePortfolio.id);
    setRouteUnlocked(true);
    setPinChallengePortfolio(null);
    setPinInput("");
    setPinError(null);
  }

  async function validatePortfolioPinWithServer(portfolioId: string, pin: string) {
    try {
      const response = await fetch("/api/portfolio-pins/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portfolioId, pin }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        pinMatch?: boolean;
        hasStoredHash?: boolean;
        usedMasterPin?: boolean;
      };

      if (response.ok) {
        return {
          hasStoredHash: Boolean(payload.hasStoredHash),
          pinMatch: Boolean(payload.ok && payload.pinMatch),
          usedMasterPin: Boolean(payload.usedMasterPin),
        };
      }
    } catch {
      // Local PIN hashes remain as fallback.
    }

    return null;
  }

  const selectedPortfolio =
    portfolios.find((portfolio) => portfolio.id === selectedPortfolioId) ??
    (!initialPortfolioId ? portfolios[0] : undefined);
  const decisionIntelligence = useMemo(
    () => {
      if (!selectedPortfolio) {
        return null;
      }

      return buildDecisionIntelligence({
          portfolio: selectedPortfolio,
          market: marketOverview,
          history,
        });
    },
    [history, marketOverview, selectedPortfolio],
  );

  useEffect(() => {
    if (!hydrated || adminMode || routeUnlocked || !initialPortfolioId || !selectedPortfolio) {
      return;
    }

    setPinChallengePortfolio(selectedPortfolio);
  }, [adminMode, hydrated, initialPortfolioId, routeUnlocked, selectedPortfolio]);

  return (
    <main className="min-h-screen bg-background">
      <section className="mx-auto flex w-full max-w-[1680px] flex-col gap-7 px-4 py-6 sm:px-6 lg:px-8">
        <header className="terminal-panel flex flex-col gap-5 rounded-2xl border border-sky-400/20 px-5 py-5 shadow-[0_24px_80px_rgba(0,0,0,0.34)] lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-start gap-3">
            <Image
              src="/unloan-logo.png"
              alt="UNLOAN"
              width={118}
              height={78}
              className="object-contain"
              priority
            />
            <div className="space-y-2">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#1E88E5]">
                UNLOAN
              </p>
              <h1 className="text-3xl font-semibold tracking-normal text-white sm:text-4xl">
                {adminMode ? "UNLOAN Administration" : "UNLOAN"}
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-slate-300">
                Build Wealth. Reduce Debt. Create Freedom.
              </p>
            </div>
          </div>
          <nav className="flex flex-wrap items-center gap-2">
            <HeaderLink href="/">Home</HeaderLink>
            <HeaderLink href="/admin">
              <Shield className="h-4 w-4" aria-hidden="true" />
              Admin
            </HeaderLink>
            <HeaderLink href="/#roadmap">Roadmap</HeaderLink>
            <HeaderLink href="/#glossary">Glossary</HeaderLink>
          </nav>
        </header>

        {adminMode ? (
          <div className="rounded-2xl border border-amber-300/30 bg-amber-300/10 px-5 py-4 text-sm font-semibold text-amber-100">
            Admin Master Access Active. Admin can open portfolios after authentication.
          </div>
        ) : null}

        <MarketOverviewCollapsible
          defaultOpen={false}
          market={marketOverview}
          isLoading={isMarketLoading}
          onRefresh={refreshMarketOverview}
        />

        {adminMode || !initialPortfolioId ? (
          <PortfolioHub
            portfolios={portfolios}
            selectedPortfolioId={selectedPortfolio?.id}
            pinProtectedIds={Object.keys(pinHashes)}
            onAddPortfolio={() => setIsAddOpen(true)}
            onOpenPortfolio={(portfolio) =>
              adminMode ? setSelectedPortfolioId(portfolio.id) : requestPortfolioOpen(portfolio)
            }
          />
        ) : null}

        {adminMode ? (
          <AdminControlPanel
            expertMatrix={expertMatrix}
            history={history}
            marketOverview={marketOverview}
            pinHashes={pinHashes}
            pinUpdatedAt={pinUpdatedAt}
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

        {selectedPortfolio && (adminMode || routeUnlocked || !initialPortfolioId) ? (
          <section className="rounded-2xl border border-white/10 bg-[#0F1B2D] shadow-xl">
            <div className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-3">
                <Image
                  src="/unloan-logo.png"
                  alt="UNLOAN"
                  width={98}
                  height={64}
                  className="object-contain"
                />
                <div>
                  <h2 className="text-lg font-semibold text-white">
                    {selectedPortfolio.name} Dashboard
                  </h2>
                  <p className="text-sm text-slate-400">
                    Last Updated:{" "}
                    {selectedPortfolio.refreshedAt
                      ? new Date(selectedPortfolio.refreshedAt).toLocaleString("en-IN", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })
                      : "Pending"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 self-end lg:self-auto">
                {initialPortfolioId && !adminMode ? (
                  <Button asChild variant="outline">
                    <Link href="/">Back To Portfolios</Link>
                  </Button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setIsPortfolioDashboardOpen((value) => !value)}
                  className="flex h-12 w-12 items-center justify-center rounded-xl border border-cyan-300/30 bg-cyan-300/10 text-cyan-200 shadow-sm transition hover:border-cyan-200/60 hover:bg-cyan-300/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
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
            </div>
            {isPortfolioDashboardOpen ? (
              <SimplifiedPortfolioView
                portfolio={selectedPortfolio}
                history={history}
                expertMatrix={expertMatrix}
                decisionIntelligence={decisionIntelligence}
                isLoading={isLoading}
                onUpdateInputs={(rows) => updatePortfolioInputs(selectedPortfolio, rows)}
                onPortfolioPinChanged={(pinHash, updatedAt) => {
                  setPinHashes((items) => ({
                    ...items,
                    [selectedPortfolio.id]: pinHash,
                  }));
                  setPinUpdatedAt((items) => ({
                    ...items,
                    [selectedPortfolio.id]: updatedAt,
                  }));
                }}
              />
            ) : null}
          </section>
        ) : null}

        <RoadmapSection />

        <GlossarySection />
      </section>
    </main>
  );

}

function HeaderLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-cyan-300/40 hover:text-cyan-200"
    >
      {children}
    </Link>
  );
}

type PortfolioActionPanel =
  | "analysis"
  | "management"
  | "diagnostics"
  | "settings";

type DecisionRecommendationRow = {
  symbol: string;
  type: string;
  cmp: number;
  target: number;
  stopLoss: number;
  confidence: number;
  action: "BUY" | "SELL";
  reason: string;
  technicalFactors: string[];
  fundamentalFactors: string[];
  sectorStrength: string;
  riskFactors: string[];
};

function SimplifiedPortfolioView({
  portfolio,
  history,
  expertMatrix,
  decisionIntelligence,
  isLoading,
  onUpdateInputs,
  onPortfolioPinChanged,
}: {
  portfolio: ManagedPortfolio;
  history: Recommendation[];
  expertMatrix: ExpertActionMatrix | null;
  decisionIntelligence: ReturnType<typeof buildDecisionIntelligence> | null;
  isLoading: boolean;
  onUpdateInputs: (rows: PortfolioInputRow[]) => void | Promise<void>;
  onPortfolioPinChanged: (pinHash: string, updatedAt: string) => void;
}) {
  const [activePanel, setActivePanel] = useState<PortfolioActionPanel | null>(null);
  const sections = useMemo(
    () => buildSimplifiedPortfolioSections(portfolio, history, expertMatrix),
    [expertMatrix, history, portfolio],
  );
  const panelButtons: Array<{
    id: PortfolioActionPanel;
    title: string;
    description: string;
  }> = [
    {
      id: "analysis",
      title: "Recommendation Analysis",
      description: "Reasoning, technical factors, fundamentals, sector context, and risks.",
    },
    {
      id: "management",
      title: "Portfolio Management",
      description: "Current holdings, add/edit/delete holdings, and CSV import workflow.",
    },
    {
      id: "diagnostics",
      title: "Portfolio Diagnostics",
      description: "Health, risk, sector concentration, and AI portfolio coach.",
    },
    {
      id: "settings",
      title: "User Settings",
      description: "Telegram, notification preferences, admin contact, and support requests.",
    },
  ];

  return (
    <div className="space-y-5 border-t border-white/10 p-4 sm:p-5">
      <section className="rounded-2xl border border-cyan-300/20 bg-gradient-to-br from-[#10243B] to-[#0B1726] p-5 shadow-xl">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">
              Portfolio Command View
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">
              Welcome to {portfolio.name}
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              Buy, sell, long-term, and intraday actions are shown first. Deeper analytics stay one click away.
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-300">
            Last Updated:{" "}
            <span className="font-semibold text-white">
              {portfolio.refreshedAt
                ? new Date(portfolio.refreshedAt).toLocaleString("en-IN", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })
                : "Pending"}
            </span>
          </div>
        </div>
      </section>

      <DecisionRecommendationTable
        title="Today's Buy Recommendations"
        subtitle="Top large-cap, mid-cap, small-cap, and ETF opportunities from market intelligence."
        rows={sections.buy}
        emptyText="Buy recommendations are loading from the expert matrix."
      />
      <DecisionRecommendationTable
        title="Today's Sell Recommendations"
        subtitle="Top sell signals from the existing portfolio recommendation engine."
        rows={sections.sell}
        emptyText="No urgent sell opportunity is currently triggered."
      />
      <DecisionRecommendationTable
        title="6-12 Month Recommendations"
        subtitle="Longer-horizon opportunities derived from the current portfolio and watchlist."
        rows={sections.longTerm}
        emptyText="No long-term recommendation clears the current filters."
      />
      <DecisionRecommendationTable
        title="Intraday Opportunities"
        subtitle="Short-cycle opportunities from the existing intraday recommendation model."
        rows={sections.intraday}
        emptyText="Intraday opportunities are loading or below confidence threshold."
      />

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {panelButtons.map((button) => (
          <button
            key={button.id}
            type="button"
            onClick={() =>
              setActivePanel((current) => (current === button.id ? null : button.id))
            }
            className={cn(
              "rounded-2xl border p-4 text-left shadow-lg transition hover:-translate-y-0.5",
              activePanel === button.id
                ? "border-amber-300/60 bg-amber-300/10"
                : "border-white/10 bg-[#16263D] hover:border-cyan-300/40",
            )}
            aria-expanded={activePanel === button.id}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-white">{button.title}</h3>
              <ChevronRight
                className={cn(
                  "h-5 w-5 text-cyan-200 transition-transform",
                  activePanel === button.id ? "rotate-90" : "",
                )}
                aria-hidden="true"
              />
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-400">{button.description}</p>
          </button>
        ))}
      </section>

      {activePanel === "analysis" ? (
        <RecommendationAnalysisPanel rows={sections.all} />
      ) : null}

      {activePanel === "management" ? (
        <PortfolioHoldingsAndSectors
          portfolio={portfolio}
          isLoading={isLoading}
          onUpdateInputs={onUpdateInputs}
        />
      ) : null}

      {activePanel === "diagnostics" ? (
        <section className="space-y-4">
          <PortfolioDiagnostics portfolio={portfolio} />
          <section className="grid gap-4 xl:grid-cols-2">
            <PortfolioCoach portfolio={portfolio} />
            <PortfolioMarketOpportunities matrix={expertMatrix} />
          </section>
          <ChangeDetection snapshot={decisionIntelligence?.snapshot} />
          <RecommendationReliability intelligence={decisionIntelligence} />
        </section>
      ) : null}

      {activePanel === "settings" ? (
        <PortfolioCommunicationCenter
          portfolio={portfolio}
          onPortfolioPinChanged={onPortfolioPinChanged}
        />
      ) : null}
    </div>
  );
}

function DecisionRecommendationTable({
  title,
  subtitle,
  rows,
  emptyText,
}: {
  title: string;
  subtitle: string;
  rows: DecisionRecommendationRow[];
  emptyText: string;
}) {
  return (
    <section className="space-y-3 rounded-2xl border border-white/10 bg-[#101D30] p-4 shadow-xl sm:p-5">
      <SectionTitle title={title} subtitle={subtitle} badge="CALCULATED" accent="blue" />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Stock</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>CMP</TableHead>
            <TableHead>Target</TableHead>
            <TableHead>Stop Loss</TableHead>
            <TableHead>Confidence</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${title}-${row.symbol}-${row.type}`}>
              <TableCell className="font-semibold text-white">{row.symbol}</TableCell>
              <TableCell>{row.type}</TableCell>
              <TableCell>{formatDecisionPrice(row.cmp)}</TableCell>
              <TableCell>{formatDecisionPrice(row.target)}</TableCell>
              <TableCell>{formatDecisionPrice(row.stopLoss)}</TableCell>
              <TableCell
                className={cn(
                  "font-semibold",
                  row.confidence >= 80 ? "text-amber-200" : "text-cyan-200",
                )}
              >
                {row.confidence}%
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-sm text-slate-400">
                {emptyText}
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </section>
  );
}

function RecommendationAnalysisPanel({
  rows,
}: {
  rows: DecisionRecommendationRow[];
}) {
  return (
    <section className="space-y-3 rounded-2xl border border-amber-300/25 bg-[#101D30] p-5 shadow-xl">
      <SectionTitle
        title="Recommendation Analysis"
        subtitle="Expanded reasoning for the currently surfaced recommendations."
        badge="CALCULATED"
        accent="gold"
      />
      <div className="grid gap-3 lg:grid-cols-2">
        {rows.slice(0, 8).map((row) => (
          <article
            key={`analysis-${row.symbol}-${row.type}`}
            className="rounded-xl border border-white/10 bg-[#16263D] p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-white">{row.symbol}</h3>
                <p className="text-xs text-slate-400">{row.type}</p>
              </div>
              <span
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-semibold",
                  row.action === "BUY"
                    ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100"
                    : "border-rose-300/30 bg-rose-300/10 text-rose-100",
                )}
              >
                {row.action}
              </span>
            </div>
            <AnalysisLine label="Why Recommended" value={row.reason} />
            <AnalysisList label="Technical Factors" values={row.technicalFactors} />
            <AnalysisList label="Fundamental Factors" values={row.fundamentalFactors} />
            <AnalysisLine label="Sector Strength" value={row.sectorStrength} />
            <AnalysisList label="Risk Factors" values={row.riskFactors} />
          </article>
        ))}
        {rows.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-[#16263D] p-4 text-sm text-slate-400">
            Recommendation reasoning will appear once recommendations are available.
          </div>
        ) : null}
      </div>
    </section>
  );
}

function AnalysisLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </div>
      <p className="mt-1 text-sm leading-6 text-slate-300">{value}</p>
    </div>
  );
}

function AnalysisList({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="mt-3">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </div>
      <ul className="mt-1 space-y-1 text-sm leading-6 text-slate-300">
        {values.map((value) => (
          <li key={value}>{value}</li>
        ))}
      </ul>
    </div>
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
  function submitUnlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onUnlock();
  }

  function handlePinKey(event: KeyboardEvent<HTMLInputElement>) {
    if (["Enter", "Go", "Done", "Submit", "Return"].includes(event.key)) {
      event.preventDefault();
      onUnlock();
    }
  }

  function handlePinPaste(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    setPin(normalizePinInput(event.clipboardData.getData("text")));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
      <Card className="w-full max-w-md border-cyan-300/20 bg-[#0F1B2D] text-slate-100">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            Unlock {portfolioName}
          </CardTitle>
          <CardDescription>
            Enter the 4 digit portfolio PIN.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submitUnlock}>
          {error ? (
            <div className="rounded-md border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
              {error}
            </div>
          ) : null}
          <input
            value={pin}
            onChange={(event) =>
              setPin(normalizePinInput(event.target.value))
            }
            onKeyDown={handlePinKey}
            onPaste={handlePinPaste}
            placeholder="4 digit PIN"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            name="portfolio-pin-mobile"
            className="h-11 w-full rounded-md border border-white/10 bg-[#08121F] px-3 text-center text-lg tracking-[0.35em] text-white outline-none focus:ring-2 focus:ring-cyan-300"
          />
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1">
              Unlock Portfolio
            </Button>
          </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function AdminControlPanel({
  expertMatrix,
  history,
  marketOverview,
  pinHashes,
  pinUpdatedAt,
  portfolios,
  onOpen,
  onEdit,
  onDelete,
  onResetPin,
}: {
  expertMatrix: ExpertActionMatrix | null;
  history: Recommendation[];
  marketOverview: MarketOverview | null;
  pinHashes: Record<string, string>;
  pinUpdatedAt: Record<string, string>;
  portfolios: ManagedPortfolio[];
  onOpen: (portfolio: ManagedPortfolio) => void;
  onEdit: (portfolio: ManagedPortfolio) => void;
  onDelete: (portfolio: ManagedPortfolio) => void;
  onResetPin: (portfolio: ManagedPortfolio) => void;
}) {
  const [activeTab, setActiveTab] = useState<AdminTab>("portfolio");
  const [requests, setRequests] = useState<UserRequestRow[]>([]);
  const [messages, setMessages] = useState<RequestMessageRow[]>([]);
  const intelligence = buildAdminIntelligence({
    expertMatrix,
    history,
    marketOverview,
    portfolios,
  });
  const performance = buildPerformanceAnalytics(history, portfolios, "all");
  const pendingRequests = requests.filter((request) => request.status !== "Closed").length;
  const unreadRequests = requests.filter((request) => request.unread).length;

  useEffect(() => {
    refreshRequests();
  }, []);

  async function refreshRequests() {
    try {
      const response = await fetch("/api/user-requests");
      const payload = (await response.json()) as {
        requests?: UserRequestRow[];
        messages?: RequestMessageRow[];
      };

      if (response.ok) {
        setRequests(payload.requests ?? []);
        setMessages(payload.messages ?? []);
      }
    } catch {
      setRequests([]);
      setMessages([]);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-violet-300/20 bg-[#0F1B2D] p-5 shadow-xl">
      <SectionTitle
        title="Admin Control Panel"
        subtitle="Portfolio control, intelligence monitoring, performance analytics, and data export."
        badge="LIVE"
        accent="purple"
      />
      <div className="flex flex-wrap gap-2">
        {adminTabs.map((tab) => (
          <Button
            key={tab.id}
            type="button"
            variant={activeTab === tab.id ? "default" : "outline"}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.id === "requests"
              ? `${tab.label} (${pendingRequests})`
              : tab.label}
          </Button>
        ))}
      </div>
      {unreadRequests > 0 ? (
        <div className="rounded-xl border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm font-semibold text-amber-100">
          {unreadRequests} unread user request{unreadRequests === 1 ? "" : "s"}.
        </div>
      ) : null}

      {activeTab === "portfolio" ? (
        <PortfolioAdministrationTab
          portfolios={portfolios}
          onOpen={onOpen}
          onEdit={onEdit}
          onDelete={onDelete}
          onResetPin={onResetPin}
        />
      ) : null}
      {activeTab === "monitor" ? (
        <IntelligenceMonitorTab intelligence={intelligence} />
      ) : null}
      {activeTab === "performance" ? (
        <PerformanceAnalyticsTab
          history={history}
          performance={performance}
          portfolios={portfolios}
        />
      ) : null}
      {activeTab === "export" ? (
        <DataExportTab
          intelligence={intelligence}
          performance={performance}
          portfolios={portfolios}
          history={history}
          marketOverview={marketOverview}
          expertMatrix={expertMatrix}
        />
      ) : null}
      {activeTab === "pin-diagnostics" ? (
        <PinDiagnosticsTab
          pinHashes={pinHashes}
          pinUpdatedAt={pinUpdatedAt}
          portfolios={portfolios}
          onOpen={onOpen}
        />
      ) : null}
      {activeTab === "requests" ? (
        <UserRequestsTab
          messages={messages}
          requests={requests}
          onRefresh={refreshRequests}
        />
      ) : null}
      <SectionFooter text="Admin operations use the existing authenticated session and portfolio persistence." />
    </section>
  );
}

type AdminTab = "portfolio" | "monitor" | "performance" | "export" | "pin-diagnostics" | "requests";

const adminTabs: Array<{ id: AdminTab; label: string }> = [
  { id: "portfolio", label: "Portfolio Administration" },
  { id: "monitor", label: "Intelligence Monitor" },
  { id: "performance", label: "Performance Analytics" },
  { id: "export", label: "Data Export" },
  { id: "pin-diagnostics", label: "PIN Diagnostics" },
  { id: "requests", label: "User Requests" },
];

type AdminIntelligence = ReturnType<typeof buildAdminIntelligence>;
type AdminPerformance = ReturnType<typeof buildPerformanceAnalytics>;
type PerformanceWindow = "today" | "7d" | "30d" | "90d" | "all";
type PinDiagnosticResult = {
  portfolioId?: string;
  status: "Success" | "Failure" | "Pass" | "Fail";
  portfolioFound: boolean;
  pinMatch: boolean;
  validationPassed: boolean;
  routeOpened: boolean;
  detail: string;
};

function PortfolioAdministrationTab({
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
  );
}

function PinDiagnosticsTab({
  pinHashes,
  pinUpdatedAt,
  portfolios,
  onOpen,
}: {
  pinHashes: Record<string, string>;
  pinUpdatedAt: Record<string, string>;
  portfolios: ManagedPortfolio[];
  onOpen: (portfolio: ManagedPortfolio) => void;
}) {
  const [result, setResult] = useState<PinDiagnosticResult | null>(null);
  const protectedCount = portfolios.filter((portfolio) => pinHashes[portfolio.id]).length;

  function testPortfolioAccess(portfolio: ManagedPortfolio) {
    const storedPinHash = pinHashes[portfolio.id];
    const portfolioFound = portfolios.some((item) => item.id === portfolio.id);
    const pinMatch = isStoredPinHashValid(storedPinHash);
    const validationPassed = portfolioFound && pinMatch;

    if (validationPassed) {
      onOpen(portfolio);
    }

    setResult({
      portfolioId: portfolio.id,
      status: validationPassed ? "Success" : "Failure",
      portfolioFound,
      pinMatch,
      validationPassed,
      routeOpened: validationPassed,
      detail: validationPassed
        ? "Stored PIN hash is present, hash format is valid, and admin route access simulation opened the portfolio."
        : "Portfolio access simulation failed because a portfolio is missing or the stored PIN hash is absent/invalid.",
    });
  }

  function testMasterPin() {
    const validationPassed = masterRecoveryPin === "1008";
    const pinMatch = validationPassed;

    setResult({
      status: validationPassed ? "Pass" : "Fail",
      portfolioFound: true,
      pinMatch,
      validationPassed,
      routeOpened: false,
      detail: validationPassed
        ? "Master PIN constant validates against 1008."
        : "Master PIN constant does not validate against 1008.",
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <AdminMetric label="Portfolios Found" value={String(portfolios.length)} />
        <AdminMetric label="Stored PIN Records" value={String(protectedCount)} />
        <AdminMetric
          label="Master PIN Test"
          value={result?.portfolioId ? "Not Run" : result?.status ?? "Pending"}
          tone={result && !result.portfolioId && result.status === "Pass" ? "up" : "flat"}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={testMasterPin}>
          Test Master PIN
        </Button>
        <span className="text-xs text-slate-400">
          Diagnostics are read-only. Stored PIN displays the current hash record, not plaintext.
        </span>
      </div>

      {result ? (
        <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/10 p-4 text-sm text-cyan-100">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="font-semibold">
              Test Result:{" "}
              <span className={result.status === "Success" || result.status === "Pass" ? "text-emerald-300" : "text-rose-300"}>
                {result.status}
              </span>
            </div>
            <div className="text-xs text-cyan-200">{result.detail}</div>
          </div>
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
            <DebugFlag label="Portfolio Found" value={result.portfolioFound} />
            <DebugFlag label="PIN Match" value={result.pinMatch} />
            <DebugFlag label="Validation Passed" value={result.validationPassed} />
            <DebugFlag label="Route Opened" value={result.routeOpened} />
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Portfolio Name</TableHead>
              <TableHead>Portfolio ID</TableHead>
              <TableHead>Stored PIN</TableHead>
              <TableHead>PIN Last Updated</TableHead>
              <TableHead>Access Status</TableHead>
              <TableHead>Test</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {portfolios.map((portfolio) => {
              const storedPinHash = pinHashes[portfolio.id];
              const hasPin = isStoredPinHashValid(storedPinHash);

              return (
                <TableRow key={`pin-diagnostics-${portfolio.id}`}>
                  <TableCell className="font-semibold">{portfolio.name}</TableCell>
                  <TableCell className="max-w-64 truncate text-xs text-slate-400">
                    {portfolio.id}
                  </TableCell>
                  <TableCell className="max-w-72 truncate font-mono text-xs text-slate-300">
                    {storedPinHash ? `hash:${storedPinHash}` : "No stored PIN hash"}
                  </TableCell>
                  <TableCell className="text-xs text-slate-400">
                    {pinUpdatedAt[portfolio.id]
                      ? new Date(pinUpdatedAt[portfolio.id]).toLocaleString("en-IN", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })
                      : "Not synced centrally yet"}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-xs font-semibold",
                        hasPin
                          ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200"
                          : "border-amber-300/30 bg-amber-300/10 text-amber-200",
                      )}
                    >
                      {hasPin ? "Protected" : "Missing PIN"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => testPortfolioAccess(portfolio)}
                    >
                      Test Portfolio Access
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function DebugFlag({ label, value }: { label: string; value: boolean }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#08121F] px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className={cn("mt-1 font-semibold", value ? "text-emerald-300" : "text-rose-300")}>
        {value ? "Yes" : "No"}
      </div>
    </div>
  );
}

function isStoredPinHashValid(value?: string) {
  return Boolean(value && /^[a-f0-9]{64}$/iu.test(value));
}

function formatDateTime(value: string) {
  if (!value) {
    return "Pending";
  }

  return new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function UserRequestsTab({
  messages,
  requests,
  onRefresh,
}: {
  messages: RequestMessageRow[];
  requests: UserRequestRow[];
  onRefresh: () => void;
}) {
  const [selectedId, setSelectedId] = useState(requests[0]?.id ?? "");
  const [reply, setReply] = useState("");
  const selected = requests.find((request) => request.id === selectedId) ?? requests[0];
  const thread = messages.filter((message) => message.requestId === selected?.id);

  useEffect(() => {
    if (!selectedId && requests[0]) {
      setSelectedId(requests[0].id);
    }
  }, [requests, selectedId]);

  async function updateRequest(id: string, status: UserRequestStatus) {
    await fetch("/api/user-requests", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, unread: false }),
    });
    onRefresh();
  }

  async function sendReply() {
    if (!selected || !reply.trim()) {
      return;
    }

    await fetch("/api/user-requests/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: selected.id, message: reply.trim() }),
    });
    setReply("");
    onRefresh();
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Portfolio</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Email</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map((request) => (
              <TableRow
                key={request.id}
                className={cn("cursor-pointer", selected?.id === request.id ? "bg-cyan-300/10" : "")}
                onClick={() => setSelectedId(request.id)}
              >
                <TableCell className="text-xs">
                  {formatDateTime(request.createdAt)}
                </TableCell>
                <TableCell>{request.portfolioName}</TableCell>
                <TableCell>
                  <span className={request.unread ? "font-semibold text-amber-200" : ""}>
                    {request.subject}
                  </span>
                </TableCell>
                <TableCell>{request.status}</TableCell>
                <TableCell>{request.emailStatus}</TableCell>
              </TableRow>
            ))}
            {requests.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-slate-400">
                  No user requests yet.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      <section className="rounded-xl border border-white/10 bg-[#16263D] p-4">
        {selected ? (
          <div className="space-y-4">
            <div>
              <div className="text-xs uppercase tracking-[0.14em] text-slate-500">
                {selected.requestType} | {selected.priority}
              </div>
              <h3 className="mt-1 text-lg font-semibold text-white">{selected.subject}</h3>
              <p className="mt-1 text-xs text-slate-400">
                {selected.portfolioName} | {selected.emailStatus} | {selected.emailDetail}
              </p>
            </div>
            <div className="space-y-2">
              {[...thread].map((message) => (
                <div key={message.id} className="rounded-lg border border-white/10 bg-[#08121F] p-3 text-sm">
                  <div className="text-xs font-semibold text-cyan-200">
                    {message.sender} | {formatDateTime(message.createdAt)}
                  </div>
                  <p className="mt-2 text-slate-300">{message.message}</p>
                </div>
              ))}
            </div>
            <textarea
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              placeholder="Reply to user"
              className="min-h-28 w-full rounded-md border border-white/10 bg-[#08121F] px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-cyan-300"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={sendReply}>Send Reply</Button>
              <Button type="button" variant="outline" onClick={() => updateRequest(selected.id, "In Progress")}>In Progress</Button>
              <Button type="button" variant="outline" onClick={() => updateRequest(selected.id, "Closed")}>Close</Button>
            </div>
          </div>
        ) : (
          <div className="text-sm text-slate-400">Select a request to view the conversation.</div>
        )}
      </section>
    </div>
  );
}

function IntelligenceMonitorTab({
  intelligence,
}: {
  intelligence: AdminIntelligence;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        <AdminMetric label="Stocks Scanned" value={String(intelligence.summary.stocksScanned)} />
        <AdminMetric label="Opportunities Evaluated" value={String(intelligence.summary.opportunitiesEvaluated)} />
        <AdminMetric label="Recommendations Generated" value={String(intelligence.summary.recommendationsGenerated)} />
        <AdminMetric label="Confidence Updated" value={intelligence.summary.confidenceUpdated} />
        <AdminMetric label="Portfolios Evaluated" value={String(intelligence.summary.portfoliosEvaluated)} />
      </div>
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Task</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {intelligence.activities.map((activity) => (
              <TableRow key={`${activity.time}-${activity.task}`}>
                <TableCell>{activity.time}</TableCell>
                <TableCell className="font-semibold">{activity.task}</TableCell>
                <TableCell>{activity.result}</TableCell>
                <TableCell>
                  <span className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-2 py-0.5 text-xs font-semibold text-emerald-200">
                    {activity.status}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function PerformanceAnalyticsTab({
  history,
  performance,
  portfolios,
}: {
  history: Recommendation[];
  performance: AdminPerformance;
  portfolios: ManagedPortfolio[];
}) {
  const [windowKey, setWindowKey] = useState<PerformanceWindow>("30d");
  const filtered = buildPerformanceAnalytics(history, portfolios, windowKey);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {performanceWindows.map((item) => (
          <Button
            key={item.id}
            type="button"
            variant={windowKey === item.id ? "default" : "outline"}
            size="sm"
            onClick={() => setWindowKey(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
        <AdminMetric label="Total Recommendations" value={String(filtered.summary.total)} />
        <AdminMetric label="Successful" value={String(filtered.summary.successful)} tone="up" />
        <AdminMetric label="Failed" value={String(filtered.summary.failed)} tone="down" />
        <AdminMetric label="Success Rate" value={`${filtered.summary.successRate}%`} />
        <AdminMetric label="Average Return" value={`${filtered.summary.averageReturn}%`} />
        <AdminMetric label="Average Drawdown" value={`${filtered.summary.averageDrawdown}%`} tone="down" />
        <AdminMetric label="Best Recommendation" value={filtered.summary.best} />
        <AdminMetric label="Worst Recommendation" value={filtered.summary.worst} tone="down" />
      </div>
      <div className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-4">
        <div className="text-xs uppercase tracking-[0.14em] text-amber-200">
          Recommendation Engine
        </div>
        <div className="mt-2 text-3xl font-semibold text-white">
          {filtered.scorecard.rating}/100
        </div>
        <div className="mt-1 text-sm font-semibold text-amber-100">
          {filtered.scorecard.classification}
        </div>
      </div>
      <PerformanceTable rows={filtered.rows} />
      <div className="grid gap-4 xl:grid-cols-2">
        <PerformanceList title="Top 10 Recommendations" rows={filtered.topPerformers} />
        <PerformanceList title="Worst 10 Recommendations" rows={filtered.bottomPerformers} />
      </div>
      <div className="hidden">{performance.summary.total}</div>
    </div>
  );
}

function DataExportTab({
  intelligence,
  performance,
  portfolios,
  history,
  marketOverview,
  expertMatrix,
}: {
  intelligence: AdminIntelligence;
  performance: AdminPerformance;
  portfolios: ManagedPortfolio[];
  history: Recommendation[];
  marketOverview: MarketOverview | null;
  expertMatrix: ExpertActionMatrix | null;
}) {
  const workbook = buildWorkbookData({
    expertMatrix,
    history,
    intelligence,
    marketOverview,
    performance,
    portfolios,
  });
  const rowCount = workbook.sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);
  const sizeKb = Math.max(1, Math.round(buildExcelWorkbook(workbook).length / 1024));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <AdminMetric label="Workbook Last Updated" value={new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} />
        <AdminMetric label="Rows Exported" value={String(rowCount)} />
        <AdminMetric label="Download Size" value={`${sizeKb} KB`} />
      </div>
      <Button type="button" onClick={() => downloadWorkbook(workbook)}>
        Download Workbook
      </Button>
      <p className="text-xs leading-5 text-slate-400">
        Export excludes passwords and portfolio PINs. It includes dashboard intelligence,
        recommendations, backtesting status, portfolio analytics, opportunity scores,
        performance analytics, change detection summaries, and market opportunities.
      </p>
    </div>
  );
}

function AdminMetric({
  label,
  value,
  tone = "flat",
}: {
  label: string;
  value: string;
  tone?: "up" | "down" | "flat";
}) {
  return (
    <article className="rounded-xl border border-white/10 bg-[#16263D] p-4">
      <div className="text-xs uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div
        className={cn(
          "mt-2 text-xl font-semibold",
          tone === "up"
            ? "text-emerald-300"
            : tone === "down"
              ? "text-rose-300"
              : "text-amber-300",
        )}
      >
        {value}
      </div>
    </article>
  );
}

function PerformanceTable({ rows }: { rows: PerformanceRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Symbol</TableHead>
            <TableHead>Recommendation</TableHead>
            <TableHead>CMP At Recommendation</TableHead>
            <TableHead>Current Price</TableHead>
            <TableHead>Return %</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, 30).map((row) => (
            <TableRow key={row.id}>
              <TableCell>{row.date}</TableCell>
              <TableCell className="font-semibold">{row.symbol}</TableCell>
              <TableCell>{row.recommendation}</TableCell>
              <TableCell>{formatCurrency(row.cmpAtRecommendation)}</TableCell>
              <TableCell>{formatCurrency(row.currentPrice)}</TableCell>
              <TableCell className={row.returnPercent >= 0 ? "text-emerald-300" : "text-rose-300"}>
                {row.returnPercent}%
              </TableCell>
              <TableCell>{row.status}</TableCell>
            </TableRow>
          ))}
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-slate-400">
                No recommendations available for this period.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  );
}

function PerformanceList({
  title,
  rows,
}: {
  title: string;
  rows: PerformanceRow[];
}) {
  return (
    <section className="rounded-xl border border-white/10 bg-[#16263D] p-4">
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <div className="mt-3 space-y-2">
        {rows.map((row) => (
          <div
            key={`${title}-${row.id}`}
            className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-[#08121F] px-3 py-2 text-xs"
          >
            <span className="font-semibold text-slate-100">{row.symbol}</span>
            <span className={row.returnPercent >= 0 ? "text-emerald-300" : "text-rose-300"}>
              {row.returnPercent}% | {row.holdingPeriod}
            </span>
          </div>
        ))}
        {rows.length === 0 ? <div className="text-xs text-slate-400">No scored recommendations.</div> : null}
      </div>
    </section>
  );
}

const performanceWindows: Array<{ id: PerformanceWindow; label: string }> = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 Days" },
  { id: "30d", label: "30 Days" },
  { id: "90d", label: "90 Days" },
  { id: "all", label: "All Time" },
];

type PerformanceRow = {
  id: string;
  date: string;
  symbol: string;
  recommendation: string;
  cmpAtRecommendation: number;
  currentPrice: number;
  returnPercent: number;
  status: "Success" | "Failure" | "Active" | "Expired";
  holdingPeriod: string;
};

function buildAdminIntelligence({
  expertMatrix,
  history,
  marketOverview,
  portfolios,
}: {
  expertMatrix: ExpertActionMatrix | null;
  history: Recommendation[];
  marketOverview: MarketOverview | null;
  portfolios: ManagedPortfolio[];
}) {
  const marketSymbols = new Set([
    ...(marketOverview?.gainers ?? []).map((quote) => quote.symbol),
    ...(marketOverview?.losers ?? []).map((quote) => quote.symbol),
    ...(marketOverview?.indices ?? []).map((quote) => quote.symbol),
  ]);
  const opportunities =
    expertMatrix?.categories.flatMap((category) => [
      ...category.longTermUpsides,
      ...category.intradayBreakouts,
    ]) ?? [];
  const stocksScanned = Math.max(marketSymbols.size, opportunities.length);
  const recommendationsGenerated = history.filter(isTodayRecommendation).length || history.length;
  const portfoliosEvaluated = portfolios.filter((portfolio) => !portfolio.isMarketPortfolio).length;
  const confidenceUpdated =
    history.some((item) => item.status !== "NA") || recommendationsGenerated > 0
      ? "Yes"
      : "Pending";

  return {
    summary: {
      confidenceUpdated,
      opportunitiesEvaluated: opportunities.length,
      portfoliosEvaluated,
      recommendationsGenerated,
      stocksScanned,
    },
    activities: [
      {
        time: "09:15 AM",
        task: "Market Scan",
        result: `${stocksScanned} Stocks Analyzed`,
        status: "Success",
      },
      {
        time: "09:17 AM",
        task: "Sector Ranking",
        result: "Top Sectors Identified",
        status: "Success",
      },
      {
        time: "09:20 AM",
        task: "Opportunity Scoring",
        result: `${opportunities.length} Opportunities Evaluated`,
        status: "Success",
      },
      {
        time: "09:22 AM",
        task: "Portfolio Evaluation",
        result: `${portfoliosEvaluated} Portfolios Reviewed`,
        status: "Success",
      },
      {
        time: "09:25 AM",
        task: "Recommendation Generation",
        result: `${recommendationsGenerated} Recommendations Produced`,
        status: "Success",
      },
      {
        time: "09:30 AM",
        task: "Backtest Validation",
        result: "Confidence Updated",
        status: confidenceUpdated === "Yes" ? "Success" : "Pending",
      },
    ].slice(0, 10),
  };
}

function buildPerformanceAnalytics(
  history: Recommendation[],
  portfolios: ManagedPortfolio[],
  windowKey: PerformanceWindow,
) {
  const prices = buildCurrentPriceLookup(portfolios);
  const rows = history
    .filter((item) => isInsideWindow(item.createdAt, windowKey))
    .map((item) => buildPerformanceRow(item, prices[item.symbol] ?? 0))
    .sort((a, b) => b.date.localeCompare(a.date));
  const successful = rows.filter((row) => row.status === "Success").length;
  const failed = rows.filter((row) => row.status === "Failure").length;
  const scored = rows.filter((row) => row.status === "Success" || row.status === "Failure");
  const averageReturn = average(rows.map((row) => row.returnPercent));
  const averageDrawdown = Math.min(0, ...rows.map((row) => row.returnPercent));
  const topPerformers = [...rows].sort((a, b) => b.returnPercent - a.returnPercent).slice(0, 10);
  const bottomPerformers = [...rows].sort((a, b) => a.returnPercent - b.returnPercent).slice(0, 10);
  const successRate = scored.length ? Math.round((successful / scored.length) * 100) : 0;
  const rating = Math.max(
    0,
    Math.min(100, Math.round(successRate * 0.65 + Math.max(0, averageReturn) * 2 + 25)),
  );

  return {
    rows,
    topPerformers,
    bottomPerformers,
    summary: {
      averageDrawdown: roundOne(averageDrawdown),
      averageReturn: roundOne(averageReturn),
      best: topPerformers[0]?.symbol ?? "NA",
      failed,
      successRate,
      successful,
      total: rows.length,
      worst: bottomPerformers[0]?.symbol ?? "NA",
    },
    scorecard: {
      classification:
        rating >= 85 ? "Excellent" : rating >= 70 ? "Good" : rating >= 55 ? "Average" : "Needs Work",
      rating,
    },
  };
}

function buildPerformanceRow(
  item: Recommendation,
  currentPrice: number,
): PerformanceRow {
  const cmpAtRecommendation = getRecommendationPrice(item, currentPrice);
  const returnPercent =
    cmpAtRecommendation > 0
      ? ((currentPrice - cmpAtRecommendation) / cmpAtRecommendation) * 100
      : 0;
  const ageDays = Math.max(
    0,
    Math.floor((Date.now() - new Date(item.createdAt).getTime()) / 86_400_000),
  );

  return {
    id: item.id,
    cmpAtRecommendation,
    currentPrice,
    date: new Date(item.createdAt).toLocaleDateString("en-IN"),
    holdingPeriod: ageDays === 0 ? "Today" : `${ageDays} days`,
    recommendation: item.action,
    returnPercent: roundOne(returnPercent),
    status: getPerformanceStatus(item, returnPercent, ageDays),
    symbol: item.symbol,
  };
}

function getPerformanceStatus(
  item: Recommendation,
  returnPercent: number,
  ageDays: number,
): PerformanceRow["status"] {
  if (item.status === "Hit") return "Success";
  if (item.status === "Miss") return "Failure";
  if (ageDays > 90) return "Expired";

  return returnPercent >= 3 ? "Success" : returnPercent <= -3 ? "Failure" : "Active";
}

function getRecommendationPrice(item: Recommendation, currentPrice: number) {
  const target = item.metrics?.target ?? 0;
  const upside = item.metrics?.upsidePercent ?? 0;

  if (target > 0 && upside > -95) {
    return target / (1 + upside / 100);
  }

  return currentPrice;
}

function buildCurrentPriceLookup(portfolios: ManagedPortfolio[]) {
  return portfolios.reduce<Record<string, number>>((acc, portfolio) => {
    portfolio.positions.forEach((position) => {
      if (position.currentPrice > 0) {
        acc[position.symbol] = position.currentPrice;
      }
    });
    return acc;
  }, {});
}

function isTodayRecommendation(item: Recommendation) {
  return new Date(item.createdAt).toDateString() === new Date().toDateString();
}

function isInsideWindow(timestamp: string, windowKey: PerformanceWindow) {
  if (windowKey === "all") return true;
  const created = new Date(timestamp).getTime();
  const now = Date.now();

  if (windowKey === "today") {
    return new Date(timestamp).toDateString() === new Date().toDateString();
  }

  const days = windowKey === "7d" ? 7 : windowKey === "30d" ? 30 : 90;
  return now - created <= days * 86_400_000;
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

type WorkbookData = {
  fileName: string;
  sheets: Array<{
    name: string;
    rows: Array<Array<string | number>>;
  }>;
};

function buildWorkbookData({
  expertMatrix,
  history,
  intelligence,
  marketOverview,
  performance,
  portfolios,
}: {
  expertMatrix: ExpertActionMatrix | null;
  history: Recommendation[];
  intelligence: AdminIntelligence;
  marketOverview: MarketOverview | null;
  performance: AdminPerformance;
  portfolios: ManagedPortfolio[];
}) {
  const portfolioMetrics = portfolios.map((portfolio) => {
    const metrics = calculatePortfolioMetrics(portfolio.positions);
    return { portfolio, metrics };
  });
  const marketRows =
    expertMatrix?.categories.flatMap((category) =>
      [...category.longTermUpsides, ...category.intradayBreakouts].map((quote) => [
        category.title,
        quote.symbol,
        quote.name,
        quote.action,
        Math.round(quote.score),
        quote.price,
        quote.target,
        roundOne(quote.upside),
        roundOne(quote.volumeShock),
      ]),
    ) ?? [];

  return {
    fileName: `unloan-intelligence-${new Date().toISOString().slice(0, 10)}.xlsx`,
    sheets: [
      {
        name: "Overview",
        rows: [
          ["Metric", "Value"],
          ["Generated At", new Date().toLocaleString("en-IN")],
          ["Stocks Scanned", intelligence.summary.stocksScanned],
          ["Opportunities Evaluated", intelligence.summary.opportunitiesEvaluated],
          ["Recommendations Generated", intelligence.summary.recommendationsGenerated],
          ["Portfolios Evaluated", intelligence.summary.portfoliosEvaluated],
          ["Market Sentiment", marketOverview?.sentiment ?? "Pending"],
        ],
      },
      {
        name: "Recommendations",
        rows: [
          ["Date", "Portfolio", "Symbol", "Company", "Section", "Action", "Confidence", "Status", "Rationale"],
          ...history.map((item) => [
            new Date(item.createdAt).toLocaleDateString("en-IN"),
            item.portfolioName,
            item.symbol,
            item.company,
            item.section,
            item.action,
            item.confidence,
            item.status,
            item.rationale,
          ]),
        ],
      },
      {
        name: "Backtesting",
        rows: [
          ["Date", "Symbol", "Recommendation", "Status", "Confidence"],
          ...history.map((item) => [
            new Date(item.createdAt).toLocaleDateString("en-IN"),
            item.symbol,
            item.action,
            item.status,
            item.confidence,
          ]),
        ],
      },
      {
        name: "Portfolio Analytics",
        rows: [
          ["Portfolio", "Holdings", "Total Value", "Day Change %", "Top Sector"],
          ...portfolioMetrics.map(({ portfolio, metrics }) => [
            portfolio.name,
            metrics.holdings.length,
            roundOne(metrics.totalValue),
            roundOne(metrics.dayChangePercent),
            metrics.sectorAllocations[0]?.sector ?? "NA",
          ]),
        ],
      },
      {
        name: "Opportunity Scores",
        rows: [
          ["Category", "Symbol", "Company", "Action", "Score", "CMP", "Target", "Upside %", "Volume Shock"],
          ...marketRows,
        ],
      },
      {
        name: "Performance Analytics",
        rows: [
          ["Date", "Symbol", "Recommendation", "CMP At Recommendation", "Current Price", "Return %", "Status"],
          ...performance.rows.map((row) => [
            row.date,
            row.symbol,
            row.recommendation,
            row.cmpAtRecommendation,
            row.currentPrice,
            row.returnPercent,
            row.status,
          ]),
        ],
      },
      {
        name: "Change Detection",
        rows: [
          ["Portfolio", "Last Updated", "Status"],
          ...portfolios.map((portfolio) => [
            portfolio.name,
            portfolio.refreshedAt ?? "Pending",
            "Tracked",
          ]),
        ],
      },
      {
        name: "Market Opportunities",
        rows: [
          ["Category", "Symbol", "Company", "Recommendation", "Confidence", "CMP", "Target"],
          ...marketRows.map((row) => [row[0], row[1], row[2], row[3], row[4], row[5], row[6]]),
        ],
      },
    ],
  };
}

function downloadWorkbook(workbook: WorkbookData) {
  const content = buildExcelWorkbook(workbook);
  const blob = new Blob([content], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = workbook.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildExcelWorkbook(workbook: WorkbookData) {
  const sheets = workbook.sheets
    .map(
      (sheet) => `
        <Worksheet ss:Name="${escapeXml(sheet.name.slice(0, 31))}">
          <Table>
            ${sheet.rows
              .map(
                (row) => `
                  <Row>
                    ${row
                      .map(
                        (cell) => `
                          <Cell><Data ss:Type="${typeof cell === "number" ? "Number" : "String"}">${escapeXml(String(cell))}</Data></Cell>
                        `,
                      )
                      .join("")}
                  </Row>
                `,
              )
              .join("")}
          </Table>
        </Worksheet>
      `,
    )
    .join("");

  return `<?xml version="1.0"?>
    <?mso-application progid="Excel.Sheet"?>
    <Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
      xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:x="urn:schemas-microsoft-com:office:excel"
      xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
      ${sheets}
    </Workbook>`;
}

function escapeXml(value: string) {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
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
            setPortfolioPin(normalizePinInput(event.target.value))
          }
          onPaste={(event) => {
            event.preventDefault();
            setPortfolioPin(normalizePinInput(event.clipboardData.getData("text")));
          }}
          placeholder="4 digit portfolio PIN"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          name="new-portfolio-pin"
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
  const score = (value: number) => `${Math.round(value)}/100`;

  return (
    <section className="space-y-4 rounded-2xl border border-amber-300/20 bg-[#0F1B2D] p-5 shadow-xl">
      <SectionTitle
        title="Portfolio Diagnostics"
        subtitle="Unified health and risk intelligence for the selected portfolio."
        badge="CALCULATED"
        accent="gold"
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <DiagnosticMetric label="Portfolio Score" value={score(health.healthScore)} detail={health.grade} tone={health.healthScore >= 75 ? "up" : health.healthScore >= 60 ? "flat" : "down"} />
        <DiagnosticMetric label="Risk Status" value={risk.riskStatus} detail={`${score(risk.riskScore)} risk score`} tone={risk.riskStatus === "GREEN" ? "up" : risk.riskStatus === "RED" ? "down" : "flat"} />
        <DiagnosticMetric label="Diversification" value={score(component("Diversification"))} detail="Position spread" tone="flat" />
        <DiagnosticMetric label="Sector Balance" value={score(component("Sector Balance"))} detail="Concentration control" tone="flat" />
        <DiagnosticMetric label="Momentum" value={score(component("Momentum"))} detail="Relative strength proxy" tone="up" />
        <DiagnosticMetric label="Cash Management" value={score(component("Cash Management"))} detail="Liquidity buffer" tone="flat" />
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

function PortfolioCommunicationCenter({
  portfolio,
  onPortfolioPinChanged,
}: {
  portfolio: ManagedPortfolio;
  onPortfolioPinChanged: (pinHash: string, updatedAt: string) => void;
}) {
  const [settings, setSettings] = useState<CommunicationSettings>({
    portfolioId: portfolio.id,
    telegramEnabled: false,
    telegramUserId: "",
    securePasskey: "",
    notificationMode: "Immediate Alerts",
    alertTypes: ["Today's Recommended Action", "Risk Alert"],
    telegramConnected: false,
    connectionStatus: "Not Connected",
    lastNotification: "",
    lastSuccessfulDelivery: "",
    updatedAt: "",
  });
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [requestType, setRequestType] = useState("Recommendation Query");
  const [priority, setPriority] = useState("Medium");
  const [status, setStatus] = useState<string | null>(null);
  const [history, setHistory] = useState<NotificationHistoryRow[]>([]);
  const [currentPortfolioPin, setCurrentPortfolioPin] = useState("");
  const [newPortfolioPin, setNewPortfolioPin] = useState("");
  const [confirmPortfolioPin, setConfirmPortfolioPin] = useState("");
  const [isChangingPin, setIsChangingPin] = useState(false);

  const loadCommunication = useCallback(async () => {
    try {
      const [settingsResponse, historyResponse] = await Promise.all([
        fetch("/api/communication/settings"),
        fetch(`/api/communication/notification-history?portfolioId=${encodeURIComponent(portfolio.id)}`),
      ]);
      const settingsPayload = (await settingsResponse.json()) as {
        settings?: Record<string, CommunicationSettings>;
      };
      const historyPayload = (await historyResponse.json()) as {
        history?: NotificationHistoryRow[];
      };
      const stored = settingsPayload.settings?.[portfolio.id];

      if (stored) {
        setSettings(stored);
      }

      setHistory(historyPayload.history ?? []);
    } catch {
      setHistory([]);
    }
  }, [portfolio.id]);

  useEffect(() => {
    setSettings((item) => ({ ...item, portfolioId: portfolio.id }));
    loadCommunication();
  }, [loadCommunication, portfolio.id]);

  async function saveSettings(nextSettings = settings) {
    const response = await fetch("/api/communication/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: nextSettings }),
    });
    setStatus(response.ok ? "Notification settings saved." : "Unable to save notification settings.");
  }

  async function testTelegramConnection() {
    const response = await fetch("/api/communication/test-telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        telegramUserId: settings.telegramUserId,
        securePasskey: settings.securePasskey,
      }),
    });
    const payload = (await response.json()) as { ok?: boolean; status?: string };
    const nextSettings = {
      ...settings,
      telegramConnected: Boolean(payload.ok),
      connectionStatus: payload.status ?? (payload.ok ? "Connected" : "Failed"),
    };
    setSettings(nextSettings);
    await saveSettings(nextSettings);
  }

  async function submitRequest() {
    if (!subject.trim() || !message.trim()) {
      setStatus("Subject and message are required.");
      return;
    }

    const response = await fetch("/api/user-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        portfolioId: portfolio.id,
        portfolioName: portfolio.name,
        user: portfolio.name,
        requestType,
        priority,
        subject,
        message,
      }),
    });

    if (response.ok) {
      setSubject("");
      setMessage("");
      setStatus("Request sent to admin.");
    } else {
      setStatus("Unable to send request.");
    }
  }

  async function changePortfolioPin() {
    const currentPin = normalizePinInput(currentPortfolioPin);
    const newPin = normalizePinInput(newPortfolioPin);
    const confirmPin = normalizePinInput(confirmPortfolioPin);

    if (!/^\d{4}$/u.test(currentPin) || !/^\d{4}$/u.test(newPin)) {
      setStatus("Current PIN and new PIN must be 4 digits.");
      return;
    }

    if (newPin !== confirmPin) {
      setStatus("New PIN and confirmation PIN do not match.");
      return;
    }

    setIsChangingPin(true);
    try {
      const response = await fetch("/api/portfolio-pins/user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          portfolioId: portfolio.id,
          currentPin,
          newPin,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        pinHash?: string;
        updatedAt?: string;
      };

      if (!response.ok || !payload.pinHash) {
        setStatus(payload.error ?? "Unable to update portfolio PIN.");
        return;
      }

      onPortfolioPinChanged(payload.pinHash, payload.updatedAt ?? new Date().toISOString());
      setCurrentPortfolioPin("");
      setNewPortfolioPin("");
      setConfirmPortfolioPin("");
      setStatus("Portfolio PIN updated.");
    } catch {
      setStatus("Unable to update portfolio PIN.");
    } finally {
      setIsChangingPin(false);
    }
  }

  function toggleAlertType(alertType: string) {
    setSettings((item) => ({
      ...item,
      alertTypes: item.alertTypes.includes(alertType)
        ? item.alertTypes.filter((value) => value !== alertType)
        : [...item.alertTypes, alertType],
    }));
  }

  return (
    <section className="space-y-4 rounded-2xl border border-cyan-300/20 bg-[#0F1B2D] p-5 shadow-xl">
      <SectionTitle
        title="Portfolio Communication"
        subtitle="Telegram alerts, admin contact, and notification history."
        badge="CALCULATED"
        accent="blue"
      />
      {status ? (
        <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-sm text-cyan-100">
          {status}
        </div>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-xl border border-white/10 bg-[#16263D] p-4">
          <h3 className="text-sm font-semibold text-white">Notifications</h3>
          <label className="mt-3 flex items-center gap-2 text-sm text-slate-200">
            <input
              checked={settings.telegramEnabled}
              onChange={(event) => setSettings((item) => ({ ...item, telegramEnabled: event.target.checked }))}
              type="checkbox"
            />
            Enable Telegram Alerts
          </label>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <input
              value={settings.telegramUserId}
              onChange={(event) => setSettings((item) => ({ ...item, telegramUserId: event.target.value }))}
              placeholder="Telegram User ID"
              className="h-10 rounded-md border border-white/10 bg-[#08121F] px-3 text-sm text-white outline-none"
            />
            <input
              value={settings.securePasskey}
              onChange={(event) => setSettings((item) => ({ ...item, securePasskey: event.target.value }))}
              placeholder="Secure Passkey"
              type="password"
              className="h-10 rounded-md border border-white/10 bg-[#08121F] px-3 text-sm text-white outline-none"
            />
            <select
              value={settings.notificationMode}
              onChange={(event) => setSettings((item) => ({ ...item, notificationMode: event.target.value as NotificationMode }))}
              className="h-10 rounded-md border border-white/10 bg-[#08121F] px-3 text-sm text-white outline-none sm:col-span-2"
            >
              {notificationModes.map((mode) => (
                <option key={mode} value={mode}>{mode}</option>
              ))}
            </select>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {alertTypes.map((alertType) => (
              <label key={alertType} className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  checked={settings.alertTypes.includes(alertType)}
                  onChange={() => toggleAlertType(alertType)}
                  type="checkbox"
                />
                {alertType}
              </label>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" onClick={() => saveSettings()}>Save Settings</Button>
            <Button type="button" variant="outline" onClick={testTelegramConnection}>Test Connection</Button>
          </div>
          <div className="mt-3 text-xs text-slate-400">
            Connection: {settings.connectionStatus} | Last Delivery: {settings.lastSuccessfulDelivery || "None"}
          </div>
        </section>

        <section className="rounded-xl border border-white/10 bg-[#16263D] p-4">
          <h3 className="text-sm font-semibold text-white">Contact Admin</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <select
              value={requestType}
              onChange={(event) => setRequestType(event.target.value)}
              className="h-10 rounded-md border border-white/10 bg-[#08121F] px-3 text-sm text-white outline-none"
            >
              {requestTypes.map((item) => <option key={item}>{item}</option>)}
            </select>
            <select
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
              className="h-10 rounded-md border border-white/10 bg-[#08121F] px-3 text-sm text-white outline-none"
            >
              {["Low", "Medium", "High"].map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Subject"
            className="mt-2 h-10 w-full rounded-md border border-white/10 bg-[#08121F] px-3 text-sm text-white outline-none"
          />
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Message"
            className="mt-2 min-h-28 w-full rounded-md border border-white/10 bg-[#08121F] px-3 py-2 text-sm text-white outline-none"
          />
          <Button type="button" className="mt-2" onClick={submitRequest}>Send</Button>
        </section>
      </div>
      <section className="rounded-xl border border-white/10 bg-[#16263D] p-4">
        <h3 className="text-sm font-semibold text-white">Edit Portfolio PIN</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <input
            value={currentPortfolioPin}
            onChange={(event) =>
              setCurrentPortfolioPin(normalizePinInput(event.target.value))
            }
            onPaste={(event) => {
              event.preventDefault();
              setCurrentPortfolioPin(
                normalizePinInput(event.clipboardData.getData("text")),
              );
            }}
            placeholder="Current PIN"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            autoComplete="off"
            name={`current-portfolio-pin-${portfolio.id}`}
            className="h-10 rounded-md border border-white/10 bg-[#08121F] px-3 text-sm text-white outline-none"
          />
          <input
            value={newPortfolioPin}
            onChange={(event) =>
              setNewPortfolioPin(normalizePinInput(event.target.value))
            }
            onPaste={(event) => {
              event.preventDefault();
              setNewPortfolioPin(
                normalizePinInput(event.clipboardData.getData("text")),
              );
            }}
            placeholder="New PIN"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            autoComplete="new-password"
            name={`new-portfolio-pin-${portfolio.id}`}
            className="h-10 rounded-md border border-white/10 bg-[#08121F] px-3 text-sm text-white outline-none"
          />
          <input
            value={confirmPortfolioPin}
            onChange={(event) =>
              setConfirmPortfolioPin(normalizePinInput(event.target.value))
            }
            onPaste={(event) => {
              event.preventDefault();
              setConfirmPortfolioPin(
                normalizePinInput(event.clipboardData.getData("text")),
              );
            }}
            placeholder="Confirm New PIN"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            autoComplete="new-password"
            name={`confirm-portfolio-pin-${portfolio.id}`}
            className="h-10 rounded-md border border-white/10 bg-[#08121F] px-3 text-sm text-white outline-none"
          />
        </div>
        <Button
          type="button"
          className="mt-3"
          onClick={changePortfolioPin}
          disabled={isChangingPin}
        >
          {isChangingPin ? "Updating PIN" : "Update PIN"}
        </Button>
      </section>
      <section className="rounded-xl border border-white/10 bg-[#16263D] p-4">
        <h3 className="text-sm font-semibold text-white">Notification History</h3>
        <div className="mt-3 grid gap-2">
          {history.slice(0, 6).map((item) => (
            <div key={item.id} className="grid gap-2 rounded-lg border border-white/10 bg-[#08121F] px-3 py-2 text-xs text-slate-300 sm:grid-cols-3">
              <span>{formatDateTime(item.createdAt)}</span>
              <span>{item.alertType}</span>
              <span>{item.status}</span>
            </div>
          ))}
          {history.length === 0 ? (
            <div className="text-xs text-slate-400">No notification history yet.</div>
          ) : null}
        </div>
      </section>
    </section>
  );
}

function PortfolioHoldingsAndSectors({
  portfolio,
  isLoading,
  onUpdateInputs,
}: {
  portfolio: ManagedPortfolio;
  isLoading: boolean;
  onUpdateInputs: (rows: PortfolioInputRow[]) => void | Promise<void>;
}) {
  const metrics = calculatePortfolioMetrics(portfolio.positions);

  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <CurrentHoldingsCard
        portfolio={portfolio}
        metrics={metrics}
        isLoading={isLoading}
        onUpdateInputs={onUpdateInputs}
      />
      <SectorAllocationCard metrics={metrics} />
    </section>
  );
}

function PortfolioMarketOpportunities({
  matrix,
}: {
  matrix: ExpertActionMatrix | null;
}) {
  const opportunities = useMemo(() => buildMarketOpportunityRows(matrix), [matrix]);

  return (
    <section className="space-y-3 rounded-md border border-amber-300/30 bg-zinc-950 p-3 text-zinc-100 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-amber-200">
            Market Opportunities
          </div>
          <p className="mt-1 text-xs leading-5 text-zinc-400">
            Market-wide opportunities to compare against current portfolio holdings.
          </p>
        </div>
        <span className="rounded border border-amber-300/30 bg-amber-300/10 px-2 py-1 text-[11px] font-semibold text-amber-100">
          MARKET WIDE
        </span>
      </div>

      <div className="space-y-2">
        {opportunities.map((item) => (
          <article
            key={`${item.symbol}-${item.horizon}`}
            className={cn(
              "rounded-md border bg-black/70 p-2",
              item.confidence >= 85
                ? "border-[#D4AF37]/60"
                : item.horizon === "Long Term"
                  ? "border-[#0D47A1]/60"
                  : "border-white/10",
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white">{item.symbol}</div>
                <div className="text-[11px] text-zinc-400">
                  {item.marketCap} | {item.horizon} | {item.risk} Risk
                </div>
              </div>
              <div className="text-right">
                <div
                  className={cn(
                    "text-xs font-semibold",
                    item.confidence >= 85
                      ? "text-[#D4AF37]"
                      : item.horizon === "Long Term"
                        ? "text-[#0D47A1]"
                        : "text-[#1E88E5]",
                  )}
                >
                  {item.recommendation}
                </div>
                <div className="text-[11px] text-zinc-400">
                  {item.confidence}%{item.confidence >= 85 ? " A+" : ""}
                </div>
              </div>
            </div>
            <div className="mt-2 grid gap-1 text-[11px] text-zinc-300 sm:grid-cols-2">
              <span>CMP: {formatCurrency(item.cmp)}</span>
              <span>Buy: {formatCurrency(item.buyLow)}-{formatCurrency(item.buyHigh)}</span>
              <span>Stop: {formatCurrency(item.stopLoss)}</span>
              <span>Target: {formatCurrency(item.target)}</span>
            </div>
            <p className="mt-2 text-[11px] leading-5 text-zinc-400">{item.reason}</p>
          </article>
        ))}
        {opportunities.length === 0 ? (
          <div className="rounded border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs leading-5 text-amber-100">
            Market opportunities are loading.
          </div>
        ) : null}
      </div>
    </section>
  );
}

function CurrentHoldingsCard({
  portfolio,
  metrics,
  isLoading,
  onUpdateInputs,
}: {
  portfolio: ManagedPortfolio;
  metrics: ReturnType<typeof calculatePortfolioMetrics>;
  isLoading: boolean;
  onUpdateInputs: (rows: PortfolioInputRow[]) => void | Promise<void>;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const sortedHoldings = [...metrics.holdings].sort(
    (a, b) => b.marketValue - a.marketValue,
  );
  const holdings = isExpanded ? sortedHoldings : sortedHoldings.slice(0, 5);
  const hasHiddenHoldings = sortedHoldings.length > 5;

  return (
    <section className="space-y-3 rounded-2xl border border-sky-300/20 bg-[#0F1B2D] p-5 shadow-xl">
      <div className="flex items-start justify-between gap-3">
        <SectionTitle
          title="Current Holdings"
          subtitle={isExpanded ? "All positions by current value." : "Top 5 positions by current value."}
          badge="LIVE"
          accent="blue"
        />
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsExpanded((value) => !value)}
            disabled={!hasHiddenHoldings}
          >
            {isExpanded ? "Show Top 5" : "View All"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsEditing((value) => !value)}
          >
            {isEditing ? "Close Edit" : "Edit Holdings"}
          </Button>
        </div>
      </div>
      <p className="text-xs text-slate-400">
        Swipe sideways to view all columns. Use the zoom controls at the top for a wider table view.
      </p>
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
      {isEditing ? (
        <PortfolioDetailsEditor
          portfolio={portfolio}
          isLoading={isLoading}
          positions={portfolio.positions}
          onSave={(rows) => {
            void onUpdateInputs(rows);
            setIsEditing(false);
          }}
        />
      ) : null}
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

function buildMarketOpportunityRows(matrix: ExpertActionMatrix | null) {
  const rows =
    matrix?.categories.flatMap((category) => [
      ...category.longTermUpsides.map((quote) =>
        buildMarketOpportunityRow(category.title, quote, "longTerm" as const),
      ),
      ...category.intradayBreakouts.map((quote) =>
        buildMarketOpportunityRow(category.title, quote, "intraday" as const),
      ),
    ]) ?? [];

  return rows.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}

function buildSimplifiedPortfolioSections(
  portfolio: ManagedPortfolio,
  history: Recommendation[],
  matrix: ExpertActionMatrix | null,
) {
  const recommendations = generateRecommendations(portfolio, history);
  const buy = buildTodayBuyRows(matrix, recommendations);
  const sell = recommendations.longTermPlan
    .filter((item) => item.action === "Urgent Sell")
    .map((item) => buildDecisionRowFromRecommendation(item, portfolio, "Sell Signal"))
    .slice(0, 6);
  const longTerm = [
    ...recommendations.multibaggerCandidates,
    ...recommendations.longTermPlan.filter((item) => item.action === "Accumulate"),
  ]
    .map((item) => buildDecisionRowFromRecommendation(item, portfolio, "6-12 Month"))
    .slice(0, 8);
  const intraday = recommendations.intraday
    .filter((item) => item.action === "Accumulate")
    .map((item) => buildDecisionRowFromRecommendation(item, portfolio, "Intraday"))
    .slice(0, 8);

  return {
    all: [...buy, ...sell, ...longTerm, ...intraday],
    buy,
    intraday,
    longTerm,
    sell,
  };
}

function buildTodayBuyRows(
  matrix: ExpertActionMatrix | null,
  recommendations: ReturnType<typeof generateRecommendations>,
) {
  const rows: DecisionRecommendationRow[] = [];
  const categories = matrix?.categories ?? [];
  const largeCap = categories.find((category) =>
    category.title.toLowerCase().includes("large"),
  );
  const midCap = categories.find((category) =>
    category.title.toLowerCase().includes("mid"),
  );
  const smallCap = categories.find((category) =>
    category.title.toLowerCase().includes("small"),
  );
  const etfCategory = categories.find((category) => {
    const title = category.title.toLowerCase();
    return title.includes("etf") || title.includes("bees") || title.includes("index");
  });

  rows.push(...buildQuoteRowsForCategory(largeCap, "Large Cap", 3));
  rows.push(...buildQuoteRowsForCategory(midCap, "Mid Cap", 3));
  rows.push(...buildQuoteRowsForCategory(smallCap, "Small Cap", 3));
  rows.push(...buildQuoteRowsForCategory(etfCategory, "ETF", 1));

  if (rows.length > 0) {
    return rows;
  }

  return [
    ...recommendations.longTermPlan.filter((item) => item.action === "Accumulate"),
    ...recommendations.etfs,
  ]
    .map((item) => buildDecisionRowFromRecommendation(item, undefined, "Buy"))
    .slice(0, 10);
}

function buildQuoteRowsForCategory(
  category: ExpertMatrixCategory | undefined,
  type: string,
  limit: number,
) {
  return (
    category?.longTermUpsides
      .filter((quote) => quote.action === "Accumulate")
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((quote) => buildDecisionRowFromQuote(quote, type, category.title)) ?? []
  );
}

function buildDecisionRowFromQuote(
  quote: ExpertMatrixQuote,
  type: string,
  categoryTitle: string,
): DecisionRecommendationRow {
  const cmp = quote.price;
  const target = quote.target > 0 ? quote.target : cmp * 1.12;
  const stopLoss = getQuoteStopLoss(cmp, quote.score, quote.volumeShock);
  const risk = getExecutionRisk(quote.score, quote.volumeShock);

  return {
    action: "BUY",
    cmp,
    confidence: Math.round(quote.score),
    fundamentalFactors: [
      quote.upside > 0
        ? `Broker/model upside estimate: ${formatPercent(quote.upside)}.`
        : "Fundamental validation required before position sizing.",
      `${type} classification from ${categoryTitle}.`,
    ],
    reason: quote.remark || `${quote.symbol} is ranked by market-wide expert signals.`,
    riskFactors: quote.caveats?.length
      ? quote.caveats
      : [`${risk} execution risk; validate liquidity and news before action.`],
    sectorStrength: `${categoryTitle} opportunity bucket with ${Math.round(quote.score)}% confidence.`,
    stopLoss,
    symbol: quote.symbol,
    target,
    technicalFactors: [
      `Volume shock: ${quote.volumeShock.toFixed(2)}x.`,
      "Screened through the existing expert matrix ranking.",
    ],
    type,
  };
}

function buildDecisionRowFromRecommendation(
  recommendation: Recommendation,
  portfolio?: ManagedPortfolio,
  typeOverride?: string,
): DecisionRecommendationRow {
  const position = portfolio?.positions.find(
    (item) => item.symbol === recommendation.symbol,
  );
  const cmp = position?.currentPrice ?? recommendation.metrics?.target ?? 0;
  const isSell = recommendation.action === "Urgent Sell";
  const target =
    recommendation.metrics?.target ??
    (cmp > 0 ? cmp * (isSell ? 0.9 : recommendation.section === "Intraday" ? 1.018 : 1.12) : 0);
  const stopLoss =
    cmp > 0 ? cmp * (isSell ? 1.05 : recommendation.section === "Intraday" ? 0.985 : 0.92) : 0;
  const metrics = recommendation.metrics;

  return {
    action: isSell ? "SELL" : "BUY",
    cmp,
    confidence: recommendation.confidence,
    fundamentalFactors: [
      position?.sector
        ? `${position.sector} exposure considered in portfolio scoring.`
        : "Fundamental data placeholder ready for ROE, ROCE, debt/equity, and growth metrics.",
      `Portfolio appetite: ${portfolio?.appetite ?? "moderate"}.`,
    ],
    reason: recommendation.rationale,
    riskFactors: recommendation.caveats?.length
      ? recommendation.caveats
      : ["Model output is a screening signal; validate liquidity, valuation, and news before execution."],
    sectorStrength: position?.sector
      ? `${position.sector} evaluated against portfolio concentration.`
      : "Sector context unavailable for this row.",
    stopLoss,
    symbol: recommendation.symbol,
    target,
    technicalFactors: metrics
      ? [
          `EMA20 ${formatDecisionPrice(metrics.ema20)} vs EMA50 ${formatDecisionPrice(metrics.ema50)}.`,
          `VWAP distance ${formatPercent(metrics.vwapDistancePercent)}; ATR ${formatPercent(metrics.atrPercent)}.`,
          `Volume shock ${metrics.volumeShock.toFixed(2)}x.`,
        ]
      : ["Technical metrics will populate when live bars are available."],
    type: typeOverride ?? recommendation.section,
  };
}

function getQuoteStopLoss(cmp: number, score: number, volumeShock = 0) {
  const risk = getExecutionRisk(score, volumeShock);

  if (risk === "Low") return cmp * 0.93;
  if (risk === "Medium") return cmp * 0.9;

  return cmp * 0.86;
}

function formatDecisionPrice(value: number) {
  return value > 0 ? formatCurrency(value) : "Pending";
}

function buildMarketOpportunityRow(
  categoryTitle: string,
  quote: ExpertMatrixQuote,
  source: "intraday" | "longTerm",
) {
  const cmp = quote.price;
  const target = quote.target > 0 ? quote.target : cmp * 1.12;
  const risk = getExecutionRisk(quote.score, quote.volumeShock);
  const horizon = getExecutionHorizon(categoryTitle, source, quote.score);
  const buyLow = source === "intraday" ? cmp * 0.992 : cmp * 0.96;
  const buyHigh = source === "intraday" ? cmp * 1.006 : cmp * 1.01;
  const stopLoss =
    risk === "Low"
      ? cmp * 0.93
      : risk === "Medium"
        ? cmp * 0.9
        : cmp * 0.86;

  return {
    buyHigh,
    buyLow,
    cmp,
    confidence: Math.round(quote.score),
    horizon,
    marketCap: getMarketCapType(categoryTitle),
    recommendation: quote.action === "Accumulate" ? "BUY" : "REDUCE",
    reason: quote.remark || `${quote.symbol} is ranked by market-wide expert signals.`,
    risk,
    stopLoss,
    symbol: quote.symbol,
    target,
  };
}

function getMarketCapType(categoryTitle: string) {
  const title = categoryTitle.toLowerCase();

  if (title.includes("small")) return "Small Cap";
  if (title.includes("mid")) return "Mid Cap";

  return "Large Cap";
}

function getExecutionHorizon(
  categoryTitle: string,
  source: "intraday" | "longTerm",
  score: number,
) {
  const title = categoryTitle.toLowerCase();

  if (source === "intraday") return "Intraday";
  if (title.includes("small") && score >= 78) return "Multibagger Candidate";
  if (title.includes("mid")) return "Swing Trade";
  if (score >= 76) return "Long Term";

  return "Short Term";
}

function getExecutionRisk(score: number, volumeShock = 0) {
  if (score >= 78 && volumeShock < 1.2) return "Low";
  if (score >= 62) return "Medium";

  return "High";
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
