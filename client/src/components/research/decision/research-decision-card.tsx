// ResearchDecisionCard — Overall research thesis display.
// Shows Bullish / Neutral / Bearish thesis derived deterministically
// from scanner data. No AI inference. No investment advice.

import { TrendingUp, TrendingDown, Minus, Shield } from "lucide-react";
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
// Pure, exported helpers — deterministic, testable
// ---------------------------------------------------------------------------

/**
 * Derive the overall research thesis from scanner data.
 * Rules are entirely deterministic — no AI weighting.
 *
 * BULLISH:  technical >= 70 AND regime is TRENDING AND risk >= 60
 * BEARISH:  regime is RISK_OFF with weak technicals,  OR  3+ warnings
 * NEUTRAL:  all other cases
 */
export function deriveThesis(
  pkg: Pick<ResearchPackage, "candidate" | "marketRegime">,
  _stars: EvidenceStars,
): Thesis {
  const tech = computeTechnicalScore(pkg.candidate);
  const { score: regime, available: regimeAvail } = computeRegimeScore(pkg.marketRegime);
  const risk = computeRiskScore(pkg.candidate);
  const warnCount = pkg.candidate.warnings.length;

  // Bearish conditions (checked first — safety matters more)
  if (warnCount >= 3) return "bearish";
  if (pkg.marketRegime === "RISK_OFF" && tech < 65) return "bearish";

  // Bullish conditions
  if (tech >= 70 && (pkg.marketRegime === "TRENDING" || (!regimeAvail)) && risk >= 60) {
    return "bullish";
  }
  if (tech >= 70 && regime >= 70 && risk >= 60) return "bullish";

  return "neutral";
}

/**
 * Build a short, deterministic thesis explanation (1–2 sentences).
 * Uses only scanner-derived text — no fabrication.
 */
export function buildThesisExplanation(pkg: ResearchPackage): string {
  const { candidate, marketRegime } = pkg;
  const strategy = candidate.strategy ?? "a technical setup";
  const primary = candidate.whySelected[0] ?? "scanner pattern identification";
  const conf = candidate.confidence ? `${candidate.confidence} confidence` : "unrated confidence";

  const regimePart =
    marketRegime === "TRENDING"
      ? "The broad market is in an uptrend, historically favorable for long setups."
      : marketRegime === "RISK_OFF"
      ? "Caution: the broad market is in a risk-off posture."
      : marketRegime === "CHOPPY"
      ? "The broad market is choppy — execution timing matters."
      : "";

  const warnPart =
    candidate.warnings.length > 0
      ? ` Note: ${candidate.warnings.length} scanner warning flag${candidate.warnings.length > 1 ? "s" : ""} present — see Invalidation section.`
      : "";

  return (
    `This candidate qualified primarily because of ${primary}, with ${conf} in the ${strategy} pattern.` +
    (regimePart ? " " + regimePart : "") +
    warnPart
  );
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

const THESIS_CONFIG: Record<
  Thesis,
  { label: string; icon: React.ElementType; badgeClass: string; textClass: string; borderClass: string }
> = {
  bullish: {
    label: "Bullish",
    icon: TrendingUp,
    badgeClass: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10",
    textClass: "text-emerald-400",
    borderClass: "border-l-emerald-500",
  },
  neutral: {
    label: "Neutral",
    icon: Minus,
    badgeClass: "text-sky-300 border-sky-500/40 bg-sky-500/10",
    textClass: "text-sky-400",
    borderClass: "border-l-sky-500",
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
  const thesis = deriveThesis(pkg, stars);
  const explanation = buildThesisExplanation(pkg);
  const config = THESIS_CONFIG[thesis];
  const Icon = config.icon;
  const confKey = (pkg.candidate.confidence ?? "").toLowerCase();
  const confClass = CONFIDENCE_COLOR[confKey] ?? "text-muted-foreground border-border/40";

  return (
    <Card
      className={cn(
        "border-border/40 border-l-2",
        config.borderClass,
      )}
      data-testid="research-decision-card"
    >
      <CardHeader className="px-4 py-3 border-b border-border/30">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-[12px] font-semibold uppercase tracking-wider flex items-center gap-2 text-muted-foreground">
            <Shield className="h-3.5 w-3.5 text-violet-400" />
            Research Thesis
          </CardTitle>
          <div className="flex items-center gap-2">
            {/* Thesis badge */}
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
          Thesis derived from deterministic scanner output only.
          Educational research — not investment advice.
        </p>
      </CardContent>
    </Card>
  );
}
