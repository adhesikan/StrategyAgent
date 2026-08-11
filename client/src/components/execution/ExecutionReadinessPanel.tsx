/**
 * client/src/components/execution/ExecutionReadinessPanel.tsx — Sprint 2.8.4
 *
 * Execution Readiness & Guardrails UI Panel.
 *
 * PERMANENT INVARIANTS:
 *   - Shows READY / READY_WITH_WARNINGS / BLOCKED status clearly.
 *   - Status is determined server-side and displayed verbatim — NEVER modified client-side.
 *   - The AI assistant may explain findings via the Workspace; it may NEVER alter the status.
 *   - No order submission CTA exists in this component.
 *   - "Continue to Review" CTA is shown only when READY or READY_WITH_WARNINGS.
 *   - BLOCKED state disables all progression with a clear message.
 *   - All labels comply with forbidden-label policy (no "Trade Approved", "Go", etc.).
 */

import React, { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle, AlertTriangle, XCircle, ChevronDown, ChevronUp,
  RefreshCw, Info, Lock, Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type {
  ExecutionReadinessResult,
  ExecutionReadinessFinding,
  ExecutionReadinessFindingCategory,
  ExecutionReadinessFindingSeverity,
} from "../../../../shared/execution-readiness-types";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface ExecutionReadinessPanelProps {
  tradePlanId: string;
  orderDraftId: string;
  onEditDraft?: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// STATUS CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  READY: {
    icon: CheckCircle,
    color: "text-green-400",
    bg: "bg-green-950/40",
    border: "border-green-800/60",
    badgeVariant: "default" as const,
    badgeClass: "bg-green-900/60 text-green-300 border-green-700",
    label: "Ready for Review",
    cta: "Continue to Review",
  },
  READY_WITH_WARNINGS: {
    icon: AlertTriangle,
    color: "text-amber-400",
    bg: "bg-amber-950/40",
    border: "border-amber-800/60",
    badgeVariant: "outline" as const,
    badgeClass: "bg-amber-900/60 text-amber-300 border-amber-700",
    label: "Ready with Warnings",
    cta: "Review Warnings",
  },
  BLOCKED: {
    icon: XCircle,
    color: "text-red-400",
    bg: "bg-red-950/40",
    border: "border-red-800/60",
    badgeVariant: "destructive" as const,
    badgeClass: "bg-red-900/60 text-red-300 border-red-700",
    label: "Blocked",
    cta: null,
  },
} as const;

const CATEGORY_LABELS: Record<ExecutionReadinessFindingCategory, string> = {
  MARKET_DATA: "Market Data",
  ACCOUNT:     "Account",
  POSITION:    "Position",
  CAPITAL:     "Capital",
  STRUCTURE:   "Structure",
  RISK:        "Assignment & Risk",
  EXPIRATION:  "Expiration",
  LIQUIDITY:   "Liquidity",
  PRICING:     "Pricing",
};

const CATEGORY_ORDER: ExecutionReadinessFindingCategory[] = [
  "MARKET_DATA", "ACCOUNT", "POSITION", "CAPITAL",
  "STRUCTURE", "RISK", "EXPIRATION", "LIQUIDITY", "PRICING",
];

const SEVERITY_ICON = {
  BLOCKER: { icon: XCircle, color: "text-red-400" },
  WARNING: { icon: AlertTriangle, color: "text-amber-400" },
  INFO:    { icon: CheckCircle, color: "text-green-400" },
};

// ─────────────────────────────────────────────────────────────────────────────
// HOOKS
// ─────────────────────────────────────────────────────────────────────────────

function useExecutionReadiness(tradePlanId: string) {
  return useQuery<{ readiness: ExecutionReadinessResult } | null>({
    queryKey: ["execution-readiness", tradePlanId, "latest"],
    queryFn: async () => {
      const res = await fetch(`/api/trade-plans/${tradePlanId}/execution-readiness/latest`, {
        credentials: "include",
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to load readiness");
      return res.json();
    },
    staleTime: 60_000,
    retry: false,
  });
}

function useEvaluateReadiness(tradePlanId: string, orderDraftId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/trade-plans/${tradePlanId}/execution-readiness`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ orderDraftId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? "Readiness evaluation failed");
      }
      return res.json() as Promise<{ readiness: ExecutionReadinessResult }>;
    },
    onSuccess: (data) => {
      qc.setQueryData(["execution-readiness", tradePlanId, "latest"], data);
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function FindingRow({ finding }: { finding: ExecutionReadinessFinding }) {
  const { icon: Icon, color } = SEVERITY_ICON[finding.severity];
  return (
    <div className="flex gap-3 py-2">
      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${color}`} />
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-200">{finding.title}</div>
        <div className="text-xs text-slate-400 mt-0.5">{finding.message}</div>
        {finding.legIndex !== undefined && (
          <span className="text-xs text-slate-500 mt-0.5">Leg {finding.legIndex + 1}</span>
        )}
      </div>
    </div>
  );
}

