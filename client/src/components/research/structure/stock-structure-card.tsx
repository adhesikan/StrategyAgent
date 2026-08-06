// StockStructureCard — determines and displays the appropriate stock structure
// for the research candidate. Fully deterministic — no API calls, no AI.
//
// Compliance: never uses "Buy/Sell/Recommended Trade/Expected Profit/Guaranteed".

import { TrendingUp, ArrowDownToLine, Zap, BarChart2, Layers } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ResearchPackage, StockStructure, StockStructureType } from "./types";

// ---------------------------------------------------------------------------
// Pure, exported helpers
// ---------------------------------------------------------------------------

/** Derive the most appropriate stock structure from scanner output. */
export function deriveStockStructure(pkg: ResearchPackage): StockStructure {
  const { candidate, marketRegime } = pkg;
  const strategy = (candidate.strategy ?? "").toUpperCase();
  const confidence = (candidate.confidence ?? "").toLowerCase();
  const whyJoined = candidate.whySelected.join(" ").toLowerCase();

  const isHigh = confidence === "high";
  const isMedium = confidence === "medium";

  // 1. Breakout entry: VCP or BREAKOUT with high confidence
  if ((strategy.includes("VCP") || strategy.includes("BREAKOUT")) && isHigh) {
    return buildStockStructure("breakout-entry", pkg);
  }

  // 2. Pullback entry: VCP with medium confidence, or explicit PULLBACK
  if (
    (strategy.includes("VCP") && isMedium) ||
    strategy.includes("PULLBACK")
  ) {
    return buildStockStructure("pullback-entry", pkg);
  }

  // 3. Swing position
  if (strategy.includes("SWING")) {
    return buildStockStructure("swing-position", pkg);
  }

  // 4. Long stock for intraday / gap strategies
  if (
    strategy.includes("GAP") ||
    strategy.includes("ORB") ||
    strategy.includes("INTRADAY")
  ) {
    return buildStockStructure("long-stock", pkg);
  }

  // 5. Position trade: trending regime + high confidence + whySelected mentions trend
  if (
    marketRegime === "TRENDING" &&
    isHigh &&
    (whyJoined.includes("trend") || whyJoined.includes("momentum"))
  ) {
    return buildStockStructure("position-trade", pkg);
  }

  // 6. Default
  return buildStockStructure("long-stock", pkg);
}

const STRUCTURE_META: Record<
  StockStructureType,
  {
    label: string;
    description: string;
    capitalEfficiency: string;
    holdingHorizon: string;
    advantages: string[];
    disadvantages: string[];
  }
