// RiskCard — Focused risk display with categorized warnings.
// Sprint 2.2.1: warnings are now grouped into deterministic categories.
// All warnings remain visible — grouping never hides items.
// Long lists (>4 items) can be collapsed, but the count always shows.
//
// Categories (keyword-matched, deterministic):
//   Market & Event Risks — earnings, macro, regime, sector
//   Trade-Plan Risks     — stop, objective, invalidation, R/R
//   Sizing & Execution   — liquidity, sizing, broker, account

import { useState } from "react";
import {
  AlertTriangle,
  XCircle,
  Newspaper,
  CheckCircle2,
  Shield,
  ChevronDown,
  ChevronUp,
  TrendingDown,
  Activity,
  BarChart2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ResearchPackage, MarketSnapshot } from "./types";

// ---------------------------------------------------------------------------
// Warning classification — pure, exported, testable
// ---------------------------------------------------------------------------

export type WarnCategory = "market" | "trade-plan" | "execution" | "other";

const MARKET_KEYWORDS = [
  "earning", "eps", "revenue",
  "macro", "fed", "cpi", "ppi", "gdp", "fomc",
  "sector", "industry", "regime", "risk-off", "choppy", "volatil", "event",
];
const TRADE_PLAN_KEYWORDS = [
  "stop", "objective", "target", "invalidat", "risk/reward", " r/r", "r:r",
  "holding", "entry", "setup", "criteria", "trigger",
];
const EXECUTION_KEYWORDS = [
  "liquidit", "thin", "spread", "float", "volume",
  "broker", "position size", "account", "budget", "sizing", "slippage",
  "option", "contract", "chain",
];

/** Classify a single warning string into a category. */
export function classifyWarning(text: string): WarnCategory {
  const lower = text.toLowerCase();
  if (MARKET_KEYWORDS.some((kw) => lower.includes(kw))) return "market";
  if (TRADE_PLAN_KEYWORDS.some((kw) => lower.includes(kw))) return "trade-plan";
  if (EXECUTION_KEYWORDS.some((kw) => lower.includes(kw))) return "execution";
  return "other";
}

