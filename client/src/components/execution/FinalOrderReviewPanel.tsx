/**
 * client/src/components/execution/FinalOrderReviewPanel.tsx — Sprint 2.8.5
 *
 * Final Order Review & Consent Panel.
 *
 * PERMANENT INVARIANTS:
 *   - No broker order submission — "Confirm Order for Submission" means confirmation for a
 *     FUTURE submission step only. Nothing is sent to a broker here.
 *   - AI assistant may EXPLAIN findings, warnings, or economics — it may NOT:
 *       - waive acknowledgements
 *       - confirm for the user
 *       - alter the snapshot
 *       - alter readiness status
 *       - approve broker submission
 *   - Status labels: READY, READY_WITH_WARNINGS, BLOCKED only.
 *   - FORBIDDEN labels: Approved, Recommended, Guaranteed, Safe Trade, AI Approved, Trade Approved.
 *   - Shown only when readiness is READY or READY_WITH_WARNINGS (not BLOCKED).
 *   - Confirmation does not appear until all required acknowledgements are checked.
 */

import React, { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle, AlertTriangle, ChevronDown, ChevronUp,
  RefreshCw, Info, Lock, ShieldCheck, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import type {
  FinalOrderReviewSnapshot,
  OrderAcknowledgement,
  OrderConfirmation,
  FinalOrderReviewLeg,
  FinalOrderEconomics,
} from "../../../../shared/order-confirmation-types";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface FinalOrderReviewPanelProps {
  tradePlanId: string;
  /** Called after a successful confirmation to advance the flow */
  onConfirmed?: (confirmation: OrderConfirmation) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function fmt(v: number | null | undefined, prefix = "$"): string {
  if (v === null || v === undefined) return "Not available";
  return `${prefix}${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPrice(v: number | null | undefined): string {
  if (v === null || v === undefined) return "Not available";
  return `$${v.toFixed(2)}`;
}

function breakEvenLabel(pts: number[]): string {
  if (!pts.length) return "Not available";
  return pts.map(p => `$${p.toFixed(2)}`).join(" / ");
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function LegRow({ leg }: { leg: FinalOrderReviewLeg }) {
  const dirColor = leg.direction === "SHORT" ? "text-red-400" : "text-green-400";
  const typeLabel = leg.optionType === "call" ? "C" : "P";
  return (
    <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-3 items-center py-2 text-sm border-b border-slate-800/60 last:border-0">
      <span className={`font-semibold w-12 ${dirColor}`}>{leg.direction}</span>
      <span className="text-slate-200 font-mono text-xs">{leg.contractSymbol}</span>
      <span className="text-slate-400">{typeLabel}</span>
      <span className="text-slate-300">${leg.strike}</span>
      <span className="text-slate-400 text-xs">{leg.expiration}</span>
      <span className="text-slate-500 text-xs">{leg.dte}d</span>
    </div>
  );
}

function EconomicsCard({ eco }: { eco: FinalOrderEconomics }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-lg bg-slate-800/40 border border-slate-700/40 p-3">
        <div className="text-xs text-slate-400 mb-1">Max Profit</div>
        <div className="text-sm font-semibold text-green-400">{fmt(eco.estimatedMaxProfit)}</div>
      </div>
      <div className="rounded-lg bg-slate-800/40 border border-slate-700/40 p-3">
        <div className="text-xs text-slate-400 mb-1">Max Loss</div>
        <div className="text-sm font-semibold text-red-400">{fmt(eco.estimatedMaxLoss)}</div>
      </div>
      <div className="rounded-lg bg-slate-800/40 border border-slate-700/40 p-3">
        <div className="text-xs text-slate-400 mb-1">Capital Required</div>
        <div className="text-sm font-semibold text-slate-200">{fmt(eco.estimatedCapitalRequired)}</div>
      </div>
      <div className="rounded-lg bg-slate-800/40 border border-slate-700/40 p-3">
        <div className="text-xs text-slate-400 mb-1">Break-even</div>
        <div className="text-sm font-semibold text-slate-200">{breakEvenLabel(eco.breakEvenPoints)}</div>
      </div>
      <div className="col-span-2 text-xs text-slate-500 italic">{eco.feesDisclaimer}</div>
    </div>
  );
}

function AcknowledgementItem({
  ack, checked, onChange,
}: {
  ack: OrderAcknowledgement;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = `ack-${ack.code}`;
  return (
    <div className={`flex gap-3 items-start p-3 rounded-lg border transition-colors ${
      checked
        ? "bg-slate-800/60 border-slate-600/60"
        : ack.required
          ? "bg-slate-900/40 border-slate-700/40 hover:border-slate-600/60"
          : "bg-slate-900/30 border-slate-700/30"
    }`}>
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        className="mt-0.5 border-slate-500 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
      />
      <div className="flex-1">
        <Label htmlFor={id} className="text-sm font-medium text-slate-200 cursor-pointer">
          {ack.title}
          {ack.required && <span className="text-red-400 ml-1">*</span>}
        </Label>
        <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{ack.text}</p>
      </div>
    </div>
  );
}

function ConfirmedBanner({ confirmation }: { confirmation: OrderConfirmation }) {
  return (
    <div className="rounded-xl border border-green-800/60 bg-green-950/40 p-5 text-center">
      <CheckCircle className="h-10 w-10 text-green-400 mx-auto mb-3" />
      <h3 className="text-lg font-semibold text-green-300 mb-1">Order Confirmed</h3>
      <p className="text-sm text-slate-400 mb-3">Ready for the next submission step.</p>
      <div className="inline-flex items-center gap-2 rounded-lg bg-slate-800/60 border border-slate-700/40 px-3 py-2">
        <Lock className="h-3.5 w-3.5 text-slate-500 shrink-0" />
        <span className="text-xs text-slate-500 font-mono break-all">
          {confirmation.snapshotHash.slice(0, 16)}…
        </span>
      </div>
      <p className="text-xs text-slate-500 mt-3 italic">
        Confirmation does not send the order to your broker.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HOOKS
// ─────────────────────────────────────────────────────────────────────────────

function useFinalReview(tradePlanId: string) {
  return useQuery<{ snapshot: FinalOrderReviewSnapshot | null; confirmation: OrderConfirmation | null } | null>({
    queryKey: ["final-review", tradePlanId],
    queryFn: async () => {
      const res = await fetch(`/api/trade-plans/${tradePlanId}/final-review`, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to load review");
      return res.json();
    },
    staleTime: 30_000,
    retry: false,
  });
}

function useCreateReview(tradePlanId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/trade-plans/${tradePlanId}/final-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? "Failed to create review");
      }
      return res.json() as Promise<{ snapshot: FinalOrderReviewSnapshot; acknowledgements: OrderAcknowledgement[] }>;
    },
    onSuccess: (data) => {
      qc.setQueryData(["final-review", tradePlanId], {
        snapshot: data.snapshot,
        confirmation: null,
      });
    },
  });
}

function useConfirm(tradePlanId: string, snapshotId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (acknowledgementCodes: string[]) => {
      const res = await fetch(`/api/trade-plans/${tradePlanId}/final-review/${snapshotId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ acknowledgementCodes }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? "Confirmation failed");
      }
      return res.json() as Promise<{ confirmation: OrderConfirmation; message: string; nextStep: string }>;
    },
    onSuccess: (data) => {
      qc.setQueryData(["final-review", tradePlanId], (old: any) => ({
        ...(old ?? {}),
        confirmation: data.confirmation,
      }));
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PANEL
// ─────────────────────────────────────────────────────────────────────────────

export function FinalOrderReviewPanel({ tradePlanId, onConfirmed }: FinalOrderReviewPanelProps) {
  const { data: reviewData, isLoading } = useFinalReview(tradePlanId);
  const createReview = useCreateReview(tradePlanId);

  const snapshot = createReview.data?.snapshot ?? reviewData?.snapshot ?? null;
  const confirmation = reviewData?.confirmation ?? null;

  const [checkedAcks, setCheckedAcks] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(true);

  const confirmMutation = useConfirm(tradePlanId, snapshot?.id ?? "");

  // Reset checked acks when snapshot changes
  const snapshotId = snapshot?.id;
  React.useEffect(() => {
    setCheckedAcks(new Set());
  }, [snapshotId]);

  const allRequiredChecked = useMemo(() => {
    if (!snapshot) return false;
    return snapshot.acknowledgements
      .filter(a => a.required)
      .every(a => checkedAcks.has(a.code));
  }, [snapshot, checkedAcks]);

  const handleAckChange = useCallback((code: string, checked: boolean) => {
    setCheckedAcks(prev => {
      const next = new Set(prev);
      if (checked) next.add(code);
      else next.delete(code);
      return next;
    });
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!snapshot || !allRequiredChecked) return;
    const result = await confirmMutation.mutateAsync(Array.from(checkedAcks));
    onConfirmed?.(result.confirmation);
  }, [snapshot, allRequiredChecked, checkedAcks, confirmMutation, onConfirmed]);

  const isExpiredOrInvalidated =
    snapshot?.state === "EXPIRED" || snapshot?.state === "INVALIDATED";

  return (
    <div className="rounded-xl border border-slate-700/60 bg-slate-900/60 overflow-hidden mt-4">
      {/* Non-submission banner */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-800/60 border-b border-slate-700/40">
        <Lock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
        <span className="text-xs text-slate-400">
          Final Order Review — Confirmation does not send the order to your broker.
        </span>
      </div>

      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-slate-400" />
            <h3 className="text-base font-semibold text-slate-200">Final Review & Confirmation</h3>
          </div>
          <Button
            variant="ghost" size="sm"
            onClick={() => setExpanded(e => !e)}
            className="text-slate-400 hover:text-slate-200 h-8 px-2"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Review the exact order details below. Your confirmation is cryptographically bound to this snapshot.
        </p>
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-4">
          {/* Loading */}
          {(isLoading || createReview.isPending) && (
            <div className="flex items-center gap-2 text-slate-400 py-6 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading review...</span>
            </div>
          )}

          {/* Already confirmed */}
          {confirmation && <ConfirmedBanner confirmation={confirmation} />}

          {/* Create review prompt */}
          {!snapshot && !isLoading && !createReview.isPending && !confirmation && (
            <div className="text-center py-6">
              <ShieldCheck className="h-10 w-10 text-slate-600 mx-auto mb-3" />
              <p className="text-sm text-slate-400 mb-4">Generate a final review snapshot to confirm your order.</p>
              <Button
                variant="outline" size="sm"
                onClick={() => createReview.mutate()}
                disabled={createReview.isPending}
                className="border-slate-600 text-slate-300"
              >
                Generate Review Snapshot
              </Button>
              {createReview.isError && (
                <p className="text-xs text-red-400 mt-2">
                  {createReview.error instanceof Error ? createReview.error.message : "Failed to create review"}
                </p>
              )}
            </div>
          )}

          {/* Expired / invalidated */}
          {snapshot && !confirmation && isExpiredOrInvalidated && (
            <div className="rounded-lg border border-amber-800/50 bg-amber-950/30 px-4 py-3">
              <AlertTriangle className="h-4 w-4 inline mr-2 text-amber-400" />
              <span className="text-sm text-amber-300">
                {snapshot.state === "EXPIRED"
                  ? "This review snapshot has expired. Please create a new one."
                  : `Review invalidated: ${snapshot.invalidationReason ?? "order changed"}. Please create a new review.`}
              </span>
              <div className="mt-2">
                <Button variant="outline" size="sm"
                  onClick={() => createReview.mutate()}
                  className="border-amber-700/60 text-amber-300"
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  New Review
                </Button>
              </div>
            </div>
          )}

          {/* Main review content */}
          {snapshot && !confirmation && !isExpiredOrInvalidated && (
            <>
              {/* Order summary */}
              <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Order Summary</div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <div className="text-xs text-slate-500">Strategy</div>
                    <div className="text-sm font-medium text-slate-200">{snapshot.strategyLabel}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Symbol</div>
                    <div className="text-sm font-medium text-slate-200">{snapshot.symbol}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Quantity</div>
                    <div className="text-sm font-medium text-slate-200">{snapshot.quantity} contract{snapshot.quantity !== 1 ? "s" : ""}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Net Price</div>
                    <div className="text-sm font-medium text-slate-200">
                      {snapshot.pricing.pricingType !== "UNKNOWN"
                        ? `${snapshot.pricing.pricingType} ${fmtPrice(snapshot.pricing.netPrice)}`
                        : "Not available"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Est. Premium</div>
                    <div className="text-sm font-medium text-slate-200">{fmt(snapshot.pricing.estimatedNotional)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Order Type</div>
                    <div className="text-sm font-medium text-slate-200">Limit</div>
                  </div>
                </div>
              </div>

              {/* Legs */}
              {snapshot.legs.length > 0 && (
                <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Legs</div>
                  <div className="space-y-0">
                    {snapshot.legs.map(leg => <LegRow key={leg.legIndex} leg={leg} />)}
                  </div>
                </div>
              )}

              {/* Economics */}
              <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Estimated Economics</div>
                <EconomicsCard eco={snapshot.economics} />
              </div>

              {/* Readiness summary */}
              <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Execution Readiness</div>
                <div className="flex items-center gap-2">
                  {snapshot.readiness.status === "READY" ? (
                    <CheckCircle className="h-4 w-4 text-green-400" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-400" />
                  )}
                  <span className={`text-sm font-medium ${snapshot.readiness.status === "READY" ? "text-green-400" : "text-amber-400"}`}>
                    {snapshot.readiness.status === "READY" ? "Ready for Review" : "Ready with Warnings"}
                  </span>
                  {snapshot.readiness.warningCount > 0 && (
                    <Badge variant="outline" className="text-xs bg-amber-900/30 text-amber-300 border-amber-700/50">
                      {snapshot.readiness.warningCount} warning{snapshot.readiness.warningCount > 1 ? "s" : ""}
                    </Badge>
                  )}
                </div>
              </div>

              {/* Snapshot expiry */}
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Info className="h-3.5 w-3.5 shrink-0" />
                This review expires at {new Date(snapshot.expiresAt).toLocaleTimeString()}.
                Snapshot ID: <span className="font-mono">{snapshot.id.slice(0, 8)}…</span>
              </div>

              <Separator className="bg-slate-800" />

              {/* Acknowledgements */}
              <div>
                <div className="text-sm font-semibold text-slate-300 mb-3">
                  Acknowledgements
                  <span className="text-xs font-normal text-slate-500 ml-2">* Required</span>
                </div>
                <div className="space-y-2">
                  {snapshot.acknowledgements.map(ack => (
                    <AcknowledgementItem
                      key={ack.code}
                      ack={ack}
                      checked={checkedAcks.has(ack.code)}
                      onChange={(c) => handleAckChange(ack.code, c as boolean)}
                    />
                  ))}
                </div>
              </div>

              <Separator className="bg-slate-800" />

              {/* Confirm button */}
              <div className="space-y-3">
                {confirmMutation.isError && (
                  <div className="rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
                    <AlertTriangle className="h-4 w-4 inline mr-2" />
                    {confirmMutation.error instanceof Error ? confirmMutation.error.message : "Confirmation failed. Please try again."}
                  </div>
                )}

                <Button
                  onClick={handleConfirm}
                  disabled={!allRequiredChecked || confirmMutation.isPending}
                  className={`w-full ${
                    allRequiredChecked
                      ? "bg-blue-700 hover:bg-blue-600 text-white"
                      : "bg-slate-800 text-slate-500 cursor-not-allowed"
                  }`}
                >
                  {confirmMutation.isPending
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Confirming…</>
                    : "Confirm Order for Submission"}
                </Button>

                <p className="text-xs text-slate-500 text-center">
                  Confirmation does not send the order to your broker.
                </p>

                {!allRequiredChecked && (
                  <p className="text-xs text-amber-400 text-center">
                    Please check all required (*) acknowledgements to continue.
                  </p>
                )}
              </div>

              {/* Disclaimer */}
              <div className="mt-2 p-3 rounded-lg bg-slate-800/40 border border-slate-700/30">
                <div className="flex items-start gap-2">
                  <Info className="h-3.5 w-3.5 text-slate-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-slate-500 leading-relaxed">
                    This is not investment advice. Options involve risk and are not appropriate for all investors.
                    Confirmation does not submit an order. Order placement is not yet enabled.
                  </p>
                </div>
              </div>
            </>
          )}

          {/* Refresh snapshot button (when not confirmed, expired, or invalidated) */}
          {snapshot && !confirmation && (
            <div className="flex justify-start">
              <Button
                variant="ghost" size="sm"
                onClick={() => createReview.mutate()}
                disabled={createReview.isPending}
                className="text-slate-500 hover:text-slate-300 text-xs"
              >
                <RefreshCw className={`h-3 w-3 mr-1 ${createReview.isPending ? "animate-spin" : ""}`} />
                Refresh Review
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
