"use client";

import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { DecisionSnapshot } from "@/lib/decision-intelligence";
import { cn } from "@/lib/utils";

const snapshotStorageKey = "unloan-decision-intelligence-snapshots";

export function ChangeDetection({
  snapshot,
}: {
  snapshot: DecisionSnapshot | null | undefined;
}) {
  const [snapshots, setSnapshots] = useState<DecisionSnapshot[]>([]);

  useEffect(() => {
    setSnapshots(readSnapshots());
  }, []);

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    const next = upsertSnapshot(readSnapshots(), snapshot);
    writeSnapshots(next);
    setSnapshots(next);
  }, [snapshot]);

  const previous = useMemo(
    () =>
      snapshot
        ? snapshots
            .filter(
              (item) =>
                item.portfolioId === snapshot.portfolioId &&
                item.date < snapshot.date,
            )
            .sort((a, b) => b.date.localeCompare(a.date))[0]
        : undefined,
    [snapshot, snapshots],
  );
  const changes = snapshot && previous ? buildChanges(snapshot, previous) : [];
  const summary = buildSummary(snapshot, previous, changes);

  return (
    <section className="space-y-3 rounded-2xl border border-white/10 bg-[#0F1B2D] p-5 shadow-xl">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
          Change Detection
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-white">
            What Changed Since Yesterday
          </h2>
          <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2 py-0.5 text-[10px] font-semibold tracking-[0.12em] text-amber-200">
            CALCULATED
          </span>
        </div>
        <p className="mt-2 text-sm text-amber-100">{summary}</p>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {changes.map((change) => (
          <article
            key={change.label}
            className="flex items-start gap-3 rounded-xl border border-white/10 bg-[#16263D] p-3"
          >
            <span
              className={cn(
                "mt-0.5 rounded-lg border p-1.5",
                change.tone === "up"
                  ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-300"
                  : change.tone === "down"
                    ? "border-rose-300/25 bg-rose-300/10 text-rose-300"
                    : "border-amber-300/25 bg-amber-300/10 text-amber-300",
              )}
            >
              {change.tone === "up" ? (
                <ArrowUp className="h-4 w-4" aria-hidden="true" />
              ) : change.tone === "down" ? (
                <ArrowDown className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              )}
            </span>
            <div>
              <div className="text-sm font-semibold text-white">{change.label}</div>
              <div className="mt-1 text-xs leading-5 text-slate-400">{change.detail}</div>
            </div>
          </article>
        ))}
        {changes.length === 0 ? (
          <article className="rounded-xl border border-white/10 bg-[#16263D] p-3 text-sm text-slate-400">
            No significant changes detected yet.
          </article>
        ) : null}
      </div>
    </section>
  );
}

function buildChanges(current: DecisionSnapshot, previous: DecisionSnapshot) {
  const changes: Array<{
    label: string;
    detail: string;
    tone: "up" | "down" | "flat";
  }> = [];
  const healthChange = current.portfolioHealth - previous.portfolioHealth;
  const riskChange = current.riskScore - previous.riskScore;
  const confidenceChange = current.confidence - previous.confidence;

  if (Math.abs(healthChange) >= 3) {
    changes.push({
      label: "Portfolio Health",
      detail: `${healthChange > 0 ? "+" : ""}${healthChange} points since previous snapshot.`,
      tone: healthChange > 0 ? "up" : "down",
    });
  }

  if (Math.abs(riskChange) >= 4) {
    changes.push({
      label: "Risk Score",
      detail:
        riskChange > 0
          ? `Risk score improved by ${riskChange} points.`
          : `Risk score weakened by ${Math.abs(riskChange)} points.`,
      tone: riskChange > 0 ? "up" : "down",
    });
  }

  if (current.marketBias !== previous.marketBias) {
    changes.push({
      label: "Market Bias",
      detail: `${previous.marketBias} changed to ${current.marketBias}.`,
      tone:
        current.marketBias === "Bullish"
          ? "up"
          : current.marketBias === "Bearish"
            ? "down"
            : "flat",
    });
  }

  if (current.topOpportunity !== previous.topOpportunity) {
    changes.push({
      label: "New Opportunity Detected",
      detail: `${previous.topOpportunity} changed to ${current.topOpportunity}.`,
      tone: current.topOpportunity === "NONE" ? "flat" : "up",
    });
  }

  if (current.recommendedAction !== previous.recommendedAction) {
    changes.push({
      label: "Recommended Action",
      detail: `${previous.recommendedAction} changed to ${current.recommendedAction}.`,
      tone: actionTone(current.recommendedAction),
    });
  } else {
    changes.push({
      label: "Recommendation",
      detail: `${current.recommendedAction} unchanged.`,
      tone: "flat",
    });
  }

  if (Math.abs(confidenceChange) >= 5) {
    changes.push({
      label: "Confidence",
      detail: `${confidenceChange > 0 ? "+" : ""}${confidenceChange}% confidence change.`,
      tone: confidenceChange > 0 ? "up" : "down",
    });
  }

  return changes.slice(0, 6);
}

function buildSummary(
  snapshot: DecisionSnapshot | null | undefined,
  previous: DecisionSnapshot | undefined,
  changes: Array<{ tone: "up" | "down" | "flat" }>,
) {
  if (!snapshot) {
    return "Unlock a portfolio to start daily decision snapshots.";
  }

  if (!previous) {
    return "First snapshot captured. Tomorrow's view will compare against this baseline.";
  }

  if (changes.some((change) => change.tone === "down")) {
    return "Material risk or confidence changes detected. Review action before trading.";
  }

  if (changes.some((change) => change.tone === "up")) {
    return "Positive change detected since the previous trading snapshot.";
  }

  return "Recommendation unchanged; no major market or portfolio shift detected.";
}

function readSnapshots() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    return JSON.parse(
      window.localStorage.getItem(snapshotStorageKey) ?? "[]",
    ) as DecisionSnapshot[];
  } catch {
    return [];
  }
}

function writeSnapshots(snapshots: DecisionSnapshot[]) {
  window.localStorage.setItem(
    snapshotStorageKey,
    JSON.stringify(snapshots.slice(-120)),
  );
}

function upsertSnapshot(snapshots: DecisionSnapshot[], snapshot: DecisionSnapshot) {
  const filtered = snapshots.filter(
    (item) =>
      !(item.portfolioId === snapshot.portfolioId && item.date === snapshot.date),
  );

  return [...filtered, snapshot].sort((a, b) => a.date.localeCompare(b.date));
}

function actionTone(action: string) {
  if (action === "BUY") return "up";
  if (action === "PROTECT CAPITAL" || action === "REDUCE RISK") return "down";
  return "flat";
}