/** Group warnings by category, preserving insertion order within each group. */
export function groupWarnings(warnings: string[]): {
  market: string[];
  "trade-plan": string[];
  execution: string[];
  other: string[];
} {
  const result: ReturnType<typeof groupWarnings> = {
    market: [],
    "trade-plan": [],
    execution: [],
    other: [],
  };
  for (const w of warnings) {
    result[classifyWarning(w)].push(w);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const CATEGORY_META: Record<
  WarnCategory,
  { label: string; icon: typeof AlertTriangle; borderClass: string; bgClass: string; iconClass: string }
> = {
  "market": {
    label: "Market & Event",
    icon: TrendingDown,
    borderClass: "border-amber-500/25",
    bgClass: "bg-amber-500/5",
    iconClass: "text-amber-400",
  },
  "trade-plan": {
    label: "Trade-Plan",
    icon: Activity,
    borderClass: "border-orange-500/25",
    bgClass: "bg-orange-500/5",
    iconClass: "text-orange-400",
  },
  "execution": {
    label: "Sizing & Execution",
    icon: BarChart2,
    borderClass: "border-sky-500/20",
    bgClass: "bg-sky-500/5",
    iconClass: "text-sky-400",
  },
  "other": {
    label: "Other",
    icon: AlertTriangle,
    borderClass: "border-amber-500/20",
    bgClass: "bg-amber-500/5",
    iconClass: "text-amber-400",
  },
};

function WarnGroup({
  category,
  items,
}: {
  category: WarnCategory;
  items: string[];
}) {
  if (items.length === 0) return null;
  const meta = CATEGORY_META[category];
  const GroupIcon = meta.icon;

  return (
    <div className="space-y-1" data-testid={`risk-group-${category}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 flex items-center gap-1 pb-0.5">
        <GroupIcon className="h-2.5 w-2.5" aria-hidden="true" />
        {meta.label}
        <Badge variant="outline" className="text-[9px] px-1 py-0 border-border/30 ml-1">
          {items.length}
        </Badge>
      </p>
      {items.map((warn, idx) => (
        <div
          key={idx}
          className={cn(
            "flex items-start gap-2 rounded border px-3 py-2",
            meta.borderClass,
            meta.bgClass,
          )}
          data-testid={`risk-warning-${category}-${idx}`}
          role="alert"
          aria-label={`${meta.label} warning: ${warn}`}
        >
          <AlertTriangle className={cn("h-3.5 w-3.5 shrink-0 mt-0.5", meta.iconClass)} aria-hidden="true" />
          <span className="text-xs text-foreground/80 leading-relaxed">{warn}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RiskCard
// ---------------------------------------------------------------------------

interface RiskCardProps {
  pkg: ResearchPackage;
  highImpactNews?: MarketSnapshot["topNews"];
}

const COLLAPSE_THRESHOLD = 4;

export function RiskCard({ pkg, highImpactNews }: RiskCardProps) {
  const { candidate } = pkg;
  const news = (highImpactNews ?? []).slice(0, 2);
  const groups = groupWarnings(candidate.warnings);
  const [expanded, setExpanded] = useState(true);

  const totalFlags =
    candidate.warnings.length +
    (candidate.invalidation ? 1 : 0) +
    news.length;

  const showCollapseToggle = candidate.warnings.length > COLLAPSE_THRESHOLD;

  return (
    <Card className="border-border/40" data-testid="risk-card">
      <CardHeader className="px-4 py-3 border-b border-border/30">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[12px] font-semibold uppercase tracking-wider flex items-center gap-2 text-muted-foreground">
            <Shield className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
            Risk Summary
          </CardTitle>
          <div className="flex items-center gap-2">
            <span
              className={
                totalFlags === 0
                  ? "text-[10px] text-emerald-400"
                  : "text-[10px] text-amber-400 font-semibold"
              }
              data-testid="risk-flag-count"
              aria-live="polite"
            >
              {totalFlags === 0
                ? "No flags"
                : `${totalFlags} flag${totalFlags !== 1 ? "s" : ""}`}
            </span>
            {showCollapseToggle && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 text-muted-foreground"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                aria-label={expanded ? "Collapse risk list" : "Expand risk list"}
              >
                {expanded ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4 pt-3 space-y-3">
        {/* Clean state */}
        {totalFlags === 0 && (
          <div
            className="flex items-center gap-2 text-xs text-emerald-400"
            data-testid="risk-clean"
            role="status"
          >
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            No scanner warning flags for this candidate.
          </div>
        )}

        {/* Invalidation — always shown, most prominent */}
        {candidate.invalidation && (
          <div
            className="flex items-start gap-2 rounded border border-rose-500/25 bg-rose-500/8 px-3 py-2.5"
            data-testid="risk-invalidation"
            role="alert"
            aria-label={`Invalidation level: Close below $${candidate.invalidation}`}
          >
            <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-xs space-y-0.5">
              <div className="font-semibold text-rose-300">Invalidation Framework</div>
              <div className="text-muted-foreground leading-relaxed">
                Setup considered invalidated when price closes below{" "}
                <span className="font-mono text-rose-300">${candidate.invalidation}</span>.
                Educational planning only.
              </div>
            </div>
          </div>
        )}

        {/* Grouped scanner warnings */}
        {candidate.warnings.length > 0 && (
          <div
            className={cn(
              "space-y-3",
              !expanded && "overflow-hidden",
            )}
            aria-label="Scanner warnings"
          >
            {expanded ? (
              <>
                <WarnGroup category="market" items={groups.market} />
                <WarnGroup category="trade-plan" items={groups["trade-plan"]} />
                <WarnGroup category="execution" items={groups.execution} />
                <WarnGroup category="other" items={groups.other} />
              </>
            ) : (
              <div
                className="flex items-center gap-2 rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2"
                data-testid="risk-collapsed-summary"
              >
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" aria-hidden="true" />
                <span className="text-xs text-foreground/70">
                  {candidate.warnings.length} warning flag{candidate.warnings.length !== 1 ? "s" : ""} —
                  expand to view
                </span>
              </div>
            )}
          </div>
        )}

        {/* High-impact market events */}
        {news.map((n, idx) => (
          <div
            key={idx}
            className="flex items-start gap-2 rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2"
            data-testid={`risk-news-${idx}`}
            role="alert"
          >
            <Newspaper className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-xs space-y-0.5">
              <div className="font-medium text-foreground/80">
                Market Event · {n.symbol}
              </div>
              <div className="text-muted-foreground leading-relaxed">{n.whyItMatters}</div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
