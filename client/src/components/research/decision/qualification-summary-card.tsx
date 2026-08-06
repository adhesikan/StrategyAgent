// QualificationSummaryCard — explains why this candidate qualified and ranked.
// Covers: qualified strategy, supporting criteria, score, confirmations.
// All data is deterministic from scanner output.

import { CheckCircle2, MinusCircle, XCircle, HelpCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ResearchPackage } from "../types";
import type { QualificationConfirmation } from "./types";

// ---------------------------------------------------------------------------
// Pure, exported helpers
// ---------------------------------------------------------------------------

/**
 * Build the qualification confirmation statuses.
 * Each item answers: is this signal confirmed, partial, missing, or unavailable?
 */
export function buildQualificationConfirmations(
  pkg: ResearchPackage,
): QualificationConfirmation[] {
  const { candidate, marketRegime } = pkg;
  const whyText = candidate.whySelected.join(" ").toLowerCase();
  const strategy = (candidate.strategy ?? "").toUpperCase();

  // Market Regime Alignment
  const regimeStatus: QualificationConfirmation["status"] =
    !marketRegime
      ? "unavailable"
      : marketRegime === "TRENDING"
      ? "confirmed"
      : marketRegime === "CHOPPY"
      ? "partial"
      : "missing"; // RISK_OFF

  const regimeDetail =
    !marketRegime
      ? "Market regime data not available for this scan"
      : marketRegime === "TRENDING"
      ? "Broad market in uptrend — favorable alignment"
      : marketRegime === "CHOPPY"
      ? "Choppy market — setup requires patience"
      : "Risk-off market — headwinds for long setups";

  // Volume Confirmation
  const hasVolume = whyText.includes("volume");
  const hasDry = whyText.includes("dry") || whyText.includes("contraction");
  const hasSurge = whyText.includes("surge") || whyText.includes("expansion");
  const volumeStatus: QualificationConfirmation["status"] = candidate.whySelected.length === 0
    ? "unavailable"
    : hasVolume && (hasDry || hasSurge)
    ? "confirmed"
    : hasVolume
    ? "partial"
    : "missing";

  const volumeDetail = candidate.whySelected.length === 0
    ? "Scanner criteria not available"
    : hasVolume && hasDry
    ? "Volume contraction (dry-up) identified — base building signal"
    : hasVolume && hasSurge
    ? "Volume surge/expansion identified — participation signal"
    : hasVolume
    ? "Volume referenced in scanner criteria — qualification detail"
    : "Volume signal not present in scanner criteria";

  // Trend Confirmation
  const trendStatus: QualificationConfirmation["status"] = !marketRegime
    ? "unavailable"
    : marketRegime === "TRENDING" && (strategy.includes("VCP") || strategy.includes("SWING") || strategy.includes("PULLBACK"))
    ? "confirmed"
    : marketRegime === "TRENDING"
    ? "partial"
    : strategy.includes("INTRADAY") || strategy.includes("ORB")
    ? "partial"   // intraday doesn't need macro trend
    : "missing";

  const trendDetail = !marketRegime
    ? "Trend data unavailable"
    : marketRegime === "TRENDING" && trendStatus === "confirmed"
    ? `${strategy} pattern in uptrend — both align`
    : marketRegime === "TRENDING"
    ? "Market uptrend present — strategy alignment partial"
    : "Market trend not favorable for setup type";

  // Momentum Confirmation
  const hasMomentum =
    whyText.includes("momentum") ||
    whyText.match(/\brs\b/) ||
    whyText.includes("relative strength") ||
    whyText.includes("outperform");
  const momentumStatus: QualificationConfirmation["status"] = candidate.whySelected.length === 0
    ? "unavailable"
    : hasMomentum && (candidate.confidence ?? "").toLowerCase() === "high"
    ? "confirmed"
    : hasMomentum
    ? "partial"
    : (candidate.confidence ?? "").toLowerCase() === "high"
    ? "partial"
    : "missing";

  const momentumDetail = hasMomentum && momentumStatus === "confirmed"
    ? "Relative strength / momentum confirmed in scanner criteria with high confidence"
    : hasMomentum
    ? "Momentum signal present — confidence below high threshold"
    : (candidate.confidence ?? "").toLowerCase() === "high"
    ? "High confidence pattern — momentum implied by setup quality"
    : "No explicit momentum signal in scanner criteria";

  return [
    {
      id: "market-regime",
      label: "Market Regime Alignment",
      status: regimeStatus,
      detail: regimeDetail,
    },
    {
      id: "volume",
      label: "Volume Confirmation",
      status: volumeStatus,
      detail: volumeDetail,
    },
    {
      id: "trend",
      label: "Trend Confirmation",
      status: trendStatus,
      detail: trendDetail,
    },
    {
      id: "momentum",
      label: "Momentum Confirmation",
      status: momentumStatus,
      detail: momentumDetail,
    },
  ];
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

const STATUS_CONFIG = {
  confirmed: {
    icon: CheckCircle2,
    className: "text-emerald-400",
    badge: "text-emerald-300 border-emerald-500/30 bg-emerald-500/8",
    label: "Confirmed",
  },
  partial: {
    icon: MinusCircle,
    className: "text-amber-400",
    badge: "text-amber-300 border-amber-500/30 bg-amber-500/8",
    label: "Partial",
  },
  missing: {
    icon: XCircle,
    className: "text-rose-400",
    badge: "text-rose-300 border-rose-500/30 bg-rose-500/8",
    label: "Missing",
  },
  unavailable: {
    icon: HelpCircle,
    className: "text-muted-foreground/50",
    badge: "text-muted-foreground border-border/30",
    label: "N/A",
  },
} as const;

// ---------------------------------------------------------------------------
// QualificationSummaryCard
// ---------------------------------------------------------------------------

interface QualificationSummaryCardProps {
  pkg: ResearchPackage;
}

export function QualificationSummaryCard({ pkg }: QualificationSummaryCardProps) {
  const { candidate } = pkg;
  const confirmations = buildQualificationConfirmations(pkg);

  // Derive the display score
  const displayScore =
    candidate.strategyScore != null
      ? Math.round(candidate.strategyScore)
      : null;

  // Supporting criteria (whySelected reframed)
  const supportingCriteria = candidate.whySelected.slice(0, 5);
  const hasWarnings = candidate.warnings.length > 0;

  return (
    <Card className="border-border/40" data-testid="qualification-summary-card">
      <CardHeader className="px-4 py-3 border-b border-border/30">
        <CardTitle className="text-[12px] font-semibold uppercase tracking-wider flex items-center gap-2 text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
          Qualification Summary
        </CardTitle>
        <p className="text-[10px] text-muted-foreground/70 mt-0.5">
          Why this candidate qualified and why it ranked here
        </p>
      </CardHeader>

      <CardContent className="px-4 py-4 space-y-5">
        {/* Strategy block */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div data-testid="qual-strategy">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-1.5">
              Qualified Strategy
            </div>
            <Badge
              variant="outline"
              className="text-[11px] border-primary/40 text-primary bg-primary/5"
            >
              {candidate.strategy ?? "Not specified"}
            </Badge>
          </div>

          <div data-testid="qual-supporting-criteria">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-1.5">
              Supporting Criteria
            </div>
            {supportingCriteria.length > 0 ? (
              <ul className="space-y-1">
                {supportingCriteria.map((c, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0 mt-0.5" />
                    <span className="text-[11px] text-foreground/80 leading-tight">{c}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-[11px] text-muted-foreground italic">Not available.</span>
            )}
          </div>

          <div data-testid="qual-score">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-1.5">
              Scanner Score
            </div>
            {displayScore != null ? (
              <div className="space-y-1">
                <span className="text-2xl font-mono font-bold text-foreground">
                  {displayScore}
                </span>
                <div className="text-[10px] text-muted-foreground">
                  Rank #{candidate.rank}
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <span className="text-[11px] text-muted-foreground italic">Not available.</span>
                <div className="text-[10px] text-muted-foreground">
                  Rank #{candidate.rank}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Rejected strategies — honest N/A */}
        <div data-testid="qual-rejected">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-1">
            Rejected Strategies
          </div>
          <p className="text-[11px] text-muted-foreground/60 italic">
            Not available — scanner returns qualified candidates only.
          </p>
        </div>

        {/* Warning flags */}
        {hasWarnings && (
          <div
            className="rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 space-y-1"
            data-testid="qual-warnings"
          >
            <div className="text-[10px] uppercase tracking-widest text-amber-400 font-medium">
              Scanner Warning Flags
            </div>
            {candidate.warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <XCircle className="h-3 w-3 text-amber-400 shrink-0 mt-0.5" />
                <span className="text-[11px] text-foreground/80">{w}</span>
              </div>
            ))}
          </div>
        )}

        {/* Confirmation grid */}
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-2">
            Signal Confirmations
          </div>
          <div className="space-y-2">
            {confirmations.map((conf) => {
              const cfg = STATUS_CONFIG[conf.status];
              const Icon = cfg.icon;
              return (
                <div
                  key={conf.id}
                  className="flex items-start gap-2.5"
                  data-testid={`confirmation-${conf.id}`}
                >
                  <Icon className={cn("h-3.5 w-3.5 shrink-0 mt-0.5", cfg.className)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-foreground/80">
                        {conf.label}
                      </span>
                      <Badge
                        variant="outline"
                        className={cn("text-[9px] uppercase tracking-wide px-1.5 py-0", cfg.badge)}
                      >
                        {cfg.label}
                      </Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed mt-0.5">
                      {conf.detail}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
