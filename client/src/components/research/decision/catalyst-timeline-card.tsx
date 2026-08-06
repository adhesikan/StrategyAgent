// CatalystTimelineCard — improvement opportunities + active warnings.
// Answers "What would improve this candidate?" and highlights current risk flags.
// All items are deterministic from scanner data. No fabrication.

import { TrendingUp, AlertTriangle, CheckCircle2, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ResearchPackage, EvidenceStars, MarketSnapshot } from "../types";
import type { ImprovementItem, WarningItem } from "./types";
import { computeTechnicalScore, computeVolumeScore } from "./score-breakdown-card";

// ---------------------------------------------------------------------------
// Pure, exported helpers
// ---------------------------------------------------------------------------

/** Build improvement suggestions based on the candidate's current gaps. */
export function buildImprovementItems(
  pkg: ResearchPackage,
  stars: EvidenceStars,
): ImprovementItem[] {
  const { candidate, marketRegime } = pkg;
  const items: ImprovementItem[] = [];

  // 1. Volume
  const volScore = computeVolumeScore(candidate);
  if (volScore < 60) {
    items.push({
      id: "volume",
      category: "Volume",
      text: "Higher confirmed volume on the breakout or pivot would strengthen the setup signal.",
    });
  }

  // 2. Regime
  if (marketRegime !== "TRENDING") {
    items.push({
      id: "regime",
      category: "Market Regime",
      text:
        marketRegime === "RISK_OFF"
          ? "A broad market shift out of risk-off mode would materially improve setup alignment."
          : "A broad market transition to a confirmed uptrend would improve macro alignment.",
    });
  }

  // 3. Technical / confidence
  const techScore = computeTechnicalScore(candidate);
  if (techScore < 70) {
    items.push({
      id: "confidence",
      category: "Pattern Completion",
      text: "Pattern completion closer to ideal criteria (higher scanner confidence rating) would increase technical score.",
    });
  }

  // 4. Relative Strength
  const whyText = candidate.whySelected.join(" ").toLowerCase();
  if (!whyText.includes("relative strength") && !whyText.match(/\brs\b/)) {
    items.push({
      id: "relative-strength",
      category: "Relative Strength",
      text: "Improved relative strength versus the broad market index would add a key confirmation signal.",
    });
  }

  // 5. Risk / Reward
  if (candidate.rewardRisk != null && candidate.rewardRisk < 2) {
    items.push({
      id: "reward-risk",
      category: "Risk / Reward",
      text: "A tighter entry zone or wider objective would improve the risk/reward ratio above the 2:1 threshold.",
    });
  } else if (candidate.rewardRisk == null) {
    items.push({
      id: "reward-risk",
      category: "Risk / Reward",
      text: "Identifying a clearer price target would allow risk/reward calculation and improve planning quality.",
    });
  }

  // 6. Warning flags
  if (candidate.warnings.length > 0) {
    items.push({
      id: "warnings",
      category: "Risk Flags",
      text: `Reduction of scanner warning flags (currently ${candidate.warnings.length}) would strengthen the candidate quality score.`,
    });
  }

  // 7. News coverage
  if (stars.news < 3) {
    items.push({
      id: "news",
      category: "News Coverage",
      text: "Increased news and analyst coverage would improve the sentiment signal for this symbol.",
    });
  }

  // Return at most 5 most impactful
  return items.slice(0, 5);
}

