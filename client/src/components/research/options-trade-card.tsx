// OptionsTradeCard — Options structure overview derived from scanner data.
// No live options chain data is fetched. All fields are educational estimates
// derived deterministically from candidate fields. Verify all values with
// your broker's options chain before making any decision.

import { TrendingUp, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Candidate, ResearchPackage } from "./types";

// ---------------------------------------------------------------------------
// Pure, exported helpers — deterministic, testable
// ---------------------------------------------------------------------------

const OPTIONS_KEYWORDS = [
  "call", "put", "spread", "straddle", "strangle", "condor",
  "butterfly", "covered", "collar", "protective",
];

/** Returns true when the candidate appears to be an options structure. */
export function shouldShowOptionsCard(
  candidate: Pick<Candidate, "instrument" | "structure">,
): boolean {
  if (!candidate.instrument && !candidate.structure) return false;
  const instrument = (candidate.instrument ?? "").toLowerCase();
  if (instrument === "options" || instrument === "option") return true;
  const structure = (candidate.structure ?? "").toLowerCase();
  return OPTIONS_KEYWORDS.some((kw) => structure.includes(kw));
}

/** Maps confidence level to a historical probability range string. */
export function deriveOptionsProbability(confidence?: string): string {
  switch ((confidence ?? "").toLowerCase()) {
    case "high":   return "~60–70% (est.)";
    case "medium": return "~40–55% (est.)";
    case "low":    return "~25–40% (est.)";
    default:       return "Verify with broker";
  }
}

/**
 * Derives an expiration target description from strategy.
 * Returns a human-readable string suitable for display.
 */
export function deriveOptionsExpirationTarget(strategy?: string): string {
  if (!strategy) return "30–45 DTE (typical)";
  const s = strategy.toUpperCase();
  if (s.includes("INTRADAY") || s.includes("ORB") || s.includes("GAP")) {
    return "0–1 DTE (intraday)";
  }
  if (s.includes("VCP") || s.includes("SWING") || s.includes("PULLBACK")) {
    return "21–45 DTE (swing)";
  }
  if (s.includes("POSITION") || s.includes("TREND")) {
    return "45–90 DTE (position)";
  }
  return "30–45 DTE (typical)";
}

/** Returns debit/credit classification from structure name. */
export function deriveOptionsPaymentType(structure?: string): string {
  if (!structure) return "Verify with broker";
  const s = structure.toLowerCase();
  // Credit structures
  if (
    s.includes("cash-secured put") ||
    s.includes("covered call") ||
    s.includes("credit spread") ||
    s.includes("iron condor") ||
    s.includes("short put")
  ) return "Credit received";
  // Debit structures
  return "Debit paid";
}

/** Returns max gain description from structure name. */
export function deriveOptionsMaxGain(structure?: string): string {
  if (!structure) return "Verify with broker";
  const s = structure.toLowerCase();
  if (s.includes("long call") || s.includes("long put")) return "Theoretically unlimited";
  if (s.includes("spread")) return "Capped at spread width";
  if (s.includes("condor") || s.includes("butterfly")) return "Capped (defined)";
  if (s.includes("covered call")) return "Capped at strike + premium";
  if (s.includes("cash-secured put")) return "Premium received only";
  return "Verify with broker";
}

// ---------------------------------------------------------------------------
// Sub-component
// ---------------------------------------------------------------------------

interface FieldProps {
  label: string;
  value: string;
  valueClass?: string;
  mono?: boolean;
  note?: string;
  "data-testid"?: string;
}

function OptionsField({ label, value, valueClass, mono = false, note, "data-testid": tid }: FieldProps) {
  return (
    <div className="p-3 space-y-1" data-testid={tid}>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
        {label}
      </div>
      <div className={cn("text-[14px] font-semibold leading-tight", mono && "font-mono", valueClass ?? "text-foreground")}>
        {value}
      </div>
      {note && <div className="text-[10px] text-muted-foreground/70">{note}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OptionsTradeCard
// ---------------------------------------------------------------------------

interface OptionsTradeCardProps {
  pkg: ResearchPackage;
}

export function OptionsTradeCard({ pkg }: OptionsTradeCardProps) {
  const { candidate } = pkg;

  const structureName = candidate.structure ?? "Options Structure";
  const probability = deriveOptionsProbability(candidate.confidence);
  const expirationTarget = deriveOptionsExpirationTarget(candidate.strategy);
  const paymentType = deriveOptionsPaymentType(candidate.structure);
  const maxGain = deriveOptionsMaxGain(candidate.structure);
  const maxRisk = candidate.maxRisk != null ? `$${candidate.maxRisk.toLocaleString()} max` : "Verify with broker";

  return (
    <Card
      className="border-violet-500/20 bg-violet-500/5 overflow-hidden"
      data-testid="options-trade-card"
    >
      {/* Header */}
      <CardHeader className="px-4 py-3 border-b border-violet-500/20">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-[12px] font-semibold uppercase tracking-wider flex items-center gap-2 text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5 text-violet-400" />
            Options Structure Overview
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="text-[9px] text-violet-300 border-violet-500/40 uppercase tracking-wide"
            >
              Educational Est.
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {/* Row 1: strategy / strike / expiration */}
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-x divide-y divide-border/20 border-b border-border/20">
          <OptionsField
            label="Strategy"
            value={structureName}
            valueClass="text-violet-300"
            data-testid="options-strategy"
          />
          <OptionsField
            label="Strike Zone"
            value={candidate.trigger ? `Near $${candidate.trigger}` : "Verify with broker"}
            note="Pivot / breakout reference"
            mono
            data-testid="options-strike"
          />
          <OptionsField
            label="Expiration Target"
            value={expirationTarget}
            note="Based on strategy holding period"
            data-testid="options-expiration"
          />
        </div>

        {/* Row 2: premium / max risk / max gain / probability */}
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y divide-border/20">
          <OptionsField
            label="Premium Type"
            value={paymentType}
            data-testid="options-payment-type"
          />
          <OptionsField
            label="Max Risk"
            value={maxRisk}
            valueClass="text-rose-400"
            mono
            data-testid="options-max-risk"
          />
          <OptionsField
            label="Max Gain"
            value={maxGain}
            valueClass="text-emerald-400"
            data-testid="options-max-gain"
          />
          <OptionsField
            label="Probability"
            value={probability}
            note="From confidence level"
            data-testid="options-probability"
          />
        </div>

        {/* Disclaimer */}
        <div className="flex items-start gap-2 px-4 py-2.5 border-t border-violet-500/20 bg-violet-500/5">
          <Info className="h-3 w-3 text-violet-400 shrink-0 mt-0.5" />
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Strike, expiration, premium, and breakeven must be verified against a live options
            chain from your broker. These fields are structural estimates derived from scanner
            output — not quotes. Probability figures are historical approximations only.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
