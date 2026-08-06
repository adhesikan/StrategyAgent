// EvidenceCard — Compact evidence signal summary for the Overview tab.
// Reuses EvidenceStars computed by the page. Provides a quick visual
// summary of all 6 evidence providers. Each signal uses a dot-bar
// indicator rather than literal stars to match institutional aesthetics.

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
import type { EvidenceStars } from "./types";

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

// ---------------------------------------------------------------------------
// Sub-component: signal row
// ---------------------------------------------------------------------------

interface SignalRowProps {
  icon: React.ElementType;
  label: string;
  stars: number;
  maxStars?: number;
  "data-testid"?: string;
}

function SignalRow({ icon: Icon, label, stars, maxStars = 5, "data-testid": tid }: SignalRowProps) {
  const filledClass = evidenceSignalClass(stars);
  const textClass = evidenceSignalTextClass(stars);
  const signalLabel = evidenceSignalLabel(stars);
  const isUnavailable = stars === 0;

  return (
    <div
      className="flex items-center gap-2 py-1.5 border-b border-border/20 last:border-0"
      data-testid={tid}
    >
      <Icon className="h-3 w-3 text-muted-foreground/60 shrink-0" />
      <span className="text-[11px] font-medium w-[88px] shrink-0 text-foreground/80">
        {label}
      </span>

      {isUnavailable ? (
        <span className="text-[10px] text-muted-foreground/50 italic">unavailable</span>
      ) : (
        <>
          {/* Dot indicators */}
          <div className="flex gap-0.5 items-center">
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
          {/* Label */}
          <span className={cn("text-[10px] font-medium ml-auto", textClass)}>
            {signalLabel}
          </span>
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
}

export function EvidenceCard({
  stars,
  completedAt,
  onViewEvidence,
  onViewCongress,
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

  return (
    <Card className="border-border/40 h-full" data-testid="evidence-card">
      <CardHeader className="px-4 py-3 border-b border-border/30">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
            Evidence Signals
          </CardTitle>
          <span className="text-[10px] text-muted-foreground/60">{scanTime}</span>
        </div>
      </CardHeader>

      <CardContent className="px-4 py-3 space-y-0">
        <SignalRow
          icon={BarChart2}
          label="Technical"
          stars={stars.technical}
          data-testid="evidence-signal-technical"
        />
        <SignalRow
          icon={Activity}
          label="Regime"
          stars={stars.regime}
          data-testid="evidence-signal-regime"
        />
        <SignalRow
          icon={Landmark}
          label="Congress"
          stars={stars.congress}
          data-testid="evidence-signal-congress"
        />
        <SignalRow
          icon={Newspaper}
          label="News"
          stars={stars.news}
          data-testid="evidence-signal-news"
        />
        <SignalRow
          icon={Zap}
          label="Catalysts"
          stars={stars.catalysts}
          maxStars={3}
          data-testid="evidence-signal-catalysts"
        />
        <SignalRow
          icon={Building2}
          label="Institutional"
          stars={stars.institutional}
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
        >
          <ExternalLink className="h-3 w-3" />
          Open Full Evidence
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-[11px] justify-start gap-1.5 text-muted-foreground hover:text-foreground px-1"
          onClick={onViewCongress}
          data-testid="btn-evidence-open-congress"
        >
          <Landmark className="h-3 w-3" />
          Congress Disclosures
        </Button>
      </div>
    </Card>
  );
}
