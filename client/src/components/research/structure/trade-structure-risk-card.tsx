// TradeStructureRiskCard — displays risk characteristics for a trade structure.
// Covers: maximum theoretical risk, assignment risk, time decay exposure,
// gap risk, volatility sensitivity, liquidity, early assignment.
// NO numerical premium calculations.
//
// Compliance: only uses educational / illustrative language.

import { ShieldAlert, Zap, Activity, TrendingDown, DropletIcon, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ResearchPackage, StockStructure, OptionsStructure, StructureRiskProfile } from "./types";

// ---------------------------------------------------------------------------
// Pure, exported helpers
// ---------------------------------------------------------------------------

/** Build risk profile for a stock structure. */
export function buildStockRiskProfile(
  stock: StockStructure,
  pkg: ResearchPackage,
): StructureRiskProfile {
  const { candidate } = pkg;
  const warnings = candidate.warnings.join(" ").toLowerCase();
  const hasEarnings = warnings.includes("earning") || warnings.includes("er ");
  const hasLowFloat = warnings.includes("low float") || warnings.includes("thin");

  return {
    maxRisk:
      "Maximum theoretical loss equals the full position value below the stop reference. " +
      (candidate.invalidation
        ? `Scanner-derived stop reference: $${candidate.invalidation}.`
        : "Stop reference not available in scanner output."),
    assignmentRisk: null,  // Stock positions have no assignment risk
    timeDecay:
      "Not applicable — stock positions do not have time decay. " +
      "The position retains full value independent of time unless the price declines.",
    gapRisk:
      hasEarnings
        ? "Elevated gap risk — an earnings or catalyst event is referenced in the scanner warnings. Consider sizing accordingly."
        : "Standard overnight gap risk applies — price may open significantly away from the prior close.",
    volatilitySensitivity:
      "Higher implied volatility in the underlying typically increases intraday price swings, " +
      "which may trigger the stop reference during normal oscillation. Consider widening stop tolerance in high-volatility environments.",
    liquidityNote:
      hasLowFloat
        ? "Scanner warnings reference low float or thin volume. Execution quality may vary — slippage risk is elevated."
        : "Liquidity risk depends on average daily volume. Ensure sufficient liquidity before sizing.",
    earlyAssignment: null,
  };
}

/** Build risk profile for an options structure. */
export function buildOptionsRiskProfile(
  options: OptionsStructure,
  pkg: ResearchPackage,
): StructureRiskProfile {
  const { candidate } = pkg;
  const warnings = candidate.warnings.join(" ").toLowerCase();
  const hasEarnings = warnings.includes("earning") || warnings.includes("er ");

  const maxRisk = buildOptionsMaxRisk(options);
  const assignmentRisk = buildAssignmentRisk(options);
  const earlyAssignment = buildEarlyAssignment(options);

  return {
    maxRisk,
    assignmentRisk,
    timeDecay: buildTimeDecayNote(options),
    gapRisk: buildOptionsGapRisk(options, hasEarnings),
    volatilitySensitivity: buildVolatilitySensitivity(options),
    liquidityNote:
      "Options liquidity varies significantly by strike and expiration. " +
      "Wide bid/ask spreads on illiquid contracts can significantly affect entry and exit quality. " +
      "Live contract resolution — including bid/ask data — is available in a future release.",
    earlyAssignment,
  };
}

