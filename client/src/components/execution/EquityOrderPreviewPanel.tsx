/**
 * client/src/components/execution/EquityOrderPreviewPanel.tsx — Sprint 2.8.2
 *
 * Equity Order Preview UI component.
 *
 * COMPLIANCE:
 * - "Preview Only — Nothing has been submitted to your broker."
 * - No Confirm, Confirm & Submit, Place Order, Submit Order, Execute, Send to Broker
 * - No Ready to Trade, Approved, Execution Ready
 * - No Expected Fill, Guaranteed Fill, Required Cash
 * - User-selected quantity is shown as-is — not "Recommended Shares"
 * - Draft limit price is shown as-is — never auto-changed
 * - Current market data clearly labeled separately from draft values
 */

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle, AlertTriangle, CheckCircle2, Clock, RefreshCw,
  Eye, Edit2, ChevronRight, Info, Lock, Shield, Building2,
  TrendingUp, TrendingDown, Minus, ExternalLink,
} from "lucide-react";
import {
  EQUITY_PREVIEW_NON_EXECUTION_BANNER,
  EQUITY_PREVIEW_DISCLAIMER,
  EQUITY_PREVIEW_PRICE_DISCLAIMER,
  EQUITY_PREVIEW_LIMIT_EDUCATION,
  SIDE_INTENT_LABELS,
  EQUITY_PREVIEW_STATUS_LABELS,
} from "../../../../shared/equity-order-preview-types";
import type {
  EquityOrderPreview,
  EquityPreviewStatus,
} from "../../../../shared/equity-order-preview-types";