> = {
  "breakout-entry": {
    label: "Breakout Entry",
    description:
      "Illustrative entry structure targeting a confirmed price breakout above a key resistance level. Full share position is sized from the scanner's risk parameters.",
    capitalEfficiency: "Moderate — full equity capital deployed",
    holdingHorizon: "Days to several weeks (swing horizon)",
    advantages: [
      "Captures momentum at the point of confirmation",
      "Clear technical invalidation level already identified",
      "Defined risk from the outset",
      "Aligns with the scanner's primary setup thesis",
    ],
    disadvantages: [
      "Breakouts can fail and reverse quickly (false breakout risk)",
      "Full capital deployed — no averaging opportunity",
      "Elevated gap risk after large opening moves",
    ],
  },
  "pullback-entry": {
    label: "Pullback Entry",
    description:
      "Illustrative entry structure targeting a controlled price retracement toward support before the next potential move. Designed for traders seeking a more favorable entry relative to resistance.",
    capitalEfficiency: "Moderate — full equity capital, but improved entry basis",
    holdingHorizon: "Days to weeks (swing horizon)",
    advantages: [
      "Better risk / reward versus a breakout entry",
      "Tighter stop placement near the pullback low",
      "Natural structure confirmation before committing capital",
      "Reduces exposure to false breakout scenarios",
    ],
    disadvantages: [
      "Pullback may not materialize — setup may trigger without retracement",
      "Requires patience and monitoring",
      "Setup can deteriorate during the wait period",
    ],
  },
  "swing-position": {
    label: "Swing Position",
    description:
      "Illustrative multi-day holding structure designed to capture a defined price swing from the current setup. Sized according to the scanner's risk parameters.",
    capitalEfficiency: "Moderate — standard equity position sizing",
    holdingHorizon: "Several days to a few weeks",
    advantages: [
      "Captures meaningful price moves without intraday commitment",
      "Stop levels align with the scanner's technical structure",
      "Suitable for part-time monitoring cadence",
    ],
    disadvantages: [
      "Overnight gap risk — price can open significantly away from stop",
      "Requires discipline during intraday volatility",
      "Position may need management across multiple sessions",
    ],
  },
  "position-trade": {
    label: "Position Trade",
    description:
      "Illustrative longer-horizon holding structure for a candidate demonstrating strong trend characteristics. Sized conservatively to allow for normal price oscillation.",
    capitalEfficiency: "Lower near-term — capital committed for weeks or longer",
    holdingHorizon: "Several weeks to months",
    advantages: [
      "Captures larger trend moves with lower turnover",
      "Allows time for the investment thesis to develop",
      "Reduced transaction costs relative to short-term trading",
    ],
    disadvantages: [
      "Higher absolute dollar risk from extended holding period",
      "Requires ongoing fundamental monitoring",
      "Opportunity cost of capital over the holding period",
    ],
  },
  "long-stock": {
    label: "Long Stock",
    description:
      "Standard long equity position sized from the scanner's risk parameters. Suitable for directional setups where the primary edge is price appreciation.",
    capitalEfficiency: "Moderate — full equity capital deployed",
    holdingHorizon: "Hours to days",
    advantages: [
      "Straightforward execution — no options knowledge required",
      "No time decay or complexity",
      "Available in all brokerage accounts",
    ],
    disadvantages: [
      "Full capital required — no leverage",
      "No protection against sharp adverse moves beyond the stop",
      "Lower capital efficiency than equivalent options structures",
    ],
  },
};

function buildStockStructure(type: StockStructureType, pkg: ResearchPackage): StockStructure {
  const meta = STRUCTURE_META[type];
  const { candidate, marketRegime } = pkg;
  const strategy = (candidate.strategy ?? "").toUpperCase();
  const confidence = (candidate.confidence ?? "").toLowerCase();

  const whyFits: string[] = [];

  if (candidate.strategy) {
    whyFits.push(`Scanner strategy "${candidate.strategy}" is best expressed through a ${meta.label.toLowerCase()} structure.`);
  }
  if (confidence === "high") {
    whyFits.push("High confidence rating supports a full-size illustrative position.");
  } else if (confidence === "medium") {
    whyFits.push("Medium confidence rating suggests a conservative initial position.");
  }
  if (marketRegime === "TRENDING") {
    whyFits.push("Trending market regime supports directional stock exposure.");
  } else if (marketRegime === "CHOPPY") {
    whyFits.push("Choppy market regime suggests tighter sizing and clear stop discipline.");
  } else if (marketRegime === "RISK_OFF") {
    whyFits.push("Risk-off environment — position sizing should reflect elevated market risk.");
  }
  if (candidate.rewardRisk !== undefined && candidate.rewardRisk >= 2) {
    whyFits.push(
      `Reward/risk ratio of ${candidate.rewardRisk.toFixed(1)}:1 meets the minimum threshold for this structure.`
    );
  }
  if (!whyFits.length) {
    whyFits.push("Default stock structure — suitable when no specialized setup is identified.");
  }

  return {
    type,
    label: meta.label,
    description: meta.description,
    capitalEfficiency: meta.capitalEfficiency,
    riskProfile: buildRiskProfile(type, candidate),
    holdingHorizon: meta.holdingHorizon,
    advantages: meta.advantages,
    disadvantages: meta.disadvantages,
    whyFits,
  };
}

