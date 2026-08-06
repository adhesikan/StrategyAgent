// ScoreBreakdownCard — deterministic contribution bars for every score component.
// No stars. No AI-generated scores. All values derived from scanner output.
// Each bar shows a 0–100 score with colour-coded fill and a source label.

import { BarChart2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ResearchPackage, EvidenceStars } from "../types";
import type { ScoreComponent } from "./types";

// ---------------------------------------------------------------------------
// Pure score derivations — exported for testing
// ---------------------------------------------------------------------------

export function computeTechnicalScore(candidate: ResearchPackage["candidate"]): number {
  const conf = (candidate.confidence ?? "").toLowerCase();
  const why = candidate.whySelected.length;
  if (conf === "high" && why >= 3) return 85;
  if (conf === "high" && why >= 1) return 70;
  if (conf === "medium") return 55;
  if (conf === "low") return 35;
  return 20;
}

export function computeMomentumScore(candidate: ResearchPackage["candidate"]): number {
  const s = (candidate.strategy ?? "").toUpperCase();
  if (s.includes("VCP") || s.includes("BREAKOUT")) return 75;
  if (s.includes("GAP")) return 70;
  if (s.includes("INTRADAY") || s.includes("ORB")) return 62;
  if (s.includes("PULLBACK")) return 55;
  if (s.includes("SWING")) return 60;
  return 40;
}

export function computeVolumeScore(candidate: ResearchPackage["candidate"]): number {
  const whyText = candidate.whySelected.join(" ").toLowerCase();
  const warnText = candidate.warnings.join(" ").toLowerCase();
  if (!whyText.includes("volume")) return 30;
  let score = 45;
  if (whyText.includes("dry") || whyText.includes("contraction")) score += 25;
  if (whyText.includes("surge") || whyText.includes("expansion")) score += 30;
  if (whyText.includes("breakout") && whyText.includes("volume")) score += 15;
  if (warnText.includes("volume") || warnText.includes("thin")) score -= 20;
  return Math.max(20, Math.min(90, score));
}

export function computeRelativeStrengthScore(candidate: ResearchPackage["candidate"]): number {
  const whyText = candidate.whySelected.join(" ").toLowerCase();
  if (
    whyText.includes("relative strength") ||
    whyText.includes(" rs ") ||
    whyText.match(/\brs\b/)
  ) return 75;
  if (whyText.includes("outperform") || whyText.includes("leading")) return 70;
  const s = (candidate.strategy ?? "").toUpperCase();
  if (s.includes("VCP") || s.includes("LEADER")) return 60;
  return 30;
}

export function computeRegimeScore(marketRegime: string | null): { score: number; available: boolean } {
  if (!marketRegime) return { score: 0, available: false };
  if (marketRegime === "TRENDING") return { score: 90, available: true };
  if (marketRegime === "CHOPPY") return { score: 50, available: true };
  if (marketRegime === "RISK_OFF") return { score: 15, available: true };
  return { score: 40, available: true };
}

export function computeFundamentalsScore(candidate: ResearchPackage["candidate"]): number {
  const q = (candidate.dataQuality ?? "").toLowerCase();
  if (q === "good") return 65;
  if (q === "partial") return 42;
  if (q === "minimal" || q === "low") return 22;
  return 35;
}

export function computeLiquidityScore(candidate: ResearchPackage["candidate"]): number {
  const warnText = candidate.warnings.join(" ").toLowerCase();
  if (warnText.includes("liquidit")) return 20;
  if (warnText.includes("thin") || warnText.includes("spread")) return 32;
  return 65;
}

export function computeRiskScore(candidate: ResearchPackage["candidate"]): number {
  const warn = candidate.warnings.length;
  if (warn === 0) return candidate.invalidation ? 80 : 70;
  if (warn === 1) return 60;
  if (warn === 2) return 45;
  return 25;
}

