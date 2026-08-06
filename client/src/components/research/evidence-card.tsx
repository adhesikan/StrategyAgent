// EvidenceCard — Compact evidence signal summary for the Overview tab.
// Reuses EvidenceStars computed by the page. Provides a quick visual
// summary of all 6 evidence providers using dot-bar indicators.
//
// Sprint 2.2.1: renamed to "Evidence Strength", added numeric score display
// (e.g. "72 / 100") beside each category using deterministic score mappings.
// Scores sourced from computeScoreComponents — no fabrication.

import {
  BarChart2,
  Activity,
  Landmark,
  Newspaper,
  Zap,
  Building2,
  ExternalLink,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { EvidenceStars, ResearchPackage } from "./types";
import {
  computeTechnicalScore,
  computeRegimeScore,
} from "./decision/score-breakdown-card";

// ---------------------------------------------------------------------------
// Pure, exported helpers — deterministic, testable
// ---------------------------------------------------------------------------

/** Maps a star count (0–5) to a human-readable signal label. */
export function evidenceSignalLabel(stars: number): string {
  if (stars === 0) return "Unavailable";
  if (stars >= 5) return "Strong";
  if (stars >= 4) return "Solid";
  if (stars >= 3) return "Moderate";
  if (stars >= 2) return "Limited";
  return "Weak";
}

/** Maps a star count (0–5) to a Tailwind color class for the filled segment. */
export function evidenceSignalClass(stars: number): string {
  if (stars === 0) return "bg-border/40";
  if (stars >= 4) return "bg-emerald-400";
  if (stars >= 3) return "bg-sky-400";
  if (stars >= 2) return "bg-amber-400";
  return "bg-rose-400";
}

/** Maps a star count (0–5) to a text color class for the label. */
export function evidenceSignalTextClass(stars: number): string {
  if (stars === 0) return "text-muted-foreground/50";
  if (stars >= 4) return "text-emerald-400";
  if (stars >= 3) return "text-sky-400";
  if (stars >= 2) return "text-amber-400";
  return "text-rose-400";
}

/**
 * Compute the numeric score (0–100) for each evidence category.
 * Uses the same deterministic mappings as computeScoreComponents.
 * Returns null for institutional (always N/A).
 */
export function computeEvidenceNumericScores(
  stars: EvidenceStars,
  pkg?: Pick<ResearchPackage, "candidate" | "marketRegime">,
): Record<keyof EvidenceStars, number | null> {
  const techScore = pkg ? computeTechnicalScore(pkg.candidate) : stars.technical * 20;
  const regimeResult = pkg
    ? computeRegimeScore(pkg.marketRegime)
    : { score: stars.regime * 20, available: stars.regime > 0 };

  return {
    technical: techScore,
    regime: regimeResult.available ? regimeResult.score : null,
    news: stars.news * 20,
    congress: stars.congress * 20,
    catalysts: Math.round(stars.catalysts * (100 / 3)),
    institutional: null,  // always N/A
  };
}

// ---------------------------------------------------------------------------
// Sub-component: signal row
// ---------------------------------------------------------------------------

interface SignalRowProps {
  icon: React.ElementType;
  label: string;
  stars: number;
  maxStars?: number;
  numericScore?: number | null;
  "data-testid"?: string;
}

function SignalRow({
  icon: Icon,
  label,
  stars,
  maxStars = 5,
  numericScore,
  "data-testid": tid,
}: SignalRowProps) {
  const filledClass = evidenceSignalClass(stars);
  const textClass = evidenceSignalTextClass(stars);
  const signalLabel = evidenceSignalLabel(stars);
  const isUnavailable = stars === 0;

  const scoreDisplay =
    numericScore !== undefined
      ? numericScore === null
        ? "N/A"
        : `${numericScore} / 100`
      : null;

  return (
    <div
      className="flex items-center gap-2 py-1.5 border-b border-border/20 last:border-0"
      data-testid={tid}
      role="row"
      aria-label={`${label}: ${isUnavailable ? "unavailable" : signalLabel}${scoreDisplay ? `, score ${scoreDisplay}` : ""}`}
    >
      <Icon className="h-3 w-3 text-muted-foreground/60 shrink-0" aria-hidden="true" />
      <span className="text-[11px] font-medium w-[80px] shrink-0 text-foreground/80">
        {label}
      </span>

      {isUnavailable ? (
        <>
          <span className="text-[10px] text-muted-foreground/50 italic flex-1">unavailable</span>
          {scoreDisplay !== null && (
            <span className="text-[10px] text-muted-foreground/40 font-mono ml-auto shrink-0">
              {scoreDisplay}
            </span>
          )}
        </>
      ) : (
        <>
          {/* Dot indicators */}
          <div className="flex gap-0.5 items-center" aria-hidden="true">
            {Array.from({ length: maxStars }, (_, i) => (
              <div
                key={i}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i < stars ? cn(filledClass, "w-3") : "bg-border/30 w-1.5",
                )}
              />
            ))}
          </div>
          {/* Text label (visible without color) */}
          <span className={cn("text-[10px] font-medium", textClass)}>
            {signalLabel}
          </span>
          {/* Numeric score */}
          {scoreDisplay !== null && (
            <span
              className="text-[10px] text-muted-foreground/60 font-mono ml-auto shrink-0"
              data-testid={`score-${tid}`}
            >
              {scoreDisplay}
            </span>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EvidenceCard
// ---------------------------------------------------------------------------

interface EvidenceCardProps {
  stars: EvidenceStars;
  completedAt: string;
  onViewEvidence: () => void;
  onViewCongress: () => void;
  /** Optional: supply pkg to compute deterministic numeric scores. */
  pkg?: Pick<ResearchPackage, "candidate" | "marketRegime">;
}

export function EvidenceCard({
  stars,
  completedAt,
  onViewEvidence,
  onViewCongress,
  pkg,
}: EvidenceCardProps) {
  const scanTime = (() => {
    try {
      const diffMs = Date.now() - new Date(completedAt).getTime();
      const diffMin = Math.floor(diffMs / 60_000);
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHr = Math.floor(diffMin / 60);
      if (diffHr < 24) return `${diffHr}h ago`;
      return `${Math.floor(diffHr / 24)}d ago`;
    } catch {
      return "—";
    }
  })();

  const numericScores = computeEvidenceNumericScores(stars, pkg);

  return (
    <Card className="border-border/40 h-full" data-testid="evidence-card">
      <CardHeader className="px-4 py-3 border-b border-border/30">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
            Evidence Strength
          </CardTitle>
          <span className="text-[10px] text-muted-foreground/60" aria-label={`Scan time: ${scanTime}`}>
            {scanTime}
          </span>
        </div>
      </CardHeader>

      <CardContent className="px-4 py-3 space-y-0" role="table" aria-label="Evidence signal scores">
        <SignalRow
          icon={BarChart2}
          label="Technical"
          stars={stars.technical}
          numericScore={numericScores.technical}
          data-testid="evidence-signal-technical"
        />
        <SignalRow
          icon={Activity}
          label="Regime"
          stars={stars.regime}
          numericScore={numericScores.regime}
          data-testid="evidence-signal-regime"
        />
        <SignalRow
          icon={Landmark}
          label="Congress"
          stars={stars.congress}
          numericScore={numericScores.congress}
          data-testid="evidence-signal-congress"
        />
        <SignalRow
          icon={Newspaper}
          label="News"
          stars={stars.news}
          numericScore={numericScores.news}
          data-testid="evidence-signal-news"
        />
        <SignalRow
          icon={Zap}
          label="Catalysts"
          stars={stars.catalysts}
          maxStars={3}
          numericScore={numericScores.catalysts}
          data-testid="evidence-signal-catalysts"
        />
        <SignalRow
          icon={Building2}
          label="Institutional"
          stars={stars.institutional}
          numericScore={numericScores.institutional}
          data-testid="evidence-signal-institutional"
        />
      </CardContent>

      <div className="px-4 pb-3 pt-0 flex flex-col gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-[11px] justify-start gap-1.5 text-muted-foreground hover:text-foreground px-1"
          onClick={onViewEvidence}
          data-testid="btn-evidence-open-technical"
          aria-label="Open full technical evidence"
        >
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
          Open Full Evidence
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-[11px] justify-start gap-1.5 text-muted-foreground hover:text-foreground px-1"
          onClick={onViewCongress}
          data-testid="btn-evidence-open-congress"
          aria-label="Open congressional disclosures"
        >
          <Landmark className="h-3 w-3" aria-hidden="true" />
          Congress Disclosures
        </Button>
      </div>
    </Card>
  );
}
