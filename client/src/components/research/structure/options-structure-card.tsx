// OptionsStructureCard — generates deterministic options structure guidance.
// NEVER displays: premiums, Greeks, OI, bid, ask, volume, expiration dates.
// Those require Sprint 2.2.1 (Live Contract Resolver).
//
// Compliance language only. No "Buy/Sell/Expected Profit".

import { CandlestickChart, Clock, Target, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ResearchPackage, OptionsStructure, OptionsStructureName } from "./types";
import type { Thesis } from "../decision/types";

// ---------------------------------------------------------------------------
// DTE and strike guidance logic
// ---------------------------------------------------------------------------

/** Determine appropriate DTE range from holding period / strategy. */
export function deriveDTE(candidate: ResearchPackage["candidate"]): string {
  const strategy = (candidate.strategy ?? "").toUpperCase();
  const whyJoined = candidate.whySelected.join(" ").toLowerCase();

  // Intraday / gap strategies — very short horizon
  if (strategy.includes("ORB") || strategy.includes("GAP") || strategy.includes("INTRADAY")) {
    return "30 DTE";
  }

  // Look for holding period clues in whySelected text
  if (
    whyJoined.includes("month") ||
    whyJoined.includes("weeks") ||
    whyJoined.includes("position") ||
    whyJoined.includes("trend")
  ) {
    return "60–90 DTE";
  }
  if (whyJoined.includes("swing") || whyJoined.includes("week")) {
    return "45–60 DTE";
  }

  // Strategy-level defaults
  if (strategy.includes("VCP") || strategy.includes("BREAKOUT")) {
    return "45–60 DTE";
  }
  if (strategy.includes("PULLBACK")) {
    return "30–45 DTE";
  }
  if (strategy.includes("SWING")) {
    return "30–45 DTE";
  }

  return "30–45 DTE";
}

/** Determine strike guidance for a given options structure. */
export function deriveStrikeGuidance(name: OptionsStructureName): string {
  switch (name) {
    case "long-call":
      return "Near ATM — within 2–3% of current price";
    case "call-debit-spread":
    case "bull-call-spread":
      return "Long leg near ATM; short leg 4–6% OTM near illustrative resistance";
    case "bull-put-spread":
      return "Both strikes below current price; short put near illustrative support";
    case "call-credit-spread":
      return "Short call 2–5% OTM; long call 5–8% OTM for defined risk";
    case "cash-secured-put":
      return "Short put strike near illustrative technical support";
    case "covered-call":
      return "Short call 2–5% OTM near illustrative technical resistance";
    case "protective-put":
      return "Near ATM or 1–2 strikes ITM for stronger protection";
    case "diagonal":
      return "Long leg: 30–60 DTE, near ATM. Short leg: 7–14 DTE, 2–4% OTM";
    case "iron-condor":
      return "Outer strikes at illustrative support and resistance; wing width 5–8%";
    default:
      return "Near ATM — discuss with a financial professional for precise selection";
  }
}

// ---------------------------------------------------------------------------
// Structure definitions
// ---------------------------------------------------------------------------

interface StructureDef {
  label: string;
  reason: string;
  capitalEfficiency: string;
  riskProfile: string;
  timeDecay: string;
  marketOutlook: string;
  isDefinedRisk: boolean;
  isIncome: boolean;
  isConservative: boolean;
}

