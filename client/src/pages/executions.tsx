/**
 * client/src/pages/executions.tsx — Sprint 2.8.6
 *
 * Execution Intent Detail Page (/executions/:id)
 * Shows mode, broker order ref, state timeline, fills, and position sync status.
 */

import { useEffect, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
  RefreshCw,
  Activity,
  ArrowLeft,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface ExecutionFill {
  id: string;
  fillSequence: number;
  orderedQty: number;
  filledQty: number;
  remainingQty: number;
  fillPrice: number | null;
  fillAt: string;
  commission: number | null;
  rawStatusFromBroker: string;
}

interface ExecutionIntentSummary {
  id: string;
  state: string;
  executionMode: string;
  tradePlanId: string;
  provider: string;
  accountRefMasked: string;
  symbol: string;
  instrumentType: string;
  structureType: string;
  orderedQty: number | null;
  filledQty: number | null;
  fillPrice: number | null;
  brokerOrderRef: string | null;
  clientOrderTag: string | null;
  submittedAt: string | null;
  acknowledgedAt: string | null;
  reconciledAt: string | null;
  filledAt: string | null;
  linkedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  orderSummary: {
    side: string;
    quantity: number;
    orderType: string;
    duration: string;
    estimatedNotional: number | null;
  } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE DISPLAY
// ─────────────────────────────────────────────────────────────────────────────

const STATE_CONFIG: Record<string, { label: string; color: string; icon: React.ComponentType<any> }> = {
  INTENT_CREATED:                { label: "Ready to Submit", color: "text-blue-400",   icon: Clock },
  FINAL_VALIDATION_IN_PROGRESS:  { label: "Validating…",    color: "text-yellow-400", icon: RefreshCw },
  FINAL_VALIDATION_FAILED:       { label: "Validation Failed", color: "text-red-400", icon: XCircle },
  SANDBOX_SUBMISSION_IN_PROGRESS:{ label: "Submitting (Paper)…", color: "text-yellow-400", icon: RefreshCw },
  SUBMISSION_IN_PROGRESS:        { label: "Submitting…",    color: "text-yellow-400", icon: RefreshCw },
  BROKER_ACCEPTED:               { label: "Accepted by Broker", color: "text-blue-400", icon: CheckCircle2 },
  SUBMISSION_UNKNOWN:            { label: "Status Unknown", color: "text-orange-400", icon: AlertTriangle },
  REJECTED:                      { label: "Rejected by Broker", color: "text-red-400", icon: XCircle },
  OPEN:                          { label: "Open at Broker",  color: "text-blue-400",   icon: Activity },
  PARTIALLY_FILLED:              { label: "Partially Filled", color: "text-blue-400",  icon: Activity },
  FILLED:                        { label: "Filled",          color: "text-green-400",  icon: CheckCircle2 },
  CANCELLED:                     { label: "Cancelled",       color: "text-slate-400",  icon: XCircle },
  EXPIRED_AT_BROKER:             { label: "Expired",         color: "text-slate-400",  icon: Clock },
  POSITION_LINKED:               { label: "Position Linked", color: "text-green-400",  icon: CheckCircle2 },
  ABANDONED:                     { label: "Abandoned",       color: "text-slate-400",  icon: XCircle },
};

// ─────────────────────────────────────────────────────────────────────────────
// PAGE COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function ExecutionDetailPage() {
  const [, params] = useRoute("/executions/:id");
  const [, setLocation] = useLocation();
  const intentId = params?.id;

  const [intent, setIntent] = useState<ExecutionIntentSummary | null>(null);
  const [fills, setFills] = useState<ExecutionFill[]>([]);
  const [executionModeLabel, setExecutionModeLabel] = useState("");
  const [submissionUnknownMessage, setSubmissionUnknownMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileMessage, setReconcileMessage] = useState<string | null>(null);

  const load = async () => {
    if (!intentId) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/executions/${intentId}`);
      if (!r.ok) { setError("Execution not found."); return; }
      const data = await r.json();
      setIntent(data.intent);
      setFills(data.fills ?? []);
      setExecutionModeLabel(data.executionModeLabel ?? "");
      setSubmissionUnknownMessage(data.submissionUnknownMessage ?? null);
    } catch {
      setError("Failed to load execution details.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [intentId]);

  const handleReconcile = async () => {
    if (!intentId) return;
    setReconciling(true);
    setReconcileMessage(null);
    try {
      const r = await fetch(`/api/executions/${intentId}/reconcile`, { method: "POST" });
      const data = await r.json();
      setReconcileMessage(data.message ?? "Reconcile complete.");
      await load();
    } catch {
      setReconcileMessage("Reconcile failed — check your broker account directly.");
    } finally {
      setReconciling(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900">
        <div className="text-slate-400 text-sm animate-pulse">Loading execution details…</div>
      </div>
    );
  }

  if (error || !intent) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 gap-4">
        <div className="text-red-400">{error ?? "Execution not found."}</div>
        <Button variant="outline" onClick={() => setLocation("/dashboard")}>Back to Dashboard</Button>
      </div>
    );
  }

  const stateConfig = STATE_CONFIG[intent.state] ?? { label: intent.state, color: "text-slate-400", icon: Clock };
  const StateIcon = stateConfig.icon;
  const isTestLive = intent.executionMode === "TEST_LIVE";
  const isSandbox = intent.executionMode === "SANDBOX";
  const isUnknown = intent.state === "SUBMISSION_UNKNOWN";
  const isFilled = intent.state === "FILLED" || intent.state === "POSITION_LINKED" || intent.state === "PARTIALLY_FILLED";
  const canReconcile = ["SUBMISSION_UNKNOWN", "BROKER_ACCEPTED", "OPEN", "PARTIALLY_FILLED"].includes(intent.state);

  const formatPrice = (n: number | null) => n !== null ? `$${n.toFixed(2)}` : "—";
  const formatQty = (n: number | null) => n !== null ? String(n) : "—";
  const formatTime = (iso: string | null) => iso ? new Date(iso).toLocaleString() : "—";

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 py-6 px-4 md:px-8">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <button onClick={() => window.history.back()} className="text-slate-400 hover:text-slate-200 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-white">{intent.symbol}</h1>
              <Badge variant="outline" className="text-xs uppercase tracking-wide">
                {intent.structureType}
              </Badge>
            </div>
            <p className="text-xs text-slate-400 mt-0.5 font-mono">{intent.id.substring(0, 16)}…</p>
          </div>
        </div>

        {/* Execution Mode Badge — prominent for TEST_LIVE */}
        {isTestLive && (
          <Alert className="border-orange-500/50 bg-orange-950/30">
            <AlertTriangle className="h-4 w-4 text-orange-400" />
            <AlertDescription className="text-orange-200 text-sm font-medium">
              ⚠️ LIVE TEST ACCOUNT — This order uses real funds in a test-authorized account. Not investment advice.
            </AlertDescription>
          </Alert>
        )}
        {isSandbox && (
          <div className="flex items-center gap-2 text-sm text-slate-400 bg-slate-800/50 rounded-lg px-3 py-2">
            <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />
            Paper Trading (Sandbox) — No real funds at risk.
          </div>
        )}

        {/* SUBMISSION_UNKNOWN warning */}
        {isUnknown && submissionUnknownMessage && (
          <Alert className="border-orange-500/50 bg-orange-950/20">
            <AlertTriangle className="h-4 w-4 text-orange-400" />
            <AlertDescription className="text-orange-200 text-sm">{submissionUnknownMessage}</AlertDescription>
          </Alert>
        )}

        {/* State + Order Summary */}
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-300">Execution Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <StateIcon className={`w-5 h-5 ${stateConfig.color}`} />
              <span className={`text-base font-semibold ${stateConfig.color}`}>{stateConfig.label}</span>
              <Badge variant="secondary" className="ml-auto text-xs">
                {executionModeLabel || intent.executionMode}
              </Badge>
            </div>

            <Separator className="bg-slate-700" />

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-slate-400 text-xs mb-1">Symbol</p>
                <p className="font-mono font-medium">{intent.symbol}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs mb-1">Direction</p>
                <p className="capitalize">{intent.orderSummary?.side ?? "—"}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs mb-1">Quantity</p>
                <p>{formatQty(intent.orderedQty)}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs mb-1">Order Type</p>
                <p className="uppercase text-xs">{intent.orderSummary?.orderType ?? "—"}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs mb-1">Provider</p>
                <p className="capitalize">{intent.provider}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs mb-1">Account</p>
                <p className="font-mono text-xs">{intent.accountRefMasked}</p>
              </div>
              {intent.brokerOrderRef && (
                <div className="col-span-2">
                  <p className="text-slate-400 text-xs mb-1">Broker Order Ref</p>
                  <p className="font-mono text-xs">{intent.brokerOrderRef}</p>
                </div>
              )}
              {intent.clientOrderTag && (
                <div className="col-span-2">
                  <p className="text-slate-400 text-xs mb-1">Client Tag</p>
                  <p className="font-mono text-xs">{intent.clientOrderTag}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Fills */}
        {isFilled && fills.length > 0 && (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-300">Fills</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {fills.map(fill => (
                  <div key={fill.id} className="flex items-center justify-between text-sm bg-slate-700/30 rounded-lg px-3 py-2">
                    <div>
                      <span className="text-green-400 font-medium">{fill.filledQty} filled</span>
                      {fill.remainingQty > 0 && <span className="text-slate-400 ml-2">({fill.remainingQty} remaining)</span>}
                    </div>
                    <div className="text-right">
                      <p className="font-mono">{formatPrice(fill.fillPrice)}</p>
                      <p className="text-xs text-slate-400">{formatTime(fill.fillAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Timeline */}
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-300">Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 text-xs">
              {[
                { label: "Created",     time: intent.createdAt },
                { label: "Submitted",   time: intent.submittedAt },
                { label: "Acknowledged", time: intent.acknowledgedAt },
                { label: "Reconciled",  time: intent.reconciledAt },
                { label: "Filled",      time: intent.filledAt },
                { label: "Linked",      time: intent.linkedAt },
              ].filter(e => e.time).map(e => (
                <div key={e.label} className="flex items-center justify-between py-1 border-b border-slate-700/50 last:border-0">
                  <span className="text-slate-400">{e.label}</span>
                  <span className="font-mono text-slate-300">{formatTime(e.time)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Error */}
        {intent.errorCode && (
          <Card className="bg-red-950/20 border-red-500/30">
            <CardContent className="pt-4">
              <p className="text-xs text-red-400 font-mono mb-1">{intent.errorCode}</p>
              <p className="text-sm text-red-200">{intent.errorMessage}</p>
            </CardContent>
          </Card>
        )}

        {/* Position Sync */}
        {intent.state === "POSITION_LINKED" && (
          <div className="flex items-center gap-2 text-sm text-green-400 bg-green-950/20 rounded-lg px-3 py-2">
            <CheckCircle2 className="w-4 h-4" />
            Portfolio position sync triggered after fill.
          </div>
        )}

        {/* Reconcile CTA */}
        {canReconcile && (
          <div className="flex flex-col gap-3">
            {isUnknown && (
              <p className="text-xs text-slate-400">
                Do <strong>not</strong> submit again. Check your broker account directly, then reconcile below.
              </p>
            )}
            <Button
              variant="outline"
              onClick={handleReconcile}
              disabled={reconciling}
              className="border-slate-600 text-slate-200 hover:bg-slate-700"
            >
              {reconciling ? (
                <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Reconciling…</>
              ) : (
                <><RefreshCw className="w-4 h-4 mr-2" />Check Broker Status</>
              )}
            </Button>
            {reconcileMessage && (
              <p className="text-xs text-slate-400">{reconcileMessage}</p>
            )}
          </div>
        )}

        {/* Refresh */}
        <div className="flex justify-end">
          <button onClick={load} className="text-xs text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1">
            <RefreshCw className="w-3 h-3" />
            Refresh
          </button>
        </div>

      </div>
    </div>
  );
}

export default ExecutionDetailPage;
