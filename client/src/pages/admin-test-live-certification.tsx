/**
 * client/src/pages/admin-test-live-certification.tsx — Sprint 2.8.6A
 *
 * Controlled TEST_LIVE Execution Certification — Admin UI
 *
 * This page walks the platform operator through the 33-step certification
 * checklist for a live test broker order. No order is placed automatically.
 *
 * Certification sections mapped to UI panels:
 *   Panel 1 — Configuration Audit (Sections 1–2)
 *   Panel 2 — Market Status (Section 6)
 *   Panel 3 — Account & Symbol Verification (Sections 2–5)
 *   Panel 4 — Pre-Submission Checklist (Sections 7–13)
 *   Panel 5 — Live Submission (Section 14–16) — manual operator action only
 *   Panel 6 — Post-Submission Status (Sections 17–29)
 *   Panel 7 — Disarm & Completion Report (Sections 30–35)
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, XCircle, Clock, RefreshCw, Shield, Activity, Lock, Unlock, ChevronDown, ChevronRight, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface ConfigGate {
  variable: string;
  status: "PASS" | "FAIL" | "NOT_CONFIGURED" | "OPTIONAL";
  safeDescription: string;
}

interface ConfigAuditResult {
  gates: ConfigGate[];
  allRequiredPass: boolean;
  missingRequired: string[];
  marketOrderPolicy: "banned";
  multiLegPolicy: "banned";
  productionBlocked: true;
  executionMode: string;
  executionEnabled: boolean;
  testLiveArmed: boolean;
  allowlistedSymbols: string[];
  accountAllowlistCount: number;
  maxNotional: number | null;
  maxEquityQty: number | null;
  maxOptionContracts: number | null;
}

interface MarketStatusResult {
  open: boolean;
  status: "OPEN" | "CLOSED_WEEKEND" | "CLOSED_OUTSIDE_HOURS" | "CLOSED_HOLIDAY";
  currentEtTime: string;
  regularSessionStartEt: "09:30";
  regularSessionEndEt: "16:00";
  note: string;
  canCertify: boolean;
}

interface AccountStatusResult {
  connected: boolean;
  provider: string | null;
  maskedAccountRef: string | null;
  inAllowlist: boolean;
  allowlistConfigured: boolean;
  requiresReauth: boolean;
  simMode?: boolean;
  note: string;
}

interface CompletionReportItem {
  item: number;
  label: string;
  value: string;
}

interface CompletionReport {
  items: CompletionReportItem[];
  verdict: string;
  decision: string;
  note: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// STATUS BADGE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function GateStatusBadge({ status }: { status: ConfigGate["status"] }) {
  if (status === "PASS") return (
    <span className="inline-flex items-center gap-1 text-emerald-400 text-xs font-semibold">
      <CheckCircle2 className="h-3.5 w-3.5" /> PASS
    </span>
  );
  if (status === "FAIL") return (
    <span className="inline-flex items-center gap-1 text-red-400 text-xs font-semibold">
      <XCircle className="h-3.5 w-3.5" /> FAIL
    </span>
  );
  if (status === "OPTIONAL") return (
    <span className="inline-flex items-center gap-1 text-slate-400 text-xs font-semibold">
      <Info className="h-3.5 w-3.5" /> OPTIONAL
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-amber-400 text-xs font-semibold">
      <Clock className="h-3.5 w-3.5" /> NOT CONFIGURED
    </span>
  );
}

function MarketBadge({ status }: { status: MarketStatusResult["status"] }) {
  if (status === "OPEN") return <Badge className="bg-emerald-600 hover:bg-emerald-600">OPEN</Badge>;
  if (status === "CLOSED_WEEKEND") return <Badge variant="secondary">CLOSED (Weekend)</Badge>;
  if (status === "CLOSED_HOLIDAY") return <Badge variant="secondary">CLOSED (Holiday)</Badge>;
  return <Badge variant="secondary">CLOSED (Outside Hours)</Badge>;
}

function DecisionBadge({ decision }: { decision: string }) {
  if (decision === "GO") return <Badge className="bg-emerald-600 text-white text-base px-3 py-1">GO</Badge>;
  if (decision === "CONDITIONAL_GO") return <Badge className="bg-amber-600 text-white text-base px-3 py-1">CONDITIONAL_GO</Badge>;
  return <Badge variant="destructive" className="text-base px-3 py-1">NO_GO</Badge>;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION PANEL WRAPPER
// ─────────────────────────────────────────────────────────────────────────────

function Section({ title, subtitle, children, defaultOpen = true }: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className="bg-slate-900 border-slate-700">
      <CardHeader
        className="pb-3 cursor-pointer select-none"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-slate-100 text-base">{title}</CardTitle>
            {subtitle && <CardDescription className="text-slate-400 mt-0.5">{subtitle}</CardDescription>}
          </div>
          {open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
        </div>
      </CardHeader>
      {open && <CardContent className="pt-0">{children}</CardContent>}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────

export default function AdminTestLiveCertificationPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  // ── Data fetching ──────────────────────────────────────────────────────────
  const {
    data: auditData, isLoading: auditLoading, refetch: refetchAudit,
    error: auditError,
  } = useQuery<{ ok: boolean; audit: ConfigAuditResult }>({
    queryKey: ["/api/admin/test-live/config-audit"],
    retry: false,
  });
  const {
    data: marketData, isLoading: marketLoading, refetch: refetchMarket,
    error: marketError,
  } = useQuery<{ ok: boolean; market: MarketStatusResult }>({
    queryKey: ["/api/admin/test-live/market-status"],
    retry: false,
    refetchInterval: 60_000, // refresh market status every minute
  });
  const {
    data: accountData, isLoading: accountLoading, refetch: refetchAccount,
    error: accountError,
  } = useQuery<{ ok: boolean; accountStatus: AccountStatusResult }>({
    queryKey: ["/api/admin/test-live/account-status"],
    retry: false,
  });
  const { data: reportData, refetch: refetchReport, error: reportError } = useQuery<{ ok: boolean; report: CompletionReport }>({
    queryKey: ["/api/admin/test-live/completion-report"],
    retry: false,
  });

  // ── HTTP error interpretation ──────────────────────────────────────────────
  function httpErrorMessage(err: unknown): string {
    if (!err) return "";
    const status = (err as any)?.status ?? (err as any)?.response?.status;
    if (status === 401) return "Authentication required. Please sign in.";
    if (status === 403) return "Administrator access is required. This page is restricted to admin accounts.";
    return "Certification service could not be loaded. Check server logs.";
  }

  // ── Disarm mutation ────────────────────────────────────────────────────────
  const disarmMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/admin/test-live/disarm");
      return r.json();
    },
    onSuccess: (data) => {
      if (data.ok) {
        toast({ title: "Disarm instructions generated", description: data.disarm?.note ?? "See instructions below." });
        qc.invalidateQueries({ queryKey: ["/api/admin/test-live/config-audit"] });
      }
    },
    onError: () => toast({ title: "Disarm failed", variant: "destructive" }),
  });

  const [disarmResult, setDisarmResult] = useState<null | { action: string; note: string; productionStillBlocked: boolean }>(null);

  const audit = auditData?.audit;
  const market = marketData?.market;
  const account = accountData?.accountStatus;
  const report = reportData?.report;

  // ── Pre-submission acknowledgements ────────────────────────────────────────
  const [acks, setAcks] = useState({
    liveOrder: false,
    realMoney: false,
    realPosition: false,
    quotesChange: false,
    limitMayNotFill: false,
  });
  const allAcked = Object.values(acks).every(Boolean);
  const allConfigPass = audit?.allRequiredPass ?? false;
  const marketOpen = market?.open ?? false;
  const accountOk = (account?.connected && account.inAllowlist && !account.requiresReauth) ?? false;

  const readyToShowSubmit = allConfigPass && marketOpen && accountOk && allAcked;

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <div className="border-b border-slate-800 bg-slate-900 px-6 py-4">
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6 text-amber-400" />
          <div>
            <h1 className="text-xl font-bold text-slate-100">TEST_LIVE Execution Certification</h1>
            <p className="text-sm text-slate-400">Sprint 2.8.6A — Controlled certification of the live execution pipeline</p>
          </div>
        </div>
        <div className="mt-3 p-3 bg-amber-950/40 border border-amber-800/60 rounded-lg">
          <p className="text-amber-300 text-sm font-medium flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            This page initiates a REAL live broker order using real money. Every step must be verified before submission.
            No automatic submissions occur — explicit operator action is required.
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6 space-y-4">

        {/* ── Panel 1: Configuration Audit ──────────────────────────────── */}
        <Section
          title="§1–2 Configuration Audit"
          subtitle="All TEST_LIVE gates must show PASS before submission is permitted."
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              {audit && (
                audit.allRequiredPass
                  ? <span className="text-emerald-400 font-semibold text-sm flex items-center gap-1"><CheckCircle2 className="h-4 w-4" /> All required gates PASS</span>
                  : <span className="text-red-400 font-semibold text-sm flex items-center gap-1"><XCircle className="h-4 w-4" /> {audit.missingRequired.length} required gate(s) failing</span>
              )}
            </div>
            <Button size="sm" variant="outline" onClick={() => refetchAudit()} disabled={auditLoading}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${auditLoading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>

          {auditLoading && <p className="text-slate-400 text-sm">Loading config audit…</p>}

          {auditError && !auditLoading && (
            <div className="p-3 bg-red-950/30 border border-red-800/50 rounded-lg">
              <p className="text-red-300 text-sm font-medium flex items-center gap-2">
                <XCircle className="h-4 w-4 shrink-0" />
                {httpErrorMessage(auditError)}
              </p>
            </div>
          )}

          {audit && (
            <div className="space-y-2">
              {audit.gates.map((gate) => (
                <div key={gate.variable} className="flex items-start justify-between gap-3 py-2 border-b border-slate-800 last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono text-slate-300 truncate">{gate.variable}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{gate.safeDescription}</p>
                  </div>
                  <GateStatusBadge status={gate.status} />
                </div>
              ))}
            </div>
          )}

          {audit && !audit.allRequiredPass && (
            <div className="mt-3 p-3 bg-red-950/30 border border-red-800/50 rounded-lg">
              <p className="text-red-300 text-xs font-medium">Missing required configuration:</p>
              <ul className="mt-1 space-y-0.5">
                {audit.missingRequired.map(v => (
                  <li key={v} className="text-red-400 text-xs font-mono">• {v}</li>
                ))}
              </ul>
              <p className="text-slate-400 text-xs mt-2">
                Set these in Replit Secrets, then restart the application and refresh this audit.
              </p>
            </div>
          )}
        </Section>

        {/* ── Panel 2: Market Status ─────────────────────────────────────── */}
        <Section
          title="§6 Market Status"
          subtitle="Submission is only permitted during NYSE regular session (09:30–16:00 ET, Mon–Fri)."
        >
          <div className="flex items-center justify-between mb-2">
            {market && <MarketBadge status={market.status} />}
            <Button size="sm" variant="outline" onClick={() => refetchMarket()} disabled={marketLoading}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${marketLoading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
          {marketError && !marketLoading && (
            <div className="p-3 bg-red-950/30 border border-red-800/50 rounded-lg">
              <p className="text-red-300 text-sm font-medium flex items-center gap-2">
                <XCircle className="h-4 w-4 shrink-0" />
                {httpErrorMessage(marketError)}
              </p>
            </div>
          )}

          {market && (
            <div className="space-y-1 text-sm">
              <div className="flex gap-2 text-slate-400">
                <span className="w-36 shrink-0 text-slate-500">Current time (ET):</span>
                <span className="font-mono text-slate-300">{market.currentEtTime}</span>
              </div>
              <div className="flex gap-2 text-slate-400">
                <span className="w-36 shrink-0 text-slate-500">Regular session:</span>
                <span className="text-slate-300">{market.regularSessionStartEt} – {market.regularSessionEndEt} ET</span>
              </div>
              <p className="text-slate-400 text-xs mt-2">{market.note}</p>
              {!market.open && (
                <div className="mt-2 p-2 bg-slate-800 rounded text-amber-400 text-xs font-medium">
                  ⚠ Market is closed. Return READY_BUT_MARKET_CLOSED — do NOT submit a live order now.
                </div>
              )}
            </div>
          )}
        </Section>

        {/* ── Panel 3: Account & Symbol Verification ────────────────────── */}
        <Section
          title="§2–5 Account & Symbol Verification"
          subtitle="Verify the test account and confirm the allowlisted symbol before proceeding."
        >
          <div className="flex justify-end mb-3">
            <Button size="sm" variant="outline" onClick={() => refetchAccount()} disabled={accountLoading}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${accountLoading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>

          {accountLoading && <p className="text-slate-400 text-sm">Checking broker account…</p>}

          {accountError && !accountLoading && (
            <div className="p-3 bg-red-950/30 border border-red-800/50 rounded-lg">
              <p className="text-red-300 text-sm font-medium flex items-center gap-2">
                <XCircle className="h-4 w-4 shrink-0" />
                {httpErrorMessage(accountError)}
              </p>
            </div>
          )}

          {account && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex flex-col gap-1">
                  <span className="text-slate-500 text-xs">Connected</span>
                  <span className={account.connected ? "text-emerald-400" : "text-red-400"}>
                    {account.connected ? "Yes" : "No — connect a broker account"}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-slate-500 text-xs">Provider</span>
                  <span className="text-slate-300 font-mono">{account.provider ?? "—"}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-slate-500 text-xs">Masked account ref</span>
                  <span className="text-slate-300 font-mono">{account.maskedAccountRef ?? "—"}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-slate-500 text-xs">In allowlist</span>
                  <span className={account.inAllowlist ? "text-emerald-400" : "text-red-400"}>
                    {account.inAllowlist ? "Yes" : "No"}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-slate-500 text-xs">Requires reauth</span>
                  <span className={account.requiresReauth ? "text-red-400" : "text-emerald-400"}>
                    {account.requiresReauth ? "Yes — reconnect" : "No"}
                  </span>
                </div>
                {account.provider === "tradestation" && (
                  <div className="flex flex-col gap-1">
                    <span className="text-slate-500 text-xs">SIM mode</span>
                    <span className={account.simMode ? "text-emerald-400" : "text-amber-400"}>
                      {account.simMode ? "Yes (SIM connection)" : "No — must be SIM for SANDBOX"}
                    </span>
                  </div>
                )}
              </div>
              <p className="text-xs text-slate-400 border-t border-slate-800 pt-2">{account.note}</p>
            </div>
          )}

          {audit && (
            <div className="mt-4 pt-3 border-t border-slate-800">
              <p className="text-slate-400 text-xs font-medium mb-2">§3 Allowlisted symbols (safe to display):</p>
              {audit.allowlistedSymbols.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {audit.allowlistedSymbols.map(sym => (
                    <Badge key={sym} variant="outline" className="font-mono text-sm">{sym}</Badge>
                  ))}
                </div>
              ) : (
                <p className="text-red-400 text-xs">No symbols allowlisted — configure EXECUTION_TEST_SYMBOL_ALLOWLIST</p>
              )}
              <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
                <div>
                  <span className="text-slate-500">Order type</span>
                  <p className="text-slate-300 font-medium mt-0.5">LIMIT only</p>
                </div>
                <div>
                  <span className="text-slate-500">Quantity</span>
                  <p className="text-slate-300 font-medium mt-0.5">
                    {audit.maxEquityQty !== null ? `${Math.min(1, audit.maxEquityQty)} share` : "—"}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Max notional</span>
                  <p className="text-slate-300 font-medium mt-0.5">
                    {audit.maxNotional !== null ? `$${audit.maxNotional.toFixed(2)}` : "NOT CONFIGURED"}
                  </p>
                </div>
              </div>
            </div>
          )}
        </Section>

        {/* ── Panel 4: Pre-Submission Checklist ─────────────────────────── */}
        <Section
          title="§7–13 Pre-Submission Checklist"
          subtitle="Complete the execution pipeline using the existing Order workflow (Trade Plan → Preflight → Draft → Preview → Review). Return here when the confirmation is ready."
          defaultOpen={false}
        >
          <div className="space-y-2 text-sm text-slate-400">
            {[
              { ref: "§7", label: "Create a dedicated equity test Trade Plan (broadExpressionType=STOCK, selectedBy=USER)" },
              { ref: "§8", label: "Run Execution Preflight — must return PASS on all 12 dimensions" },
              { ref: "§9", label: "Create non-executable OrderDraft: 1 share, LIMIT, TIF=day, user-selected price" },
              { ref: "§10", label: "Generate Equity Order Preview — confirm current bid/ask and estimated notional" },
              { ref: "§11", label: "Build immutable Final Order Review — record snapshot hash" },
              { ref: "§12", label: "Obtain all required TEST_LIVE acknowledgements" },
              { ref: "§13", label: "Run final revalidation (all 19 checks) immediately before submit" },
            ].map(step => (
              <div key={step.ref} className="flex gap-3 items-start py-1.5 border-b border-slate-800/60 last:border-0">
                <span className="text-slate-600 font-mono text-xs shrink-0 mt-0.5 w-7">{step.ref}</span>
                <span className="text-slate-300 text-sm">{step.label}</span>
              </div>
            ))}
          </div>
          <p className="text-slate-500 text-xs mt-3">
            Use the <strong>Trade Planning</strong> and <strong>Execution</strong> pages in the app to complete these steps.
            The existing /api/executions pipeline handles all verification automatically.
          </p>
        </Section>

        {/* ── Panel 5: Required Acknowledgements (§12) ──────────────────── */}
        <Section
          title="§12 Required Acknowledgements"
          subtitle="All five must be checked before the submit button becomes available. Nothing may be pre-checked."
        >
          <div className="space-y-3">
            {(
              [
                { key: "liveOrder", label: "I understand this is a LIVE test order — it will reach the real broker." },
                { key: "realMoney", label: "I understand real money may be affected by this order." },
                { key: "realPosition", label: "I understand a real position may result from this order." },
                { key: "quotesChange", label: "I understand quotes may change between preview and execution." },
                { key: "limitMayNotFill", label: "I understand a limit order may not execute if the price is not reached." },
              ] as const
            ).map(({ key, label }) => (
              <div key={key} className="flex items-start gap-3">
                <Checkbox
                  id={key}
                  checked={acks[key]}
                  onCheckedChange={(checked) => setAcks(a => ({ ...a, [key]: !!checked }))}
                  className="mt-0.5"
                />
                <label htmlFor={key} className="text-sm text-slate-300 cursor-pointer leading-snug">
                  {label}
                </label>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Panel 6: Live Submission Control (§14) ────────────────────── */}
        <Section
          title="§14 Live Submission Control"
          subtitle="The submit action is available only when all gates pass, market is open, account is verified, and all acknowledgements are checked."
        >
          {/* Summary before submit */}
          {audit && market && account && (
            <div className="mb-4 p-3 bg-slate-800 rounded-lg space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Execution mode</span>
                <span className={`font-mono font-bold ${audit.executionMode === "test_live" ? "text-amber-400" : "text-red-400"}`}>
                  {audit.executionMode.toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Account</span>
                <span className="font-mono text-slate-300">{account.maskedAccountRef ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Symbol</span>
                <span className="font-mono text-amber-300">{audit.allowlistedSymbols[0] ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Quantity</span>
                <span className="text-slate-300">
                  {audit.maxEquityQty !== null ? `${Math.min(1, audit.maxEquityQty)} share` : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Order type</span>
                <span className="text-slate-300">LIMIT (user-selected price)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Max notional</span>
                <span className="text-slate-300">
                  {audit.maxNotional !== null ? `$${audit.maxNotional.toFixed(2)}` : "NOT CONFIGURED"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Market state</span>
                <span className={market.open ? "text-emerald-400" : "text-amber-400"}>{market.status}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Config gates</span>
                <span className={audit.allRequiredPass ? "text-emerald-400" : "text-red-400"}>
                  {audit.allRequiredPass ? "All PASS" : `${audit.missingRequired.length} FAIL`}
                </span>
              </div>
            </div>
          )}

          {/* Gate summary */}
          <div className="space-y-1.5 mb-4">
            {[
              { label: "Config audit", ok: allConfigPass },
              { label: "Market open", ok: marketOpen },
              { label: "Account verified + in allowlist", ok: accountOk },
              { label: "All acknowledgements checked", ok: allAcked },
            ].map(({ label, ok }) => (
              <div key={label} className="flex items-center gap-2 text-sm">
                {ok
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  : <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                }
                <span className={ok ? "text-slate-300" : "text-slate-500"}>{label}</span>
              </div>
            ))}
          </div>

          <div className="p-3 bg-slate-800/60 rounded-lg border border-slate-700 text-sm text-slate-400 mb-4">
            <p className="font-medium text-slate-300 mb-1">§14 — Operator action required</p>
            <p>
              The actual order submission is handled through the standard execution pipeline
              (<strong>/executions/:id/submit</strong> endpoint). Once you have a confirmed
              ExecutionIntent (from completing steps §7–13 in the Trade Planning workflow),
              use the <strong>Execution Detail</strong> page at <code className="text-amber-300">/executions/:id</code> to
              submit the order. The submit button on that page enforces all safety gates and
              requires explicit operator click.
            </p>
          </div>

          {!readyToShowSubmit && (
            <div className="p-3 bg-slate-900 rounded border border-slate-700 text-slate-500 text-sm text-center">
              {!allAcked
                ? "Check all five acknowledgements above to unlock submission guidance."
                : !allConfigPass
                ? "Fix failing configuration gates before proceeding."
                : !marketOpen
                ? "Market is closed. Return during NYSE regular session."
                : "Verify broker account is connected and in allowlist."}
            </div>
          )}

          {readyToShowSubmit && (
            <div className="p-4 bg-emerald-950/30 border border-emerald-700/50 rounded-lg">
              <p className="text-emerald-300 font-medium text-sm mb-2 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                All pre-conditions met — proceed to the Execution Detail page to submit
              </p>
              <p className="text-slate-400 text-xs">
                Navigate to <code className="text-amber-300">/executions/:id</code> for your confirmed intent,
                verify the order summary shown there, and click <strong>Submit Live Test Order</strong>.
                Exactly one broker mutation will occur. No automatic retries.
              </p>
            </div>
          )}
        </Section>

        {/* ── Panel 7: Post-Submission Verification (§15–29) ────────────── */}
        <Section
          title="§15–29 Post-Submission Verification"
          subtitle="After submitting, verify these items on the Execution Detail page (/executions/:id)."
          defaultOpen={false}
        >
          <div className="space-y-2 text-sm">
            {[
              { ref: "§15", label: "Exactly ONE ExecutionIntent, ONE submission attempt, ONE idempotency key, ONE broker mutation" },
              { ref: "§16", label: "Broker acknowledgement: brokerOrderRef received, state = BROKER_ACCEPTED (or REJECTED/SUBMISSION_UNKNOWN)" },
              { ref: "§17", label: "If SUBMISSION_UNKNOWN: submit button unavailable, Check Broker Status CTA visible, no auto-retry" },
              { ref: "§18", label: "Status check: query broker by brokerOrderRef, verify normalized state" },
              { ref: "§19", label: "If order remains open: do NOT auto-alter price, do NOT chase fill" },
              { ref: "§20", label: "If order fills: verify fill record (qty, price, timestamp, broker order link, state=FILLED)" },
              { ref: "§21", label: "Position link appears only after authoritative broker/portfolio data confirms it" },
              { ref: "§22", label: "NO automatic close/opposite order — leave position visible" },
              { ref: "§23", label: "Audit trail: events exist for validation, lock, submission started, ack/rejection, fills" },
              { ref: "§24", label: "Duplicate protection: reload the confirmation path — zero additional broker mutations" },
              { ref: "§25", label: "Execution Detail page (/executions/:id) shows mode badge, timeline, fills, reconciliation state" },
            ].map(step => (
              <div key={step.ref} className="flex gap-3 items-start py-1.5 border-b border-slate-800/60 last:border-0">
                <span className="text-slate-600 font-mono text-xs shrink-0 mt-0.5 w-7">{step.ref}</span>
                <span className="text-slate-400 text-sm">{step.label}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Panel 8: Platform Health (§26) ────────────────────────────── */}
        <Section
          title="§26 Platform Health Check"
          subtitle="After certification, verify the execution section on the Platform Health page."
          defaultOpen={false}
        >
          <div className="text-sm text-slate-400 space-y-2">
            <p>Navigate to <code className="text-amber-300">/admin/platform-health</code> and verify:</p>
            <ul className="space-y-1.5 list-none">
              {[
                "Submission attempt recorded",
                "SUBMISSION_IN_PROGRESS is NOT stuck (must be resolved)",
                "Fill metrics accurate (if filled)",
                "Position-link health (if linked)",
                "Global production mode still disabled",
              ].map(item => (
                <li key={item} className="flex items-center gap-2">
                  <Activity className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </Section>

        {/* ── Panel 9: Disarm (§30) ──────────────────────────────────────── */}
        <Section
          title="§30 Post-Certification Disarm"
          subtitle="After certification is complete, disarm TEST_LIVE to prevent unintended live orders."
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1">
              {audit?.testLiveArmed ? (
                <div className="flex items-center gap-2 text-amber-400 text-sm font-medium">
                  <Unlock className="h-4 w-4" /> TEST_LIVE is currently ARMED
                </div>
              ) : (
                <div className="flex items-center gap-2 text-slate-400 text-sm font-medium">
                  <Lock className="h-4 w-4" /> TEST_LIVE is not armed
                </div>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const result = await disarmMutation.mutateAsync();
                if (result.ok) setDisarmResult(result.disarm);
              }}
              disabled={disarmMutation.isPending}
            >
              {disarmMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Lock className="h-3.5 w-3.5 mr-1" />}
              Generate Disarm Instructions
            </Button>
          </div>

          {disarmResult && (
            <div className="p-3 bg-slate-800 rounded-lg space-y-2">
              <p className="text-sm font-medium text-slate-200">
                Action: <span className="text-amber-300">{disarmResult.action}</span>
              </p>
              <p className="text-xs text-slate-400">{disarmResult.note}</p>
              <div className="flex items-center gap-2 text-xs text-emerald-400">
                <Lock className="h-3 w-3" />
                Production execution: still permanently blocked
              </div>
            </div>
          )}

          <p className="text-xs text-slate-500 mt-3">
            Note: This API cannot modify environment variables directly. You must remove or set
            <code className="text-amber-300 mx-1">EXECUTION_TEST_LIVE_ARMED</code> to
            <code className="text-amber-300 mx-1">false</code> in Replit Secrets and restart the application.
          </p>
        </Section>

        {/* ── Panel 10: Completion Report (§34) ────────────────────────── */}
        <Section
          title="§34 Completion Report (48 Items)"
          subtitle="The full certification completion report. NOT_YET_RUN items require a live test execution."
          defaultOpen={false}
        >
          <div className="flex justify-end mb-3">
            <Button size="sm" variant="outline" onClick={() => refetchReport()}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh Report
            </Button>
          </div>

          {reportError && (
            <div className="p-3 bg-red-950/30 border border-red-800/50 rounded-lg mb-3">
              <p className="text-red-300 text-sm font-medium flex items-center gap-2">
                <XCircle className="h-4 w-4 shrink-0" />
                {httpErrorMessage(reportError)}
              </p>
            </div>
          )}

          {report && (
            <>
              <div className="flex items-center gap-3 mb-4 p-3 bg-slate-800 rounded-lg">
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-200">
                    Verdict: <span className="text-amber-300">{report.verdict}</span>
                  </p>
                  <p className="text-xs text-slate-400 mt-1">{report.note}</p>
                </div>
                <DecisionBadge decision={report.decision} />
              </div>

              <ScrollArea className="h-96">
                <div className="space-y-1 pr-4">
                  {report.items.map(item => (
                    <div key={item.item} className="flex gap-3 py-1.5 border-b border-slate-800/50 last:border-0 text-sm">
                      <span className="text-slate-600 font-mono text-xs w-6 shrink-0 mt-0.5">{item.item}.</span>
                      <span className="text-slate-400 w-52 shrink-0">{item.label}</span>
                      <span className={`font-mono text-xs mt-0.5 ${
                        item.value === "NOT_YET_RUN" ? "text-slate-600" :
                        item.value === "NOT_CONFIGURED" ? "text-red-400" :
                        item.value.startsWith("PASS") ? "text-emerald-400" :
                        item.value.startsWith("FAIL") ? "text-red-400" :
                        item.value === "NO_GO" ? "text-red-400" :
                        item.value === "CONDITIONAL_GO" ? "text-amber-400" :
                        "text-slate-300"
                      }`}>
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </>
          )}
        </Section>

        {/* Footer notice */}
        <div className="text-center py-4">
          <p className="text-xs text-slate-600">
            Sprint 2.8.6A — Certification infrastructure. General customer production execution remains DISABLED.
          </p>
        </div>
      </div>
    </div>
  );
}
