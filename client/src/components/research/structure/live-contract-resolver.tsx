// Live Contract Resolver — Sprint 2.2.2
//
// Converts an illustrative options structure into verified, currently listed
// option-contract candidates using the user's connected broker.
//
// Compliance rules:
//   - Never says "Recommended Contract", "Buy this call", or "Expected profit"
//   - Every numeric value is labeled with its source and basis
//   - "Estimated from displayed quotes — actual execution price may differ"
//   - No fabricated contracts, strikes, premiums, or Greeks
//   - Explicit "unavailable" states — never silent zeros
//   - No order submission occurs from this component

import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Link2,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Activity,
  RefreshCcw,
  ChevronDown,
  ChevronUp,
  Info,
  Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import type { ResearchPackage, MarketSnapshot } from "../types";
import type { OptionsStructure } from "./types";

// ---------------------------------------------------------------------------
// Types (mirror server/services/live-contract-resolver.ts)
// ---------------------------------------------------------------------------

export type LiveContractStatus =
  | "resolved"
  | "partial"
  | "broker_not_connected"
  | "capability_unavailable"
  | "unsupported_structure"
  | "chain_unavailable"
  | "no_matching_expiration"
  | "no_matching_strike"
  | "pricing_unavailable"
  | "error";

export type LiquidityStatus =
  | "verified"
  | "acceptable"
  | "limited"
  | "unavailable"
  | "rejected";

export interface ResolvedContractLeg {
  action: "buy" | "sell";
  optionType: "call" | "put";
  strike: number;
  expiration: string;
  contractId: string;
  contractSymbol: string;
  bid: number | null;
  ask: number | null;
  mark: number | null;
  volume: number | null;
  openInterest: number | null;
  impliedVolatility: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
}

export interface ResolvedContractCandidate {
  id: string;
  structure: string;
  structureLabel: string;
  expiration: string;
  dte: number;
  legs: ResolvedContractLeg[];
  contractFit: number;
  fitReasons: string[];
  warnings: string[];
  liquidityStatus: LiquidityStatus;
  pricingStatus: "available" | "partial" | "unavailable";
  estimatedDebit: number | null;
  estimatedCredit: number | null;
  pricingBasis: string | null;
  maxRisk: number | null;
  maxGain: string | null;
  breakeven: number | null;
  multiplier: number;
  greeksAvailable: boolean;
  source: string;
  asOf: string | null;
}

export interface LiveContractResolutionResult {
  status: LiveContractStatus;
  symbol: string;
  structure: string;
  provider: string | null;
  targetDte: { min: number; max: number } | null;
  candidates: ResolvedContractCandidate[];
  warnings: string[];
  asOf: string | null;
}

