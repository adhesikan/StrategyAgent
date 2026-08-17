/**
 * client/src/components/execution/ExecutionPreflightPanel.tsx
 *
 * Sprint 2.8.0 — Execution Preflight Panel
 *
 * User-facing preflight panel from the Trade Plan page.
 * CTA: "Check Execution Preconditions" — NOT "Place Trade".
 * Shows all 12 validation dimensions, blockers, warnings, validUntil.
 * Includes mandatory compliance disclaimer.
 * Never shows order fields, trade approval language, or "Place Order" CTA.
 */

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ExecutionPreflightResult, ValidationDimension, ValidationStatus } from "@shared/execution-types";
import { EXECUTION_PREFLIGHT_DISCLAIMER } from "@shared/execution-types";

// ─── Icons (inline SVG to avoid dependency on icon library) ─────────────────

function CheckIcon() {
  return (
    <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg className="w-4 h-4 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    </svg>
  );
}

function QuestionIcon() {
  return (
    <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function SkipIcon() {
  return (
    <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
    </svg>
  );
}

// ─── Status helpers ──────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: ValidationStatus | "SKIPPED" }) {
  switch (status) {
    case "PASS":             return <CheckIcon />;
    case "FAIL":             return <XIcon />;
    case "REQUIRES_REVIEW":  return <AlertIcon />;
    case "UNAVAILABLE":      return <QuestionIcon />;
    // Sprint 2.8.7A: new brokerless status values
    case "NOT_CONNECTED":    return <QuestionIcon />;
    case "NOT_APPLICABLE":   return <SkipIcon />;
    case "NOT_CONFIRMED":    return <QuestionIcon />;
    case "PLANNING_MODE":    return <QuestionIcon />;
    default:                 return <SkipIcon />;
  }
}

function statusColor(status: ValidationStatus | string): string {
  switch (status) {
    case "PASS":             return "text-green-400";
    case "FAIL":             return "text-red-400";
    case "REQUIRES_REVIEW":  return "text-yellow-400";
    case "UNAVAILABLE":      return "text-slate-400";
    // Sprint 2.8.7A: new values — neutral slate (not error)
    case "NOT_CONNECTED":    return "text-slate-400";
    case "NOT_APPLICABLE":   return "text-slate-500";
    case "NOT_CONFIRMED":    return "text-amber-400";
    case "PLANNING_MODE":    return "text-blue-400";
    default:                 return "text-slate-500";
  }
}

function overallStatusBadge(status: string): { label: string; cls: string } {
  switch (status) {
    case "PASS":
      return { label: "Preconditions Met", cls: "bg-green-900/50 text-green-300 border-green-700" };
    case "FAIL":
      return { label: "Blockers Found", cls: "bg-red-900/50 text-red-300 border-red-700" };
    case "REQUIRES_REVIEW":
      return { label: "Review Required", cls: "bg-yellow-900/50 text-yellow-300 border-yellow-700" };
    case "UNAVAILABLE":
      return { label: "Cannot Evaluate", cls: "bg-slate-800 text-slate-400 border-slate-600" };
    case "EXECUTION_DISABLED":
      return { label: "Execution Disabled", cls: "bg-slate-800 text-slate-400 border-slate-600" };
    default:
      return { label: status, cls: "bg-slate-800 text-slate-400 border-slate-600" };
  }
}

// ─── Dimension row ───────────────────────────────────────────────────────────

function DimensionRow({ dim }: { dim: ValidationDimension }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-slate-700/50 last:border-0">
      <div className="mt-0.5 flex-shrink-0">
        <StatusIcon status={dim.status} />
      </div>
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-medium ${statusColor(dim.status)}`}>
          {dim.label}
        </div>
        {dim.note && (
          <div className="text-xs text-slate-400 mt-0.5">{dim.note}</div>
        )}
      </div>
      <div className={`text-xs font-mono ${statusColor(dim.status)}`}>
        {dim.status}
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

interface ExecutionPreflightPanelProps {
  tradePlanId: string;
  brokerConnected: boolean;
}

export function ExecutionPreflightPanel({
  tradePlanId,
  brokerConnected,
}: ExecutionPreflightPanelProps) {
  const queryClient = useQueryClient();
  const [runCount, setRunCount] = useState(0);

  // Fetch existing preflight result
  const { data: existing, isLoading: loadingExisting } = useQuery<ExecutionPreflightResult & { isExpired?: boolean }>({
    queryKey: ["execution-preflight", tradePlanId],
    queryFn: async () => {
      const res = await fetch(`/api/trade-plans/${tradePlanId}/execution/preflight`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Could not load preflight.");
      return res.json();
    },
    retry: false,
    staleTime: 60_000,
  });

  // Run new preflight
  const runPreflight = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/trade-plans/${tradePlanId}/execution/preflight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}), // No bypass fields
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Preflight failed." }));
        throw new Error(data.error ?? "Preflight failed.");
      }
      return res.json();
    },
    onSuccess: () => {
      setRunCount(c => c + 1);
      queryClient.invalidateQueries({ queryKey: ["execution-preflight", tradePlanId] });
    },
  });

  const result = runPreflight.data ?? existing;
  const isExpired = existing?.isExpired;

  // Ordered dimension entries
  const dimensions = result ? [
    result.tradePlanValidation,
    result.lifecycleValidation,
    result.freshnessValidation,
    result.brokerValidation,
    result.accountValidation,
    result.permissionsValidation,
    result.buyingPowerValidation,
    result.positionValidation,
    result.quoteValidation,
    result.structureValidation,
    result.riskValidation,
  ] : [];

  const badge = result ? overallStatusBadge(result.overallStatus) : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h3 className="text-base font-semibold text-slate-100">Execution Preflight</h3>
        <p className="text-xs text-slate-400 mt-1">
          Checks technical preconditions that would need to be satisfied before a future broker order could be prepared.
        </p>
      </div>

      {/* Status badge */}
      {result && badge && (
        <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded border text-sm font-medium ${badge.cls}`}>
          <StatusIcon status={result.overallStatus as any} />
          {badge.label}
          {result.validUntil && !isExpired && (
            <span className="ml-1 text-xs opacity-70">
              · expires {new Date(result.validUntil).toLocaleTimeString()}
            </span>
          )}
          {isExpired && (
            <span className="ml-1 text-xs text-amber-400">· Expired — re-run</span>
          )}
        </div>
      )}

      {/* Run button — Sprint 2.8.7A: no longer disabled when broker absent */}
      <div>
        <button
          onClick={() => runPreflight.mutate()}
          disabled={runPreflight.isPending}
          className="px-4 py-2 text-sm font-medium rounded transition-colors bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60"
        >
          {runPreflight.isPending ? "Checking…" : "Check Execution Preconditions"}
        </button>

        {!brokerConnected && (
          <p className="text-xs text-slate-400 mt-1">No broker connected — independent plan checks will run; broker dimensions will show NOT_CONNECTED.</p>
        )}

        {runPreflight.error && (
          <p className="text-xs text-red-400 mt-1">{(runPreflight.error as Error).message}</p>
        )}
      </div>

      {/* Execution disabled notice */}
      {result?.overallStatus === "EXECUTION_DISABLED" && (
        <div className="rounded bg-slate-800 border border-slate-600 p-3 text-sm text-slate-400">
          Order submission is currently disabled. This preflight checks technical readiness only.
        </div>
      )}

      {/* Validation dimensions */}
      {dimensions.length > 0 && (
        <div className="rounded-lg border border-slate-700 bg-slate-800/50">
          <div className="px-4 py-2 border-b border-slate-700">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
              Validation Dimensions
            </span>
          </div>
          <div className="px-4 py-2 divide-y divide-slate-700/50">
            {dimensions.map((dim, i) => (
              <DimensionRow key={i} dim={dim} />
            ))}
          </div>
        </div>
      )}

      {/* Blockers */}
      {result && result.blockers.length > 0 && (
        <div className="rounded-lg border border-red-800/50 bg-red-900/10 p-4">
          <div className="text-xs font-semibold text-red-400 uppercase tracking-wide mb-2">
            Blockers ({result.blockers.length})
          </div>
          <ul className="space-y-1.5">
            {result.blockers.map((b: { code: string; message: string }, i: number) => (
              <li key={i} className="text-sm text-red-300">
                <span className="font-mono text-xs text-red-500 mr-2">[{b.code}]</span>
                {b.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Warnings */}
      {result && result.warnings.length > 0 && (
        <div className="rounded-lg border border-yellow-800/50 bg-yellow-900/10 p-4">
          <div className="text-xs font-semibold text-yellow-400 uppercase tracking-wide mb-2">
            Warnings ({result.warnings.length})
          </div>
          <ul className="space-y-1.5">
            {result.warnings.map((w: { code: string; message: string }, i: number) => (
              <li key={i} className="text-sm text-yellow-300">
                <span className="font-mono text-xs text-yellow-600 mr-2">[{w.code}]</span>
                {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Order submission notice */}
      {result && result.overallStatus !== "EXECUTION_DISABLED" && (
        <div className="rounded bg-slate-800/50 border border-slate-700 p-3 text-sm text-slate-400">
          Order submission remains disabled. A passing preflight does not initiate a trade.
        </div>
      )}

      {/* Compliance disclaimer */}
      <div className="rounded bg-slate-900 border border-slate-700 p-3 text-xs text-slate-500">
        <div className="font-semibold text-slate-400 mb-1">Important Notice</div>
        {EXECUTION_PREFLIGHT_DISCLAIMER}
      </div>

      {/* Evaluated at */}
      {result && (
        <div className="text-xs text-slate-600">
          Evaluated {new Date(result.evaluatedAt).toLocaleString()}
          {result.provider && ` · ${result.provider}`}
          {" · Methodology v"}{result.methodologyVersion}
        </div>
      )}
    </div>
  );
}

export default ExecutionPreflightPanel;
