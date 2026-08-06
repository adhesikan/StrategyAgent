// ResearchDecisionCard — Overall research thesis and posture display.
//
// Sprint 2.2.1: refined posture vocabulary to prevent bullish candidates
// from incorrectly displaying "Bearish" due to warning count alone.
//
// Posture vocabulary: Bullish | Constructive | Neutral | Defensive | Unrated | Bearish
// Bearish is ONLY returned when an explicit bearish market signal exists
// (e.g. RISK_OFF regime + weak technicals). Warnings alone reduce posture
// from Bullish to Constructive — they never reverse direction.

import { TrendingUp, TrendingDown, Minus, Shield, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ResearchPackage, EvidenceStars } from "../types";
import type { Thesis } from "./types";
import {
  computeTechnicalScore,
  computeRegimeScore,
  computeRiskScore,
} from "./score-breakdown-card";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Posture =
  | "bullish"
  | "constructive"
  | "neutral"
  | "defensive"
  | "unrated"
  | "bearish";

// ---------------------------------------------------------------------------
// Pure, exported helpers — deterministic, testable
// ---------------------------------------------------------------------------

/**
 * Derive the overall research thesis (3-way: bullish / neutral / bearish).
 * Used by the Trade Structure Engine and other downstream consumers.
 * FIXED: warning count alone no longer produces "bearish".
 * Bearish requires an explicit market-regime signal (RISK_OFF + weak tech).
 */
export function deriveThesis(
  pkg: Pick<ResearchPackage, "candidate" | "marketRegime">,
  _stars: EvidenceStars,
): Thesis {
  const tech = computeTechnicalScore(pkg.candidate);
  const { score: regime, available: regimeAvail } = computeRegimeScore(pkg.marketRegime);
  const risk = computeRiskScore(pkg.candidate);

  // Bearish ONLY with an explicit bearish market-regime signal
  if (pkg.marketRegime === "RISK_OFF" && tech < 65) return "bearish";

  // Bullish conditions
  if (tech >= 70 && (pkg.marketRegime === "TRENDING" || !regimeAvail) && risk >= 60) {
    return "bullish";
  }
  if (tech >= 70 && regime >= 70 && risk >= 60) return "bullish";

  return "neutral";
}

/**
 * Derive the display posture (6-way: richer vocabulary for the badge).
 * Rules:
 * - "bearish" only when RISK_OFF + weak technicals (explicit bearish signal)
 * - "defensive" when RISK_OFF but technicals remain acceptable
 * - "bullish" when base conditions are met and no active warnings
 * - "constructive" when bullish base conditions met but warnings reduce confidence
 * - "unrated" when confidence is absent and evidence is weak
 * - "neutral" otherwise
 */
export function derivePosture(
  pkg: Pick<ResearchPackage, "candidate" | "marketRegime">,
  _stars: EvidenceStars,
): Posture {
  const { candidate, marketRegime } = pkg;
  const tech = computeTechnicalScore(candidate);
  const { score: regime, available: regimeAvail } = computeRegimeScore(marketRegime);
  const risk = computeRiskScore(candidate);
  const warnCount = candidate.warnings.length;
  const hasConfidence = !!(candidate.confidence);

  // Bearish: explicit RISK_OFF signal + weak technicals
  if (marketRegime === "RISK_OFF" && tech < 65) return "bearish";

  // Defensive: RISK_OFF but technicals hold — warns but doesn't reverse
  if (marketRegime === "RISK_OFF") return "defensive";

  // Determine if the base directional thesis is positive.
  // Uses technicals + regime ONLY — warning count is handled separately below
  // and must NOT gate the directional determination (warnings reduce, not reverse).
  const isBullishBase =
    tech >= 70 && (marketRegime === "TRENDING" || !regimeAvail || regime >= 70);

  if (isBullishBase) {
    // Warnings reduce confidence but do NOT reverse direction
    if (warnCount >= 1) return "constructive";
    return "bullish";
  }

  // Choppy regime with multiple warnings → defensive posture
  if (marketRegime === "CHOPPY" && warnCount >= 2) return "defensive";

  // Missing confidence with weak technicals → unrated
  if (!hasConfidence && tech < 55) return "unrated";

  return "neutral";
}

/**
 * Build a concise, specific, deterministic thesis paragraph.
 * Includes: why qualified, rank, strategy, regime, warning count.
 * Uses only scanner-derived fields — no fabrication.
 */