function buildOptionsMaxRisk(s: OptionsStructure): string {
  switch (s.name) {
    case "long-call":
      return "Maximum theoretical loss is the illustrative premium paid for the call option. Occurs if the underlying closes below the strike at expiration.";
    case "bull-call-spread":
    case "call-debit-spread":
      return "Maximum theoretical loss is the illustrative net debit paid. Occurs if the underlying closes below the long strike at expiration.";
    case "bull-put-spread":
      return "Maximum theoretical loss is the spread width minus the illustrative net credit received. Occurs if the underlying closes below the short put strike at expiration.";
    case "cash-secured-put":
      return "Maximum theoretical risk is effectively that of owning 100 shares at the short put strike minus any credit received. Risk extends to zero if the underlying declines significantly.";
    case "covered-call":
      return "Maximum theoretical downside is the full stock position value minus the illustrative premium received. The short call caps upside at the strike price.";
    case "protective-put":
      return "Maximum theoretical loss is the illustrative premium paid for the protective put plus any decline from cost basis to the put strike.";
    case "iron-condor":
      return "Maximum theoretical loss is the wider spread width minus the illustrative net credit received. Occurs if the underlying moves beyond either short strike at expiration.";
    case "diagonal":
      return "Maximum theoretical loss is the illustrative net debit paid. Occurs if the underlying closes below the long call strike at expiration of the long leg.";
    default:
      return "Maximum risk depends on the specific structure configuration. Consult options education resources before considering any trade.";
  }
}

function buildAssignmentRisk(s: OptionsStructure): string | null {
  if (s.name === "long-call" || s.name === "protective-put") return null;
  if (s.name === "iron-condor" || s.name === "bull-call-spread" || s.name === "call-debit-spread") {
    return "Short options legs may be subject to early assignment. While rare before expiration for equity options, it remains possible — particularly near ex-dividend dates.";
  }
  if (s.name === "cash-secured-put") {
    return "If the short put expires in the money, assignment results in acquiring 100 shares per contract at the strike price. Full cash collateral is required.";
  }
  if (s.name === "covered-call") {
    return "If the short call is assigned, 100 shares per contract are delivered at the strike price. This terminates the covered call position.";
  }
  if (s.name === "bull-put-spread") {
    return "Short put may be assigned if the underlying moves below the strike. The long put provides downside protection to the width of the spread.";
  }
  return "Short options components carry assignment risk. Review the structure's mechanics carefully.";
}

function buildEarlyAssignment(s: OptionsStructure): string | null {
  if (!["cash-secured-put", "covered-call", "bull-put-spread", "iron-condor", "diagonal"].includes(s.name)) {
    return null;
  }
  return "American-style equity options can be exercised early by the holder at any time. " +
    "Early assignment risk is elevated around ex-dividend dates when a call option is deep in the money. " +
    "Monitor positions accordingly.";
}

function buildTimeDecayNote(s: OptionsStructure): string {
  if (s.timeDecay === "Works against") {
    return "Time decay (theta) reduces the value of this position daily. The underlying must move favorably — and quickly enough — to offset time decay before expiration.";
  }
  if (s.timeDecay === "Works for") {
    return "Time decay (theta) benefits this position — the net short option exposure gains value as expiry approaches, assuming the underlying stays within the favorable range.";
  }
  return "Time decay has a mixed effect — the short leg benefits while the long leg loses value from time passage.";
}

function buildOptionsGapRisk(s: OptionsStructure, hasEarnings: boolean): string {
  const base = hasEarnings
    ? "Elevated gap risk — an earnings or catalyst event is referenced in scanner warnings. This may cause significant overnight price moves."
    : "Standard gap risk — the underlying may open significantly away from the prior close due to pre-market news or events.";
  if (s.name === "long-call") {
    return base + " A large adverse gap can result in total loss of the illustrative premium.";
  }
  if (s.isDefinedRisk) {
    return base + " Defined-risk structure limits the maximum loss to the illustrative spread or premium.";
  }
  return base + " Monitor positions around known catalyst dates.";
}

