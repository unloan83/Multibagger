"use client";

import { useEffect, useState } from "react";

type Category = {
  key: string;
  title: string;
  longTermUpsides: StockPick[];
  intradayBreakouts: StockPick[];
};

type StockPick = {
  symbol: string;
  name: string;
  price: number;
  previousClose: number;
  changePercent: number;
  target: number;
  upside: number;
  score: number;
  action: string;
  remark: string;
  theme: string;
  sector: string;
  dataQuality: number;
  factorScores: {
    growth: number;
    quality: number;
    valuation: number;
    momentum: number;
    sectorStrength: number;
    liquidity: number;
    risk: number;
  };
};

type Snapshot = {
  asOf: string;
  marketRegime: string;
  universeSize: number;
  evaluatedSize: number;
  eligibleSize: number;
  abstained: boolean;
  categories: Category[];
};

type Holding = {
  symbol: string;
  price: number;
  changePercent: number;
  name: string;
};

export default function HomePage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [holdings, setHoldings] = useState<Holding[]>([]);

  useEffect(() => {
    fetch("/api/snapshots/wealth")
      .then(async (res) => {
        if (!res.ok) {
          const localRes = await fetch("/data/wealth_recommendations.json").catch(() => null);
          if (localRes?.ok) return localRes.json();
          throw new Error("Could not load recommendations.");
        }
        return res.json();
      })
      .then((data) => {
        setSnapshot(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });

    fetch("/data/wealth_recommendations.json")
      .then((res) => {
        if (res.ok) return res.json();
        return null;
      })
      .then((data) => {
        if (data && !snapshot) {
          setSnapshot(data);
          setLoading(false);
        }
      })
      .catch(() => {});

    fetch("/api/watchlist")
      .then(async (res) => {
        const data = await res.json();
        if (data.ok) setHoldings(data.holdings);
      })
      .catch(() => {});
  }, []);

  return (
    <main className="min-h-screen bg-[#08121f] text-slate-100">
      <header className="border-b border-white/10 bg-[#0a1628]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              <span className="bg-gradient-to-r from-cyan-300 to-blue-400 bg-clip-text text-transparent">
                Multibagger
              </span>
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Daily long-term &amp; intraday stock picks from NIFTY 500 screening
            </p>
          </div>
          {snapshot && (
            <div className="hidden text-right text-xs text-slate-500 sm:block">
              <div>
                Regime:{" "}
                <span className="font-semibold text-slate-300">
                  {snapshot.marketRegime}
                </span>
              </div>
              <div>
                Updated:{" "}
                {new Date(snapshot.asOf).toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "Asia/Kolkata",
                })}{" "}
                IST
              </div>
              <div>
                Universe: {snapshot.evaluatedSize}/{snapshot.universeSize} stocks
                screened
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-8 px-5 py-8">
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-300 border-t-transparent" />
            <span className="ml-3 text-slate-400">
              Loading recommendations…
            </span>
          </div>
        )}

        {error && !snapshot && (
          <div className="rounded-xl border border-amber-300/25 bg-amber-300/10 p-5 text-sm text-amber-100">
            {error}
            <p className="mt-2 text-xs text-amber-200/70">
              Run{" "}
              <code className="rounded bg-white/10 px-1.5 py-0.5">
                npm run wealth:snapshot
              </code>{" "}
              to generate fresh recommendations.
            </p>
          </div>
        )}

        {snapshot?.abstained && (
          <div className="rounded-xl border border-amber-300/25 bg-amber-300/10 p-5 text-sm text-amber-100">
            The screening engine is abstaining — no fresh snapshot is available.
            Run{" "}
            <code className="rounded bg-white/10 px-1.5 py-0.5">
              npm run wealth:snapshot
            </code>{" "}
            to generate picks.
          </div>
        )}

        {snapshot &&
          !snapshot.abstained &&
          snapshot.categories.map((category) => (
            <CategorySection key={category.key} category={category} />
          ))}

        {holdings.length > 0 && (
          <section className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-300">
              <span className="inline-block h-2 w-2 rounded-full bg-slate-400" />
              My Holdings
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {holdings.map((h) => (
                <div
                  key={h.symbol}
                  className="rounded-xl border border-white/10 bg-[#0f1b2d] p-4 shadow-lg"
                >
                  <div className="text-base font-bold text-white">{h.symbol}</div>
                  <div className="mt-0.5 truncate text-xs text-slate-400">{h.name}</div>
                  <div className="mt-3 flex items-center gap-4 text-xs">
                    <div>
                      <div className="text-slate-500">CMP</div>
                      <div className="font-semibold text-white">
                        ₹{h.price.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Change</div>
                      <div
                        className={`font-semibold ${h.changePercent >= 0 ? "text-emerald-300" : "text-rose-300"}`}
                      >
                        {h.changePercent >= 0 ? "+" : ""}
                        {h.changePercent.toFixed(1)}%
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-600">
              Edit <code className="rounded bg-white/5 px-1 py-0.5">data/watchlist.json</code> to add or remove symbols.
            </p>
          </section>
        )}

        {snapshot && (
          <p className="text-center text-xs leading-5 text-slate-600">
            AI-assisted market screening — not certified investment advice.
            Verify exchange filings, valuation, governance, liquidity, and
            position sizing before investing.
          </p>
        )}
      </div>
    </main>
  );
}

function CategorySection({ category }: { category: Category }) {
  const hasLongTerm = category.longTermUpsides.length > 0;
  const hasIntraday = category.intradayBreakouts.length > 0;

  if (!hasLongTerm && !hasIntraday) return null;

  return (
    <section className="space-y-5">
      <h2 className="text-lg font-semibold text-white">{category.title}</h2>

      {hasLongTerm && (
        <div className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-emerald-300">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
            Long-Term Picks
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {category.longTermUpsides.map((stock) => (
              <StockCard key={stock.symbol} stock={stock} variant="longTerm" />
            ))}
          </div>
        </div>
      )}

      {hasIntraday && (
        <div className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-amber-300">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
            Intraday Breakouts
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {category.intradayBreakouts.map((stock) => (
              <StockCard
                key={stock.symbol}
                stock={stock}
                variant="intraday"
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function StockCard({
  stock,
  variant,
}: {
  stock: StockPick;
  variant: "longTerm" | "intraday";
}) {
  const changeColor =
    stock.changePercent >= 0 ? "text-emerald-300" : "text-rose-300";
  const actionColor =
    stock.action === "Accumulate"
      ? "bg-emerald-400/15 text-emerald-300 border-emerald-400/30"
      : "bg-amber-400/15 text-amber-300 border-amber-400/30";
  const accentBorder =
    variant === "longTerm"
      ? "border-l-emerald-400/60"
      : "border-l-amber-400/60";

  return (
    <div
      className={`rounded-xl border border-white/10 border-l-2 ${accentBorder} bg-[#0f1b2d] p-4 shadow-lg transition hover:-translate-y-0.5 hover:border-white/20 hover:shadow-xl`}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="text-base font-bold text-white">{stock.symbol}</div>
          <div className="mt-0.5 truncate text-xs text-slate-400">
            {stock.name}
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${actionColor}`}
        >
          {stock.action}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="text-slate-500">CMP</div>
          <div className="font-semibold text-white">
            ₹{stock.price.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
          </div>
        </div>
        <div>
          <div className="text-slate-500">Target</div>
          <div className="font-semibold text-cyan-200">
            ₹{stock.target.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
          </div>
        </div>
        <div>
          <div className="text-slate-500">Change</div>
          <div className={`font-semibold ${changeColor}`}>
            {stock.changePercent >= 0 ? "+" : ""}
            {stock.changePercent.toFixed(1)}%
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="text-slate-500">Upside</span>
          <span className="font-semibold text-cyan-300">
            {stock.upside.toFixed(1)}%
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-slate-500">Score</span>
          <span className="font-semibold text-white">{stock.score}/100</span>
        </div>
      </div>

      <div className="mt-2 text-[11px] leading-4 text-slate-500">
        {stock.sector} · {stock.theme}
      </div>
    </div>
  );
}