const STRUCTURE_DEFS: Record<OptionsStructureName, StructureDef> = {
  "long-call": {
    label: "Long Call",
    reason:
      "Provides leveraged directional exposure with defined maximum risk equal to the illustrative premium paid. Suitable when high confidence and directional conviction are both present.",
    capitalEfficiency: "High — controls 100 shares per contract with limited capital",
    riskProfile: "Defined — maximum loss is the illustrative premium paid",
    timeDecay: "Works against (long option loses value with each passing day)",
    marketOutlook: "Bullish — benefits from price appreciation and/or implied volatility expansion",
    isDefinedRisk: true,
    isIncome: false,
    isConservative: false,
  },
  "bull-call-spread": {
    label: "Bull Call Spread",
    reason:
      "Defined-risk bullish structure that reduces net cost versus a long call by capping upside at the short strike. Appropriate when the thesis is bullish with a clear price target near resistance.",
    capitalEfficiency: "Moderate — lower cost than a long call, capped profit potential",
    riskProfile: "Defined — maximum loss is the illustrative net debit paid",
    timeDecay: "Moderately negative (net long position loses time value)",
    marketOutlook: "Moderately bullish — targets a price range rather than unlimited upside",
    isDefinedRisk: true,
    isIncome: false,
    isConservative: false,
  },
  "call-debit-spread": {
    label: "Call Debit Spread",
    reason:
      "Functionally equivalent to a bull call spread — a long call at a lower strike financed by a short call at a higher strike. Used when defined risk and capital efficiency are the primary concerns.",
    capitalEfficiency: "Moderate — lower cost than a single long call",
    riskProfile: "Defined — maximum loss is the net debit paid",
    timeDecay: "Moderately negative",
    marketOutlook: "Moderately bullish with a defined upper target",
    isDefinedRisk: true,
    isIncome: false,
    isConservative: false,
  },
  "bull-put-spread": {
    label: "Bull Put Spread",
    reason:
      "Collects a net credit by selling a put at a higher strike and buying a put at a lower strike for protection. Appropriate when the research thesis is mildly bullish or range-bound with strong support.",
    capitalEfficiency: "Moderate — receives net credit; ties up capital as margin collateral",
    riskProfile: "Defined — maximum loss is the spread width minus net credit received",
    timeDecay: "Works for (net short position gains value as expiry approaches)",
    marketOutlook: "Mildly bullish to neutral — expects price to remain above the short put strike",
    isDefinedRisk: true,
    isIncome: true,
    isConservative: true,
  },
  "cash-secured-put": {
    label: "Cash Secured Put",
    reason:
      "Generates illustrative income by selling a put option at a strike near technical support. If assigned, acquires shares at the strike price minus the premium. Appropriate when the trader is comfortable owning the stock at a lower price.",
    capitalEfficiency: "Low — requires full cash collateral equal to 100× strike price",
    riskProfile: "Undefined below the short strike (effectively long stock risk on assignment)",
    timeDecay: "Works for (collects time value as expiry approaches)",
    marketOutlook: "Neutral to mildly bullish — comfortable acquiring shares at the strike level",
    isDefinedRisk: false,
    isIncome: true,
    isConservative: false,
  },
  "covered-call": {
    label: "Covered Call",
    reason:
      "Generates illustrative income on an existing or simultaneous long stock position by selling a call option against it. Suitable for range-bound to mildly bullish outlook with a willingness to have shares called away at the short strike.",
    capitalEfficiency: "Low — requires full stock position as collateral",
    riskProfile: "Downside risk of the full stock position; upside capped at short strike",
    timeDecay: "Works for (short option gains from time decay)",
    marketOutlook: "Neutral to mildly bullish — expects limited near-term upside",
    isDefinedRisk: false,
    isIncome: true,
    isConservative: true,
  },
  "protective-put": {
    label: "Protective Put",
    reason:
      "Provides downside insurance on an existing long stock position by purchasing a put option. Useful when the primary thesis remains bullish but a known risk event (earnings, macro) increases near-term uncertainty.",
    capitalEfficiency: "Low — premium cost reduces net return",
    riskProfile: "Defined downside; full upside participation on the stock",
    timeDecay: "Works against (put loses value if stock stays above strike)",
    marketOutlook: "Bullish with hedged downside — for risk-aware directional holders",
    isDefinedRisk: true,
    isIncome: false,
    isConservative: true,
  },
  "diagonal": {
    label: "Diagonal Spread",
    reason:
      "Long a further-dated call to capture the directional move; short a nearer-dated OTM call to reduce carrying cost. Appropriate for multi-week setups where the trader expects a gradual move.",
    capitalEfficiency: "Moderate — net debit structure with reduced cost versus a single long call",
    riskProfile: "Defined — net debit paid is the maximum loss",
    timeDecay: "Mixed — shorter short leg works for; longer long leg works against",
    marketOutlook: "Moderately bullish over a longer horizon",
    isDefinedRisk: true,
    isIncome: false,
    isConservative: false,
  },
  "iron-condor": {
    label: "Iron Condor",
    reason:
      "Simultaneously sells an OTM put spread and an OTM call spread to collect net credit when expecting low volatility and range-bound price action. Not a directional strategy.",
    capitalEfficiency: "Moderate — net credit received; ties up margin as collateral",
    riskProfile: "Defined — maximum loss is the wider spread width minus net credit",
    timeDecay: "Works for (net short options benefit from time decay)",
    marketOutlook: "Neutral — expects the underlying to remain within the two short strikes at expiry",
    isDefinedRisk: true,
    isIncome: true,
    isConservative: true,
  },
  "call-credit-spread": {
    label: "Call Credit Spread",
    reason:
      "Bearish to neutral defined-risk structure. Not displayed for bullish research theses.",
    capitalEfficiency: "Moderate",
    riskProfile: "Defined",
    timeDecay: "Works for",
    marketOutlook: "Neutral to bearish",
    isDefinedRisk: true,
    isIncome: true,
    isConservative: false,
  },
};