// ─────────────────────────────────────────────────────────────────────────────
// STATUS BADGE
// ─────────────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: EquityPreviewStatus }) {
  const configs: Record<EquityPreviewStatus, { color: string; icon: React.ReactNode }> = {
    VALID:           { color: "bg-green-600/10 text-green-700 border-green-600/20", icon: <CheckCircle2 className="h-3 w-3" /> },
    REQUIRES_REVIEW: { color: "bg-amber-500/10 text-amber-700 border-amber-500/20", icon: <AlertTriangle className="h-3 w-3" /> },
    EXPIRED:         { color: "bg-red-500/10 text-red-700 border-red-500/20",       icon: <Clock className="h-3 w-3" /> },
    INVALID:         { color: "bg-red-600/10 text-red-700 border-red-600/20",       icon: <AlertCircle className="h-3 w-3" /> },
    UNAVAILABLE:     { color: "bg-muted/40 text-muted-foreground",                   icon: <AlertCircle className="h-3 w-3" /> },
  };
  const { color, icon } = configs[status] ?? configs.UNAVAILABLE;
  return (
    <Badge variant="outline" className={`text-xs flex items-center gap-1 ${color}`}>
      {icon}
      {EQUITY_PREVIEW_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION WRAPPERS
// ─────────────────────────────────────────────────────────────────────────────

function Section({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section aria-labelledby={`section-${title.replace(/\s+/g, "-").toLowerCase()}`} className={className}>
      <h4
        id={`section-${title.replace(/\s+/g, "-").toLowerCase()}`}
        className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2"
      >
        {title}
      </h4>
      {children}
    </section>
  );
}

function DataRow({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div className="flex items-start justify-between gap-2 py-1 border-b border-border/50 last:border-0">
      <span className="text-xs text-muted-foreground shrink-0 min-w-[120px]">{label}</span>
      <span className="text-xs text-right font-medium">
        {value}
        {note && <span className="text-muted-foreground font-normal ml-1">({note})</span>}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PRICE MOVEMENT ICON
// ─────────────────────────────────────────────────────────────────────────────

function PriceMovementIcon({ movement }: { movement: string }) {
  if (movement === "MATERIAL_CHANGE") return <TrendingUp className="h-3.5 w-3.5 text-amber-600" />;
  if (movement === "SMALL_CHANGE") return <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />;
  if (movement === "UNCHANGED") return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

interface EquityOrderPreviewPanelProps {
  draftId: string;
  onEditDraft?: () => void;
}

export function EquityOrderPreviewPanel({ draftId, onEditDraft }: EquityOrderPreviewPanelProps) {
  const qc = useQueryClient();
  const queryKey = ["/api/execution/order-drafts", draftId, "equity-preview"];

  const { data, isLoading, error } = useQuery<{ preview: EquityOrderPreview }>({
    queryKey,
    queryFn: () =>
      apiRequest("POST", `/api/execution/order-drafts/${draftId}/equity-preview`, {})
        .then(r => r.json()),
    staleTime: 60_000,
    enabled: !!draftId,
  });

  const refreshMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/execution/order-drafts/${draftId}/equity-preview/refresh`, {})
        .then(r => r.json()),
    onSuccess: (newData) => {
      qc.setQueryData(queryKey, newData);
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Loading equity order preview…
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !data?.preview) {
    return (
      <Card>
        <CardContent className="p-6 space-y-3">
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertCircle className="h-4 w-4" />
            Preview unavailable.
          </div>
          <p className="text-xs text-muted-foreground">
            Ensure you have a valid Order Draft before generating an Equity Order Preview.
          </p>
        </CardContent>
      </Card>
    );
  }

  const preview = data.preview;
  const hasBlockers = preview.blockers.length > 0;
  const realBlockers = preview.blockers; // all blockers (EXECUTION_DISABLED is a warning, not a blocker)

  return (
    <div className="space-y-4" data-testid="equity-order-preview-panel">
      {/* ── Preview Only Banner ──────────────────────────────────────────── */}
      <div
        className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-50 dark:bg-amber-900/20 px-4 py-2.5"
        role="alert"
        aria-label="Preview Only — Nothing has been submitted"
        data-testid="preview-only-banner"
      >
        <Eye className="h-4 w-4 text-amber-600 shrink-0" />
        <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
          {EQUITY_PREVIEW_NON_EXECUTION_BANNER}
        </span>
      </div>

      {/* ── Header Card ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <CardTitle className="text-base font-semibold">Equity Order Preview</CardTitle>
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  Preview Only
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                <span className="font-medium">{preview.symbol}</span>
                {preview.companyName && ` · ${preview.companyName}`}
              </p>
            </div>
            <StatusBadge status={preview.status} />
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-muted-foreground">
            <span>Broker: <span className="text-foreground font-medium">{preview.broker.provider}</span></span>
            <span>Account: <span className="text-foreground font-medium">{preview.broker.accountMasked}</span></span>
            <span>Mode: <span className="text-foreground font-medium">{preview.broker.executionMode}</span></span>
            <span>Draft v{preview.orderDraftVersion}</span>
            <span>Generated: <span className="text-foreground">{new Date(preview.generatedAt).toLocaleTimeString()}</span></span>
            <span>Valid until: <span className="text-foreground">{new Date(preview.validUntil).toLocaleTimeString()}</span></span>
          </div>

          {!preview.broker.executionEnabled && (
            <p className="text-xs text-amber-700 bg-amber-50 dark:bg-amber-900/20 rounded px-2 py-1">
              Broker submission is currently disabled.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Source Chain ─────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-1 flex-wrap text-xs" role="list" aria-label="Workflow stages">
            {[
              { label: "Trade Plan", done: true },
              { label: "Execution Preflight", done: true },
              { label: "Order Draft", done: true },
              { label: "Equity Preview", current: true },
            ].map((stage, i) => (
              <React.Fragment key={stage.label}>
                {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                <span
                  className={`px-2 py-0.5 rounded text-xs ${
                    stage.current
                      ? "bg-primary/10 text-primary font-medium"
                      : stage.done
                      ? "text-muted-foreground"
                      : "text-muted-foreground opacity-50"
                  }`}
                  role="listitem"
                >
                  {stage.done && !stage.current && <span aria-hidden="true">✓ </span>}
                  {stage.label}
                  {stage.current && <span className="ml-1 font-normal opacity-70">— Current</span>}
                </span>
              </React.Fragment>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Research structure selected by you: <span className="font-medium">Stock</span>
          </p>
        </CardContent>
      </Card>

      {/* ── Blockers ─────────────────────────────────────────────────────── */}
      {realBlockers.length > 0 && (
        <section aria-label="Needs Attention" data-testid="blockers-section">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-destructive mb-2 flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5" />
            Needs Attention ({realBlockers.length})
          </h4>
          <div className="space-y-2">
            {realBlockers.map(blocker => (
              <div key={blocker.code} className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                <p className="text-xs font-medium text-destructive">{blocker.code.replace(/_/g, " ")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{blocker.message}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Warnings ─────────────────────────────────────────────────────── */}
      {preview.warnings.filter(w => w.code !== "EXECUTION_DISABLED").length > 0 && (
        <section aria-label="Warnings" data-testid="warnings-section">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-700 mb-2 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            Warnings ({preview.warnings.filter(w => w.code !== "EXECUTION_DISABLED").length})
          </h4>
          <div className="space-y-2">
            {preview.warnings.filter(w => w.code !== "EXECUTION_DISABLED").map(w => (
              <div key={w.code} className="rounded-md border border-amber-500/30 bg-amber-50/50 dark:bg-amber-900/10 px-3 py-2">
                <p className="text-xs font-medium text-amber-800 dark:text-amber-200">{w.code.replace(/_/g, " ")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{w.message}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Order Summary ─────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <Section title="Order Summary">
            <div className="space-y-0">
              <DataRow label="Side Intent" value={preview.sideIntentLabel} />
              <DataRow
                label="Quantity"
                value={`${preview.quantity.toLocaleString()} ${preview.quantityUnit}`}
                note="Selected in Order Preparation"
              />
              <DataRow label="Order Type" value={preview.orderType} />
              <DataRow label="Time in Force" value={preview.timeInForce} />
              <DataRow label="Extended Hours" value={preview.allowExtendedHours ? "Yes" : "No"} />
              <DataRow
                label="Market Status"
                value={<span className={preview.marketHours.sessionState === "OPEN" ? "text-green-700" : "text-amber-700"}>{preview.marketHours.sessionState}</span>}
              />
            </div>
          </Section>
        </CardContent>
      </Card>

      {/* ── Market Data ──────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <Section title="Current Market Data">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
              {[
                { label: "Bid", value: preview.pricing.currentQuote.bid },
                { label: "Ask", value: preview.pricing.currentQuote.ask },
                { label: "Last", value: preview.pricing.currentQuote.last },
                { label: "Midpoint", value: preview.pricing.currentQuote.midpoint },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-md border p-2 text-center">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-sm font-semibold">
                    {value !== null ? `$${value.toFixed(2)}` : "—"}
                  </p>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Quote: {new Date(preview.pricing.currentQuote.quoteTime).toLocaleTimeString()} · {preview.pricing.currentQuote.freshnessCategory}</span>
              <span>Source: {preview.pricing.currentQuote.provider}</span>
            </div>
          </Section>

          {/* ── Draft Values (immutable) ── */}
          <Section title="Draft Values (Order Preparation)">
            <div className="space-y-0 rounded-md bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground mb-2">
                These values are from your order draft and are not changed by market movements.
              </p>
              {preview.orderType === "LIMIT" && preview.pricing.draftLimitPrice !== null && (
                <DataRow
                  label="Draft Limit Price"
                  value={`$${preview.pricing.draftLimitPrice.toFixed(2)}`}
                  note={preview.pricing.draftLimitPriceSource ?? undefined}
                />
              )}
              {preview.pricing.draftBid !== null && (
                <DataRow label="Bid at Draft" value={`$${preview.pricing.draftBid.toFixed(2)}`} />
              )}
              {preview.pricing.draftAsk !== null && (
                <DataRow label="Ask at Draft" value={`$${preview.pricing.draftAsk.toFixed(2)}`} />
              )}
            </div>
          </Section>

          {/* ── Limit Analysis ── */}
          {preview.orderType === "LIMIT" && preview.pricing.limitMarketRelation && (
            <Section title="Limit Price Analysis">
              <div className="space-y-0">
                <DataRow label="Current Market Relation" value={preview.pricing.limitMarketRelation?.replace(/_/g, " ")} />
                {preview.pricing.limitDistanceFromBid !== null && (
                  <DataRow label="Distance from Bid" value={`${preview.pricing.limitDistanceFromBid! >= 0 ? "+" : ""}$${preview.pricing.limitDistanceFromBid!.toFixed(2)}`} />
                )}
                {preview.pricing.limitDistanceFromAsk !== null && (
                  <DataRow label="Distance from Ask" value={`${preview.pricing.limitDistanceFromAsk! >= 0 ? "+" : ""}$${preview.pricing.limitDistanceFromAsk!.toFixed(2)}`} />
                )}
              </div>
              <div className="rounded-md bg-muted/40 p-2 mt-2">
                <p className="text-xs text-muted-foreground">{EQUITY_PREVIEW_LIMIT_EDUCATION}</p>
              </div>
            </Section>
          )}

          {/* ── Price Movement ── */}
          <Section title="Since Draft Preparation">
            <div className="flex items-center gap-2">
              <PriceMovementIcon movement={preview.pricing.priceMovement} />
              <span className="text-xs">
                Price movement: <span className="font-medium">{preview.pricing.priceMovement.replace(/_/g, " ")}</span>
                {preview.pricing.priceDifferencePct != null && (
                  <span className="text-muted-foreground ml-1">
                    ({(preview.pricing.priceDifferencePct as number) >= 0 ? "+" : ""}{(preview.pricing.priceDifferencePct as number).toFixed(2)}%)
                  </span>
                )}
              </span>
            </div>
          </Section>

          {/* ── Estimated Notional ── */}
          <Section title="Estimated Notional">
            <div className="flex items-baseline justify-between">
              <p className="text-xs text-muted-foreground">{preview.pricing.estimatedNotionalLabel}</p>
              <p className="text-lg font-semibold">
                {preview.pricing.estimatedNotional !== null
                  ? `$${preview.pricing.estimatedNotional.toFixed(2)}`
                  : "—"}
              </p>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{EQUITY_PREVIEW_PRICE_DISCLAIMER}</p>
          </Section>
        </CardContent>
      </Card>

      {/* ── Capital Context ───────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-4">
          <Section title="Capital & Account Context">
            <div className="space-y-0">
              <DataRow
                label="Estimated Draft Notional"
                value={preview.estimatedDraftNotional !== null ? `$${preview.estimatedDraftNotional.toFixed(2)}` : "—"}
              />
              <DataRow
                label="Buying Power Check"
                value={
                  <span className={preview.buyingPowerCheckStatus === "PASS" ? "text-green-700" : "text-amber-700"}>
                    {preview.buyingPowerCheckStatus}
                  </span>
                }
              />
              <DataRow label="Account" value={preview.broker.accountMasked} note={preview.broker.accountType} />
              <DataRow label="Provider" value={preview.broker.provider} />
            </div>
          </Section>
        </CardContent>
      </Card>

      {/* ── Research & Lifecycle Context ──────────────────────────────────── */}
      <Card>
        <CardContent className="p-4">
          <Section title="Research & Lifecycle Context">
            <div className="space-y-0">
              {preview.planningContext.researchSummary && (
                <DataRow label="Research Summary" value={preview.planningContext.researchSummary} />
              )}
              {preview.planningContext.researchScoreAtPlanCreation !== undefined &&
               preview.planningContext.researchScoreAtPlanCreation !== null && (
                <DataRow label="Score at Plan Creation" value={String(preview.planningContext.researchScoreAtPlanCreation)} />
              )}
              <DataRow
                label="Lifecycle State"
                value={
                  <span className={preview.planningContext.thesisInvalidated ? "text-destructive" : "text-foreground"}>
                    {preview.planningContext.currentLifecycleState}
                  </span>
                }
              />
              <DataRow label="Thesis Invalidated" value={preview.planningContext.thesisInvalidated ? "Yes" : "No"} />
              <DataRow label="Plan Version" value={String(preview.planningContext.planVersion)} />
            </div>
          </Section>
          {preview.riskContext.riskFlags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {preview.riskContext.riskFlags.map(f => (
                <Badge key={f} variant="outline" className="text-xs">{f.replace(/_/g, " ")}</Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Actions ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          aria-label="Refresh preview — revalidates current quote and status"
          data-testid="button-refresh-preview"
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
          Refresh Preview
        </Button>

        {onEditDraft && (
          <Button
            variant="outline"
            size="sm"
            onClick={onEditDraft}
            aria-label="Edit order draft — returns to Order Preparation"
            data-testid="button-edit-draft"
          >
            <Edit2 className="h-3.5 w-3.5 mr-1.5" />
            Edit Order Draft
          </Button>
        )}

        {/* Future action — disabled — Sprint 2.8.5 */}
        <Button
          variant="outline"
          size="sm"
          disabled
          className="opacity-50 cursor-not-allowed"
          aria-label="Continue to Final Execution Validation — Upcoming"
          aria-disabled="true"
          data-testid="button-future-validation"
        >
          <Lock className="h-3.5 w-3.5 mr-1.5" />
          Continue to Final Execution Validation — Upcoming
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Broker submission remains disabled at this stage.</p>

      {/* ── Disclaimer ───────────────────────────────────────────────────── */}
      <div className="rounded-md bg-muted/50 px-3 py-2.5 flex gap-2">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground leading-relaxed">{EQUITY_PREVIEW_DISCLAIMER}</p>
      </div>
    </div>
  );
}
