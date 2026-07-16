"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, FlaskConical, RefreshCw, ShieldCheck } from "lucide-react";
import type { AgentValidationReport } from "@/lib/agents/validationTypes";
import type { ManagedPortfolio } from "@/lib/portfolio";
import type { ModelEvaluation } from "@/lib/model-evaluation";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type ValidationPreflight = {
  readyToRun: boolean;
  readyForPromotionEvidence: boolean;
  mode: "shadow";
  checks: Array<{
    id: string;
    label: string;
    configured: boolean;
    requiredAccess: string;
    impact: string;
  }>;
  report?: AgentValidationReport | null;
  recentReports?: AgentValidationReport[];
  evaluation?: ModelEvaluation;
};

export function AdminAgentValidationDashboard({
  portfolios,
}: {
  portfolios: ManagedPortfolio[];
}) {
  const candidates = useMemo(
    () => portfolios.filter((portfolio) => portfolio.positions.length > 0),
    [portfolios],
  );
  const [portfolioId, setPortfolioId] = useState(candidates[0]?.id ?? "");
  const [report, setReport] = useState<AgentValidationReport | null>(null);
  const [recentReports, setRecentReports] = useState<AgentValidationReport[]>([]);
  const [evaluation, setEvaluation] = useState<ModelEvaluation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preflight, setPreflight] = useState<ValidationPreflight | null>(null);
  const portfolio = candidates.find((item) => item.id === portfolioId) ?? candidates[0];

  useEffect(() => {
    if (!portfolio?.id) return;
    fetch(`/api/admin/agent-validation?portfolioId=${encodeURIComponent(portfolio.id)}`, { cache: "no-store" })
      .then(async (response) => response.ok ? await readJsonResponse<ValidationPreflight>(response) : null)
      .then((payload) => {
        setPreflight(payload);
        setReport(payload?.report ?? null);
        setRecentReports(payload?.recentReports ?? []);
        setEvaluation(payload?.evaluation ?? null);
      })
      .catch(() => setPreflight(null));
  }, [portfolio?.id]);

  async function runShadowValidation() {
    if (!portfolio) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/agent-validation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          portfolioId: portfolio.id,
          positions: portfolio.positions,
          costBasis: portfolio.inputs.map((input) => ({
            symbol: input.stockCode,
            buyPrice: input.buyPrice,
          })),
        }),
      });
      const payload = await readJsonResponse<{
        report?: AgentValidationReport;
        recentReports?: AgentValidationReport[];
        evaluation?: ModelEvaluation;
        error?: string;
      }>(response);
      if (!response.ok || !payload.report) {
        throw new Error(payload.error ?? "Shadow validation failed.");
      }
      setReport(payload.report);
      setRecentReports(payload.recentReports ?? []);
      setEvaluation(payload.evaluation ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Shadow validation failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-violet-300/25 bg-violet-300/10 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-violet-200">
              <FlaskConical className="h-4 w-4" aria-hidden="true" />
              Shadow mode only
            </div>
            <h3 className="mt-2 text-lg font-semibold text-white">Agent Validation Layer</h3>
            <p className="mt-1 max-w-3xl text-sm text-slate-300">
              Agent decisions now power the portfolio-facing recommendation tabs. This panel keeps the shadow audit trail, source coverage checks, and promotion evidence separate from the user view.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              value={portfolio?.id ?? ""}
              onChange={(event) => setPortfolioId(event.target.value)}
              className="rounded-md border border-white/10 bg-[#08121F] px-3 py-2 text-sm text-white"
              aria-label="Portfolio to validate"
            >
              {candidates.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
            <Button
              type="button"
              onClick={runShadowValidation}
              disabled={!portfolio || loading || preflight?.readyToRun === false}
            >
              {loading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Run Shadow Validation
            </Button>
          </div>
        </div>
        {error ? <p className="mt-3 text-sm text-rose-200">{error}</p> : null}
      </section>

      {preflight ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <Heading title="Access readiness" />
            <StatusBadge value={preflight.readyForPromotionEvidence ? "healthy" : "degraded"} />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {preflight.checks.map((check) => (
              <article
                key={check.id}
                className={cn(
                  "rounded-xl border p-4",
                  check.configured
                    ? "border-emerald-300/25 bg-emerald-300/10"
                    : "border-amber-300/25 bg-amber-300/10",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-white">{check.label}</h3>
                  <span className={check.configured ? "text-emerald-200" : "text-amber-200"}>
                    {check.configured ? "Configured" : "Missing"}
                  </span>
                </div>
                {!check.configured ? (
                  <>
                    <p className="mt-3 text-xs leading-5 text-slate-300">{check.impact}</p>
                    <p className="mt-2 text-xs text-amber-100">Required: {check.requiredAccess}</p>
                  </>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {evaluation ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <Heading title="Out-of-sample model evaluation" />
            <StatusBadge value={evaluation.promotionGate.eligible ? "healthy" : "degraded"} />
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Metric label="Evaluation status" value={evaluation.status} tone={evaluation.promotionGate.eligible ? "good" : "warn"} />
            <Metric label="Completed outcomes" value={`${evaluation.sample.completed}/${evaluation.promotionGate.minimumCompleted}`} />
            <Metric label="Held-out outcomes" value={`${evaluation.sample.test}/${evaluation.promotionGate.minimumTest}`} />
            <Metric label="Held-out hit rate" value={evaluation.outOfSample.hitRate == null ? "Pending" : `${evaluation.outOfSample.hitRate}%`} />
            <Metric label="Return vs cash" value={evaluation.outOfSample.excessReturnVsCashPercent == null ? "Pending" : `${evaluation.outOfSample.excessReturnVsCashPercent}%`} />
            <Metric label="Brier calibration" value={evaluation.outOfSample.brierScore == null ? "Pending" : String(evaluation.outOfSample.brierScore)} />
            <Metric label="Maximum drawdown" value={evaluation.outOfSample.maximumDrawdownPercent == null ? "Pending" : `${evaluation.outOfSample.maximumDrawdownPercent}%`} />
            <Metric label="Walk-forward folds" value={String(evaluation.walkForward.length)} />
          </div>
          {evaluation.promotionGate.reasons.length ? (
            <div className="rounded-xl border border-amber-300/25 bg-amber-300/10 p-4 text-xs leading-5 text-amber-100">
              {evaluation.promotionGate.reasons.join(" ")}
            </div>
          ) : null}
        </section>
      ) : null}

      {!report ? (
        <div className="rounded-xl border border-white/10 bg-[#16263D] p-5 text-sm text-slate-400">
          No saved shadow run exists for this portfolio yet. Use Run Shadow Validation now, or wait for the weekday scheduled run at 10:45 AM IST.
        </div>
      ) : (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Metric label="Promotion status" value={report.promotionGate.status} tone={report.promotionGate.eligible ? "good" : "warn"} />
            <Metric label="Agent accuracy" value={formatAccuracy(report.performance.agentLogic.accuracy)} />
            <Metric label="Current accuracy" value={formatAccuracy(report.performance.currentLogic.accuracy)} />
            <Metric label="Accuracy improvement" value={report.performance.accuracyImprovement === null ? "Pending" : `${report.performance.accuracyImprovement > 0 ? "+" : ""}${report.performance.accuracyImprovement} pp`} />
            <Metric label="Hit / miss" value={report.performance.hitMissRatio} />
            <Metric label="Confidence calibration" value={report.performance.confidenceCalibration === null ? "Pending" : `${report.performance.confidenceCalibration}%`} />
            <Metric label="Explanation quality" value={`${report.promotionGate.explanationQuality}/100`} />
            <Metric label="Completed shadow records" value={`${report.promotionGate.completedAgentRecommendations}/${report.promotionGate.minimumRequired}`} />
          </section>

          <section className="space-y-3">
            <Heading title="Agent health" />
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {report.agentHealth.map((agent) => (
                <article key={agent.agent} className="rounded-xl border border-white/10 bg-[#16263D] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="font-semibold text-white">{agent.agent}</h4>
                    <StatusBadge value={agent.health} />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-400">
                    <span>Signal <b className="text-white">{agent.signalScore}/5</b></span>
                    <span>Confidence <b className="text-white">{agent.confidence}%</b></span>
                    <span>Freshness <b className="text-white">{agent.freshnessScore}</b></span>
                    <span>Credibility <b className="text-white">{agent.sourceCredibilityScore}</b></span>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-slate-400">{agent.reason}</p>
                  {agent.missingInformation.length ? (
                    <p className="mt-2 text-xs text-amber-200">Missing: {agent.missingInformation.join(", ")}</p>
                  ) : null}
                </article>
              ))}
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <ValidationTable title="Source coverage" headers={["Area", "Status", "Evidence", "Confidence impact"]} rows={report.sourceCoverage.map((item) => [
              item.area,
              item.status,
              String(item.evidenceCount),
              item.confidenceImpact ? `-${item.confidenceImpact}` : "0",
            ])} />
            <ValidationTable title="Access gaps" headers={["Agent", "Missing data", "Required access", "Impact"]} rows={report.accessGaps.map((item) => [
              item.agent,
              item.missingDataType,
              item.requiredAccess,
              `-${item.confidenceImpact}`,
            ])} />
          </section>

          <ValidationTable title="Source audit" headers={["Source", "Type", "Credibility", "Reference", "Timestamp", "Freshness"]} rows={(report.agentHealth[0]?.sources ?? []).map((source) => [
            source.name,
            source.type,
            `${source.credibility} · ${source.credibilityScore}`,
            source.urlOrReference,
            source.timestamp ? new Date(source.timestamp).toLocaleString("en-IN") : "Missing",
            `${source.freshness} · ${source.freshnessScore}`,
          ])} />

          <section className="grid gap-4 xl:grid-cols-2">
            <AlertList title="Missing source alerts" rows={report.missingSourceAlerts} />
            <AlertList title="Stale data alerts" rows={report.staleDataAlerts} />
          </section>

          <ValidationTable title="Current logic vs shadow agents" headers={["Stock", "Current", "Shadow", "Match", "Confidence", "Result"]} rows={report.shadowComparison.map((item) => [
            item.symbol,
            `${item.currentLogicAction} ${item.currentLogicConfidence}%`,
            `${item.agentAction} ${item.agentConfidence}%`,
            item.sameAction ? "Yes" : "No",
            `${item.explanationQuality}/100 explanation`,
            item.result,
          ])} />

          <ValidationTable title="Orchestrator decision audit" headers={["Stock", "Final", "Supports", "Opposes", "Downgrade"]} rows={report.orchestratorValidation.map((item) => [
            item.symbol,
            `${item.finalAction} · ${item.timeframe} · ${item.confidence}%`,
            item.supportingAgents.join(", ") || "None",
            item.opposingAgents.join(", ") || "None",
            item.confidenceDowngraded ? item.downgradeReasons.join(", ") || "action changed" : "No",
          ])} />

          <section className="grid gap-4 xl:grid-cols-2">
            <ValidationTable title="Agent-wise contribution" headers={["Agent", "Completed", "Hits", "Misses", "Accuracy"]} rows={report.performance.agentContribution.map((item) => [
              item.label, String(item.completed), String(item.hits), String(item.misses), formatAccuracy(item.accuracy),
            ])} />
            <ValidationTable title="Source-wise reliability" headers={["Source type", "Completed", "Hits", "Misses", "Accuracy"]} rows={report.performance.sourceReliability.map((item) => [
              item.label, String(item.completed), String(item.hits), String(item.misses), formatAccuracy(item.accuracy),
            ])} />
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <ValidationTable title="Horizon accuracy" headers={["Horizon", "Completed", "Hits", "Misses", "Accuracy"]} rows={report.performance.horizonAccuracy.map((item) => [
              item.label, String(item.completed), String(item.hits), String(item.misses), formatAccuracy(item.accuracy),
            ])} />
            <ValidationTable title="Recent outcome reasons" headers={["Stock", "Action", "1 day", "1 week", "1 month", "Status / reason"]} rows={report.performance.recentOutcomes.map((item) => [
              item.stock, item.action, item.oneDay, item.oneWeek, item.oneMonth, `${item.status}: ${item.reason}`,
            ])} />
          </section>

          <section className={cn(
            "rounded-xl border p-4",
            report.promotionGate.eligible ? "border-emerald-300/30 bg-emerald-300/10" : "border-amber-300/30 bg-amber-300/10",
          )}>
            <div className="flex items-center gap-2 font-semibold text-white">
              {report.promotionGate.eligible ? <ShieldCheck className="h-5 w-5 text-emerald-200" /> : <AlertTriangle className="h-5 w-5 text-amber-200" />}
              Promotion gate: {report.promotionGate.status}
            </div>
            <ul className="mt-3 space-y-1 text-sm text-slate-300">
              {report.promotionGate.reasons.map((reason) => <li key={reason}>• {reason}</li>)}
            </ul>
          </section>

          {recentReports.length ? (
            <p className="text-xs text-slate-500">Stored validation runs available: {recentReports.length}. Latest run {new Date(report.generatedAt).toLocaleString("en-IN")}.</p>
          ) : null}
        </>
      )}
    </div>
  );
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const body = await response.text();
  if (!body.trim()) {
    throw new Error(
      response.ok
        ? "The validation service returned an empty response. Please retry."
        : `The validation service ended before returning details (HTTP ${response.status}).`,
    );
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`The validation service returned an invalid response (HTTP ${response.status}).`);
  }
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "good" | "warn" }) {
  return (
    <div className={cn("rounded-xl border p-4", tone === "good" ? "border-emerald-300/30 bg-emerald-300/10" : tone === "warn" ? "border-amber-300/30 bg-amber-300/10" : "border-white/10 bg-[#16263D]")}>
      <div className="text-xs uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className="mt-2 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

function Heading({ title }: { title: string }) {
  return <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-cyan-200">{title}</h3>;
}

function StatusBadge({ value }: { value: string }) {
  return <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase", value === "healthy" ? "bg-emerald-300/15 text-emerald-200" : value === "blocked" ? "bg-rose-300/15 text-rose-200" : "bg-amber-300/15 text-amber-200")}>{value}</span>;
}

function AlertList({ title, rows }: { title: string; rows: string[] }) {
  return (
    <section className="rounded-xl border border-white/10 bg-[#16263D] p-4">
      <h3 className="font-semibold text-white">{title}</h3>
      <ul className="mt-3 space-y-2 text-xs leading-5 text-slate-400">
        {rows.map((row) => <li key={row}>• {row}</li>)}
        {!rows.length ? <li>No alerts.</li> : null}
      </ul>
    </section>
  );
}

function ValidationTable({ title, headers, rows }: { title: string; headers: string[]; rows: string[][] }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-white/10">
      <div className="border-b border-white/10 bg-[#16263D] px-4 py-3 font-semibold text-white">{title}</div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow>{headers.map((header) => <TableHead key={header}>{header}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {rows.map((row, index) => <TableRow key={`${title}-${index}`}>{row.map((cell, cellIndex) => <TableCell key={`${title}-${index}-${cellIndex}`}>{cell}</TableCell>)}</TableRow>)}
            {!rows.length ? <TableRow><TableCell colSpan={headers.length}>No completed observations.</TableCell></TableRow> : null}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function formatAccuracy(value: number | null) {
  return value === null ? "Pending" : `${value}%`;
}