function buildVolatilitySensitivity(s: OptionsStructure): string {
  if (s.name === "long-call") {
    return "Long calls benefit from rising implied volatility (vega positive). A collapse in implied volatility after purchase can significantly reduce option value even if the underlying moves favorably.";
  }
  if (s.isIncome && s.timeDecay === "Works for") {
    return "Net short options structures are vega negative — rising implied volatility increases the value of short legs and can result in unrealized losses. This risk is mitigated in defined-risk spread structures.";
  }
  if (s.isDefinedRisk) {
    return "Defined-risk spread structures have limited net vega exposure — the long and short legs partially offset each other's volatility sensitivity.";
  }
  return "Implied volatility changes affect the mark-to-market value of options positions. Consult options education resources to understand vega exposure.";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface RiskRow {
  icon: typeof ShieldAlert;
  label: string;
  value: string;
  severity: "high" | "medium" | "low" | "none";
}

const SEVERITY_COLOR = {
  high: "text-red-400",
  medium: "text-amber-400",
  low: "text-sky-400",
  none: "text-muted-foreground",
};

interface TradeStructureRiskCardProps {
  stockRisk: StructureRiskProfile;
  optionsRisk?: StructureRiskProfile;
  optionsLabel?: string;
}

export function TradeStructureRiskCard({
  stockRisk,
  optionsRisk,
  optionsLabel,
}: TradeStructureRiskCardProps) {
  const stockRows = buildRiskRows(stockRisk);

  return (
    <Card className="border-border/40" data-testid="trade-structure-risk-card">
      <CardHeader className="px-4 py-3 border-b border-border/30">
        <CardTitle className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <ShieldAlert className="h-3.5 w-3.5" />
          Risk Characteristics
        </CardTitle>
      </CardHeader>

      <CardContent className="px-4 py-3 space-y-4">
        {/* Stock risk */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Stock Structure
          </p>
          <RiskTable rows={stockRows} />
        </div>

        {/* Options risk */}
        {optionsRisk && (
          <>
            <div className="border-t border-border/20" />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Options Structure{optionsLabel ? ` — ${optionsLabel}` : ""}
              </p>
              <RiskTable rows={buildRiskRows(optionsRisk)} />
            </div>
          </>
        )}

        <p className="text-[10px] text-muted-foreground/50 border-t border-border/20 pt-2">
          Illustrative risk characteristics for educational planning only. No numerical premium calculations. Not investment advice.
        </p>
      </CardContent>
    </Card>
  );
}

function buildRiskRows(risk: StructureRiskProfile): RiskRow[] {
  const rows: RiskRow[] = [
    {
      icon: TrendingDown,
      label: "Maximum Risk",
      value: risk.maxRisk,
      severity: "high",
    },
    {
      icon: Activity,
      label: "Time Decay",
      value: risk.timeDecay,
      severity: "medium",
    },
    {
      icon: Zap,
      label: "Gap Risk",
      value: risk.gapRisk,
      severity: "medium",
    },
    {
      icon: Activity,
      label: "Volatility Sensitivity",
      value: risk.volatilitySensitivity,
      severity: "low",
    },
    {
      icon: DropletIcon,
      label: "Liquidity",
      value: risk.liquidityNote,
      severity: "low",
    },
  ];

  if (risk.assignmentRisk) {
    rows.push({
      icon: ShieldAlert,
      label: "Assignment Risk",
      value: risk.assignmentRisk,
      severity: "medium",
    });
  }
  if (risk.earlyAssignment) {
    rows.push({
      icon: Clock,
      label: "Early Assignment",
      value: risk.earlyAssignment,
      severity: "low",
    });
  }

  return rows;
}

function RiskTable({ rows }: { rows: RiskRow[] }) {
  return (
    <div className="space-y-2" data-testid="risk-table">
      {rows.map((row) => {
        const Icon = row.icon;
        return (
          <div
            key={row.label}
            className="flex items-start gap-2.5 rounded-md bg-muted/20 px-2.5 py-2"
            data-testid={`risk-row-${row.label.toLowerCase().replace(/\s+/g, "-")}`}
          >
            <Icon className={cn("h-3.5 w-3.5 shrink-0 mt-0.5", SEVERITY_COLOR[row.severity])} />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                {row.label}
              </p>
              <p className="text-[11px] text-foreground/75 leading-relaxed">{row.value}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