// ---------------------------------------------------------------------------
// Main selector
// ---------------------------------------------------------------------------

/** Derive options structures appropriate for the research thesis. */
export function deriveOptionsStructures(
  pkg: ResearchPackage,
  thesis: Thesis,
): OptionsStructure[] {
  const { candidate, marketRegime } = pkg;
  const strategy = (candidate.strategy ?? "").toUpperCase();
  const confidence = (candidate.confidence ?? "").toLowerCase();
  const dte = deriveDTE(candidate);
  const results: OptionsStructure[] = [];

  // Risk-off + bearish → no structures (options not suitable for bullish thesis in risk-off)
  if (thesis === "bearish" || marketRegime === "RISK_OFF") {
    return [];
  }

  // Intraday strategies → avoid options (too short horizon)
  if (strategy.includes("ORB") || strategy.includes("GAP") || strategy.includes("INTRADAY")) {
    return [];
  }

  if (thesis === "bullish") {
    // Trending + high confidence → best overall = bull-call-spread
    if (marketRegime === "TRENDING" && confidence === "high") {
      results.push(makeStructure("bull-call-spread", dte, true, false, false));
      results.push(makeStructure("long-call", dte, false, false, false));
      results.push(makeStructure("cash-secured-put", dte, false, true, false));
      results.push(makeStructure("bull-put-spread", dte, false, true, true));
      return results;
    }
    // Trending + medium confidence
    if (marketRegime === "TRENDING" && confidence === "medium") {
      results.push(makeStructure("bull-call-spread", dte, true, false, false));
      results.push(makeStructure("bull-put-spread", dte, false, true, true));
      return results;
    }
    // Choppy → income-focused; spreads preferred
    if (marketRegime === "CHOPPY") {
      results.push(makeStructure("bull-put-spread", dte, true, true, true));
      results.push(makeStructure("cash-secured-put", dte, false, true, false));
      return results;
    }
    // Default bullish
    results.push(makeStructure("bull-call-spread", dte, true, false, false));
    results.push(makeStructure("cash-secured-put", dte, false, true, false));
    results.push(makeStructure("bull-put-spread", dte, false, false, true));
    return results;
  }

  // Neutral thesis
  if (thesis === "neutral") {
    results.push(makeStructure("iron-condor", dte, true, true, true));
    results.push(makeStructure("covered-call", dte, false, true, true));
    return results;
  }

  return results;
}

