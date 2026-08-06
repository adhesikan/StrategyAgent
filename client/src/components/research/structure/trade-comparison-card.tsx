// TradeComparisonCard — ranks illustrative trade structures side by side.
// Fully deterministic. No AI. No fabricated premiums or returns.
//
// Categories: Best Overall, Best Stock, Income Alternative, Conservative.

import { GitCompare, Trophy, TrendingUp, DollarSign, Shield } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  ResearchPackage,
  StockStructure,
  OptionsStructure,
  StructureComparison,
  ComparisonCategory,
} from "./types";
import type { Thesis } from "../decision/types";

// ---------------------------------------------------------------------------
// Pure, exported helpers
// ---------------------------------------------------------------------------

/**
 * Build a ranked list of structure comparisons.
 * All confidence scores are derived from techScore + regime + thesis — no AI.
 */
export function buildStructureComparisons(
  pkg: ResearchPackage,
  stock: StockStructure,
  options: OptionsStructure[],
  thesis: Thesis,
): StructureComparison[] {
  const { candidate, marketRegime } = pkg;
  const confidence = (candidate.confidence ?? "").toLowerCase();
  const isHigh = confidence === "high";
  const isMedium = confidence === "medium";
  const isTrending = marketRegime === "TRENDING";
  const isChoppy = marketRegime === "CHOPPY";

  // Base tech score (re-derived deterministically)
  const techBase = isHigh ? 85 : isMedium ? 65 : 45;
  const regimeMod = isTrending ? 8 : isChoppy ? -5 : 0;
  const thesisMod = thesis === "bullish" ? 5 : thesis === "neutral" ? 0 : -10;
  const baseScore = Math.min(100, Math.max(0, techBase + regimeMod + thesisMod));

  const results: StructureComparison[] = [];

  // Best Overall
  const bestOptions = options.find((o) => o.isBestOverall);
  if (bestOptions && thesis !== "bearish" && marketRegime !== "RISK_OFF") {
    const conf = Math.min(100, baseScore + 5);
    results.push({
      category: "best-overall",
      categoryLabel: "Best Overall",
      structureName: bestOptions.label,
      confidence: conf,
      reasons: buildBestOverallReasons(bestOptions, pkg, thesis),
    });
  }

  // Best Stock
  {
    const conf = Math.min(100, baseScore);
    results.push({
      category: "best-stock",
      categoryLabel: "Best Stock Structure",
      structureName: stock.label,
      confidence: conf,
      reasons: buildStockReasons(stock, pkg),
    });
  }

  // Income Alternative
  const incomeOption = options.find((o) => o.isIncome);
  if (incomeOption) {
    const conf = Math.min(100, baseScore - 5);
    results.push({
      category: "income-alternative",
      categoryLabel: "Income Alternative",
      structureName: incomeOption.label,
      confidence: conf,
      reasons: buildIncomeReasons(incomeOption, pkg),
    });
  }

  // Conservative
  const conservOption = options.find((o) => o.isConservative);
  if (conservOption) {
    const conf = Math.min(100, baseScore - 8);
    results.push({
      category: "conservative",
      categoryLabel: "Conservative",
      structureName: conservOption.label,
      confidence: conf,
      reasons: buildConservativeReasons(conservOption, pkg),
    });
  }

  return results;
}

function buildBestOverallReasons(
  s: OptionsStructure,
  pkg: ResearchPackage,
  thesis: Thesis,
): string[] {
  const reasons: string[] = [];
  if (s.isDefinedRisk) reasons.push("Defined maximum risk");
  reasons.push("Capital efficient relative to long stock");
  if (thesis === "bullish") reasons.push("Aligned with bullish research thesis");
  if (pkg.marketRegime === "TRENDING") reasons.push("Supported by trending market regime");
  if (pkg.candidate.rewardRisk !== undefined && pkg.candidate.rewardRisk >= 2) {
    reasons.push(`R/R ratio of ${pkg.candidate.rewardRisk.toFixed(1)}:1 supports spread structure`);
  }
  return reasons;
}

function buildStockReasons(stock: StockStructure, pkg: ResearchPackage): string[] {
  const reasons: string[] = [];
  reasons.push("No options knowledge or approval required");
  reasons.push("Clear stop reference from scanner output");
  if (stock.type === "breakout-entry") reasons.push("Optimal for momentum breakout setups");
  if (stock.type === "pullback-entry") reasons.push("Improved entry versus breakout pricing");
  if (stock.type === "position-trade") reasons.push("Allows thesis to develop over multiple weeks");
  if (pkg.candidate.fitsRiskBudget) reasons.push("Fits within risk budget parameters");
  return reasons;
}