/** Build all 11 score components from existing data. No AI, no fabrication. */
export function computeScoreComponents(
  pkg: ResearchPackage,
  stars: EvidenceStars,
): ScoreComponent[] {
  const { candidate, marketRegime } = pkg;
  const regime = computeRegimeScore(marketRegime);

  return [
    {
      id: "technical",
      label: "Technical",
      score: computeTechnicalScore(candidate),
      available: true,
      source: "Pattern confidence + scanner criteria count",
    },
    {
      id: "momentum",
      label: "Momentum",
      score: computeMomentumScore(candidate),
      available: true,
      source: "Strategy classification",
    },
    {
      id: "volume",
      label: "Volume",
      score: computeVolumeScore(candidate),
      available: true,
      source: "Scanner criteria keywords",
    },
    {
      id: "relative-strength",
      label: "Relative Strength",
      score: computeRelativeStrengthScore(candidate),
      available: true,
      source: "Scanner criteria + strategy",
    },
    {
      id: "market-regime",
      label: "Market Regime",
      score: regime.score,
      available: regime.available,
      source: "Broad market regime classification",
    },
    {
      id: "news",
      label: "News",
      score: stars.news * 20,
      available: true,
      source: "Sentiment article coverage (open News tab to refresh)",
    },
    {
      id: "congress",
      label: "Congress",
      score: stars.congress * 20,
      available: true,
      source: "CongressFlow — publicly disclosed transactions",
    },
    {
      id: "institutional",
      label: "Institutional",
      score: 0,
      available: false,
      source: "No institutional data provider configured",
    },
    {
      id: "fundamentals",
      label: "Fundamentals",
      score: computeFundamentalsScore(candidate),
      available: true,
      source: "Scanner data quality classification",
    },
    {
      id: "liquidity",
      label: "Liquidity",
      score: computeLiquidityScore(candidate),
      available: true,
      source: "Scanner warning flags (bid-ask/volume)",
    },
    {
      id: "risk",
      label: "Risk",
      score: computeRiskScore(candidate),
      available: true,
      source: "Warning flag count + invalidation presence",
    },
  ];
}

// ---------------------------------------------------------------------------
// Bar color helper
// ---------------------------------------------------------------------------

function barColor(score: number): string {
  if (score >= 70) return "bg-emerald-500";
  if (score >= 50) return "bg-sky-500";
  if (score >= 30) return "bg-amber-500";
  return "bg-rose-500";
}

function labelColor(score: number): string {
  if (score >= 70) return "text-emerald-400";
  if (score >= 50) return "text-sky-400";
  if (score >= 30) return "text-amber-400";
  return "text-rose-400";
}

// ---------------------------------------------------------------------------
// ScoreBreakdownCard
// ---------------------------------------------------------------------------

interface ScoreBreakdownCardProps {
  pkg: ResearchPackage;
  stars: EvidenceStars;
}

export function ScoreBreakdownCard({ pkg, stars }: ScoreBreakdownCardProps) {
  const components = computeScoreComponents(pkg, stars);

  return (
    <Card className="border-border/40" data-testid="score-breakdown-card">
      <CardHeader className="px-4 py-3 border-b border-border/30">
        <CardTitle className="text-[12px] font-semibold uppercase tracking-wider flex items-center gap-2 text-muted-foreground">
          <BarChart2 className="h-3.5 w-3.5 text-sky-400" />
          Score Breakdown
        </CardTitle>
        <p className="text-[10px] text-muted-foreground/70 mt-1">
          Deterministic values from scanner data · No AI weighting
        </p>
      </CardHeader>

      <CardContent className="px-4 py-4 space-y-3">
        {components.map((c) => (
          <div
            key={c.id}
            className="space-y-1"
            data-testid={`score-component-${c.id}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-foreground/80">
                {c.label}
              </span>
              {c.available ? (
                <span className={cn("text-[11px] font-mono font-semibold", labelColor(c.score))}>
                  {c.score}
                </span>
              ) : (
                <span className="text-[10px] text-muted-foreground/50 italic">N/A</span>
              )}
            </div>

            {/* Contribution bar */}
            <div className="h-1.5 bg-border/25 rounded-full overflow-hidden">
              {c.available ? (
                <div
                  className={cn("h-full rounded-full transition-all duration-500", barColor(c.score))}
                  style={{ width: `${c.score}%` }}
                  aria-label={`${c.label}: ${c.score} out of 100`}
                />
              ) : (
                <div className="h-full w-full bg-border/20 rounded-full" />
              )}
            </div>

            <p className="text-[9px] text-muted-foreground/50 leading-tight">{c.source}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
