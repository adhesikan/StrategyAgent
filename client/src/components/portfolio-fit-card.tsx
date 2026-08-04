// Sprint 4D — Portfolio Fit section.
//
// Renders safe portfolio-awareness fields returned by the Ask AI route when
// the user has a connected broker. Never shows account numbers, raw balances,
// or buying-power dollar amounts — only derived labels and counts.
//
// Design rules:
//   - Never fabricate values: render only supplied fields.
//   - Never show account IDs, connection IDs, or broker tokens.
//   - Graceful: if awareness is null/undefined the component renders nothing.

import { Badge } from "@/components/ui/badge";
import type { SafePortfolioAwareness } from "@/lib/portfolio-awareness";

const LEVEL_STYLE: Record<string, string> = {
  normal: "border-emerald-500/40 text-emerald-300 bg-emerald-500/10",
  elevated: "border-amber-500/40 text-amber-300 bg-amber-500/10",
  high: "border-red-500/40 text-red-300 bg-red-500/10",
};

const SUFFICIENCY_STYLE: Record<string, string> = {
  verified: "text-emerald-300",
  sufficient: "text-emerald-300",
  not_verified: "text-amber-300",
  insufficient: "text-red-300",
  unknown: "text-muted-foreground",
};

const SUFFICIENCY_LABEL: Record<string, string> = {
  verified: "Verified",
  sufficient: "Sufficient",
  not_verified: "Not verified",
  insufficient: "Insufficient",
  unknown: "Unknown",
};

interface PortfolioFitCardProps {
  awareness: SafePortfolioAwareness | null | undefined;
  /** Whether this is a market-wide search (no specific symbol). */
  marketWide?: boolean;
}

export function PortfolioFitCard({ awareness, marketWide }: PortfolioFitCardProps) {
  if (!awareness) return null;

  // Determine if there's anything meaningful to show
  const hasPosition = awareness.existingPosition != null;
  const hasConcentration = awareness.concentrationWarning != null;
  const hasCash = awareness.cashSufficiency != null && awareness.cashSufficiency !== "unknown";
  const hasBP = awareness.buyingPowerSufficiency != null && awareness.buyingPowerSufficiency !== "unknown";
  const hasOptionsNote = awareness.existingOptionExposure;

  if (!hasPosition && !hasConcentration && !hasCash && !hasBP && !hasOptionsNote) {
    return null;
  }

  return (
    <div
      className="rounded-md border border-border/50 bg-muted/10 p-3 space-y-2"
      data-testid="card-portfolio-fit"
      aria-label="Portfolio fit"
    >
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Portfolio Fit
        {marketWide && (
          <span className="ml-1.5 font-normal normal-case text-muted-foreground/60">(market-wide)</span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
        {/* Existing position */}
        {hasPosition && (
          <div data-testid="row-portfolio-existing-position">
            <span className="text-muted-foreground">Existing position: </span>
            <span className="font-medium">
              {awareness.existingPosition!.shares.toLocaleString()} shares
            </span>
            {awareness.existingPosition!.unrealizedPnl !== 0 && (
              <span
                className={`ml-1 text-[10px] ${awareness.existingPosition!.unrealizedPnl >= 0 ? "text-emerald-300" : "text-red-300"}`}
              >
                ({awareness.existingPosition!.unrealizedPnl >= 0 ? "+" : ""}
                {awareness.existingPosition!.unrealizedPnl.toLocaleString(undefined, { maximumFractionDigits: 0 })} P&L)
              </span>
            )}
          </div>
        )}

        {/* Concentration warning */}
        {hasConcentration && (
          <div data-testid="row-portfolio-concentration">
            <span className="text-muted-foreground">Portfolio concentration: </span>
            <span>
              {awareness.concentrationWarning!.pct}%
              {" "}
              <Badge
                variant="outline"
                className={`text-[9px] py-0 ${LEVEL_STYLE[awareness.concentrationWarning!.level]}`}
                data-testid="badge-portfolio-concentration-level"
              >
                {awareness.concentrationWarning!.level}
              </Badge>
            </span>
          </div>
        )}

        {/* Cash sufficiency */}
        {hasCash && (
          <div data-testid="row-portfolio-cash">
            <span className="text-muted-foreground">Cash requirement: </span>
            <span
              className={`font-medium ${SUFFICIENCY_STYLE[awareness.cashSufficiency!] ?? ""}`}
              data-testid="text-portfolio-cash-sufficiency"
            >
              {SUFFICIENCY_LABEL[awareness.cashSufficiency!] ?? awareness.cashSufficiency}
            </span>
          </div>
        )}

        {/* Buying power */}
        {hasBP && (
          <div data-testid="row-portfolio-buying-power">
            <span className="text-muted-foreground">Buying power: </span>
            <span
              className={`font-medium ${SUFFICIENCY_STYLE[awareness.buyingPowerSufficiency!] ?? ""}`}
              data-testid="text-portfolio-buying-power"
            >
              {SUFFICIENCY_LABEL[awareness.buyingPowerSufficiency!] ?? awareness.buyingPowerSufficiency}
            </span>
          </div>
        )}

        {/* Existing options exposure */}
        {hasOptionsNote && (
          <div className="col-span-full" data-testid="row-portfolio-options-exposure">
            <span className="text-muted-foreground">Existing option exposure: </span>
            <span>{awareness.existingOptionExposure}</span>
          </div>
        )}
      </div>

      {/* Sizing adjustment hint */}
      {awareness.sizingAdjustment && (
        <div className="text-[11px] text-amber-200/80 border-t border-border/40 pt-1.5" data-testid="text-portfolio-sizing-hint">
          {awareness.sizingAdjustment}
        </div>
      )}

      <div className="text-[10px] text-muted-foreground/50 border-t border-border/30 pt-1.5">
        Portfolio context is read-only — data freshness: {new Date(awareness.contextFreshness).toLocaleTimeString()}.
        No account numbers are shown or stored.
      </div>
    </div>
  );
}
