"use client";

import Papa from "papaparse";
import { BookOpen, FileUp, Lock, LockKeyhole, Map, Plus, Shield, Sparkles, Trash2, TrendingUp, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { MarketOverviewCollapsible } from "@/components/market-overview-collapsible";
import { PortfolioHub } from "@/components/portfolio-hub";
import { Button } from "@/components/ui/button";
import type { MarketOverview } from "@/lib/decision-intelligence";
import {
  hashPortfolioPin,
  masterRecoveryPin,
  normalizePinInput,
  validatePortfolioPin,
} from "@/lib/portfolio-pin";
import {
  buildPortfolioInputRow,
  type InvestmentAppetite,
  type ManagedPortfolio,
  type PortfolioInputRow,
  type PortfolioPosition,
  samplePortfolio,
} from "@/lib/portfolio";
import { cn } from "@/lib/utils";

type ExpertMatrixQuote = {
  symbol: string;
  name: string;
  score: number;
  action: "Accumulate" | "Urgent Sell";
};

type ExpertActionMatrix = {
  asOf: string;
  categories: Array<{
    title: string;
    longTermUpsides: ExpertMatrixQuote[];
    intradayBreakouts: ExpertMatrixQuote[];
  }>;
};

type PublicPortfolioCsvRow = {
  "stock code"?: string;
  stockCode?: string;
  symbol?: string;
  ticker?: string;
  code?: string;
  stock?: string;
  company?: string;
  name?: string;
  quantity?: string;
  qty?: string;
  "avg buy price"?: string;
  "buy price"?: string;
  avgBuyPrice?: string;
  buyPrice?: string;
  purchasePrice?: string;
};

const portfoliosStorageKey = "multibagger-portfolios";
const pinStorageKey = "unloan-portfolio-pin-hashes";
const unlockedPortfolioStorageKey = "unloan-unlocked-portfolio";
const publicPortfolioContactStorageKey = "unloan-public-portfolio-contact";

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

const glossaryItems = [
  ["Fear & Greed", "A calculated sentiment gauge for market participation and risk appetite."],
  ["India VIX", "A volatility proxy; higher readings favor tighter risk management."],
  ["News Shock", "A calculated signal that highlights unusual market movement pressure."],
  ["Market Breadth", "Advancers versus decliners; shows whether the market move is broad."],
  ["Top Focus Sectors", "Sectors inferred from leading movers and index context."],
  ["Market Opportunities", "Aggregated expert/market signals without exposing portfolio ownership."],
];

export function PublicMarketPortal() {
  const router = useRouter();
  const [market, setMarket] = useState<MarketOverview | null>(null);
  const [expertMatrix, setExpertMatrix] = useState<ExpertActionMatrix | null>(null);
  const [portfolios, setPortfolios] = useState<ManagedPortfolio[]>([samplePortfolio]);
  const [pinHashes, setPinHashes] = useState<Record<string, string>>({});
  const [pinChallengePortfolio, setPinChallengePortfolio] =
    useState<ManagedPortfolio | null>(null);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [isMarketLoading, setIsMarketLoading] = useState(false);
  const [isAdminLoginOpen, setIsAdminLoginOpen] = useState(false);
  const [adminUsername, setAdminUsername] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminError, setAdminError] = useState("");
  const [isAdminLoading, setIsAdminLoading] = useState(false);
  const [isAddPortfolioOpen, setIsAddPortfolioOpen] = useState(false);
  const [isCreatingPortfolio, setIsCreatingPortfolio] = useState(false);
  const [addPortfolioError, setAddPortfolioError] = useState<string | null>(null);
  const [portfolioName, setPortfolioName] = useState("");
  const [portfolioPin, setPortfolioPin] = useState("");
  const [investmentAppetite, setInvestmentAppetite] =
    useState<InvestmentAppetite>("moderate");
  const [draftRows, setDraftRows] = useState<PortfolioInputRow[]>([
    buildPortfolioInputRow({}),
  ]);
  const [telegramUserId, setTelegramUserId] = useState("");
  const [telegramPasskey, setTelegramPasskey] = useState("");
  const [emailAddress, setEmailAddress] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function refreshMarket() {
    setIsMarketLoading(true);
    try {
      const response = await fetch("/api/market");
      if (response.ok) {
        setMarket((await response.json()) as MarketOverview);
      }
    } finally {
      setIsMarketLoading(false);
    }
  }

  useEffect(() => {
    refreshMarket();
    hydratePortfolios();
    fetch("/api/expert-action-matrix")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => setExpertMatrix(payload as ExpertActionMatrix | null))
      .catch(() => setExpertMatrix(null));
  }, []);

  async function hydratePortfolios() {
    const savedPins = window.localStorage.getItem(pinStorageKey);

    if (savedPins) {
      setPinHashes(JSON.parse(savedPins) as Record<string, string>);
    }

    try {
      const response = await fetch("/api/portfolios");
      const payload = (await response.json()) as {
        configured?: boolean;
        portfolios?: ManagedPortfolio[];
      };

      if (response.ok && payload.configured && payload.portfolios?.length) {
        setPortfolios(filterHomepagePortfolios(payload.portfolios));
        return;
      }
    } catch {
      // Fall back to browser cache below.
    }

    const savedPortfolios = window.localStorage.getItem(portfoliosStorageKey);

    if (savedPortfolios) {
      setPortfolios(filterHomepagePortfolios(JSON.parse(savedPortfolios) as ManagedPortfolio[]));
    }
  }

  async function unlockPortfolio() {
    if (!pinChallengePortfolio) {
      return;
    }

    const normalizedPin = normalizePinInput(pinInput);
    const savedHash = pinHashes[pinChallengePortfolio.id];
    const serverResult = await validatePortfolioPinWithServer(
      pinChallengePortfolio.id,
      pinInput,
    );
    const portfolioPinResult =
      serverResult ??
      (await validatePortfolioPin({
        enteredPin: pinInput,
        portfolioId: pinChallengePortfolio.id,
        portfolioName: pinChallengePortfolio.name,
        storedHash: savedHash,
      }));
    const enteredMasterPin = normalizedPin === masterRecoveryPin;
    const enteredPortfolioPin = portfolioPinResult.pinMatch;

    console.log("[PIN DEBUG] Public Mobile Fallback", {
      portfolioId: pinChallengePortfolio.id,
      portfolioName: pinChallengePortfolio.name,
      hasStoredHash: "hasStoredHash" in portfolioPinResult ? portfolioPinResult.hasStoredHash : Boolean(savedHash),
      normalizedPin,
      masterPinMatch: enteredMasterPin,
      portfolioPinMatch: portfolioPinResult.pinMatch,
      authenticationResult: enteredPortfolioPin,
    });

    if (!enteredPortfolioPin) {
      setPinError("Access denied. Enter the portfolio PIN.");
      return;
    }

    window.sessionStorage.setItem(
      unlockedPortfolioStorageKey,
      pinChallengePortfolio.id,
    );
    router.push(`/portfolio/${encodeURIComponent(pinChallengePortfolio.id)}`);
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
      // Fall back to local hash validation below.
    }

    return null;
  }

  function updateDraftRow(index: number, nextRow: Partial<PortfolioInputRow>) {
    setDraftRows((rows) =>
      rows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...nextRow } : row,
      ),
    );
  }

  function addDraftRow() {
    setDraftRows((rows) => [...rows, buildPortfolioInputRow({})]);
  }

  function removeDraftRow(index: number) {
    setDraftRows((rows) =>
      rows.length === 1 ? rows : rows.filter((_, rowIndex) => rowIndex !== index),
    );
  }

  function parseCsvRows(file: File) {
    Papa.parse<PublicPortfolioCsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const rows = result.data
          .map((row) =>
            buildPortfolioInputRow({
              stockCode: getCsvValue(row, ["stock code", "stockCode", "symbol", "ticker", "code", "stock"]),
              company: getCsvValue(row, ["company", "name"]),
              quantity: Number(getCsvValue(row, ["quantity", "qty"])),
              buyPrice: Number(getCsvValue(row, ["avg buy price", "buy price", "avgBuyPrice", "buyPrice", "purchasePrice"])),
            }),
          )
          .filter((row) => row.stockCode || row.company);

        if (rows.length > 0) {
          setDraftRows(rows);
          setAddPortfolioError(null);
        } else {
          setAddPortfolioError("CSV should include stock code, company, and quantity columns.");
        }
      },
      error: () => setAddPortfolioError("Unable to read CSV file."),
    });
  }

  async function fetchQuotePositions(rows: PortfolioInputRow[]) {
    const response = await fetch("/api/quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
  }

  async function createPortfolio() {
    const cleanName = portfolioName.trim();
    const cleanPin = normalizePinInput(portfolioPin);
    const cleanRows = normalizePublicPortfolioRows(draftRows);

    setAddPortfolioError(null);

    if (!cleanName) {
      setAddPortfolioError("Add a portfolio name.");
      return;
    }

    if (!/^\d{4}$/u.test(cleanPin)) {
      setAddPortfolioError("Set a 4 digit portfolio PIN.");
      return;
    }

    if (cleanRows.length === 0) {
      setAddPortfolioError("Add at least one stock or upload a valid CSV.");
      return;
    }

    setIsCreatingPortfolio(true);

    try {
      const id = `portfolio-${Date.now()}-${cleanName
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, "-")
        .replace(/^-|-$/gu, "")
        .slice(0, 32) || "new"}`;
      const positions = await fetchQuotePositions(cleanRows);
      const portfolio: ManagedPortfolio = {
        id,
        name: cleanName,
        appetite: investmentAppetite,
        inputs: cleanRows,
        positions,
        refreshedAt: new Date().toISOString(),
      };
      const pinHash = await hashPortfolioPin(id, cleanPin);
      const nextPortfolios = filterHomepagePortfolios([
        ...portfolios.filter((item) => item.id !== id),
        portfolio,
      ]);
      const nextPins = { ...pinHashes, [id]: pinHash };

      setPortfolios(nextPortfolios);
      setPinHashes(nextPins);
      window.localStorage.setItem(portfoliosStorageKey, JSON.stringify(nextPortfolios));
      window.localStorage.setItem(pinStorageKey, JSON.stringify(nextPins));
      window.localStorage.setItem(
        `${publicPortfolioContactStorageKey}-${id}`,
        JSON.stringify({
          emailAddress: emailAddress.trim(),
          telegramPasskey: telegramPasskey.trim(),
          telegramUserId: telegramUserId.trim(),
        }),
      );

      await Promise.allSettled([
        fetch("/api/portfolios", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ portfolio }),
        }),
        fetch("/api/portfolio-pins", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ portfolioId: id, pinHash }),
        }),
      ]);

      setPortfolioName("");
      setPortfolioPin("");
      setInvestmentAppetite("moderate");
      setDraftRows([buildPortfolioInputRow({})]);
      setTelegramUserId("");
      setTelegramPasskey("");
      setEmailAddress("");
      setIsAddPortfolioOpen(false);
    } catch (error) {
      setAddPortfolioError(error instanceof Error ? error.message : "Unable to create portfolio.");
    } finally {
      setIsCreatingPortfolio(false);
    }
  }

  async function loginAdmin() {
    setIsAdminLoading(true);
    setAdminError("");

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: adminUsername,
        password: adminPassword,
      }),
    });

    if (!response.ok) {
      setAdminError("Invalid username or password.");
      setIsAdminLoading(false);
      return;
    }

    router.push("/admin");
  }

  return (
    <main className="min-h-screen bg-background">
      <section className="mx-auto flex w-full max-w-[1680px] flex-col gap-7 px-4 py-6 sm:px-6 lg:px-8">
        <header className="terminal-panel flex flex-col gap-5 rounded-2xl border border-sky-400/20 px-5 py-5 shadow-[0_24px_80px_rgba(0,0,0,0.34)] lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <Image src="/unloan-logo.png" alt="UNLOAN" width={118} height={78} className="object-contain" priority />
            <div className="space-y-2">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#1E88E5]">UNLOAN</p>
              <h1 className="text-3xl font-semibold tracking-normal text-white sm:text-4xl">
                UNLOAN
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-slate-300">
                Build Wealth. Reduce Debt. Create Freedom.
              </p>
            </div>
          </div>
          <nav className="flex flex-wrap items-center gap-2">
            <HeaderLink href="/">Home</HeaderLink>
            <Button type="button" variant="outline" onClick={() => setIsAdminLoginOpen(true)}>
              <Shield className="h-4 w-4" aria-hidden="true" />
              Admin
            </Button>
            <HeaderLink href="#roadmap">Roadmap</HeaderLink>
            <HeaderLink href="#glossary">Glossary</HeaderLink>
          </nav>
        </header>

        <MarketOverviewCollapsible
          market={market}
          isLoading={isMarketLoading}
          onRefresh={refreshMarket}
        />

        <PortfolioHub
          portfolios={portfolios}
          selectedPortfolioId={undefined}
          pinProtectedIds={Object.keys(pinHashes)}
          onAddPortfolio={() => setIsAddPortfolioOpen(true)}
          onOpenPortfolio={(portfolio) => {
            setPinChallengePortfolio(portfolio);
            setPinInput("");
            setPinError(null);
          }}
        />

        {isAddPortfolioOpen ? (
          <PublicAddPortfolioModal
            draftRows={draftRows}
            emailAddress={emailAddress}
            error={addPortfolioError}
            fileInputRef={fileInputRef}
            investmentAppetite={investmentAppetite}
            isLoading={isCreatingPortfolio}
            portfolioName={portfolioName}
            portfolioPin={portfolioPin}
            telegramPasskey={telegramPasskey}
            telegramUserId={telegramUserId}
            addDraftRow={addDraftRow}
            createPortfolio={createPortfolio}
            parseCsvRows={parseCsvRows}
            removeDraftRow={removeDraftRow}
            setEmailAddress={setEmailAddress}
            setInvestmentAppetite={setInvestmentAppetite}
            setPortfolioName={setPortfolioName}
            setPortfolioPin={setPortfolioPin}
            setTelegramPasskey={setTelegramPasskey}
            setTelegramUserId={setTelegramUserId}
            updateDraftRow={updateDraftRow}
            onClose={() => {
              setIsAddPortfolioOpen(false);
              setAddPortfolioError(null);
            }}
          />
        ) : null}

        {pinChallengePortfolio ? (
          <PortfolioPinModal
            error={pinError}
            pin={pinInput}
            portfolioName={pinChallengePortfolio.name}
            setPin={setPinInput}
            onClose={() => setPinChallengePortfolio(null)}
            onUnlock={unlockPortfolio}
          />
        ) : null}

        {isAdminLoginOpen ? (
          <AdminLoginModal
            error={adminError}
            isLoading={isAdminLoading}
            password={adminPassword}
            setPassword={setAdminPassword}
            setUsername={setAdminUsername}
            username={adminUsername}
            onCancel={() => {
              setIsAdminLoginOpen(false);
              setAdminError("");
              setAdminPassword("");
            }}
            onLogin={loginAdmin}
          />
        ) : null}

        <MarketOpportunitiesSection matrix={expertMatrix} market={market} />

        <RoadmapSection />

        <GlossarySection />
      </section>
    </main>
  );
}