export function buildThesisExplanation(pkg: ResearchPackage): string {
  const { candidate, marketRegime } = pkg;
  const strategy = candidate.strategy ?? null;
  const rank = candidate.rank;
  const primary =
    candidate.whySelected.length > 0
      ? candidate.whySelected[0]
      : null;

  // Part 1: why it qualified (preserve original casing from scanner output)
  let text = primary
    ? `${pkg.symbol} qualified because the scanner identified ${primary}.`
    : candidate.whySelected.length === 0
    ? "The available scanner output does not include a detailed qualification explanation."
    : `${pkg.symbol} qualified based on the scanner's deterministic criteria.`;

  // Part 2: rank + strategy
  if (strategy && rank != null) {
    text += ` It currently ranks #${rank} among qualified candidates within the ${strategy} setup.`;
  } else if (rank != null) {
    text += ` It currently ranks #${rank} among the latest qualified candidates.`;
  }

  // Part 3: market regime
  if (marketRegime === "TRENDING") {
    text += " It is being evaluated within a Strong Bull market regime.";
  } else if (marketRegime === "CHOPPY") {
    text += " It is being evaluated within a Choppy market regime — execution timing matters.";
  } else if (marketRegime === "RISK_OFF") {
    text += " Caution: it is being evaluated within a Risk-Off market regime.";
  } else if (!marketRegime) {
    text += " Market-regime context is unavailable.";
  }

  // Part 4: warnings
  const warnCount = candidate.warnings.length;
  if (warnCount >= 3) {
    text += ` ${warnCount} active warning flags reduce the strength of the current research posture.`;
  } else if (warnCount === 2) {
    text += " 2 scanner warning flags are present — review the Risk Summary.";
  } else if (warnCount === 1) {
    text += " 1 scanner warning flag is present.";
  }

  return text;
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

const POSTURE_CONFIG: Record<
  Posture,
  {
    label: string;
    icon: React.ElementType;
    badgeClass: string;
    textClass: string;
    borderClass: string;
  }
> = {
  bullish: {
    label: "Bullish",
    icon: TrendingUp,
    badgeClass: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10",
    textClass: "text-emerald-400",
    borderClass: "border-l-emerald-500",
  },
  constructive: {
    label: "Constructive",
    icon: TrendingUp,
    badgeClass: "text-sky-300 border-sky-500/40 bg-sky-500/10",
    textClass: "text-sky-400",
    borderClass: "border-l-sky-500",
  },
  neutral: {
    label: "Neutral",
    icon: Minus,
    badgeClass: "text-slate-300 border-slate-500/40 bg-slate-500/10",
    textClass: "text-slate-400",
    borderClass: "border-l-slate-500",
  },
  defensive: {
    label: "Defensive",
    icon: Shield,
    badgeClass: "text-amber-300 border-amber-500/40 bg-amber-500/10",
    textClass: "text-amber-400",
    borderClass: "border-l-amber-500",
  },
  unrated: {
    label: "Unrated",
    icon: Minus,
    badgeClass: "text-muted-foreground border-border/40 bg-muted/20",
    textClass: "text-muted-foreground",
    borderClass: "border-l-border",
  },
  bearish: {
    label: "Bearish",
    icon: TrendingDown,
    badgeClass: "text-rose-300 border-rose-500/40 bg-rose-500/10",
    textClass: "text-rose-400",
    borderClass: "border-l-rose-500",
  },
};

const CONFIDENCE_COLOR: Record<string, string> = {
  high:   "text-emerald-400 border-emerald-500/40",
  medium: "text-amber-400 border-amber-500/40",
  low:    "text-rose-400 border-rose-500/40",
};

// ---------------------------------------------------------------------------
// ResearchDecisionCard
// ---------------------------------------------------------------------------

interface ResearchDecisionCardProps {
  pkg: ResearchPackage;
  stars: EvidenceStars;
}

export function ResearchDecisionCard({ pkg, stars }: ResearchDecisionCardProps) {
  const posture = derivePosture(pkg, stars);
  const explanation = buildThesisExplanation(pkg);
  const config = POSTURE_CONFIG[posture];
  const Icon = config.icon;
  const confKey = (pkg.candidate.confidence ?? "").toLowerCase();
  const confClass = CONFIDENCE_COLOR[confKey] ?? "text-muted-foreground border-border/40";

  const warnCount = pkg.candidate.warnings.length;

  return (
    <Card
      className={cn("border-border/40 border-l-2", config.borderClass)}
      data-testid="research-decision-card"
    >
      <CardHeader className="px-4 py-3 border-b border-border/30">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-[12px] font-semibold uppercase tracking-wider flex items-center gap-2 text-muted-foreground">
            <Shield className="h-3.5 w-3.5 text-violet-400" />
            Research Thesis
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Posture badge */}
            <Badge
              variant="outline"
              className={cn("gap-1 font-semibold text-[11px]", config.badgeClass)}
              data-testid="thesis-badge"
            >
              <Icon className="h-3 w-3" />
              {config.label}
            </Badge>
            {/* Confidence badge */}
            {pkg.candidate.confidence && (
              <Badge
                variant="outline"
                className={cn("text-[10px] capitalize", confClass)}
                data-testid="thesis-confidence"
              >
                {pkg.candidate.confidence} confidence
              </Badge>
            )}
            {/* Warning count badge — only when warnings present */}
            {warnCount > 0 && (
              <Badge
                variant="outline"
                className="text-[10px] text-amber-400 border-amber-500/30 bg-amber-500/8 gap-1"
                data-testid="thesis-warning-count"
              >
                <AlertTriangle className="h-2.5 w-2.5" />
                {warnCount} flag{warnCount !== 1 ? "s" : ""}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-4 py-3">
        <p
          className="text-[12px] text-foreground/80 leading-relaxed"
          data-testid="thesis-explanation"
        >
          {explanation}
        </p>
        <p className="text-[10px] text-muted-foreground/60 mt-2 leading-relaxed">
          Research posture derived from deterministic scanner output only.
          Educational research — not investment advice.
        </p>
      </CardContent>
    </Card>
  );
}
