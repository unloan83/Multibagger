"use client";

import { Lock, Plus, ShieldCheck, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ManagedPortfolio } from "@/lib/portfolio";
import { calculatePortfolioMetrics, formatCurrency } from "@/lib/portfolio";
import { cn } from "@/lib/utils";

export function PortfolioHub({
  portfolios,
  selectedPortfolioId,
  pinProtectedIds,
  onAddPortfolio,
  onOpenPortfolio,
}: {
  portfolios: ManagedPortfolio[];
  selectedPortfolioId?: string;
  pinProtectedIds: string[];
  onAddPortfolio: () => void;
  onOpenPortfolio: (portfolio: ManagedPortfolio) => void;
}) {
  const protectedLookup = new Set(pinProtectedIds);

  return (
    <section className="space-y-4 rounded-2xl border border-white/10 bg-[#0F1B2D] p-5 shadow-xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Portfolio Access Area</h2>
          <p className="text-sm text-slate-400">
            Add, unlock, and switch between portfolios.
          </p>
        </div>
        <Button type="button" onClick={onAddPortfolio}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add Portfolio
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {portfolios.map((portfolio) => (
          <PortfolioAccessCard
            key={portfolio.id}
            portfolio={portfolio}
            isSelected={portfolio.id === selectedPortfolioId}
            isProtected={protectedLookup.has(portfolio.id)}
            onOpen={() => onOpenPortfolio(portfolio)}
          />
        ))}
      </div>
    </section>
  );
}

function PortfolioAccessCard({
  portfolio,
  isSelected,
  isProtected,
  onOpen,
}: {
  portfolio: ManagedPortfolio;
  isSelected: boolean;
  isProtected: boolean;
  onOpen: () => void;
}) {
  const metrics = calculatePortfolioMetrics(portfolio.positions);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group rounded-xl border bg-[#16263D] p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-cyan-300/50 hover:shadow-lg",
        isSelected ? "border-cyan-300/70 ring-1 ring-cyan-300/30" : "border-white/10",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-white">{portfolio.name}</div>
          <div className="mt-1 text-xs capitalize text-slate-400">
            {portfolio.appetite ?? "moderate"} appetite
          </div>
        </div>
        <span
          className={cn(
            "rounded-full border p-2",
            isProtected
              ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-300"
              : "border-amber-300/30 bg-amber-300/10 text-amber-300",
          )}
        >
          {isProtected ? <ShieldCheck className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg border border-white/10 bg-[#08121F] p-2">
          <div className="text-slate-500">Value</div>
          <div className="mt-1 truncate font-semibold text-cyan-200">
            {formatCurrency(metrics.totalValue)}
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-[#08121F] p-2">
          <div className="text-slate-500">Holdings</div>
          <div className="mt-1 font-semibold text-amber-200">{metrics.holdings.length}</div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-slate-400 group-hover:text-cyan-200">
        <Unlock className="h-3.5 w-3.5" aria-hidden="true" />
        Unlock dashboard
      </div>
    </button>
  );
}
