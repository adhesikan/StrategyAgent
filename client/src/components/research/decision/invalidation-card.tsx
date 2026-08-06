// InvalidationCard — shows all invalidation conditions for this candidate.
// Covers: price, technical, fundamental, earnings, macro, sector risk.
// No fabricated text. "Not available." shown when data is absent.

import { XCircle, AlertTriangle, HelpCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ResearchPackage, MarketSnapshot } from "../types";
import type { InvalidationItem } from "./types";

// ---------------------------------------------------------------------------
// Pure, exported helpers
// ---------------------------------------------------------------------------

const EARNINGS_KEYWORDS = ["earning", "er ", " er ", "eps", "report", "revenue"];
const LIQUIDITY_KEYWORDS = ["liquidity", "spread", "thin volume", "low float"];
const SECTOR_KEYWORDS = ["sector", "industry", "group"];

function hasKeyword(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

/** Build all invalidation conditions from existing scanner data. */
export function buildInvalidationItems(
  pkg: ResearchPackage,
  snapshot?: MarketSnapshot,
): InvalidationItem[] {
  const { candidate, marketRegime } = pkg;
  const warnText = candidate.warnings.join(" ");
  const highImpactNews = (snapshot?.topNews ?? []).filter((n) => n.impact === "high");

  // 1. Price invalidation
  const priceItem: InvalidationItem = candidate.invalidation
    ? {
        type: "price",
        label: "Price Invalidation",
        description: `Setup is considered invalidated when price closes below $${candidate.invalidation}. This is the scanner-derived stop reference — not a trade instruction.`,
        available: true,
      }
    : {
        type: "price",
        label: "Price Invalidation",
        description: "Not available — invalidation level not specified by scanner for this candidate.",
        available: false,
      };

  // 2. Technical invalidation
  const hasTechBreakdown = hasKeyword(warnText, ["breakdown", "support", "break"]);
  const techItem: InvalidationItem = {
    type: "technical",
    label: "Technical Invalidation",
    description: hasTechBreakdown
      ? `Scanner flags: ${candidate.warnings.find((w) => hasKeyword(w, ["breakdown", "support", "break"])) ?? "technical structure at risk"}.`
      : candidate.invalidation
      ? `Breakdown below pivot/base structure concurrent with close below $${candidate.invalidation} would further weaken the setup.`
      : "Breakdown below the identified pattern base on heavy volume would invalidate the setup.",
    available: true,
  };

  // 3. Fundamental invalidation
  const fundItem: InvalidationItem = {
    type: "fundamental",
    label: "Fundamental Invalidation",
    description:
      "A significant earnings miss, guidance cut, or credit event affecting the company's business outlook would invalidate a growth-based thesis. Verify upcoming earnings dates with your broker.",
    available: true,
  };

  // 4. Earnings risk
  const hasEarningsWarn = hasKeyword(warnText, EARNINGS_KEYWORDS);
  const earningsItem: InvalidationItem = hasEarningsWarn
    ? {
        type: "earnings",
        label: "Earnings Risk",
        description: `Scanner warning: ${candidate.warnings.find((w) => hasKeyword(w, EARNINGS_KEYWORDS)) ?? "earnings-related event flagged"}. Verify the exact date and expected magnitude with your broker.`,
        available: true,
      }
    : {
        type: "earnings",
        label: "Earnings Risk",
        description: "No earnings warning flagged by the scanner. Always verify upcoming earnings dates independently — gaps can move price significantly beyond the invalidation level.",
        available: true,
      };

  // 5. Macro risk
  const macroItem: InvalidationItem = {
    type: "macro",
    label: "Macro Risk",
    description:
      marketRegime === "RISK_OFF"
        ? "Current macro environment is risk-off. A sustained risk-off rotation or Federal Reserve policy surprise could broadly invalidate growth setups."
        : marketRegime === "CHOPPY"
        ? "Market is choppy. A deterioration to risk-off or a VIX spike above key levels would worsen the macro backdrop."
        : highImpactNews.length > 0
        ? `High-impact market events active (${highImpactNews.map((n) => n.symbol).join(", ")}). Monitor for macro spillover.`
        : "No specific macro risk flagged at current regime. A sudden shift to risk-off would invalidate broad long exposure.",
    available: true,
  };

  // 6. Sector risk
  const hasSectorWarn = hasKeyword(warnText, SECTOR_KEYWORDS);
  const sectorNews = highImpactNews.filter((n) => n.impact === "high");
  const sectorItem: InvalidationItem = hasSectorWarn
    ? {
        type: "sector",
        label: "Sector Risk",
        description: `Scanner warning: ${candidate.warnings.find((w) => hasKeyword(w, SECTOR_KEYWORDS)) ?? "sector-level concern flagged"}.`,
        available: true,
      }
    : sectorNews.length > 0
    ? {
        type: "sector",
        label: "Sector Risk",
        description: `High-impact news affecting: ${sectorNews.map((n) => n.symbol).join(", ")}. Monitor whether sector-level weakness spreads.`,
        available: true,
      }
    : {
        type: "sector",
        label: "Sector Risk",
        description: "Not available — no sector-level risk flags from scanner or market events for this scan.",
        available: false,
      };

  return [priceItem, techItem, fundItem, earningsItem, macroItem, sectorItem];
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

const TYPE_CONFIG: Record<
  InvalidationItem["type"],
  { color: string; icon: React.ElementType }
> = {
  price:         { color: "border-rose-500/25 bg-rose-500/5",   icon: XCircle },
  technical:     { color: "border-amber-500/20 bg-amber-500/5", icon: AlertTriangle },
  fundamental:   { color: "border-amber-500/20 bg-amber-500/5", icon: AlertTriangle },
  earnings:      { color: "border-amber-500/20 bg-amber-500/5", icon: AlertTriangle },
  macro:         { color: "border-border/30 bg-card/20",        icon: AlertTriangle },
  sector:        { color: "border-border/30 bg-card/20",        icon: AlertTriangle },
};

const ICON_COLOR: Record<InvalidationItem["type"], string> = {
  price:       "text-rose-400",
  technical:   "text-amber-400",
  fundamental: "text-amber-400",
  earnings:    "text-amber-400",
  macro:       "text-muted-foreground",
  sector:      "text-muted-foreground",
};

// ---------------------------------------------------------------------------
// InvalidationCard
// ---------------------------------------------------------------------------

interface InvalidationCardProps {
  pkg: ResearchPackage;
  snapshot?: MarketSnapshot;
}

export function InvalidationCard({ pkg, snapshot }: InvalidationCardProps) {
  const items = buildInvalidationItems(pkg, snapshot);

  return (
    <Card className="border-border/40" data-testid="invalidation-card">
      <CardHeader className="px-4 py-3 border-b border-border/30">
        <CardTitle className="text-[12px] font-semibold uppercase tracking-wider flex items-center gap-2 text-muted-foreground">
          <XCircle className="h-3.5 w-3.5 text-rose-400" />
          Invalidation Conditions
        </CardTitle>
        <p className="text-[10px] text-muted-foreground/70 mt-0.5">
          Educational reference only — not a stop-loss instruction
        </p>
      </CardHeader>

      <CardContent className="px-4 py-4 space-y-2">
        {items.map((item) => {
          const cfg = TYPE_CONFIG[item.type];
          const Icon = item.available ? cfg.icon : HelpCircle;
          const iconColor = item.available ? ICON_COLOR[item.type] : "text-muted-foreground/40";

          return (
            <div
              key={item.type}
              className={cn(
                "rounded border px-3 py-2.5",
                item.available ? cfg.color : "border-border/20 bg-card/10",
              )}
              data-testid={`invalidation-${item.type}`}
            >
              <div className="flex items-start gap-2">
                <Icon className={cn("h-3.5 w-3.5 shrink-0 mt-0.5", iconColor)} />
                <div className="space-y-0.5">
                  <div
                    className={cn(
                      "text-[11px] font-semibold",
                      item.available ? "text-foreground/80" : "text-muted-foreground/60",
                    )}
                  >
                    {item.label}
                  </div>
                  <p
                    className={cn(
                      "text-[10px] leading-relaxed",
                      item.available ? "text-foreground/70" : "text-muted-foreground/50 italic",
                    )}
                  >
                    {item.description}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