function makeStructure(
  name: OptionsStructureName,
  dte: string,
  isBestOverall: boolean,
  isIncome: boolean,
  isConservative: boolean,
): OptionsStructure {
  const def = STRUCTURE_DEFS[name];
  return {
    name,
    label: def.label,
    preferredDTE: dte,
    strikeGuidance: deriveStrikeGuidance(name),
    reason: def.reason,
    capitalEfficiency: def.capitalEfficiency,
    riskProfile: def.riskProfile,
    timeDecay: def.timeDecay,
    marketOutlook: def.marketOutlook,
    isDefinedRisk: def.isDefinedRisk,
    isBestOverall,
    isIncome,
    isConservative,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface OptionsStructureCardProps {
  pkg: ResearchPackage;
  thesis: Thesis;
}

export function OptionsStructureCard({ pkg, thesis }: OptionsStructureCardProps) {
  const structures = deriveOptionsStructures(pkg, thesis);

  if (structures.length === 0) {
    return (
      <Card className="border-border/40" data-testid="options-structure-card">
        <CardHeader className="px-4 py-3 border-b border-border/30">
          <CardTitle className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <CandlestickChart className="h-3.5 w-3.5" />
            Options Structures
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 py-4">
          <p className="text-[12px] text-muted-foreground">
            Options structures are not displayed for this research thesis or market regime.
            The current environment does not support directional options structures aligned with this candidate.
          </p>
        </CardContent>
      </Card>
    );
  }

  const primary = structures[0];

  return (
    <Card className="border-border/40" data-testid="options-structure-card">
      <CardHeader className="px-4 py-3 border-b border-border/30">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <CandlestickChart className="h-3.5 w-3.5" />
            Options Structures
          </CardTitle>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="text-[10px] border-violet-500/30 text-violet-400 bg-violet-500/10">
              {primary.label}
            </Badge>
            {primary.isDefinedRisk && (
              <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
                Defined Risk
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-4 py-3 space-y-4">
        {/* DTE + Strike guidance */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md bg-muted/30 px-2.5 py-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5 flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" />
              Illustrative DTE Guidance
            </p>
            <p className="text-[13px] font-semibold text-foreground">{primary.preferredDTE}</p>
          </div>
          <div className="rounded-md bg-muted/30 px-2.5 py-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5 flex items-center gap-1">
              <Target className="h-2.5 w-2.5" />
              Illustrative Strike Guidance
            </p>
            <p className="text-[12px] text-foreground">{primary.strikeGuidance}</p>
          </div>
        </div>

        {/* Primary structure detail */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
            Primary Illustrative Structure — {primary.label}
          </p>
          <p className="text-[12px] text-foreground/80 leading-relaxed mb-2">{primary.reason}</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Capital Efficiency", value: primary.capitalEfficiency },
              { label: "Risk Profile", value: primary.riskProfile },
              { label: "Time Decay", value: primary.timeDecay },
              { label: "Market Outlook", value: primary.marketOutlook },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-md bg-muted/20 px-2.5 py-1.5">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">{label}</p>
                <p className="text-[11px] text-foreground/80">{value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Additional structures */}
        {structures.length > 1 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Additional Possible Structures
            </p>
            <div className="space-y-1.5">
              {structures.slice(1).map((s) => (
                <div
                  key={s.name}
                  className="flex items-start gap-2 rounded-md bg-muted/20 px-2.5 py-2"
                  data-testid={`options-structure-${s.name}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[12px] font-medium text-foreground/90">{s.label}</span>
                      {s.isIncome && (
                        <Badge variant="outline" className="text-[9px] px-1 border-amber-500/30 text-amber-400 bg-amber-500/10">
                          Income
                        </Badge>
                      )}
                      {s.isConservative && (
                        <Badge variant="outline" className="text-[9px] px-1 border-sky-500/30 text-sky-400 bg-sky-500/10">
                          Conservative
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground line-clamp-2">{s.reason.split(".")[0]}.</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[10px] text-muted-foreground">{s.preferredDTE}</p>
                    <p className="text-[10px] text-muted-foreground/60">{s.isDefinedRisk ? "Defined" : "Undefined"}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Live contracts disclaimer */}
        <div className="flex items-start gap-2 rounded-md bg-amber-500/5 border border-amber-500/20 px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            <span className="font-medium text-amber-400">Live contract resolution not yet active.</span>{" "}
            No actual premiums, Greeks, bid/ask prices, open interest, or expiration dates are shown.
            Illustrative DTE and strike guidance only. Connect a broker in a future release to resolve live contracts.
          </p>
        </div>

        <p className="text-[10px] text-muted-foreground/50 border-t border-border/20 pt-2">
          Illustrative trade structures for educational planning only. Not investment advice.
        </p>
      </CardContent>
    </Card>
  );
}
