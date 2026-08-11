/**
 * client/src/components/execution/OptionsOrderPreviewPanel.tsx — Sprint 2.8.3
 *
 * Options / Multi-Leg Order Preview UI panel.
 *
 * COMPLIANCE:
 * - "Preview Only — Nothing has been submitted to your broker." always visible
 * - No Confirm, Place Order, Submit Order, Execute, Send to Broker
 * - No Ready to Trade, Approved, Execution Ready
 * - No Probability of Profit, Expected Return, Roll Now, Close Now
 * - Contract, strike, expiration, ratio, quantity: NEVER changed by preview
 * - Draft values always labeled as "Draft" and never overwritten
 * - Current market data labeled separately
 * - No leg decomposition offered
 */

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle, AlertTriangle, CheckCircle2, Clock, RefreshCw, Eye,
  Edit2, ChevronRight, Info, Lock, TrendingUp, TrendingDown, Minus,
  ChevronDown, ChevronUp, Shield, ArrowUpDown,
} from "lucide-react";
import {
  OPTIONS_PREVIEW_NON_EXECUTION_BANNER,
  OPTIONS_PREVIEW_DISCLAIMER,
  OPTIONS_PREVIEW_PRICE_DISCLAIMER,
  OPTIONS_PREVIEW_MIDPOINT_DISCLAIMER,
  OPTIONS_RISK_DISCLOSURE,
  OPTIONS_PREVIEW_STATUS_LABELS,
  CANONICAL_INTENT_LABELS,
  LIQUIDITY_CATEGORY_LABELS,
} from "../../../../shared/options-order-preview-types";
import type {
  OptionsOrderPreview,
  OptionsPreviewStatus,
  OptionsPreviewLeg,
} from "../../../../shared/options-order-preview-types";