function buildIncomeReasons(s: OptionsStructure, pkg: ResearchPackage): string[] {
  const reasons: string[] = [];
  reasons.push("Generates illustrative income from time decay");
  if (s.name === "cash-secured-put") {
    reasons.push("Potential to acquire shares at a lower illustrative basis if assigned");
    reasons.push("Defined at the strike — downside is effectively long stock risk below it");
  }
  if (s.name === "covered-call") {
    reasons.push("Reduces effective cost basis of an existing long stock position");
  }
  if (s.isDefinedRisk) reasons.push("Spread structure limits maximum loss");
  return reasons;
}

function buildConservativeReasons(s: OptionsStructure, pkg: ResearchPackage): string[] {
  const reasons: string[] = [];
  reasons.push("Limited capital at risk versus outright directional exposure");
  if (s.isDefinedRisk) reasons.push("Both maximum gain and maximum loss are defined");
  if (s.timeDecay === "Works for") reasons.push("Time decay benefits the position");
  if (s.name === "bull-put-spread") {
    reasons.push("Position profits if underlying remains above short put strike");
  }
  if (s.name === "iron-condor") {
    reasons.push("Profits in low-volatility, range-bound environments");
  }
  if (pkg.marketRegime === "CHOPPY") {
    reasons.push("Suitable for choppy market conditions where directional moves are limited");
  }
  return reasons;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const CATEGORY_ICON: Record<ComparisonCategory, typeof Trophy> = {
  "best-overall":       Trophy,
  "best-stock":         TrendingUp,
  "income-alternative": DollarSign,
  "conservative":       Shield,
};

const CATEGORY_COLOR: Record<ComparisonCategory, string> = {
  "best-overall":       "text-amber-400",
  "best-stock":         "text-emerald-400",
  "income-alternative": "text-sky-400",
  "conservative":       "text-violet-400",
};

const CATEGORY_BG: Record<ComparisonCategory, string> = {
  "best-overall":       "bg-amber-500/10 border-amber-500/20",
  "best-stock":         "bg-emerald-500/10 border-emerald-500/20",
  "income-alternative": "bg-sky-500/10 border-sky-500/20",
  "conservative":       "bg-violet-500/10 border-violet-500/20",
};

interface TradeComparisonCardProps {
  comparisons: StructureComparison[];
}

export function TradeComparisonCard({ comparisons }: TradeComparisonCardProps) {
  if (comparisons.length === 0) {
    return (
      <Card className="border-border/40" data-testid="trade-comparison-card">
        <CardHeader className="px-4 py-3 border-b border-border/30">
          <CardTitle className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <GitCompare className="h-3.5 w-3.5" />
            Structure Comparison
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 py-4">
          <p className="text-[12px] text-muted-foreground">
            No comparable structures available for the current research thesis.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/40" data-testid="trade-comparison-card">
      <CardHeader className="px-4 py-3 border-b border-border/30">
        <CardTitle className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <GitCompare className="h-3.5 w-3.5" />
          Structure Comparison
        </CardTitle>
      </CardHeader>

      <CardContent className="px-4 py-3 space-y-2">
        {comparisons.map((c) => {
          const Icon = CATEGORY_ICON[c.category];
          return (
            <div
              key={c.category}
              className={cn(
                "rounded-md border px-3 py-2.5 space-y-1.5",
                CATEGORY_BG[c.category],
              )}
              data-testid={`comparison-${c.category}`}
            >
              {/* Header row */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Icon className={cn("h-3.5 w-3.5 shrink-0", CATEGORY_COLOR[c.category])} />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {c.categoryLabel}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-foreground">
                    {c.structureName}
                  </span>
                  <ConfidenceBar confidence={c.confidence} category={c.category} />
                </div>
              </div>

              {/* Reason bullets */}
              <ul className="space-y-0.5">
                {c.reasons.map((r, i) => (
                  <li key={i} className="text-[11px] text-foreground/70 flex items-start gap-1.5">
                    <span className={cn("mt-1 h-1 w-1 rounded-full shrink-0", CATEGORY_COLOR[c.category])} />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}

        <p className="text-[10px] text-muted-foreground/50 border-t border-border/20 pt-2">
          Illustrative structure comparison for educational planning only. Confidence scores are deterministic research signals, not performance predictions.
        </p>
      </CardContent>
    </Card>
  );
}

function ConfidenceBar({ confidence, category }: { confidence: number; category: ComparisonCategory }) {
  const colorClass: Record<ComparisonCategory, string> = {
    "best-overall":       "bg-amber-400",
    "best-stock":         "bg-emerald-400",
    "income-alternative": "bg-sky-400",
    "conservative":       "bg-violet-400",
  };

  return (
    <div className="flex items-center gap-1.5" data-testid={`confidence-${category}`}>
      <div className="w-16 h-1.5 rounded-full bg-muted/50 overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", colorClass[category])}
          style={{ width: `${confidence}%` }}
        />
      </div>
      <span className="text-[11px] font-semibold text-muted-foreground w-6 text-right">
        {confidence}
      </span>
    </div>
  );
}