/** Build warning items from scanner warnings and market events. */
export function buildWarningItems(
  pkg: ResearchPackage,
  snapshot?: MarketSnapshot,
): WarningItem[] {
  const { candidate, marketRegime } = pkg;
  const items: WarningItem[] = [];
  const warnText = candidate.warnings.join(" ").toLowerCase();

  // Scanner warnings → high severity
  candidate.warnings.forEach((w, i) => {
    items.push({
      id: `scanner-${i}`,
      severity: "high",
      text: w,
    });
  });

  // Market regime headwinds
  if (marketRegime === "RISK_OFF") {
    items.push({
      id: "regime-risk-off",
      severity: "high",
      text: "Broad market in risk-off posture — historically unfavorable for new long entries.",
    });
  } else if (marketRegime === "CHOPPY") {
    items.push({
      id: "regime-choppy",
      severity: "medium",
      text: "Broad market is choppy — entry timing and position sizing discipline are critical.",
    });
  }

  // Earnings
  if (warnText.includes("earn") || warnText.includes("eps") || warnText.includes("report")) {
    items.push({
      id: "earnings",
      severity: "high",
      text: "Upcoming earnings event flagged by scanner. Verify exact date — binary gap risk.",
    });
  }

  // Liquidity
  if (warnText.includes("liquid") || warnText.includes("spread") || warnText.includes("thin")) {
    items.push({
      id: "liquidity",
      severity: "medium",
      text: "Low liquidity or wide bid-ask spread flagged. Verify with your broker before entry.",
    });
  }

  // Sector weakness from high-impact news
  const highImpact = (snapshot?.topNews ?? []).filter((n) => n.impact === "high");
  if (highImpact.length > 0) {
    items.push({
      id: "market-events",
      severity: "medium",
      text: `High-impact market event(s): ${highImpact.map((n) => n.label ?? n.symbol).slice(0, 2).join("; ")}.`,
    });
  }

  // Deduplicate by id, return at most 6
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).slice(0, 6);
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

const SEVERITY_CONFIG = {
  high:   { class: "text-rose-400",   badgeClass: "text-rose-300 border-rose-500/30 bg-rose-500/8" },
  medium: { class: "text-amber-400",  badgeClass: "text-amber-300 border-amber-500/30 bg-amber-500/8" },
  low:    { class: "text-sky-400",    badgeClass: "text-sky-300 border-sky-500/30 bg-sky-500/8" },
};

// ---------------------------------------------------------------------------
// CatalystTimelineCard
// ---------------------------------------------------------------------------

interface CatalystTimelineCardProps {
  pkg: ResearchPackage;
  stars: EvidenceStars;
  snapshot?: MarketSnapshot;
}

export function CatalystTimelineCard({ pkg, stars, snapshot }: CatalystTimelineCardProps) {
  const improvements = buildImprovementItems(pkg, stars);
  const warnings = buildWarningItems(pkg, snapshot);

  return (
    <Card className="border-border/40" data-testid="catalyst-timeline-card">
      <CardHeader className="px-4 py-3 border-b border-border/30">
        <CardTitle className="text-[12px] font-semibold uppercase tracking-wider flex items-center gap-2 text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-amber-400" />
          Improvements &amp; Warnings
        </CardTitle>
        <p className="text-[10px] text-muted-foreground/70 mt-0.5">
          What would strengthen this candidate · Current risk flags
        </p>
      </CardHeader>

      <CardContent className="px-4 py-4 space-y-5">
        {/* --- Improvement Opportunities --- */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-[11px] font-semibold text-foreground/80 uppercase tracking-wide">
              What Would Improve This Candidate
            </span>
          </div>

          {improvements.length === 0 ? (
            <div className="flex items-center gap-2 text-[11px] text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              No significant improvement gaps identified from scanner data.
            </div>
          ) : (
            <ul className="space-y-2" data-testid="improvement-list">
              {improvements.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start gap-2 rounded border border-border/25 bg-card/20 px-3 py-2"
                  data-testid={`improvement-${item.id}`}
                >
                  <TrendingUp className="h-3 w-3 text-emerald-400/70 shrink-0 mt-0.5" />
                  <div>
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                      {item.category}:{" "}
                    </span>
                    <span className="text-[11px] text-foreground/80">{item.text}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* --- Warnings --- */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-[11px] font-semibold text-foreground/80 uppercase tracking-wide">
              Active Warnings
            </span>
          </div>

          {warnings.length === 0 ? (
            <div className="flex items-center gap-2 text-[11px] text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              No scanner warnings or market risk flags for this candidate.
            </div>
          ) : (
            <ul className="space-y-1.5" data-testid="warning-list">
              {warnings.map((w) => {
                const scfg = SEVERITY_CONFIG[w.severity];
                return (
                  <li
                    key={w.id}
                    className="flex items-start gap-2"
                    data-testid={`warning-${w.id}`}
                  >
                    <AlertTriangle className={cn("h-3.5 w-3.5 shrink-0 mt-0.5", scfg.class)} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] text-foreground/80 leading-relaxed">
                          {w.text}
                        </span>
                        <Badge
                          variant="outline"
                          className={cn("text-[9px] uppercase px-1.5 py-0 shrink-0", scfg.badgeClass)}
                        >
                          {w.severity}
                        </Badge>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