function CategorySection({ category, findings }: {
  category: ExecutionReadinessFindingCategory;
  findings: ExecutionReadinessFinding[];
}) {
  const [open, setOpen] = useState(true);
  const blockers = findings.filter(f => f.severity === "BLOCKER");
  const warnings = findings.filter(f => f.severity === "WARNING");
  const infos = findings.filter(f => f.severity === "INFO");

  const badgeEl = blockers.length > 0
    ? <span className="text-xs bg-red-900/40 text-red-300 px-2 py-0.5 rounded-full">{blockers.length} blocker{blockers.length > 1 ? "s" : ""}</span>
    : warnings.length > 0
      ? <span className="text-xs bg-amber-900/40 text-amber-300 px-2 py-0.5 rounded-full">{warnings.length} warning{warnings.length > 1 ? "s" : ""}</span>
      : <span className="text-xs bg-green-900/40 text-green-300 px-2 py-0.5 rounded-full">{infos.length > 0 ? "✓" : "—"}</span>;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center justify-between py-2 hover:text-slate-200 transition-colors group">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-300">{CATEGORY_LABELS[category]}</span>
          {badgeEl}
        </div>
        {open
          ? <ChevronUp className="h-4 w-4 text-slate-500 group-hover:text-slate-300" />
          : <ChevronDown className="h-4 w-4 text-slate-500 group-hover:text-slate-300" />}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pl-1 pb-1 space-y-0 divide-y divide-slate-800/60">
          {findings.map((f, i) => <FindingRow key={`${f.code}-${i}`} finding={f} />)}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function CapitalCard({ result }: { result: ExecutionReadinessResult }) {
  const est = result.capitalEstimate;
  if (!est) return null;
  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4 mt-3">
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Capital Estimate</div>
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-semibold text-slate-200">
          {est.estimatedRequirementUsd !== null
            ? `$${est.estimatedRequirementUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : "Broker calculation required"}
        </span>
        <span className="text-xs text-slate-500">(estimate only)</span>
      </div>
      <div className="text-xs text-slate-400 mt-1">{est.breakdown}</div>
      <div className="text-xs text-slate-500 mt-2 italic">{est.disclaimer}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PANEL
// ─────────────────────────────────────────────────────────────────────────────

export function ExecutionReadinessPanel({
  tradePlanId,
  orderDraftId,
  onEditDraft,
}: ExecutionReadinessPanelProps) {
  const { data: latestData, isLoading } = useExecutionReadiness(tradePlanId);
  const evaluate = useEvaluateReadiness(tradePlanId, orderDraftId);
  const [expanded, setExpanded] = useState(true);

  const result: ExecutionReadinessResult | null = evaluate.data?.readiness ?? latestData?.readiness ?? null;
  const statusCfg = result ? STATUS_CONFIG[result.status] : null;
  const StatusIcon = statusCfg?.icon ?? Shield;

  const groupedFindings = CATEGORY_ORDER
    .map(cat => ({
      category: cat,
      findings: (result?.findings ?? []).filter(f => f.category === cat),
    }))
    .filter(g => g.findings.length > 0);

  const handleEvaluate = useCallback(() => {
    evaluate.mutate();
  }, [evaluate]);

  return (
    <div className="rounded-xl border border-slate-700/60 bg-slate-900/60 overflow-hidden mt-4">
      {/* Non-execution banner */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-800/60 border-b border-slate-700/40">
        <Lock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
        <span className="text-xs text-slate-400">
          Execution Readiness Check — No order has been submitted to your broker.
        </span>
      </div>

      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-slate-400" />
            <h3 className="text-base font-semibold text-slate-200">Execution Readiness</h3>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(e => !e)}
            className="text-slate-400 hover:text-slate-200 h-8 px-2"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Deterministic pre-trade check. The AI assistant may explain findings but may not change this result.
        </p>
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-4">
          {/* Status banner */}
          {result && statusCfg && (
            <div className={`rounded-lg border px-4 py-3 flex items-start gap-3 ${statusCfg.bg} ${statusCfg.border}`}>
              <StatusIcon className={`h-5 w-5 mt-0.5 shrink-0 ${statusCfg.color}`} />
              <div>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-semibold ${statusCfg.color}`}>
                    {statusCfg.label}
                  </span>
                  <Badge variant="outline" className={`text-xs h-5 px-2 ${statusCfg.badgeClass}`}>
                    {result.blockerCount > 0 ? `${result.blockerCount} blocker${result.blockerCount > 1 ? "s" : ""}` :
                      result.warningCount > 0 ? `${result.warningCount} warning${result.warningCount > 1 ? "s" : ""}` :
                      "All checks pass"}
                  </Badge>
                </div>
                <p className="text-xs text-slate-400 mt-1">{result.statusDescription}</p>
              </div>
            </div>
          )}

          {/* Not yet evaluated */}
          {!result && !isLoading && !evaluate.isPending && (
            <div className="text-center py-6">
              <Shield className="h-10 w-10 text-slate-600 mx-auto mb-3" />
              <p className="text-sm text-slate-400">Run readiness check to validate this order structure.</p>
              <p className="text-xs text-slate-500 mt-1">
                Checks quote freshness, broker connectivity, positions, capital, and structure.
              </p>
            </div>
          )}

          {/* Loading */}
          {(isLoading || evaluate.isPending) && (
            <div className="flex items-center gap-2 text-slate-400 py-4 justify-center">
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span className="text-sm">Evaluating readiness...</span>
            </div>
          )}

          {/* Error */}
          {evaluate.isError && (
            <div className="rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
              <AlertTriangle className="h-4 w-4 inline mr-2" />
              {evaluate.error instanceof Error ? evaluate.error.message : "Evaluation failed. Try again."}
            </div>
          )}

          {/* Capital estimate */}
          {result && <CapitalCard result={result} />}

          {/* Findings by category */}
          {result && groupedFindings.length > 0 && (
            <div>
              <Separator className="bg-slate-800 mb-3" />
              <div className="space-y-1 divide-y divide-slate-800/60">
                {groupedFindings.map(g => (
                  <CategorySection key={g.category} category={g.category} findings={g.findings} />
                ))}
              </div>
            </div>
          )}

          {/* CTA section */}
          <Separator className="bg-slate-800" />
          <div className="flex gap-3 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={handleEvaluate}
              disabled={evaluate.isPending}
              className="border-slate-600 text-slate-300 hover:bg-slate-800"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${evaluate.isPending ? "animate-spin" : ""}`} />
              {result ? "Re-check Readiness" : "Check Readiness"}
            </Button>

            {result?.status === "BLOCKED" && (
              <div className="flex items-center gap-2 text-xs text-red-400 mt-1 w-full">
                <XCircle className="h-3.5 w-3.5 shrink-0" />
                Resolve blockers before continuing.
              </div>
            )}

            {result?.status === "READY" && (
              <Button
                variant="outline"
                size="sm"
                disabled
                className="border-green-800/60 text-green-400 opacity-60 cursor-not-allowed"
              >
                Continue to Review
                <span className="ml-2 text-xs text-slate-500">(Sprint 2.8.5)</span>
              </Button>
            )}

            {result?.status === "READY_WITH_WARNINGS" && (
              <Button
                variant="outline"
                size="sm"
                disabled
                className="border-amber-800/60 text-amber-400 opacity-60 cursor-not-allowed"
              >
                Review Warnings &amp; Continue
                <span className="ml-2 text-xs text-slate-500">(Sprint 2.8.5)</span>
              </Button>
            )}

            {onEditDraft && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onEditDraft}
                className="text-slate-400 hover:text-slate-200"
              >
                Edit Draft
              </Button>
            )}
          </div>

          {/* Disclaimer */}
          {result && (
            <div className="mt-3 p-3 rounded-lg bg-slate-800/40 border border-slate-700/30">
              <div className="flex items-start gap-2">
                <Info className="h-3.5 w-3.5 text-slate-500 mt-0.5 shrink-0" />
                <p className="text-xs text-slate-500 leading-relaxed">{result.disclaimer}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