// ─────────────────────────────────────────────────────────────────────────────
// STATUS BADGE
// ─────────────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: OptionsPreviewStatus }) {
  const configs: Record<OptionsPreviewStatus, { color: string; icon: React.ReactNode }> = {
    VALID:           { color: "bg-green-600/10 text-green-700 border-green-600/20", icon: <CheckCircle2 className="h-3 w-3" /> },
    REQUIRES_REVIEW: { color: "bg-amber-500/10 text-amber-700 border-amber-500/20", icon: <AlertTriangle className="h-3 w-3" /> },
    EXPIRED:         { color: "bg-red-500/10 text-red-700 border-red-500/20",       icon: <Clock className="h-3 w-3" /> },
    INVALID:         { color: "bg-red-600/10 text-red-700 border-red-600/20",       icon: <AlertCircle className="h-3 w-3" /> },
    UNAVAILABLE:     { color: "bg-muted/40 text-muted-foreground",                  icon: <AlertCircle className="h-3 w-3" /> },
  };
  const { color, icon } = configs[status] ?? configs.UNAVAILABLE;
  return (
    <Badge variant="outline" className={`text-xs flex items-center gap-1 ${color}`}>
      {icon}
      {OPTIONS_PREVIEW_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED SECTION WRAPPER
// ─────────────────────────────────────────────────────────────────────────────

function Section({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section aria-labelledby={`s-${title.replace(/\W/g, "-").toLowerCase()}`} className={className}>
      <h4 id={`s-${title.replace(/\W/g, "-").toLowerCase()}`}
        className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{title}</h4>
      {children}
    </section>
  );
}

function DataRow({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div className="flex items-start justify-between gap-2 py-1 border-b border-border/50 last:border-0">
      <span className="text-xs text-muted-foreground shrink-0 min-w-[140px]">{label}</span>
      <span className="text-xs text-right font-medium">
        {value}
        {note && <span className="text-muted-foreground font-normal ml-1">({note})</span>}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PER-LEG CARD
// ─────────────────────────────────────────────────────────────────────────────

function LegCard({ leg }: { leg: OptionsPreviewLeg }) {
  const [greeksOpen, setGreeksOpen] = useState(false);
  const isExpired = leg.status === "EXPIRED";
  const isShort = leg.canonicalIntent.includes("SHORT");

  return (
    <div className={`rounded-md border p-3 space-y-2 ${isExpired ? "border-destructive/50 bg-destructive/5" : "border-border/50"}`}
      data-testid={`leg-card-${leg.legIndex}`}>
      {/* Leg header */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className={`text-xs ${isShort ? "border-amber-500/30 text-amber-700" : "border-green-500/30 text-green-700"}`}>
              {leg.roleLabel}
            </Badge>
            <span className="text-xs font-semibold">{leg.contractSymbol}</span>
            {isExpired && <Badge variant="outline" className="text-xs border-red-500/30 text-red-700">Expired</Badge>}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {leg.optionType.toUpperCase()} · Strike ${leg.strike.toFixed(2)} · {leg.expirationLabel}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">{leg.canonicalIntentLabel}</p>
          <p className="text-xs">{leg.quantity} contract{leg.quantity !== 1 ? "s" : ""} · ×{leg.multiplier}</p>
        </div>
      </div>

      {/* Quote comparison */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded bg-muted/30 p-2">
          <p className="text-xs text-muted-foreground mb-1">Draft Midpoint</p>
          <p className="text-sm font-semibold">{leg.draftQuote?.midpoint != null ? `$${leg.draftQuote.midpoint.toFixed(2)}` : "—"}</p>
        </div>
        <div className="rounded bg-muted/30 p-2">
          <p className="text-xs text-muted-foreground mb-1">Current Mid</p>
          <p className="text-sm font-semibold">{leg.currentQuote?.midpoint != null ? `$${leg.currentQuote.midpoint.toFixed(2)}` : "—"}</p>
          {leg.quoteMidpointChangePct != null && (
            <p className={`text-xs mt-0.5 ${Math.abs(leg.quoteMidpointChangePct) >= 2 ? "text-amber-600" : "text-muted-foreground"}`}>
              {leg.quoteMidpointChangePct >= 0 ? "+" : ""}{leg.quoteMidpointChangePct.toFixed(1)}%
            </p>
          )}
        </div>
      </div>

      {/* Bid / Ask / OI / Volume */}
      <div className="grid grid-cols-4 gap-1 text-center">
        {[
          { label: "Bid", value: leg.currentQuote?.bid },
          { label: "Ask", value: leg.currentQuote?.ask },
          { label: "OI", value: leg.liquidity.openInterest },
          { label: "Vol", value: leg.liquidity.volume },
        ].map(({ label, value }) => (
          <div key={label} className="rounded bg-muted/20 p-1">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-xs font-medium">
              {value != null ? (label === "Bid" || label === "Ask" ? `$${(value as number).toFixed(2)}` : value.toLocaleString()) : "—"}
            </p>
          </div>
        ))}
      </div>

      {/* Liquidity */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Liquidity: <span className="font-medium">{LIQUIDITY_CATEGORY_LABELS[leg.liquidity.category]}</span></span>
        {leg.greeks?.impliedVolatility != null && (
          <span className="text-muted-foreground">IV: <span className="font-medium">{(leg.greeks.impliedVolatility * 100).toFixed(1)}%</span></span>
        )}
        <span className={`text-muted-foreground ${!leg.currentQuote?.isStale ? "text-green-600" : "text-amber-600"}`}>
          {leg.currentQuote?.freshnessCategory ?? "—"}
        </span>
      </div>

      {/* Greeks (expandable) */}
      {leg.greeks && (
        <div>
          <button
            className="text-xs text-muted-foreground flex items-center gap-1 hover:text-foreground"
            onClick={() => setGreeksOpen(o => !o)}
            aria-expanded={greeksOpen}
          >
            {greeksOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Greeks
          </button>
          {greeksOpen && (
            <div className="grid grid-cols-4 gap-1 text-center mt-2">
              {[
                { label: "Δ Delta", value: leg.greeks.delta },
                { label: "Γ Gamma", value: leg.greeks.gamma },
                { label: "Θ Theta", value: leg.greeks.theta },
                { label: "Ν Vega",  value: leg.greeks.vega },
              ].map(({ label, value }) => (
                <div key={label} className="rounded bg-muted/20 p-1">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-xs font-medium">{value != null ? value.toFixed(3) : "—"}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Leg warnings */}
      {leg.warnings.length > 0 && (
        <div className="space-y-1">
          {leg.warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-700 dark:text-amber-300 flex items-start gap-1">
              <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
              {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

interface OptionsOrderPreviewPanelProps {
  draftId: string;
  onEditDraft?: () => void;
}

export function OptionsOrderPreviewPanel({ draftId, onEditDraft }: OptionsOrderPreviewPanelProps) {
  const qc = useQueryClient();
  const queryKey = ["/api/execution/order-drafts", draftId, "options-preview"];

  const { data, isLoading, error } = useQuery<{ preview: OptionsOrderPreview }>({
    queryKey,
    queryFn: () =>
      apiRequest("POST", `/api/execution/order-drafts/${draftId}/options-preview`, {})
        .then(r => r.json()),
    staleTime: 60_000,
    enabled: !!draftId,
  });

  const refreshMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/execution/order-drafts/${draftId}/options-preview/refresh`, {})
        .then(r => r.json()),
    onSuccess: (newData) => { qc.setQueryData(queryKey, newData); },
  });

  if (isLoading) {
    return (
      <Card><CardContent className="p-6">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <RefreshCw className="h-4 w-4 animate-spin" />
          Loading options order preview…
        </div>
      </CardContent></Card>
    );
  }

  if (error || !data?.preview) {
    return (
      <Card><CardContent className="p-6 space-y-3">
        <div className="flex items-center gap-2 text-destructive text-sm">
          <AlertCircle className="h-4 w-4" />
          Options preview unavailable.
        </div>
        <p className="text-xs text-muted-foreground">Ensure you have a valid Order Draft before generating an Options Order Preview.</p>
      </CardContent></Card>
    );
  }

  const preview = data.preview;
  const realBlockers = preview.blockers.filter(b => b.code !== "EXECUTION_DISABLED" as any);
  const userWarnings = preview.warnings.filter(w => w.code !== "EXECUTION_DISABLED");

  return (
    <div className="space-y-4" data-testid="options-order-preview-panel">
      {/* ── Preview Only Banner ────────────────────────────────────────── */}
      <div
        className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-50 dark:bg-amber-900/20 px-4 py-2.5"
        role="alert"
        aria-label="Preview Only — Nothing has been submitted"
        data-testid="preview-only-banner"
      >
        <Eye className="h-4 w-4 text-amber-600 shrink-0" />
        <span className="text-sm font-medium text-amber-800 dark:text-amber-200">{OPTIONS_PREVIEW_NON_EXECUTION_BANNER}</span>
      </div>

      {/* ── Header Card ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <CardTitle className="text-base font-semibold">Options Order Preview</CardTitle>
                <Badge variant="outline" className="text-xs text-muted-foreground">Preview Only</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                <span className="font-medium">{preview.symbol}</span>
                {preview.companyName && ` · ${preview.companyName}`}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{preview.strategyLabel}</p>
            </div>
            <StatusBadge status={preview.status} />
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-muted-foreground">
            <span>Broker: <span className="font-medium text-foreground">{preview.broker.provider}</span></span>
            <span>Account: <span className="font-medium text-foreground">{preview.broker.accountMasked}</span></span>
            <span>Mode: <span className="font-medium text-foreground">{preview.broker.executionMode}</span></span>
            <span>Draft v{preview.orderDraftVersion}</span>
            <span>Generated: <span className="text-foreground">{new Date(preview.generatedAt).toLocaleTimeString()}</span></span>
            <span>Valid until: <span className="text-foreground">{new Date(preview.validUntil).toLocaleTimeString()}</span></span>
          </div>
        </CardContent>
      </Card>

      {/* ── Source Chain ─────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-1 flex-wrap text-xs" role="list">
            {[
              { label: "Trade Plan", done: true },
              { label: "Execution Preflight", done: true },
              { label: "Order Draft", done: true },
              { label: "Options Preview", current: true },
            ].map((stage, i) => (
              <React.Fragment key={stage.label}>
                {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                <span className={`px-2 py-0.5 rounded text-xs ${stage.current ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground"}`} role="listitem">
                  {stage.done && !stage.current && <span aria-hidden="true">✓ </span>}
                  {stage.label}
                  {stage.current && <span className="ml-1 font-normal opacity-70">— Current</span>}
                </span>
              </React.Fragment>
            ))}
          </div>
          <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
            <p>Broad expression: <span className="font-medium text-foreground">{preview.broadExpressionType.replace(/_/g, " ")}</span></p>
            <p>Strategy: <span className="font-medium text-foreground">{preview.strategyLabel}</span></p>
            <p>Selected by: <span className="font-medium text-foreground">USER</span></p>
          </div>
        </CardContent>
      </Card>

      {/* ── Blockers ──────────────────────────────────────────────────── */}
      {realBlockers.length > 0 && (
        <section aria-label="Needs Attention" data-testid="blockers-section">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-destructive mb-2 flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5" />
            Needs Attention ({realBlockers.length})
          </h4>
          <div className="space-y-2">
            {realBlockers.map(b => (
              <div key={b.code} className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                <p className="text-xs font-medium text-destructive">{b.code.replace(/_/g, " ")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{b.message}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Warnings ─────────────────────────────────────────────────── */}
      {userWarnings.length > 0 && (
        <section aria-label="Warnings" data-testid="warnings-section">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-700 mb-2 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            Warnings ({userWarnings.length})
          </h4>
          <div className="space-y-2">
            {userWarnings.map(w => (
              <div key={`${w.code}-${w.legIndex ?? "agg"}`} className="rounded-md border border-amber-500/30 bg-amber-50/50 dark:bg-amber-900/10 px-3 py-2">
                <p className="text-xs font-medium text-amber-800 dark:text-amber-200">{w.code.replace(/_/g, " ")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{w.message}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Structure Summary ────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-4">
          <Section title="Structure Summary">
            <div className="space-y-0">
              <DataRow label="Broad Expression" value={preview.broadExpressionType.replace(/_/g, " ")} />
              <DataRow label="Strategy" value={preview.strategyLabel} />
              <DataRow label="Instrument" value={preview.instrumentType.replace(/_/g, " ")} />
              <DataRow label="Contracts" value={`${preview.quantityContext.confirmedQuantity}`} note="Selected in Order Preparation" />
              <DataRow label="Order Type" value={preview.orderType} />
              <DataRow label="Time in Force" value={preview.timeInForce} />
              <DataRow label="Market Status" value={
                <span className={preview.expirationContext.anyExpired ? "text-red-700" : "text-foreground"}>
                  {preview.expirationContext.anyExpired ? "Contract Expired" : preview.expirationContext.primaryExpiration}
                </span>
              } />
            </div>
          </Section>
        </CardContent>
      </Card>

      {/* ── Net Structure Pricing ────────────────────────────────────── */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <Section title="Net Structure Pricing">
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="rounded-md border p-2 text-center">
                <p className="text-xs text-muted-foreground">Draft Reference</p>
                <p className="text-sm font-semibold">
                  {preview.netStructurePricing.draftNetReference != null
                    ? `$${preview.netStructurePricing.draftNetReference.toFixed(2)} ${preview.netStructurePricing.draftPricingType}`
                    : "—"}
                </p>
              </div>
              <div className="rounded-md border p-2 text-center">
                <p className="text-xs text-muted-foreground">Current Reference</p>
                <p className="text-sm font-semibold">
                  {preview.netStructurePricing.amountPerUnit != null
                    ? `$${preview.netStructurePricing.amountPerUnit.toFixed(2)} ${preview.netStructurePricing.pricingType}`
                    : "—"}
                </p>
                {preview.netStructurePricing.differencePct != null && (
                  <p className={`text-xs mt-0.5 ${Math.abs(preview.netStructurePricing.differencePct) > 5 ? "text-amber-600" : "text-muted-foreground"}`}>
                    {preview.netStructurePricing.differencePct >= 0 ? "+" : ""}{preview.netStructurePricing.differencePct.toFixed(1)}%
                  </p>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{OPTIONS_PREVIEW_MIDPOINT_DISCLAIMER}</p>
          </Section>

          <Section title="Estimated Per Contract">
            <DataRow label="Multiplier" value="× 100" />
            {preview.netStructurePricing.amountPerContract != null && (
              <DataRow
                label={`Estimated ${preview.netStructurePricing.pricingType}`}
                value={`$${preview.netStructurePricing.amountPerContract.toFixed(2)}/contract`}
              />
            )}
            {preview.netStructurePricing.totalAmount != null && (
              <DataRow
                label="Total"
                value={`$${preview.netStructurePricing.totalAmount.toFixed(2)}`}
                note={`${preview.quantityContext.confirmedQuantity} contract${preview.quantityContext.confirmedQuantity !== 1 ? "s" : ""}`}
              />
            )}
            <p className="text-xs text-muted-foreground mt-2">{OPTIONS_PREVIEW_PRICE_DISCLAIMER}</p>
          </Section>
        </CardContent>
      </Card>

      {/* ── Legs ────────────────────────────────────────────────────── */}
      <section aria-label="Option Legs" data-testid="legs-section">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Legs ({preview.legs.length})
          <span className="ml-2 font-normal text-muted-foreground/60 normal-case">
            — All contracts, strikes, and expirations are from your draft and are not changed by preview
          </span>
        </h4>
        <div className="space-y-2">
          {preview.legs.map(leg => <LegCard key={leg.legIndex} leg={leg} />)}
        </div>
      </section>

      {/* ── Expiration Context ───────────────────────────────────────── */}
      {preview.expirationContext.hasMultipleExpirations && (
        <Card>
          <CardContent className="p-4">
            <Section title="Multiple Expirations">
              <p className="text-xs text-muted-foreground mb-2">
                This structure spans multiple expirations (calendar/diagonal). Payoff is path-dependent.
              </p>
              {preview.expirationContext.dteSummary.map(d => (
                <DataRow key={d.legIndex} label={`Leg ${d.legIndex + 1}`} value={`${d.expiration} · ${d.dte} DTE`} />
              ))}
            </Section>
          </CardContent>
        </Card>
      )}

      {/* ── Risk Summary ─────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <Section title="Risk Summary">
            <p className="text-xs text-muted-foreground mb-2">From saved Risk Analysis — not recomputed.</p>
            <div className="space-y-0">
              <DataRow label="Constraint Status" value={preview.riskContext.constraintStatus.replace(/_/g, " ")} />
              {preview.riskContext.pathDependent && (
                <DataRow label="Payoff" value={<span className="text-amber-700">Path-Dependent</span>} />
              )}
            </div>
            {preview.riskContext.netGreeks && (
              <div className="mt-2 grid grid-cols-4 gap-1 text-center">
                {[
                  { label: "Net Δ", value: preview.riskContext.netGreeks.netDelta },
                  { label: "Net Θ", value: preview.riskContext.netGreeks.netTheta },
                  { label: "Net Ν", value: preview.riskContext.netGreeks.netVega },
                  { label: "Net Γ", value: preview.riskContext.netGreeks.netGamma },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded bg-muted/20 p-1">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-xs font-medium">{value != null ? value.toFixed(3) : "—"}</p>
                  </div>
                ))}
              </div>
            )}
            {preview.riskContext.riskFlags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {preview.riskContext.riskFlags.map(f => (
                  <Badge key={f} variant="outline" className="text-xs">{f.replace(/_/g, " ")}</Badge>
                ))}
              </div>
            )}
          </Section>
        </CardContent>
      </Card>

      {/* ── Assignment / Exercise ────────────────────────────────────── */}
      {(preview.assignmentExerciseContext.assignmentRisk || preview.assignmentExerciseContext.earlyExerciseRisk) && (
        <Card>
          <CardContent className="p-4">
            <Section title="Assignment & Exercise">
              {preview.assignmentExerciseContext.assignmentNote && (
                <p className="text-xs text-muted-foreground mb-1">
                  <span className="font-medium text-foreground">Assignment: </span>
                  {preview.assignmentExerciseContext.assignmentNote}
                </p>
              )}
              {preview.assignmentExerciseContext.earlyExerciseNote && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Early Exercise: </span>
                  {preview.assignmentExerciseContext.earlyExerciseNote}
                </p>
              )}
              {preview.assignmentExerciseContext.coverageRequired && (
                <p className={`text-xs mt-1 ${preview.assignmentExerciseContext.coverageValidated ? "text-green-700" : "text-amber-700"}`}>
                  Coverage: {preview.assignmentExerciseContext.coverageNote}
                </p>
              )}
            </Section>
          </CardContent>
        </Card>
      )}

      {/* ── Liquidity ────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-4">
          <Section title="Aggregate Liquidity">
            <DataRow label="Overall Category" value={LIQUIDITY_CATEGORY_LABELS[preview.liquidityContext.overallCategory]} />
            {preview.liquidityContext.widestSpreadPct != null && (
              <DataRow label="Widest Spread" value={`${preview.liquidityContext.widestSpreadPct.toFixed(1)}%`} />
            )}
            {preview.liquidityContext.note && (
              <p className="text-xs text-muted-foreground mt-1">{preview.liquidityContext.note}</p>
            )}
          </Section>
        </CardContent>
      </Card>

      {/* ── Broker & Permissions ─────────────────────────────────────── */}
      <Card>
        <CardContent className="p-4">
          <Section title="Account & Permissions">
            <DataRow label="Options Permission" value={
              <span className={preview.broker.optionsPermissionStatus === "PASS" ? "text-green-700" : "text-amber-700"}>
                {preview.broker.optionsPermissionStatus}
              </span>
            } />
            <DataRow label="Multi-Leg Capability" value={preview.broker.multiLegCapabilityStatus.replace(/_/g, " ")} />
            <DataRow label="Buying Power Check" value={preview.broker.buyingPowerCheckStatus} />
          </Section>
          {preview.broker.multiLegCapabilityStatus !== "SUPPORTED" && preview.legs.length > 1 && (
            <p className="text-xs text-amber-700 mt-2">
              Native multi-leg submission is not confirmed for this provider.
              No leg decomposition is performed — future execution progression will require multi-leg capability confirmation.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Actions ──────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-2 flex-wrap">
        <Button
          variant="outline" size="sm"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          aria-label="Refresh preview — revalidates current quotes and status"
          data-testid="button-refresh-preview"
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
          Refresh Preview
        </Button>

        {onEditDraft && (
          <Button variant="outline" size="sm" onClick={onEditDraft}
            aria-label="Edit order draft — returns to Order Preparation"
            data-testid="button-edit-draft">
            <Edit2 className="h-3.5 w-3.5 mr-1.5" />
            Edit Order Draft
          </Button>
        )}

        {/* Future action — disabled — Sprint 2.8.5 */}
        <Button variant="outline" size="sm" disabled
          className="opacity-50 cursor-not-allowed"
          aria-label="Continue to Final Execution Validation — Upcoming"
          aria-disabled="true"
          data-testid="button-future-validation">
          <Lock className="h-3.5 w-3.5 mr-1.5" />
          Continue to Final Execution Validation — Upcoming
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Broker submission remains disabled at this stage. No order has been or will be submitted.</p>

      {/* ── Options Risk Disclosure ───────────────────────────────────── */}
      <div className="rounded-md bg-muted/40 px-3 py-2.5 flex gap-2">
        <Shield className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground leading-relaxed">{OPTIONS_RISK_DISCLOSURE}</p>
      </div>

      {/* ── Disclaimer ───────────────────────────────────────────────── */}
      <div className="rounded-md bg-muted/50 px-3 py-2.5 flex gap-2">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground leading-relaxed">{OPTIONS_PREVIEW_DISCLAIMER}</p>
      </div>
    </div>
  );
}
