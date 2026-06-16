"use client";

import { AlertTriangle, BarChart3, ShieldCheck, Target, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import type { DecisionIntelligence } from "@/lib/decision-intelligence";
import { formatCurrency } from "@/lib/portfolio";
import { cn } from "@/lib/utils";

export function TodaysActionCenter({
  intelligence,
}: {
  intelligence: DecisionIntelligence | null;
}) {
  if (!intelligence) {
    return (
      <section className="rounded-2xl border border-white/10 bg-[#0F1B2D] p-5 shadow-xl">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-white">Today&apos;s Action Center</h2>
          <SourceBadge label="CALCULATED" />
        </div>
        <p className="mt-2 text-sm text-slate-400">
          Unlock a portfolio to generate today&apos;s action intelligence.
        </p>
      </section>
    );
  }
  const execution = getActionExecution(intelligence.recommendedAction.action);
  const core = intelligence.portfolioCore;
  const leadOpportunity = core.topOpportunities[0];

  return (
    <section className="space-y-4 rounded-2xl border border-white/10 bg-[#0F1B2D] p-5 shadow-xl">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
            Decision Intelligence Layer
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold text-white">Today&apos;s Action Center</h2>
            <SourceBadge label="CALCULATED" />
          </div>
        </div>
        <p className="max-w-3xl text-sm font-medium text-amber-100">
          {intelligence.summary}
        </p>
      </div>

      <article
        className={cn(
          "rounded-2xl border bg-[#16263D] p-5 shadow-lg",
          toneClasses[actionTone(intelligence.recommendedAction.action)].border,
        )}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
              <BarChart3 className="h-4 w-4" aria-hidden="true" />
              Today&apos;s Recommended Action
            </div>
            <div
              className={cn(
                "mt-3 text-3xl font-semibold sm:text-4xl",
                toneClasses[actionTone(intelligence.recommendedAction.action)].text,
              )}
            >
              {intelligence.recommendedAction.action}
            </div>
            <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-300">
              {intelligence.recommendedAction.reason}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#08121F] px-4 py-3 text-sm">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-500">
              Confidence
            </div>
            <div className="mt-1 text-2xl font-semibold text-white">
              {intelligence.confidence.finalConfidence}%
            </div>
            <div className="mt-1 text-xs font-semibold text-amber-200">
              {intelligence.confidence.label}
            </div>
            <div className="mt-3 grid gap-2 border-t border-white/10 pt-3 text-xs text-slate-300">
              <span>Holding Period: {execution.horizon}</span>
              <span>Risk Level: {execution.risk}</span>
            </div>
          </div>
        </div>
      </article>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <ActionCard
          icon={<TrendingUp className="h-5 w-5" aria-hidden="true" />}
          title="Market Bias"
          value={intelligence.marketBias.label}
          detail={`Confidence ${intelligence.marketBias.confidence}%`}
          reason={intelligence.marketBias.reason}
          tone={biasTone(intelligence.marketBias.label)}
        />
        <ActionCard
          icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
          title="Portfolio Risk"
          value={`${intelligence.portfolioRisk.score}/100`}
          detail={intelligence.portfolioRisk.status}
          reason={intelligence.portfolioRisk.largestRisk}
          tone={riskTone(intelligence.portfolioRisk.status)}
        />
        <ActionCard
          icon={<Target className="h-5 w-5" aria-hidden="true" />}
          title="Best Opportunity"
          value={intelligence.bestOpportunity.symbol}
          detail={`Score ${intelligence.bestOpportunity.score}/100`}
          reason={intelligence.bestOpportunity.reason}
          tone={opportunityTone(intelligence.bestOpportunity.score)}
        />
        <ActionCard
          icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
          title="Biggest Risk"
          value={intelligence.biggestRisk.name}
          detail={intelligence.biggestRisk.severity}
          reason={intelligence.biggestRisk.reason}
          tone={severityTone(intelligence.biggestRisk.severity)}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <ActionCard
          icon={<BarChart3 className="h-5 w-5" aria-hidden="true" />}
          title="Market Regime"
          value={core.marketRegime.regime}
          detail={`Confidence ${core.marketRegime.confidence}%`}
          reason={core.marketRegime.reason}
          tone={regimeTone(core.marketRegime.regime)}
        />
        <ActionCard
          icon={<Target className="h-5 w-5" aria-hidden="true" />}
          title="Opportunity Quality"
          value={`${core.opportunityQuality.score}/100`}
          detail={core.opportunityQuality.label}
          reason={
            core.opportunityQuality.action === "DO NOTHING"
              ? "Below 40 means no portfolio edge today."
              : "Action only on ranked, position-sized opportunities."
          }
          tone={opportunityTone(core.opportunityQuality.score)}
        />
        <ActionCard
          icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
          title="Suggested Action"
          value={core.coach.suggestedNextAction}
          detail={core.coach.bestOpportunity}
          reason={core.coach.topImprovement}
          tone={core.opportunityQuality.action === "DO NOTHING" ? "flat" : "up"}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
        <section className="rounded-xl border border-white/10 bg-[#16263D] p-4">
          <h3 className="text-sm font-semibold text-white">Top Opportunities</h3>
          <div className="table-scroll mt-3 rounded-lg border border-white/10" role="region" aria-label="Scrollable top opportunities table" tabIndex={0}>
            <div className="table-scroll-hint md:hidden">← Swipe to view more →</div>
            <table className="w-max min-w-[760px] max-w-none text-left text-xs">
              <thead className="bg-[#08121F] text-slate-400">
                <tr>
                  <th className="px-3 py-2">Rank</th>
                  <th className="px-3 py-2">Stock</th>
                  <th className="px-3 py-2">Score</th>
                  <th className="px-3 py-2">Conviction</th>
                  <th className="px-3 py-2">Confidence</th>
                  <th className="px-3 py-2">Impact</th>
                  <th className="px-3 py-2">Suggested Buy</th>
                </tr>
              </thead>
              <tbody>
                {core.topOpportunities.map((item) => (
                  <tr key={`${item.rank}-${item.symbol}`} className="border-t border-white/10">
                    <td className="px-3 py-2 text-slate-300">{item.rank}</td>
                    <td className="px-3 py-2 font-semibold text-white">{item.symbol}</td>
                    <td className="px-3 py-2 text-amber-200">{item.score}</td>
                    <td className="px-3 py-2 text-cyan-200">
                      {item.conviction} · {item.convictionLabel}
                    </td>
                    <td className="px-3 py-2 text-slate-300">{item.confidence}%</td>
                    <td className={cn("px-3 py-2 font-semibold", item.portfolioImpact.scoreChange >= 0 ? "text-emerald-300" : "text-rose-300")}>
                      {item.portfolioImpact.scoreChange >= 0 ? "+" : ""}
                      {item.portfolioImpact.scoreChange}
                    </td>
                    <td className="px-3 py-2 text-slate-300">
                      {item.suggestedInvestment > 0 ? formatCurrency(item.suggestedInvestment) : "Hold"}
                    </td>
                  </tr>
                ))}
                {core.topOpportunities.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-4 text-slate-400">
                      No buy opportunity clears the current filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-white/10 bg-[#16263D] p-4">
          <h3 className="text-sm font-semibold text-white">Sell Discipline</h3>
          <div className="mt-3 space-y-2">
            {core.sellDiscipline.slice(0, 5).map((item) => (
              <div key={`${item.action}-${item.symbol}`} className="rounded-lg border border-white/10 bg-[#08121F] px-3 py-2 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-white">{item.symbol}</span>
                  <span className={cn("font-semibold", item.action === "EXIT" ? "text-rose-300" : item.action === "REDUCE" ? "text-orange-300" : "text-amber-300")}>
                    {item.action}
                  </span>
                </div>
                <div className="mt-1 text-slate-400">{item.reason}</div>
                <div className="mt-1 text-slate-500">{item.urgency}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {leadOpportunity ? (
        <section className="rounded-xl border border-emerald-300/20 bg-[#16263D] p-4">
          <h3 className="text-sm font-semibold text-white">Execution Template</h3>
          <div className="mt-3 grid gap-2 text-xs text-slate-300 md:grid-cols-3 xl:grid-cols-4">
            <ExplainMetric label="Recommendation" value={`${leadOpportunity.symbol} ${leadOpportunity.action}`} />
            <ExplainMetric label="Confidence" value={`${leadOpportunity.confidence}%`} />
            <ExplainMetric label="Conviction" value={`${leadOpportunity.conviction} · ${leadOpportunity.convictionLabel}`} />
            <ExplainMetric label="CMP" value={leadOpportunity.cmp > 0 ? formatCurrency(leadOpportunity.cmp) : "Pending"} />
            <ExplainMetric label="Buy Range" value={leadOpportunity.buyRange} />
            <ExplainMetric label="Stop Loss" value={leadOpportunity.stopLoss > 0 ? formatCurrency(leadOpportunity.stopLoss) : "Pending"} />
            <ExplainMetric label="Target" value={leadOpportunity.target > 0 ? formatCurrency(leadOpportunity.target) : "Pending"} />
            <ExplainMetric label="Time Horizon" value={leadOpportunity.timeHorizon} />
            <ExplainMetric label="Risk Level" value={leadOpportunity.riskLevel} />
            <ExplainMetric label="Portfolio Impact" value={`${leadOpportunity.portfolioImpact.scoreChange >= 0 ? "+" : ""}${leadOpportunity.portfolioImpact.scoreChange} Score`} />
            <ExplainMetric label="Current Weight" value={`${leadOpportunity.currentWeight.toFixed(1)}%`} />
            <ExplainMetric label="Target Weight" value={`${leadOpportunity.targetWeight.toFixed(1)}%`} />
          </div>
          <div className="mt-3 rounded-lg border border-white/10 bg-[#08121F] p-3 text-xs leading-5 text-slate-300">
            <span className="font-semibold text-emerald-200">Reason: </span>
            {leadOpportunity.reason}
            <div className="mt-2 text-slate-400">
              Portfolio Impact: {leadOpportunity.portfolioImpact.currentScore} to{" "}
              {leadOpportunity.portfolioImpact.projectedScore};{" "}
              {leadOpportunity.portfolioImpact.sectorAllocationChange};{" "}
              {leadOpportunity.portfolioImpact.riskChange};{" "}
              {leadOpportunity.portfolioImpact.diversificationChange}.
            </div>
          </div>
        </section>
      ) : null}

      <div className="grid gap-4">
        <section className="rounded-xl border border-white/10 bg-[#16263D] p-4">
          <h3 className="text-sm font-semibold text-white">
            Why This Recommendation
          </h3>
          <div className="mt-3 grid gap-2 text-xs text-slate-300 sm:grid-cols-3">
            <ExplainMetric label="Market Bias" value={intelligence.explainability.marketBias} />
            <ExplainMetric label="VIX" value={intelligence.explainability.vix} />
            <ExplainMetric label="Fear & Greed" value={intelligence.explainability.fearGreed} />
            <ExplainMetric label="Sector Strength" value={intelligence.explainability.sectorStrength} />
            <ExplainMetric label="Portfolio Risk" value={intelligence.explainability.portfolioRisk} />
            <ExplainMetric label="Historical Accuracy" value={intelligence.explainability.historicalAccuracy} />
          </div>
          <ul className="mt-3 grid gap-2 text-xs text-slate-300 md:grid-cols-2">
            {intelligence.explainability.reasons.map((reason) => (
              <li key={reason} className="rounded-lg border border-white/10 bg-[#08121F] px-3 py-2">
                {reason}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="rounded-xl border border-white/10 bg-[#16263D] p-4">
        <h3 className="text-sm font-semibold text-white">Learning Summary</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {core.learningSummary.slice(0, 3).map((item) => (
            <ExplainMetric
              key={item.label}
              label={item.label}
              value={item.successRate === null ? "Pending Data" : `${item.successRate}% Success`}
            />
          ))}
        </div>
      </section>
    </section>
  );
}

export function RecommendationReliability({
  intelligence,
}: {
  intelligence: DecisionIntelligence | null;
}) {
  if (!intelligence) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-cyan-300/20 bg-[#0F1B2D] p-5 shadow-xl">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-white">Recommendation Reliability</h2>
        <SourceBadge label="CALCULATED" />
      </div>
      <div className="mt-3 grid gap-2">
        <ReliabilityRow title="Last 30 Days" data={intelligence.reliability.last30Days} />
        <ReliabilityRow title="Last 90 Days" data={intelligence.reliability.last90Days} />
        <ReliabilityRow title="All Time" data={intelligence.reliability.allTime} />
      </div>
      <div className="mt-3 rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs text-cyan-100">
        Confidence = signal strength {intelligence.confidence.signalStrength}% x
        historical accuracy modifier {intelligence.confidence.historicalAccuracy}%.
      </div>
    </section>
  );
}

function ActionCard({
  icon,
  title,
  value,
  detail,
  reason,
  tone,
}: {
  icon: ReactNode;
  title: string;
  value: string;
  detail: string;
  reason: string;
  tone: keyof typeof toneClasses;
}) {
  return (
    <article className={cn("min-h-52 rounded-xl border bg-[#16263D] p-4 shadow-sm", toneClasses[tone].border)}>
      <div className="flex items-center justify-between gap-3">
        <div className={cn("rounded-lg border p-2", toneClasses[tone].badge)}>
          {icon}
        </div>
        <div className="text-xs uppercase tracking-[0.16em] text-slate-500">{title}</div>
      </div>
      <div className={cn("mt-4 line-clamp-2 text-xl font-semibold", toneClasses[tone].text)}>
        {value}
      </div>
      <div className="mt-2 text-sm font-semibold text-slate-200">{detail}</div>
      <p className="mt-3 line-clamp-4 text-xs leading-5 text-slate-400">{reason}</p>
    </article>
  );
}

function SourceBadge({ label }: { label: "LIVE" | "CALCULATED" }) {
  return (
    <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-[10px] font-semibold tracking-[0.12em] text-cyan-200">
      {label}
    </span>
  );
}

function ExplainMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#08121F] p-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-1 font-semibold text-slate-100">{value}</div>
    </div>
  );
}

function ReliabilityRow({
  title,
  data,
}: {
  title: string;
  data: DecisionIntelligence["reliability"]["last30Days"];
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#08121F] p-3 text-xs">
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold text-slate-100">{title}</span>
        <span className="text-slate-500">{data.sampleSize} scored</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-slate-400">
        <span>Win Rate: {formatNullablePercent(data.winRate)}</span>
        <span>Success: {formatNullablePercent(data.successRate)}</span>
        <span>Avg Return: Pending data</span>
        <span>Drawdown: Pending data</span>
      </div>
    </div>
  );
}

function biasTone(value: string) {
  if (value === "Bullish") return "up";
  if (value === "Bearish") return "down";
  return "flat";
}

function riskTone(value: string) {
  if (value === "GREEN") return "up";
  if (value === "RED") return "down";
  return "flat";
}

function opportunityTone(score: number) {
  if (score >= 70) return "up";
  if (score < 40) return "down";
  return "flat";
}

function severityTone(value: string) {
  if (value === "HIGH") return "down";
  if (value === "LOW") return "up";
  return "flat";
}

function regimeTone(value: string) {
  if (value === "Bull Market" || value === "Risk-On") return "up";
  if (value === "Correction" || value === "Risk-Off") return "down";
  return "flat";
}

function actionTone(value: string) {
  if (value === "BUY") return "up";
  if (value === "PROTECT CAPITAL" || value === "REDUCE RISK") return "down";
  return "flat";
}

function getActionExecution(value: string) {
  if (value === "BUY") {
    return { horizon: "Swing Trade", risk: "Medium" };
  }

  if (value === "PROTECT CAPITAL" || value === "REDUCE RISK") {
    return { horizon: "Short Term", risk: "High" };
  }

  return { horizon: "Long Term", risk: "Low" };
}

function formatNullablePercent(value: number | null) {
  return value === null ? "NA" : `${Math.round(value)}%`;
}

const toneClasses = {
  up: {
    border: "border-emerald-300/25",
    badge: "border-emerald-300/25 bg-emerald-300/10 text-emerald-300",
    text: "text-emerald-300",
  },
  down: {
    border: "border-rose-300/25",
    badge: "border-rose-300/25 bg-rose-300/10 text-rose-300",
    text: "text-rose-300",
  },
  flat: {
    border: "border-amber-300/25",
    badge: "border-amber-300/25 bg-amber-300/10 text-amber-300",
    text: "text-amber-300",
  },
} as const;