function buildRiskProfile(type: StockStructureType, candidate: ResearchPackage["candidate"]): string {
  const inv = candidate.invalidation;
  const cur = candidate.currentPrice;
  if (inv && cur) {
    const stopPct = (((cur - parseFloat(inv)) / cur) * 100).toFixed(1);
    return `Defined stop reference ${stopPct}% below current price ($${inv}). Full equity risk to stop.`;
  }
  if (type === "position-trade") {
    return "Defined stop at technical support. Wider stop tolerance reflects longer holding horizon.";
  }
  return "Defined stop at technical support level. Full equity risk to stop.";
}

// ---------------------------------------------------------------------------
// Icons + colors
// ---------------------------------------------------------------------------

const ICON_MAP: Record<StockStructureType, typeof TrendingUp> = {
  "breakout-entry":  Zap,
  "pullback-entry":  ArrowDownToLine,
  "swing-position":  BarChart2,
  "position-trade":  Layers,
  "long-stock":      TrendingUp,
};

const BADGE_STYLE: Record<StockStructureType, string> = {
  "breakout-entry":  "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  "pullback-entry":  "bg-sky-500/15 text-sky-400 border-sky-500/30",
  "swing-position":  "bg-violet-500/15 text-violet-400 border-violet-500/30",
  "position-trade":  "bg-amber-500/15 text-amber-400 border-amber-500/30",
  "long-stock":      "bg-slate-500/15 text-slate-400 border-slate-500/30",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface StockStructureCardProps {
  pkg: ResearchPackage;
}

export function StockStructureCard({ pkg }: StockStructureCardProps) {
  const structure = deriveStockStructure(pkg);
  const Icon = ICON_MAP[structure.type];

  return (
    <Card className="border-border/40" data-testid="stock-structure-card">
      <CardHeader className="px-4 py-3 border-b border-border/30">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" />
            Stock Structure
          </CardTitle>
          <Badge
            variant="outline"
            className={cn("text-[11px] font-semibold border", BADGE_STYLE[structure.type])}
          >
            <Icon className="h-3 w-3 mr-1" />
            {structure.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="px-4 py-3 space-y-3">
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          {structure.description}
        </p>

        {/* Why this fits */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
            Why This Structure Fits
          </p>
          <ul className="space-y-1">
            {structure.whyFits.map((item, i) => (
              <li key={i} className="text-[12px] text-foreground/80 flex items-start gap-1.5">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-500/70 shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Metrics grid */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md bg-muted/30 px-2.5 py-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Capital Efficiency</p>
            <p className="text-[12px] text-foreground/90">{structure.capitalEfficiency}</p>
          </div>
          <div className="rounded-md bg-muted/30 px-2.5 py-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Holding Horizon</p>
            <p className="text-[12px] text-foreground/90">{structure.holdingHorizon}</p>
          </div>
          <div className="rounded-md bg-muted/30 px-2.5 py-2 col-span-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Risk Profile</p>
            <p className="text-[12px] text-foreground/90">{structure.riskProfile}</p>
          </div>
        </div>

        {/* Advantages / Disadvantages */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400/80 mb-1">
              Advantages
            </p>
            <ul className="space-y-1">
              {structure.advantages.map((a, i) => (
                <li key={i} className="text-[11px] text-foreground/70 flex items-start gap-1.5">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-500/50 shrink-0" />
                  {a}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-400/80 mb-1">
              Considerations
            </p>
            <ul className="space-y-1">
              {structure.disadvantages.map((d, i) => (
                <li key={i} className="text-[11px] text-foreground/70 flex items-start gap-1.5">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500/50 shrink-0" />
                  {d}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="text-[10px] text-muted-foreground/50 border-t border-border/20 pt-2">
          Illustrative trade structure for educational planning only. Not investment advice.
        </p>
      </CardContent>
    </Card>
  );
}