interface BrokerCapabilityResult {
  connected: boolean;
  provider: string | null;
  optionsChainSupported: boolean;
  greeksSupported: boolean;
  multiLegSupported: boolean;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface LiveContractResolverProps {
  pkg: ResearchPackage;
  structures: OptionsStructure[];    // from deriveOptionsStructures — the illustrative structures
  snapshot?: MarketSnapshot;
  onSelectCandidate?: (candidate: ResolvedContractCandidate) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtPrice(v: number | null, prefix = "$"): string {
  if (v === null) return "—";
  return `${prefix}${v.toFixed(2)}`;
}

function fmtDollar(v: number | null): string {
  if (v === null) return "—";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch { return iso; }
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch { return iso; }
}

// Extract DTE min/max from "30–45 DTE" string
function parseDteRange(preferredDTE: string): { min: number; max: number } {
  const m = preferredDTE.match(/(\d+)[\s–\-]+(\d+)/);
  if (m) return { min: parseInt(m[1]), max: parseInt(m[2]) };
  const single = preferredDTE.match(/(\d+)/);
  if (single) { const d = parseInt(single[1]); return { min: d, max: d }; }
  return { min: 30, max: 45 };
}

// Convert kebab-case structure name to snake_case for API
function toApiStructure(name: string): string {
  return name.replace(/-/g, "_");
}

// Parse numeric level from strings like "$150.00" or "150" or "near $150"
function parseLevel(value: string | undefined | null): number | null {
  if (!value) return null;
  const m = value.match(/\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

// Build strike guidance from structure name
function buildStrikeGuidance(structureName: string): {
  longLeg?: string;
  shortLeg?: string;
  singleLeg?: string;
} {
  switch (structureName) {
    case "long_call":       return { singleLeg: "near_atm" };
    case "cash_secured_put":return { singleLeg: "near_support" };
    case "covered_call":    return { singleLeg: "otm_2_5" };
    case "protective_put":  return { singleLeg: "near_atm" };
    case "bull_call_spread":return { longLeg: "near_atm", shortLeg: "near_technical_objective" };
    case "bull_put_spread": return { shortLeg: "near_support", longLeg: "near_support" };
    default:                return { singleLeg: "near_atm" };
  }
}

// ---------------------------------------------------------------------------
// Liquidity badge
// ---------------------------------------------------------------------------

function LiquidityBadge({ status }: { status: LiquidityStatus }) {
  const cfg = {
    verified:    { label: "Verified",    cls: "text-emerald-400 border-emerald-500/30 bg-emerald-500/8" },
    acceptable:  { label: "Acceptable",  cls: "text-sky-400 border-sky-500/30 bg-sky-500/8" },
    limited:     { label: "Limited",     cls: "text-amber-400 border-amber-500/30 bg-amber-500/8" },
    unavailable: { label: "Unavailable", cls: "text-muted-foreground border-border/40" },
    rejected:    { label: "Rejected",    cls: "text-rose-400 border-rose-500/30 bg-rose-500/8" },
  }[status] ?? { label: status, cls: "text-muted-foreground border-border/40" };

  return (
    <Badge variant="outline" className={cn("text-[10px] font-medium", cfg.cls)}>
      {cfg.label}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Leg display
// ---------------------------------------------------------------------------

function LegRow({ leg }: { leg: ResolvedContractLeg }) {
  const actionLabel = leg.action === "buy" ? "Long" : "Short";
  const typeLabel = leg.optionType === "call" ? "Call" : "Put";
  const quoteField = leg.action === "buy" ? "Ask" : "Bid";
  const quoteValue = leg.action === "buy" ? leg.ask : leg.bid;

  return (
    <div
      className="border border-border/20 rounded-md p-3 space-y-1.5 bg-muted/10"
      role="group"
      aria-label={`${actionLabel} 1 ${typeLabel}, strike ${leg.strike}`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <Badge
          variant="outline"
          className={cn(
            "text-[10px]",
            leg.action === "buy"
              ? "border-sky-500/30 text-sky-400 bg-sky-500/8"
              : "border-amber-500/30 text-amber-400 bg-amber-500/8",
          )}
        >
          {actionLabel} 1 {typeLabel}
        </Badge>
        <span className="text-[12px] font-semibold">Strike: {leg.strike}</span>
        {leg.impliedVolatility !== null && (
          <span className="text-[10px] text-muted-foreground/70">
            IV: {(leg.impliedVolatility * 100).toFixed(0)}%
          </span>
        )}
        {leg.delta !== null && (
          <span className="text-[10px] text-muted-foreground/70">
            Δ {leg.delta.toFixed(2)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <p className="text-muted-foreground/60">Bid</p>
          <p className="font-mono">{fmtPrice(leg.bid)}</p>
        </div>
        <div>
          <p className="text-muted-foreground/60">Ask</p>
          <p className="font-mono">{fmtPrice(leg.ask)}</p>
        </div>
        <div>
          <p className="text-muted-foreground/60">{quoteField} (used)</p>
          <p className="font-mono font-medium">{fmtPrice(quoteValue)}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[10px] text-muted-foreground/60">
        {leg.volume !== null && <span>Vol: {leg.volume.toLocaleString()}</span>}
        {leg.openInterest !== null && <span>OI: {leg.openInterest.toLocaleString()}</span>}
      </div>

      <p className="text-[9px] text-muted-foreground/50 font-mono">{leg.contractSymbol}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Candidate card
// ---------------------------------------------------------------------------

function CandidateCard({
  candidate,
  rank,
  isSelected,
  onSelect,
}: {
  candidate: ResolvedContractCandidate;
  rank: number;
  isSelected: boolean;
  onSelect: (c: ResolvedContractCandidate) => void;
}) {
  const [showReasons, setShowReasons] = useState(false);
  const hasSpreadPricing = candidate.estimatedDebit !== null || candidate.estimatedCredit !== null;
  const priceAmount = candidate.estimatedDebit ?? candidate.estimatedCredit;
  const priceLabel = candidate.estimatedDebit !== null ? "Estimated Net Debit" : "Estimated Net Credit";
  const perSpread = priceAmount !== null ? priceAmount * candidate.multiplier : null;

  return (
    <Card
      className={cn(
        "border transition-all",
        isSelected
          ? "border-emerald-500/50 bg-emerald-500/5"
          : "border-border/40 hover:border-border/60",
      )}
      data-testid={`contract-candidate-${rank}`}
    >
      <CardHeader className="px-4 py-3 border-b border-border/20">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground/60 font-mono">#{rank}</span>
            <CardTitle className="text-[13px] font-semibold">
              {candidate.structureLabel}
            </CardTitle>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <LiquidityBadge status={candidate.liquidityStatus} />
            <Badge
              variant="outline"
              className="text-[10px] text-sky-400 border-sky-500/30 bg-sky-500/8"
              aria-label={`Contract Fit score: ${candidate.contractFit} out of 100`}
            >
              Fit: {candidate.contractFit} / 100
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-4 py-3 space-y-3">
        {/* Expiration + DTE */}
        <div className="flex items-center gap-3 text-[12px]">
          <Clock className="h-3 w-3 text-muted-foreground/60" aria-hidden="true" />
          <span className="font-medium">{fmtDate(candidate.expiration)}</span>
          <span className="text-muted-foreground/70">{candidate.dte} DTE</span>
          {candidate.asOf && (
            <span className="text-[10px] text-muted-foreground/50 ml-auto">
              as of {fmtTime(candidate.asOf)}
            </span>
          )}
        </div>

        {/* Legs */}
        <div className="space-y-2" role="list" aria-label="Option legs">
          {candidate.legs.map((leg, i) => (
            <LegRow key={i} leg={leg} />
          ))}
        </div>

        {/* Spread pricing */}
        {hasSpreadPricing && (
          <div className="border border-border/20 rounded-md p-3 space-y-1.5 bg-muted/5">
            <p className="text-[11px] font-medium text-foreground/80">{priceLabel}</p>
            {priceAmount !== null && (
              <>
                <p className="text-[14px] font-semibold font-mono">
                  {fmtPrice(priceAmount)} per share
                </p>
                <p className="text-[12px] font-mono text-muted-foreground/80">
                  {fmtDollar(perSpread)} per contract (100 shares)
                </p>
              </>
            )}
            {candidate.pricingBasis && (
              <p className="text-[10px] text-muted-foreground/60">
                Quote basis: {candidate.pricingBasis}
              </p>
            )}
          </div>
        )}

        {candidate.pricingStatus === "unavailable" && (
          <p className="text-[11px] text-amber-400/80">
            Pricing unavailable — verify current quotes in your broker.
          </p>
        )}

        {/* Risk metrics */}
        {(candidate.maxRisk !== null || candidate.maxGain !== null || candidate.breakeven !== null) && (
          <div className="grid grid-cols-3 gap-2">
            {candidate.maxRisk !== null && (
              <div className="space-y-0.5">
                <p className="text-[10px] text-muted-foreground/60">Max Risk (est.)</p>
                <p className="text-[11px] font-mono font-medium text-rose-400">
                  {fmtDollar(candidate.maxRisk)}
                </p>
              </div>
            )}
            {candidate.maxGain !== null && (
              <div className="space-y-0.5">
                <p className="text-[10px] text-muted-foreground/60">Max Gain (est.)</p>
                <p className="text-[11px] font-medium text-emerald-400">
                  {candidate.maxGain.startsWith("Theoretically") ? "Unlimited" : candidate.maxGain.replace(/^Estimated /, "")}
                </p>
              </div>
            )}
            {candidate.breakeven !== null && (
              <div className="space-y-0.5">
                <p className="text-[10px] text-muted-foreground/60">Breakeven (est.)</p>
                <p className="text-[11px] font-mono">{fmtPrice(candidate.breakeven)}</p>
              </div>
            )}
          </div>
        )}

        {/* Greeks availability */}
        {!candidate.greeksAvailable && (
          <p className="text-[10px] text-muted-foreground/60">
            Greeks not supplied by the connected provider for this contract.
          </p>
        )}

        {/* Warnings */}
        {candidate.warnings.length > 0 && (
          <div className="space-y-1">
            {candidate.warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-1.5" role="alert">
                <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
                <p className="text-[10px] text-amber-400/90">{w}</p>
              </div>
            ))}
          </div>
        )}

        {/* Contract fit reasons */}
        {candidate.fitReasons.length > 0 && (
          <div>
            <button
              onClick={() => setShowReasons((p) => !p)}
              className="flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-foreground/70 transition-colors"
              aria-expanded={showReasons}
              aria-label="Toggle contract fit reasons"
            >
              {showReasons ? <ChevronUp className="h-3 w-3" aria-hidden /> : <ChevronDown className="h-3 w-3" aria-hidden />}
              Contract Fit details
            </button>
            {showReasons && (
              <ul className="mt-1.5 space-y-0.5 pl-3">
                {candidate.fitReasons.map((r, i) => (
                  <li key={i} className="text-[10px] text-muted-foreground/70 list-disc">{r}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Provider + disclaimer */}
        <div className="pt-1 border-t border-border/20 space-y-1">
          <p className="text-[9px] text-muted-foreground/50">
            Provider: {candidate.source} · Multiplier: {candidate.multiplier} shares/contract
          </p>
          <p className="text-[9px] text-muted-foreground/50 italic">
            Estimated from displayed quotes. Actual execution price may differ.
            Not a trade recommendation. Verify in broker order preview before proceeding.
          </p>
        </div>

        {/* Select CTA */}
        <Button
          size="sm"
          variant={isSelected ? "default" : "outline"}
          className={cn(
            "w-full h-8 text-[11px] font-medium",
            isSelected
              ? "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600"
              : "border-border/50 hover:border-border/80",
          )}
          onClick={() => onSelect(candidate)}
          data-testid={`btn-select-candidate-${rank}`}
          aria-label={`Select ${candidate.structureLabel} expiring ${candidate.expiration} for InstaTrade review`}
          aria-pressed={isSelected}
        >
          {isSelected ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
              Selected for InstaTrade™ Review
            </>
          ) : (
            <>
              <Zap className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
              Select for InstaTrade™ Review
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Structure selector
// ---------------------------------------------------------------------------

function StructureSelector({
  structures,
  selected,
  onSelect,
}: {
  structures: OptionsStructure[];
  selected: OptionsStructure | null;
  onSelect: (s: OptionsStructure) => void;
}) {
  // Only show structures supported by the resolver
  const SUPPORTED = new Set([
    "long-call",
    "bull-call-spread",
    "bull-put-spread",
    "cash-secured-put",
    "covered-call",
    "protective-put",
  ]);
  const resolvable = structures.filter((s) => SUPPORTED.has(s.name));

  if (resolvable.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Select structure to resolve">
      {resolvable.map((s) => (
        <button
          key={s.name}
          onClick={() => onSelect(s)}
          className={cn(
            "px-2.5 py-1 text-[11px] rounded-md border transition-all",
            s.name === selected?.name
              ? "border-sky-500/50 bg-sky-500/10 text-sky-400 font-medium"
              : "border-border/40 text-muted-foreground hover:border-border/70 hover:text-foreground/80",
          )}
          aria-pressed={s.name === selected?.name}
          data-testid={`structure-tab-${s.name}`}
        >
          {s.label}
          {s.isBestOverall && (
            <span className="ml-1 text-[9px] text-amber-400/80">★</span>
          )}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status-specific displays
// ---------------------------------------------------------------------------

function StatusMessage({
  status,
  warnings,
}: {
  status: LiveContractStatus;
  warnings: string[];
}) {
  const messages: Record<string, string> = {
    capability_unavailable: "Live option contracts are not available through the connected brokerage integration.",
    chain_unavailable: "Option chain data is currently unavailable. The connected broker may be experiencing an issue.",
    no_matching_expiration: "No listed expirations were found within the target DTE range.",
    no_matching_strike: "No listed strikes matched the selected guidance for this expiration.",
    pricing_unavailable: "Contracts were found but live pricing is unavailable from the provider.",
    unsupported_structure: "This structure is not supported for live contract resolution in the current release.",
    error: "An unexpected error occurred during contract resolution. Please try again.",
  };

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2" role="alert">
        <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-[12px] text-foreground/80">
          {messages[status] ?? "Contract resolution returned an unexpected status."}
        </p>
      </div>
      {warnings.map((w, i) => (
        <p key={i} className="text-[11px] text-muted-foreground/70 pl-6">{w}</p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function LiveContractResolver({
  pkg,
  structures,
  snapshot,
  onSelectCandidate,
}: LiveContractResolverProps) {
  const [selectedStructure, setSelectedStructure] = useState<OptionsStructure | null>(
    structures.find((s) => s.isBestOverall) ?? structures[0] ?? null,
  );
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [resolutionResult, setResolutionResult] = useState<LiveContractResolutionResult | null>(null);

  // ── Capability check (lightweight, no chain data) ──────────────────────
  const { data: capabilityData, isLoading: capLoading } = useQuery<BrokerCapabilityResult>({
    queryKey: ["broker-capability"],
    queryFn: () => apiRequest("GET", "/api/options/broker-capability").then((r) => r.json()),
    enabled: pkg.brokerConnected,
    staleTime: 30_000,
    retry: false,
  });

  // ── Contract resolution mutation ────────────────────────────────────────
  const { mutate: resolve, isPending: isResolving } = useMutation({
    mutationFn: async () => {
      if (!selectedStructure) throw new Error("No structure selected");
      const apiStructure = toApiStructure(selectedStructure.name);
      const dte = parseDteRange(selectedStructure.preferredDTE);
      const underlying = pkg.candidate.currentPrice ?? (snapshot as any)?.underlyingPrice;

      if (!underlying) throw new Error("Underlying price unavailable");

      const body = {
        symbol: pkg.symbol,
        structure: apiStructure,
        targetDte: dte,
        strikeGuidance: buildStrikeGuidance(apiStructure),
        referenceLevels: {
          underlyingPrice: underlying,
          support: parseLevel(pkg.candidate.invalidation),
          resistance: parseLevel(pkg.candidate.trigger),
          breakout: parseLevel(pkg.candidate.trigger),
          objective: parseLevel(pkg.candidate.objective),
        },
      };

      const res = await apiRequest("POST", "/api/options/resolve-contracts", body);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any)?.error?.message ?? `HTTP ${res.status}`);
      }
      return res.json() as Promise<LiveContractResolutionResult>;
    },
    onSuccess: (data) => {
      setResolutionResult(data);
      setSelectedCandidateId(null);
    },
    onError: () => {
      setResolutionResult(null);
    },
  });

  const handleResolve = useCallback(() => {
    setResolutionResult(null);
    resolve();
  }, [resolve]);

  const handleSelectCandidate = (candidate: ResolvedContractCandidate) => {
    setSelectedCandidateId(candidate.id);
    onSelectCandidate?.(candidate);
  };

  const handleStructureChange = (s: OptionsStructure) => {
    setSelectedStructure(s);
    setResolutionResult(null);
    setSelectedCandidateId(null);
  };

  // ── State: no broker connected ──────────────────────────────────────────
  if (!pkg.brokerConnected) {
    return (
      <Card className="border-border/40" data-testid="live-contract-resolver-no-broker">
        <CardHeader className="px-4 py-3 border-b border-border/30">
          <CardTitle className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
            Live Contract Verification
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 py-4 space-y-3">
          <p className="text-[12px] text-foreground/80 leading-relaxed">
            Connect a supported brokerage to:
          </p>
          <ul className="text-[11px] text-muted-foreground space-y-1 pl-3 list-disc">
            <li>Retrieve listed expirations</li>
            <li>View actual listed strikes</li>
            <li>Inspect live bid/ask quotes</li>
            <li>Evaluate contract liquidity</li>
            <li>Prepare an InstaTrade™ order review</li>
          </ul>
          <Button
            variant="outline"
            size="sm"
            className="border-border/50 hover:border-border/80 text-[11px]"
            data-testid="btn-connect-broker"
            aria-label="Connect a broker to enable live contract verification"
          >
            <Link2 className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
            Connect Broker
          </Button>
          <p className="text-[10px] text-muted-foreground/50 italic">
            Educational Trade Planning — not a recommendation. No trades are submitted without your explicit confirmation.
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── State: capability loading ───────────────────────────────────────────
  if (capLoading) {
    return (
      <Card className="border-border/40" data-testid="live-contract-resolver-loading-capability">
        <CardContent className="px-4 py-6 flex items-center gap-2 text-muted-foreground/60">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span className="text-[12px]">Checking broker options capability…</span>
        </CardContent>
      </Card>
    );
  }

  // ── State: options chain not supported by this broker ───────────────────
  if (capabilityData && !capabilityData.optionsChainSupported) {
    return (
      <Card className="border-border/40" data-testid="live-contract-resolver-no-capability">
        <CardHeader className="px-4 py-3 border-b border-border/30">
          <CardTitle className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
            Live Contract Verification
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 py-4 space-y-3">
          <div className="flex items-start gap-2" role="status">
            <Info className="h-4 w-4 text-muted-foreground/60 shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-[12px] text-foreground/80">
              Live option contracts are not available through the connected brokerage integration
              {capabilityData.provider ? ` (${capabilityData.provider})` : ""}.
            </p>
          </div>
          {selectedStructure && (
            <div className="text-[11px] text-muted-foreground/70 space-y-1">
              <p><span className="font-medium">Structure:</span> {selectedStructure.label}</p>
              <p><span className="font-medium">DTE guidance:</span> {selectedStructure.preferredDTE}</p>
              <p><span className="font-medium">Strike framework:</span> {selectedStructure.strikeGuidance}</p>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground/50">
            To access live contracts, connect a broker that supports options chain retrieval (e.g. Tradier or TradeStation).
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── State: connected + capable ──────────────────────────────────────────
  const hasUnderlying = !!(pkg.candidate.currentPrice ?? (snapshot as any)?.underlyingPrice);

  return (
    <Card className="border-border/40" data-testid="live-contract-resolver">
      <CardHeader className="px-4 py-3 border-b border-border/30">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
            Live Contract Verification
            {capabilityData?.provider && (
              <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-400 bg-emerald-500/8">
                {capabilityData.provider}
              </Badge>
            )}
          </CardTitle>
          {resolutionResult && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] text-muted-foreground/60 hover:text-foreground/80"
              onClick={handleResolve}
              disabled={isResolving}
              aria-label="Refresh contract resolution"
              data-testid="btn-refresh-contracts"
            >
              <RefreshCcw className="h-3 w-3 mr-1" aria-hidden="true" />
              Refresh
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="px-4 py-4 space-y-4">
        {/* Structure selector */}
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground/70">Select structure to resolve:</p>
          <StructureSelector
            structures={structures}
            selected={selectedStructure}
            onSelect={handleStructureChange}
          />
        </div>

        {selectedStructure && (
          <div className="text-[11px] text-muted-foreground/60 space-y-0.5">
            <p>DTE target: <span className="text-foreground/80">{selectedStructure.preferredDTE}</span></p>
            <p>Strike framework: <span className="text-foreground/80">{selectedStructure.strikeGuidance}</span></p>
          </div>
        )}

        {/* Resolve button */}
        {!resolutionResult && (
          <Button
            variant="outline"
            size="sm"
            className="w-full border-sky-500/40 text-sky-400 hover:bg-sky-500/10 text-[11px] font-medium"
            onClick={handleResolve}
            disabled={isResolving || !selectedStructure || !hasUnderlying}
            data-testid="btn-resolve-contracts"
            aria-label={`Resolve live option contracts for ${selectedStructure?.label ?? "selected structure"}`}
          >
            {isResolving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden="true" />
                Resolving Contracts…
              </>
            ) : (
              <>
                <Activity className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                Resolve Live Contracts
              </>
            )}
          </Button>
        )}

        {!hasUnderlying && !isResolving && (
          <p className="text-[10px] text-amber-400/80">
            Underlying price not available — contract resolution requires a current price reference.
          </p>
        )}

        {/* Resolution loading */}
        {isResolving && (
          <div className="flex items-center gap-2 py-4 text-muted-foreground/60" role="status" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span className="text-[12px]">Fetching live options chain from {capabilityData?.provider ?? "broker"}…</span>
          </div>
        )}

        {/* Error state */}
        {!isResolving && !resolutionResult && (
          // Initial or reset state — nothing to show
          null
        )}

        {/* Resolution result */}
        {resolutionResult && !isResolving && (
          <div className="space-y-3">
            {/* Status + global warnings */}
            {resolutionResult.status !== "resolved" && resolutionResult.status !== "partial" && (
              <StatusMessage status={resolutionResult.status} warnings={resolutionResult.warnings} />
            )}

            {resolutionResult.warnings.length > 0 &&
              (resolutionResult.status === "resolved" || resolutionResult.status === "partial") && (
                <div className="space-y-1">
                  {resolutionResult.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-1.5" role="alert">
                      <AlertTriangle className="h-3 w-3 text-amber-400/70 shrink-0 mt-0.5" aria-hidden="true" />
                      <p className="text-[10px] text-muted-foreground/70">{w}</p>
                    </div>
                  ))}
                </div>
              )}

            {/* Candidates (up to 3) */}
            {resolutionResult.candidates.length > 0 && (
              <div className="space-y-3" role="list" aria-label="Verified contract candidates">
                <p className="text-[11px] text-muted-foreground/70">
                  {resolutionResult.candidates.length} Verified Contract Candidate{resolutionResult.candidates.length !== 1 ? "s" : ""} found
                  {resolutionResult.targetDte && (
                    <> · Target DTE: {resolutionResult.targetDte.min}–{resolutionResult.targetDte.max}</>
                  )}
                </p>
                {resolutionResult.candidates.map((c, i) => (
                  <CandidateCard
                    key={c.id}
                    candidate={c}
                    rank={i + 1}
                    isSelected={c.id === selectedCandidateId}
                    onSelect={handleSelectCandidate}
                  />
                ))}
              </div>
            )}

            {/* Resolve again button */}
            {resolutionResult.status !== "resolved" || resolutionResult.candidates.length === 0 ? (
              <Button
                variant="outline"
                size="sm"
                className="w-full text-[11px]"
                onClick={handleResolve}
                disabled={isResolving}
                data-testid="btn-resolve-again"
              >
                Try Again
              </Button>
            ) : null}
          </div>
        )}

        {/* Compliance footer */}
        <p className="text-[9px] text-muted-foreground/40 leading-tight border-t border-border/20 pt-2">
          Live Contract Verification is educational trade planning only — not a recommendation or solicitation.
          Verify all contracts, strikes, premiums, and execution prices independently through your broker.
          No trades are submitted from this screen.
        </p>
      </CardContent>
    </Card>
  );
}
