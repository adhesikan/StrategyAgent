/**
 * client/src/components/execution/OrderPreparationPanel.tsx — Sprint 2.8.1
 *
 * Order Preparation UI panel.
 *
 * COMPLIANCE:
 * - Never shows "Submit", "Execute", "Confirm Trade", "Place Trade"
 * - Always shows non-execution banner
 * - Always shows compliance disclaimer
 * - Market orders always show price uncertainty warning
 * - All quotes are labeled as references, not fill prices
 */

import React, { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  OrderDraft,
  OrderPreparationPreferences,
  DraftOrderType,
  DraftTimeInForce,
  DraftLimitPriceSource,
} from "../../../../shared/order-draft-types";
import {
  ORDER_DRAFT_NON_EXECUTION_BANNER,
  ORDER_PREPARATION_DISCLAIMER,
  MARKET_ORDER_WARNING,
  DRAFT_QUOTE_WARNING,
} from "../../../../shared/order-draft-types";
import type { ExecutionPreflightResult } from "../../../../shared/execution-types";

// ─────────────────────────────────────────────────────────────────────────────
// PROPS
// ─────────────────────────────────────────────────────────────────────────────

interface OrderPreparationPanelProps {
  tradePlanId: string;
  /** Passing preflight result — required to show this panel */
  preflight: ExecutionPreflightResult;
  brokerConnected: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function fmt(v: number | undefined | null, prefix = "$"): string {
  if (v == null) return "—";
  return `${prefix}${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtTs(iso: string | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch { return iso; }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function OrderPreparationPanel({
  tradePlanId,
  preflight,
  brokerConnected,
}: OrderPreparationPanelProps): React.ReactElement {
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState<string>("1");
  const [orderType, setOrderType] = useState<DraftOrderType>("LIMIT");
  const [tif, setTif] = useState<DraftTimeInForce>("DAY");
  const [limitPrice, setLimitPrice] = useState<string>("");
  const [limitPriceSource, setLimitPriceSource] = useState<DraftLimitPriceSource>("USER_SELECTED");
  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Load existing draft
  const { data: existingDraft, isLoading: draftLoading } = useQuery<OrderDraft>({
    queryKey: ["order-draft", tradePlanId],
    queryFn: async () => {
      const r = await fetch(`/api/trade-plans/${tradePlanId}/execution/order-draft`, { credentials: "include" });
      if (r.status === 404) return null as any;
      if (!r.ok) throw new Error("Failed to load order draft");
      return r.json();
    },
    retry: false,
  });

  // Create draft mutation
  const createMutation = useMutation({
    mutationFn: async (prefs: OrderPreparationPreferences) => {
      const r = await fetch(`/api/trade-plans/${tradePlanId}/execution/order-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          preflightId: preflight.id,
          preferences: prefs,
        }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.message ?? "Failed to create order draft");
      }
      return r.json() as Promise<OrderDraft>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order-draft", tradePlanId] });
      setCreateError(null);
      setShowCreate(false);
    },
    onError: (e: Error) => setCreateError(e.message),
  });

  // Abandon draft mutation
  const abandonMutation = useMutation({
    mutationFn: async (draftId: string) => {
      const r = await fetch(`/api/execution/order-drafts/${draftId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error("Failed to abandon draft");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order-draft", tradePlanId] });
    },
  });

  const handleCreateDraft = useCallback(() => {
    setCreateError(null);
    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) {
      setCreateError("Please enter a valid quantity greater than 0.");
      return;
    }
    const lp = orderType === "LIMIT" ? parseFloat(limitPrice) : undefined;
    if (orderType === "LIMIT" && (!lp || isNaN(lp) || lp <= 0)) {
      setCreateError("Please enter a valid limit price greater than 0.");
      return;
    }

    createMutation.mutate({
      quantity: qty,
      orderTypePreference: orderType,
      timeInForcePreference: tif,
      limitPricePreference: lp,
      limitPriceSource: lp ? limitPriceSource : undefined,
      allowExtendedHours: false,
    });
  }, [quantity, orderType, tif, limitPrice, limitPriceSource, createMutation]);

  const draft = existingDraft;
  const isDraftExpired = draft ? new Date() >= new Date(draft.expiresAt) : false;

  if (!brokerConnected) {
    return (
      <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-6">
        <p className="text-sm text-slate-400">Connect a broker to use Order Preparation.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Non-Execution Banner (persistent, difficult to miss) ── */}
      <div
        className="rounded-lg border border-amber-500/40 bg-amber-900/20 px-4 py-3 flex items-center gap-3"
        role="status"
        aria-label="Order draft status"
      >
        <span className="text-amber-400 text-lg" aria-hidden>⚠</span>
        <p className="text-sm font-semibold text-amber-300">{ORDER_DRAFT_NON_EXECUTION_BANNER}</p>
      </div>

      {/* ── Header ── */}
      <div>
        <h3 className="text-base font-semibold text-white">Order Preparation</h3>
        <p className="text-xs text-slate-400 mt-1">
          Review how this saved research plan could be represented as a future broker order.
          Nothing is submitted to your broker at this stage.
        </p>
      </div>

      {/* ── Existing Draft ── */}
      {!draftLoading && draft && !isDraftExpired && (
        <DraftView
          draft={draft}
          onAbandon={() => abandonMutation.mutate(draft.id)}
          onCreateNew={() => setShowCreate(true)}
          isAbandoning={abandonMutation.isPending}
        />
      )}

      {!draftLoading && draft && isDraftExpired && (
        <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4 text-sm text-slate-400">
          Your previous order draft has expired. Create a new draft to continue.
          <button
            onClick={() => { queryClient.invalidateQueries({ queryKey: ["order-draft", tradePlanId] }); setShowCreate(true); }}
            className="ml-2 text-blue-400 underline underline-offset-2 hover:text-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-400 rounded"
          >
            Create New Draft
          </button>
        </div>
      )}

      {!draftLoading && !draft && !showCreate && (
        <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-5 flex flex-col items-center gap-3">
          <p className="text-sm text-slate-400">No order draft yet. Prepare one from this Trade Plan.</p>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-blue-400 transition-colors"
            aria-label="Prepare Order Draft"
          >
            Prepare Order Draft
          </button>
          <p className="text-xs text-slate-500 text-center">Preflight status: {preflight.overallStatus}</p>
        </div>
      )}

      {/* ── Create Form ── */}
      {showCreate && (
        <CreateDraftForm
          preflight={preflight}
          quantity={quantity}
          setQuantity={setQuantity}
          orderType={orderType}
          setOrderType={setOrderType}
          tif={tif}
          setTif={setTif}
          limitPrice={limitPrice}
          setLimitPrice={setLimitPrice}
          limitPriceSource={limitPriceSource}
          setLimitPriceSource={setLimitPriceSource}
          onSave={handleCreateDraft}
          onCancel={() => { setShowCreate(false); setCreateError(null); }}
          isSaving={createMutation.isPending}
          error={createError}
        />
      )}

      {/* ── Compliance Disclaimer ── */}
      <p className="text-xs text-slate-500 leading-relaxed">{ORDER_PREPARATION_DISCLAIMER}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CREATE DRAFT FORM
// ─────────────────────────────────────────────────────────────────────────────

interface CreateDraftFormProps {
  preflight: ExecutionPreflightResult;
  quantity: string;
  setQuantity: (v: string) => void;
  orderType: DraftOrderType;
  setOrderType: (v: DraftOrderType) => void;
  tif: DraftTimeInForce;
  setTif: (v: DraftTimeInForce) => void;
  limitPrice: string;
  setLimitPrice: (v: string) => void;
  limitPriceSource: DraftLimitPriceSource;
  setLimitPriceSource: (v: DraftLimitPriceSource) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
  error: string | null;
}

function CreateDraftForm({
  preflight, quantity, setQuantity, orderType, setOrderType,
  tif, setTif, limitPrice, setLimitPrice, limitPriceSource, setLimitPriceSource,
  onSave, onCancel, isSaving, error,
}: CreateDraftFormProps): React.ReactElement {
  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-5 space-y-5">
      <h4 className="text-sm font-semibold text-white">Order Draft Details</h4>

      {/* Quantity */}
      <div className="space-y-1">
        <label htmlFor="od-quantity" className="text-xs font-medium text-slate-300">
          Order Draft Quantity
          <span className="ml-1 text-slate-500 font-normal">(required — shares or contracts)</span>
        </label>
        <input
          id="od-quantity"
          type="number"
          min="1"
          step="1"
          value={quantity}
          onChange={e => setQuantity(e.target.value)}
          className="w-full sm:w-40 px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="e.g. 10"
          aria-label="Order draft quantity"
          aria-required="true"
          aria-describedby="od-quantity-hint"
        />
        <p id="od-quantity-hint" className="text-xs text-slate-500">
          Enter your confirmed quantity. Hypothetical plan sizes are not automatically used.
        </p>
      </div>

      {/* Order Type */}
      <fieldset className="space-y-1">
        <legend className="text-xs font-medium text-slate-300">Order Type</legend>
        <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Order type">
          {(["MARKET", "LIMIT"] as DraftOrderType[]).map(ot => (
            <label key={ot} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="orderType"
                value={ot}
                checked={orderType === ot}
                onChange={() => setOrderType(ot)}
                className="text-blue-500 focus:ring-blue-400"
                aria-label={ot}
              />
              <span className="text-sm text-slate-200">{ot}</span>
            </label>
          ))}
        </div>
        {orderType === "MARKET" && (
          <p className="text-xs text-amber-400 mt-1" role="alert">{MARKET_ORDER_WARNING}</p>
        )}
      </fieldset>

      {/* Limit Price */}
      {orderType === "LIMIT" && (
        <div className="space-y-2">
          <div className="space-y-1">
            <label htmlFor="od-limit-price" className="text-xs font-medium text-slate-300">
              Limit Price Reference
            </label>
            <input
              id="od-limit-price"
              type="number"
              min="0.01"
              step="0.01"
              value={limitPrice}
              onChange={e => setLimitPrice(e.target.value)}
              className="w-full sm:w-48 px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. 195.00"
              aria-label="Limit price reference"
              aria-required="true"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="od-limit-source" className="text-xs font-medium text-slate-300">Price Source</label>
            <select
              id="od-limit-source"
              value={limitPriceSource}
              onChange={e => setLimitPriceSource(e.target.value as DraftLimitPriceSource)}
              className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Limit price source"
            >
              <option value="USER_SELECTED">User Selected</option>
              <option value="REFERENCE_MIDPOINT">Reference Midpoint</option>
              <option value="REFERENCE_BID">Reference Bid</option>
              <option value="REFERENCE_ASK">Reference Ask</option>
            </select>
          </div>
        </div>
      )}

      {/* Time in Force */}
      <fieldset className="space-y-1">
        <legend className="text-xs font-medium text-slate-300">Time in Force</legend>
        <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Time in force">
          {(["DAY", "GTC"] as DraftTimeInForce[]).map(t => (
            <label key={t} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="tif"
                value={t}
                checked={tif === t}
                onChange={() => setTif(t)}
                className="text-blue-500 focus:ring-blue-400"
                aria-label={t === "DAY" ? "Day order" : "Good Till Cancelled"}
              />
              <span className="text-sm text-slate-200">{t === "DAY" ? "Day" : "GTC"}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Error */}
      {error && (
        <p className="text-sm text-red-400" role="alert" aria-live="assertive">{error}</p>
      )}

      {/* Quote warning */}
      <p className="text-xs text-slate-500">{DRAFT_QUOTE_WARNING}</p>

      {/* Actions — no Submit/Execute/Confirm */}
      <div className="flex flex-wrap gap-3 pt-1">
        <button
          onClick={onSave}
          disabled={isSaving}
          className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-blue-400 transition-colors"
          aria-label="Save Order Draft"
        >
          {isSaving ? "Saving…" : "Save Draft"}
        </button>
        <button
          onClick={onCancel}
          disabled={isSaving}
          className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-sm font-medium text-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-400 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DRAFT VIEW
// ─────────────────────────────────────────────────────────────────────────────

interface DraftViewProps {
  draft: OrderDraft;
  onAbandon: () => void;
  onCreateNew: () => void;
  isAbandoning: boolean;
}

function DraftView({ draft, onAbandon, onCreateNew, isAbandoning }: DraftViewProps): React.ReactElement {
  const isExpiringSoon = new Date(draft.expiresAt).getTime() - Date.now() < 3 * 60 * 1000;

  return (
    <div className="space-y-4">
      {/* Status row */}
      <div className="flex flex-wrap items-center gap-3">
        <DraftStatusBadge status={draft.status} />
        <span className="text-xs text-slate-500">v{draft.version}</span>
        <span className="text-xs text-slate-500">•</span>
        <span className="text-xs text-slate-500">
          Expires {fmtTs(draft.expiresAt)}
          {isExpiringSoon && (
            <span className="ml-1 text-amber-400 font-medium">(expiring soon)</span>
          )}
        </span>
      </div>

      {/* Blockers */}
      {draft.blockers.length > 0 && (
        <div className="rounded-lg border border-red-800/50 bg-red-900/10 p-4" role="alert">
          <p className="text-xs font-semibold text-red-400 uppercase tracking-wide mb-2">
            Blockers ({draft.blockers.length})
          </p>
          <ul className="space-y-1.5">
            {draft.blockers.map((b: { code: string; message: string }, i: number) => (
              <li key={i} className="text-sm text-red-300">
                <span className="font-mono text-xs text-red-500 mr-2">[{b.code}]</span>
                {b.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Warnings */}
      {draft.warnings.length > 0 && (
        <div className="rounded-lg border border-yellow-800/50 bg-yellow-900/10 p-4">
          <p className="text-xs font-semibold text-yellow-400 uppercase tracking-wide mb-2">
            Warnings ({draft.warnings.length})
          </p>
          <ul className="space-y-1.5">
            {draft.warnings.map((w: { code: string; message: string }, i: number) => (
              <li key={i} className="text-sm text-yellow-300">
                <span className="font-mono text-xs text-yellow-600 mr-2">[{w.code}]</span>
                {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Instrument / Strategy */}
      <Section title="Instrument / Strategy">
        <Row label="Instrument Type" value={draft.instrumentType} />
        <Row label="Structure" value={draft.structureType} />
        {draft.sideIntent && <Row label="Side Intent" value={draft.sideIntent} />}
      </Section>

      {/* Broker / Account */}
      <Section title="Broker / Account">
        <Row label="Broker" value={draft.brokerProvider} />
        <Row label="Account" value={draft.brokerAccountMasked} />
        <Row label="Account Type" value={draft.brokerAccountType} />
        <Row label="Execution Mode" value={draft.executionMode} />
      </Section>

      {/* Order Draft Legs */}
      {draft.legs.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
            Order Draft Legs
          </h5>
          <div className="overflow-x-auto">
            <table className="w-full text-xs" aria-label="Order draft legs">
              <thead>
                <tr className="text-slate-500">
                  <th className="text-left pb-1 pr-3">Role</th>
                  <th className="text-left pb-1 pr-3">Contract</th>
                  <th className="text-left pb-1 pr-3">Type</th>
                  <th className="text-left pb-1 pr-3">Exp</th>
                  <th className="text-left pb-1 pr-3">Strike</th>
                  <th className="text-left pb-1 pr-3">Qty</th>
                  <th className="text-left pb-1">Ratio</th>
                </tr>
              </thead>
              <tbody>
                {draft.legs.map((leg, i) => (
                  <tr key={i} className="text-slate-300 border-t border-slate-700/40">
                    <td className="py-1 pr-3">{leg.legIntent.replace(/_/g, " ")}</td>
                    <td className="py-1 pr-3 font-mono text-xs">{leg.symbol}</td>
                    <td className="py-1 pr-3">{leg.optionType ?? "—"}</td>
                    <td className="py-1 pr-3">{leg.expiration ?? "—"}</td>
                    <td className="py-1 pr-3">{leg.strike != null ? fmt(leg.strike, "") : "—"}</td>
                    <td className="py-1 pr-3">{leg.quantity}</td>
                    <td className="py-1">{leg.ratio}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Quantity */}
      <Section title="Quantity">
        <Row label="Confirmed Quantity" value={`${draft.quantityContext.confirmedQuantity} ${draft.quantityContext.unit}`} />
        <Row label="Unit" value={draft.quantityContext.unit} />
        {draft.quantityContext.hypotheticalPlanQuantity != null && (
          <Row
            label="Hypothetical Plan Size (reference only)"
            value={`${draft.quantityContext.hypotheticalPlanQuantity} ${draft.quantityContext.unit}`}
          />
        )}
      </Section>

      {/* Order Type Preference */}
      <Section title="Order Type Preference">
        <Row label="Order Type" value={draft.pricingContext.orderType} />
        {draft.pricingContext.orderType === "LIMIT" && (
          <>
            <Row label="Limit Price Reference" value={fmt(draft.pricingContext.limitPriceReference)} />
            <Row label="Price Source" value={draft.pricingContext.limitPriceSource ?? "—"} />
          </>
        )}
        {draft.pricingContext.marketOrderWarningGenerated && (
          <p className="text-xs text-amber-400 mt-1">{MARKET_ORDER_WARNING}</p>
        )}
      </Section>

      {/* Time in Force */}
      <Section title="Time in Force">
        <Row label="TIF" value={draft.timeInForceContext.timeInForce} />
        <Row label="Supported" value={draft.timeInForceContext.supported ? "Yes" : "No"} />
        {draft.timeInForceContext.note && (
          <p className="text-xs text-slate-400 mt-1">{draft.timeInForceContext.note}</p>
        )}
      </Section>

      {/* Pricing Reference / Estimated Capital */}
      <Section title="Estimated Capital">
        {draft.capitalContext.estimatedNotional != null && (
          <Row label="Estimated Notional" value={fmt(draft.capitalContext.estimatedNotional)} />
        )}
        {draft.capitalContext.estimatedDebit != null && (
          <Row label="Estimated Midpoint Debit" value={fmt(draft.capitalContext.estimatedDebit)} />
        )}
        {draft.capitalContext.estimatedCredit != null && (
          <Row label="Estimated Midpoint Credit" value={fmt(draft.capitalContext.estimatedCredit)} />
        )}
        <p className="text-xs text-slate-500 mt-1">{draft.capitalContext.estimateNote}</p>
      </Section>

      {/* Risk Summary */}
      {(draft.riskContext.maxLoss || draft.riskContext.riskFlags.length > 0) && (
        <Section title="Risk Summary (from saved plan)">
          {draft.riskContext.maxLoss && (
            <Row label="Max Loss" value={(draft.riskContext.maxLoss as any)?.label ?? "—"} />
          )}
          {draft.riskContext.maxGain && (
            <Row label="Max Gain" value={(draft.riskContext.maxGain as any)?.label ?? "—"} />
          )}
          <Row label="Constraint Status" value={draft.riskContext.constraintStatus} />
          {draft.riskContext.riskFlags.length > 0 && (
            <Row label="Risk Flags" value={draft.riskContext.riskFlags.join(", ")} />
          )}
        </Section>
      )}

      {/* Quote Freshness */}
      <Section title="Quote Freshness">
        <Row label="Status" value={draft.quoteSnapshot.freshnessStatus} />
        <Row label="Captured At" value={fmtTs(draft.quoteSnapshot.capturedAt)} />
        <Row label="Market Session" value={draft.marketHoursContext.sessionState} />
        <p className="text-xs text-slate-500 mt-1">{DRAFT_QUOTE_WARNING}</p>
      </Section>

      {/* Fingerprint / Audit */}
      <Section title="Expiration">
        <Row label="Expires At" value={fmtTs(draft.expiresAt)} />
        <Row label="Fingerprint" value={draft.preparationFingerprint.slice(0, 12) + "…"} />
        <Row label="Created At" value={fmtTs(draft.createdAt)} />
        <Row label="Version" value={String(draft.version)} />
      </Section>

      {/* Future Step — not executable */}
      <div className="rounded-lg border border-slate-700/30 bg-slate-800/20 p-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Next Step</p>
        <p className="text-sm text-slate-400">
          Continue to Preview — Upcoming (Sprint 2.8.2 / 2.8.3)
        </p>
        <p className="text-xs text-slate-500 mt-1">
          Order preview and explicit confirmation are future steps. No order has been submitted.
        </p>
      </div>

      {/* Actions — Save Draft / Discard only. No Submit/Execute/Confirm Trade. */}
      <div className="flex flex-wrap gap-3 pt-1">
        <button
          onClick={onCreateNew}
          className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm font-medium text-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-400 transition-colors"
          aria-label="Update Draft"
        >
          Update Draft
        </button>
        <button
          onClick={onAbandon}
          disabled={isAbandoning}
          className="px-4 py-2 rounded-lg border border-slate-600 hover:border-red-700/60 hover:text-red-400 text-sm font-medium text-slate-400 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-400 transition-colors"
          aria-label="Abandon this order draft"
        >
          {isAbandoning ? "Abandoning…" : "Abandon Draft"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div>
      <h5 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">{title}</h5>
      <div className="rounded-lg border border-slate-700/40 bg-slate-800/20 p-3 space-y-1.5">
        {children}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="flex justify-between items-start gap-3">
      <span className="text-xs text-slate-400 shrink-0">{label}</span>
      <span className="text-xs text-slate-200 text-right">{value}</span>
    </div>
  );
}

function DraftStatusBadge({ status }: { status: string }): React.ReactElement {
  const colors: Record<string, string> = {
    VALID: "bg-emerald-900/40 text-emerald-400 border-emerald-800/50",
    DRAFT: "bg-blue-900/40 text-blue-400 border-blue-800/50",
    REQUIRES_REVIEW: "bg-yellow-900/40 text-yellow-400 border-yellow-800/50",
    EXPIRED: "bg-slate-700/40 text-slate-400 border-slate-600/50",
    INVALID: "bg-red-900/40 text-red-400 border-red-800/50",
    ABANDONED: "bg-slate-700/40 text-slate-500 border-slate-600/50",
  };
  const cls = colors[status] ?? "bg-slate-700/40 text-slate-400 border-slate-600/50";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${cls}`}
      aria-label={`Draft status: ${status}`}>
      {status}
    </span>
  );
}