function AdminLoginModal({
  error,
  isLoading,
  password,
  setPassword,
  setUsername,
  username,
  onCancel,
  onLogin,
}: {
  error: string;
  isLoading: boolean;
  password: string;
  setPassword: (password: string) => void;
  setUsername: (username: string) => void;
  username: string;
  onCancel: () => void;
  onLogin: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
      <section className="w-full max-w-md rounded-2xl border border-cyan-300/20 bg-[#0F1B2D] p-5 text-slate-100 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
              <LockKeyhole className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              Admin Login
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Enter admin credentials to continue.
            </p>
          </div>
          <Button type="button" variant="outline" size="icon" onClick={onCancel}>
            <X className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Cancel</span>
          </Button>
        </div>
        <div className="mt-4 space-y-3">
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Username"
            autoComplete="username"
            className="h-11 w-full rounded-md border border-white/10 bg-[#08121F] px-3 text-sm text-white outline-none focus:ring-2 focus:ring-cyan-300"
          />
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            type="password"
            autoComplete="current-password"
            className="h-11 w-full rounded-md border border-white/10 bg-[#08121F] px-3 text-sm text-white outline-none focus:ring-2 focus:ring-cyan-300"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onLogin();
              }
            }}
          />
          {error ? (
            <div className="rounded-md border border-rose-300/30 bg-rose-300/10 px-3 py-2 text-sm text-rose-100">
              {error}
            </div>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2">
            <Button type="button" onClick={onLogin} disabled={isLoading}>
              {isLoading ? "Logging in" : "Login"}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function PortfolioPinModal({
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
      <section className="w-full max-w-md rounded-2xl border border-cyan-300/20 bg-[#0F1B2D] p-5 text-slate-100 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
              <Lock className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              Unlock {portfolioName}
            </h2>
            <p className="mt-1 text-sm text-slate-400">Enter the portfolio PIN.</p>
          </div>
          <Button type="button" variant="outline" size="icon" onClick={onClose}>
            <X className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Close</span>
          </Button>
        </div>
        {error ? (
          <div className="mt-4 rounded-md border border-rose-300/30 bg-rose-300/10 px-3 py-2 text-sm text-rose-100">
            {error}
          </div>
        ) : null}
        <form onSubmit={submitUnlock}>
          <input
            value={pin}
            onChange={(event) => setPin(normalizePinInput(event.target.value))}
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
            className="mt-4 h-11 w-full rounded-md border border-white/10 bg-[#08121F] px-3 text-center text-lg tracking-[0.35em] text-white outline-none focus:ring-2 focus:ring-cyan-300"
          />
          <Button type="submit" className="mt-4 w-full">
            Open Portfolio
          </Button>
        </form>
      </section>
    </div>
  );
}

function HeaderLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-cyan-300/40 hover:text-cyan-200"
    >
      {children}
    </Link>
  );
}

function PublicAddPortfolioModal({
  draftRows,
  emailAddress,
  error,
  fileInputRef,
  investmentAppetite,
  isLoading,
  portfolioName,
  portfolioPin,
  telegramPasskey,
  telegramUserId,
  addDraftRow,
  createPortfolio,
  parseCsvRows,
  removeDraftRow,
  setEmailAddress,
  setInvestmentAppetite,
  setPortfolioName,
  setPortfolioPin,
  setTelegramPasskey,
  setTelegramUserId,
  updateDraftRow,
  onClose,
}: {
  draftRows: PortfolioInputRow[];
  emailAddress: string;
  error: string | null;
  fileInputRef: RefObject<HTMLInputElement | null>;
  investmentAppetite: InvestmentAppetite;
  isLoading: boolean;
  portfolioName: string;
  portfolioPin: string;
  telegramPasskey: string;
  telegramUserId: string;
  addDraftRow: () => void;
  createPortfolio: () => void;
  parseCsvRows: (file: File) => void;
  removeDraftRow: (index: number) => void;
  setEmailAddress: (value: string) => void;
  setInvestmentAppetite: (value: InvestmentAppetite) => void;
  setPortfolioName: (value: string) => void;
  setPortfolioPin: (value: string) => void;
  setTelegramPasskey: (value: string) => void;
  setTelegramUserId: (value: string) => void;
  updateDraftRow: (index: number, row: Partial<PortfolioInputRow>) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 px-4 py-6 backdrop-blur-sm">
      <section className="mx-auto w-full max-w-5xl rounded-2xl border border-cyan-300/20 bg-[#0F1B2D] p-5 text-slate-100 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Add Portfolio</h2>
            <p className="mt-1 text-sm text-slate-400">
              Create a PIN-protected portfolio. No username or password required.
            </p>
          </div>
          <Button type="button" variant="outline" size="icon" onClick={onClose}>
            <X className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Close add portfolio</span>
          </Button>
        </div>

        {error ? (
          <div className="mt-4 rounded-md border border-rose-300/30 bg-rose-300/10 px-3 py-2 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <input
            value={portfolioName}
            onChange={(event) => setPortfolioName(event.target.value)}
            placeholder="Portfolio Name"
            className="h-11 rounded-md border border-white/10 bg-[#08121F] px-3 text-sm text-white outline-none focus:ring-2 focus:ring-cyan-300"
          />
          <input
            value={portfolioPin}
            onChange={(event) => setPortfolioPin(normalizePinInput(event.target.value))}
            onPaste={(event) => {
              event.preventDefault();
              setPortfolioPin(normalizePinInput(event.clipboardData.getData("text")));
            }}
            placeholder="Portfolio PIN"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            autoComplete="off"
            className="h-11 rounded-md border border-white/10 bg-[#08121F] px-3 text-sm text-white outline-none focus:ring-2 focus:ring-cyan-300"
          />
          <select
            value={investmentAppetite}
            onChange={(event) => setInvestmentAppetite(event.target.value as InvestmentAppetite)}
            className="h-11 rounded-md border border-white/10 bg-[#08121F] px-3 text-sm text-white outline-none focus:ring-2 focus:ring-cyan-300"
          >
            <option value="safe">Safe Risk Appetite</option>
            <option value="moderate">Moderate Risk Appetite</option>
            <option value="aggressive">Aggressive Risk Appetite</option>
          </select>
        </div>

        <div className="mt-5 space-y-2">
          <div className="text-sm font-semibold text-white">Stock List</div>
          {draftRows.map((row, index) => (
            <div key={`public-draft-${index}`} className="grid gap-2 md:grid-cols-[160px_1fr_120px_140px_44px]">
              <input
                value={row.stockCode}
                onChange={(event) => {
                  const stockCode = event.target.value.toUpperCase();
                  updateDraftRow(index, {
                    stock: stockCode || row.company,
                    stockCode,
                  });
                }}
                placeholder="Stock Code"
                className="h-10 rounded-md border border-white/10 bg-[#08121F] px-3 text-sm text-white outline-none focus:ring-2 focus:ring-cyan-300"
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
                className="h-10 rounded-md border border-white/10 bg-[#08121F] px-3 text-sm text-white outline-none focus:ring-2 focus:ring-cyan-300"
              />
              <input
                value={row.quantity || ""}
                onChange={(event) =>
                  updateDraftRow(index, {
                    list: Number(event.target.value) > 0 ? "current" : "watchlist",
                    quantity: Number(event.target.value),
                  })
                }
                placeholder="Quantity"
                type="number"
                className="h-10 rounded-md border border-white/10 bg-[#08121F] px-3 text-sm text-white outline-none focus:ring-2 focus:ring-cyan-300"
              />
              <input
                value={row.buyPrice ?? ""}
                onChange={(event) =>
                  updateDraftRow(index, {
                    buyPrice: Number(event.target.value) || undefined,
                  })
                }
                placeholder="Avg Buy Price"
                type="number"
                min="0"
                step="0.01"
                className="h-10 rounded-md border border-white/10 bg-[#08121F] px-3 text-sm text-white outline-none focus:ring-2 focus:ring-cyan-300"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => removeDraftRow(index)}
                disabled={draftRows.length === 1}
                aria-label="Remove stock row"
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

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <input
            value={telegramUserId}
            onChange={(event) => setTelegramUserId(event.target.value)}
            placeholder="Telegram User ID (Optional)"
            className="h-11 rounded-md border border-white/10 bg-[#08121F] px-3 text-sm text-white outline-none focus:ring-2 focus:ring-cyan-300"
          />
          <input
            value={telegramPasskey}
            onChange={(event) => setTelegramPasskey(event.target.value)}
            placeholder="Telegram Passkey (Optional)"
            className="h-11 rounded-md border border-white/10 bg-[#08121F] px-3 text-sm text-white outline-none focus:ring-2 focus:ring-cyan-300"
          />
          <input
            value={emailAddress}
            onChange={(event) => setEmailAddress(event.target.value)}
            placeholder="Email Address (Optional)"
            type="email"
            className="h-11 rounded-md border border-white/10 bg-[#08121F] px-3 text-sm text-white outline-none focus:ring-2 focus:ring-cyan-300"
          />
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={addDraftRow}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add Stock
          </Button>
          <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
            <FileUp className="h-4 w-4" aria-hidden="true" />
            Upload CSV
          </Button>
          <Button type="button" onClick={createPortfolio} disabled={isLoading}>
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            {isLoading ? "Creating Portfolio" : "Create Portfolio"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function MarketOpportunitiesSection({
  matrix,
  market,
}: {
  matrix: ExpertActionMatrix | null;
  market: MarketOverview | null;
}) {
  const picks = useMemo(() => {
    const rows =
      matrix?.categories.flatMap((category) => [
        ...category.longTermUpsides.map((item) => ({
          ...item,
          horizon: getInvestmentHorizon(category.title, "longTerm", item.score),
          marketCapType: getMarketCapType(category.title),
        })),
        ...category.intradayBreakouts.map((item) => ({
          ...item,
          horizon: getInvestmentHorizon(category.title, "intraday", item.score),
          marketCapType: getMarketCapType(category.title),
        })),
      ]) ?? [];
    const grouped = rows.reduce<Record<string, { symbol: string; score: number; count: number; action: string; marketCapType: string; horizon: string }>>(
      (acc, item) => {
        const existing = acc[item.symbol] ?? {
          symbol: item.symbol,
          score: 0,
          count: 0,
          action: "BUY",
          marketCapType: item.marketCapType,
          horizon: item.horizon,
        };
        existing.score += item.score;
        existing.count += 1;
        existing.action = item.action === "Accumulate" ? "BUY" : "REDUCE";
        if (horizonRank[item.horizon] > horizonRank[existing.horizon]) {
          existing.horizon = item.horizon;
        }
        existing.marketCapType = existing.marketCapType || item.marketCapType;
        acc[item.symbol] = existing;
        return acc;
      },
      {},
    );

    return Object.values(grouped)
      .map((item) => ({
        ...item,
        confidence: Math.round(item.score / item.count),
      }))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 8);
  }, [matrix]);
  const opportunityScore = picks.length
    ? Math.round(
        picks.reduce((sum, item) => sum + item.confidence * item.count, 0) /
          Math.max(1, picks.reduce((sum, item) => sum + item.count, 0)),
      )
    : Math.max(0, Math.min(100, Math.round(50 + (market?.averageMove ?? 0) * 6)));
  const classification = getOpportunityClass(opportunityScore, market?.sentiment);
  const totalRecommendations = picks.reduce((sum, item) => sum + item.count, 0);
  const buyCount = picks.filter((item) => item.action === "BUY").length;
  const reduceCount = picks.filter((item) => item.action === "REDUCE").length;
  const holdCount = 0;
  const doNothingCount = picks.length ? 0 : 1;
  const summary = getMarketOpportunitySummary(picks, classification, market);

  return (
    <section className="space-y-4 rounded-2xl border border-cyan-300/20 bg-[#0F1B2D] p-5 shadow-xl">
      <SectionTitle
        icon={<TrendingUp className="h-5 w-5" aria-hidden="true" />}
        title="Market Opportunities"
        subtitle="AI-ranked opportunities across the market. Not tied to any individual portfolio."
        badge="CALCULATED"
        secondaryBadge="MARKET WIDE"
      />
      <div className="grid gap-3 lg:grid-cols-[0.8fr_1.2fr]">
        <article className="rounded-xl border border-amber-300/25 bg-[#16263D] p-4">
          <div className="text-sm uppercase tracking-[0.1em] text-slate-400">
            Opportunity Score
          </div>
          <div className="mt-3 flex items-end gap-3">
            <span className={cn("text-4xl font-semibold", opportunityTone(opportunityScore))}>
              {opportunityScore}
            </span>
            <span className="pb-1 font-semibold text-slate-400">/100</span>
          </div>
          <div className={cn("mt-2 text-sm font-semibold", opportunityTone(opportunityScore))}>
            {classification}
          </div>
          <p className="mt-3 leading-6 text-slate-300">{summary}</p>
        </article>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="BUY" value={String(buyCount)} tone="up" />
          <Metric label="HOLD" value={String(holdCount)} />
          <Metric label="REDUCE" value={String(reduceCount)} tone="down" />
          <Metric label="DO NOTHING" value={String(doNothingCount)} />
          <Metric label="Total Signals" value={String(totalRecommendations)} className="hidden sm:block" />
          <Metric label="Stocks Covered" value={String(picks.length || (market?.gainers.length ?? 0) + (market?.losers.length ?? 0))} className="hidden sm:block" />
        </div>
      </div>
      <div className="table-scroll rounded-xl border border-white/10" role="region" aria-label="Scrollable market opportunities table" tabIndex={0}>
        <div className="table-scroll-hint md:hidden">Swipe left/right to view more</div>
        <table className="w-max min-w-[860px] max-w-none text-left text-sm">
          <thead className="bg-white/[0.03] text-xs uppercase tracking-[0.1em] text-slate-400">
            <tr>
              <th className="px-3 py-3">Symbol</th>
              <th className="px-3 py-3">Recommendation</th>
              <th className="px-3 py-3">Confidence</th>
              <th className="px-3 py-3">Market Cap</th>
              <th className="px-3 py-3">Horizon</th>
              <th className="px-3 py-3">Signals</th>
              <th className="px-3 py-3">Updated</th>
            </tr>
          </thead>
          <tbody>
            {picks.map((pick) => (
              <tr key={pick.symbol} className="border-t border-white/10">
                <td className="px-3 py-3 font-semibold text-white">{pick.symbol}</td>
                <td className={cn("px-3 py-3 font-semibold", marketOpportunityTone(pick))}>{pick.action}</td>
                <td className={cn("px-3 py-3", pick.confidence >= 85 ? "font-semibold text-amber-300" : "text-slate-300")}>
                  {pick.confidence}%
                  {pick.confidence >= 85 ? " A+" : ""}
                </td>
                <td className="px-3 py-3 text-slate-300">{pick.marketCapType}</td>
                <td className={cn("px-3 py-3", pick.horizon === "Long Term" ? "font-semibold text-sky-300" : "text-slate-300")}>{pick.horizon}</td>
                <td className="px-3 py-3 text-slate-300">{pick.count}</td>
                <td className="px-3 py-3 text-slate-400">{matrix?.asOf ? "Today" : "Pending"}</td>
              </tr>
            ))}
            {picks.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-slate-400">
                  Market recommendations are loading.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function getOpportunityClass(
  score: number,
  sentiment?: MarketOverview["sentiment"],
) {
  if (score >= 80 && sentiment !== "Negative") return "Excellent";
  if (score >= 60) return "Selective";
  if (score >= 40) return "Defensive";
  return "No Edge";
}

function getMarketOpportunitySummary(
  picks: Array<{ action: string; confidence: number; count: number; symbol: string }>,
  classification: string,
  market: MarketOverview | null,
) {
  const leading = picks.filter((pick) => pick.action === "BUY").slice(0, 3);
  const marketTone =
    market?.sentiment === "Positive"
      ? "positive market breadth"
      : market?.sentiment === "Negative"
        ? "defensive market breadth"
        : "mixed market breadth";

  if (classification === "Excellent" && leading.length) {
    return `Excellent opportunities are concentrated in ${leading.map((pick) => pick.symbol).join(", ")} with ${marketTone}.`;
  }

  if (classification === "Selective" && leading.length) {
    return `Selective opportunities exist in ${leading.map((pick) => pick.symbol).join(", ")} while risk controls remain important.`;
  }

  if (classification === "Defensive") {
    return "Defensive conditions suggest prioritising quality, liquidity, and position sizing.";
  }

  return "No clear edge is visible until stronger, repeatable market signals emerge.";
}

function opportunityTone(score: number) {
  if (score >= 70) return "text-emerald-300";
  if (score < 40) return "text-rose-300";
  return "text-amber-300";
}

function marketOpportunityTone(pick: { action: string; confidence: number; horizon: string }) {
  if (pick.confidence >= 85) return "text-amber-300";
  if (pick.horizon === "Long Term") return "text-sky-300";
  if (pick.action === "BUY") return "text-blue-400";
  return "text-slate-300";
}

function getMarketCapType(categoryTitle: string) {
  const title = categoryTitle.toLowerCase();

  if (title.includes("small")) return "Small Cap";
  if (title.includes("mid")) return "Mid Cap";

  return "Large Cap";
}

function getInvestmentHorizon(
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

const horizonRank: Record<string, number> = {
  Intraday: 1,
  "Short Term": 2,
  "Swing Trade": 3,
  "Long Term": 4,
  "Multibagger Candidate": 5,
};

function RoadmapSection() {
  return (
    <section id="roadmap" className="space-y-4 rounded-2xl border border-violet-300/20 bg-[#0F1B2D] p-5 shadow-xl">
      <SectionTitle icon={<Map className="h-5 w-5" aria-hidden="true" />} title="Roadmap" subtitle="Planned intelligence modules." badge="CALCULATED" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {roadmapItems.map((item) => (
          <article key={item} className="rounded-xl border border-white/10 bg-[#16263D] p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">Coming Soon</div>
            <h3 className="mt-2 text-sm font-semibold text-white">{item}</h3>
          </article>
        ))}
      </div>
    </section>
  );
}

function GlossarySection() {
  return (
    <section id="glossary" className="space-y-4 rounded-2xl border border-amber-300/20 bg-[#0F1B2D] p-5 shadow-xl">
      <SectionTitle icon={<BookOpen className="h-5 w-5" aria-hidden="true" />} title="Glossary" subtitle="Plain-English market intelligence terms." badge="CALCULATED" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {glossaryItems.map(([term, definition]) => (
          <article key={term} className="rounded-xl border border-white/10 bg-[#16263D] p-4">
            <h3 className="text-sm font-semibold text-amber-200">{term}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-400">{definition}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function SectionTitle({
  icon,
  title,
  subtitle,
  badge,
  secondaryBadge,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  badge: "LIVE" | "CALCULATED";
  secondaryBadge?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="rounded-xl border border-cyan-300/25 bg-cyan-300/10 p-2 text-cyan-200">{icon}</span>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold text-white">{title}</h2>
          <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-[10px] font-semibold tracking-[0.12em] text-cyan-200">
            {badge}
          </span>
          {secondaryBadge ? (
            <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2 py-0.5 text-[10px] font-semibold tracking-[0.12em] text-amber-200">
              {secondaryBadge}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
      </div>
    </div>
  );
}

function Metric({ label, value, tone = "flat", className }: { label: string; value: string; tone?: "up" | "down" | "flat", className?: string }) {
  return (
    <article className={cn("rounded-xl border border-white/10 bg-[#16263D] p-3", className)}>
      <div className="text-xs uppercase tracking-[0.1em] text-slate-400">{label}</div>
      <div className={cn("mt-2 text-xl font-semibold", tone === "up" ? "text-emerald-300" : tone === "down" ? "text-rose-300" : "text-amber-300")}>{value}</div>
    </article>
  );
}

function filterHomepagePortfolios(portfolios: ManagedPortfolio[]) {
  return portfolios
    .filter(
      (portfolio) =>
        !portfolio.isMarketPortfolio &&
        portfolio.id !== "market-recommendations" &&
        portfolio.name.toLowerCase() !== "market recommendation",
    )
    .map((portfolio) => ({
      ...portfolio,
      inputs: portfolio.inputs ?? [],
      positions: portfolio.positions ?? [],
    }))
    .sort((a, b) => {
      const aIsSuchi = a.name.toLowerCase().includes("suchi icici");
      const bIsSuchi = b.name.toLowerCase().includes("suchi icici");

      if (aIsSuchi !== bIsSuchi) {
        return aIsSuchi ? -1 : 1;
      }

      return a.name.localeCompare(b.name);
    });
}

function normalizePublicPortfolioRows(rows: PortfolioInputRow[]) {
  const merged = rows.reduce<Record<string, PortfolioInputRow>>((acc, row) => {
    const stockCode = String(row.stockCode || "")
      .trim()
      .toUpperCase()
      .replace(/\.NS$|\.BO$/u, "");
    const company = String(row.company || row.stock || "").trim();
    const quantity = Number(row.quantity) || 0;
    const buyPrice = Number(row.buyPrice) || undefined;
    const key = stockCode || company.toLowerCase();

    if (!key || quantity <= 0) {
      return acc;
    }

    const normalized = buildPortfolioInputRow({
      company,
      quantity,
      buyPrice,
      stockCode,
    });
    const existing = acc[key];

    if (!existing) {
      acc[key] = normalized;
      return acc;
    }

    acc[key] = {
      ...existing,
      company: existing.company || normalized.company,
      buyPrice: existing.buyPrice ?? normalized.buyPrice,
      quantity: existing.quantity + normalized.quantity,
      stock: existing.stockCode || existing.company || normalized.stock,
    };

    return acc;
  }, {});

  return Object.values(merged);
}

function getCsvValue(row: PublicPortfolioCsvRow, keys: string[]) {
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
