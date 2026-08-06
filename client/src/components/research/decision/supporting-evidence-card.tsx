// SupportingEvidenceCard — classifies each evidence section as
// Supports Thesis / Neutral / Weakens Thesis / Not Available.
// No AI inference. Alignment is determined from deterministic score thresholds.

import {
  TrendingUp,
  Activity,
  Landmark,
  Building2,
  Newspaper,
  Zap,
  BarChart2,
  CheckCircle2,
  Minus,
  TrendingDown,
  HelpCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ResearchPackage, EvidenceStars, MarketSnapshot } from "../types";
import type { EvidenceAlignment, EvidenceSection } from "./types";
import {
  computeTechnicalScore,
  computeRegimeScore,
  computeFundamentalsScore,
} from "./score-breakdown-card";

// ---------------------------------------------------------------------------
// Pure, exported helpers
// ---------------------------------------------------------------------------

/** Classify a 0-100 score (or unavailable) into an alignment label. */
export function classifyEvidenceAlignment(
  score: number,
  available: boolean,
): EvidenceAlignment {
  if (!available) return "unavailable";
  if (score >= 65) return "supports";
  if (score >= 40) return "neutral";
  return "weakens";
}

/** Build all evidence sections with alignment classification. */
export function buildEvidenceSections(
  pkg: ResearchPackage,
  stars: EvidenceStars,
  snapshot?: MarketSnapshot,
): EvidenceSection[] {
  const { candidate, marketRegime } = pkg;
  const whyText = candidate.whySelected.join(" ").toLowerCase();

  // --- Technical ---
  const techScore = computeTechnicalScore(candidate);
  const techItems = candidate.whySelected.length > 0
    ? candidate.whySelected
    : [];
  const techGap = techScore < 65
    ? "Pattern confidence below high threshold or insufficient criteria count"
    : undefined;

  // --- Fundamentals ---
  const fundScore = computeFundamentalsScore(candidate);

  // --- Market Regime ---
  const { score: regimeScore, available: regimeAvail } = computeRegimeScore(marketRegime);
  const regimeItems = regimeAvail && marketRegime
    ? [`Market regime: ${marketRegime.replace("_", " ")}`]
    : [];
  const regimeGap = regimeAvail && marketRegime !== "TRENDING"
    ? `Regime is ${marketRegime} — less favorable for long setups`
    : undefined;

  // --- Congress ---
  const congressScore = stars.congress * 20;
  const congressItems = ["Congressional trading data available via CongressFlow"];
  const congressGap = stars.congress < 3
    ? "Limited congressional activity data for this symbol"
    : undefined;

  // --- Institutional ---
  // Always unavailable
  const instItems: string[] = [];

  // --- News ---
  const newsScore = stars.news * 20;
  const newsItems =
    newsScore >= 60
      ? [`${Math.round(stars.news)} of 5 news coverage signal`]
      : newsScore >= 40
      ? ["Limited news coverage indexed"]
      : [];
  const newsGap = newsScore < 40
    ? "Open the News tab to load article coverage"
    : undefined;

  // --- Catalysts ---
  const hasHighImpact = (snapshot?.topNews ?? []).some((n) => n.impact === "high");
  const catScore = candidate.warnings.length === 0 && !hasHighImpact
    ? 75
    : candidate.warnings.length >= 2 || hasHighImpact
    ? 35
    : 55;
  const catItems: string[] = [];
  if (candidate.warnings.length > 0) catItems.push(...candidate.warnings.slice(0, 2));
  if (hasHighImpact) catItems.push("High-impact market event active");
  const catGap = catScore < 65 ? "Risk flags or market events reduce catalyst alignment" : undefined;

  // Volume item for technical context
  const volItems = whyText.includes("volume")
    ? ["Volume pattern identified in scanner criteria"]
    : [];

  return [
    {
      id: "technical",
      label: "Technical Evidence",
      score: techScore,
      available: true,
      alignment: classifyEvidenceAlignment(techScore, true),
      items: [...techItems, ...volItems].slice(0, 4),
      gap: techGap,
    },
    {
      id: "fundamentals",
      label: "Fundamental Evidence",
      score: fundScore,
      available: true,
      alignment: classifyEvidenceAlignment(fundScore, true),
      items: [`Data quality: ${candidate.dataQuality ?? "not specified"}`],
      gap: fundScore < 65 ? "Fundamental data quality below ideal threshold" : undefined,
    },
    {
      id: "market-regime",
      label: "Market Regime",
      score: regimeScore,
      available: regimeAvail,
      alignment: classifyEvidenceAlignment(regimeScore, regimeAvail),
      items: regimeItems,
      gap: regimeGap,
    },
    {
      id: "congress",
      label: "Congress Activity",
      score: congressScore,
      available: true,
      alignment: classifyEvidenceAlignment(congressScore, true),
      items: congressItems,
      gap: congressGap,
    },
    {
      id: "institutional",
      label: "Institutional",
      score: 0,
      available: false,
      alignment: "unavailable",
      items: instItems,
      gap: "No institutional data provider configured in this version",
    },
    {
      id: "news",
      label: "News & Sentiment",
      score: newsScore,
      available: true,
      alignment: classifyEvidenceAlignment(newsScore, true),
      items: newsItems,
      gap: newsGap,
    },
    {
      id: "catalysts",
      label: "Catalysts & Risk",
      score: catScore,
      available: true,
      alignment: classifyEvidenceAlignment(catScore, true),
      items: catItems,
      gap: catGap,
    },
  ];
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

const SECTION_ICONS: Record<string, React.ElementType> = {
  technical:       BarChart2,
  fundamentals:    TrendingUp,
  "market-regime": Activity,
  congress:        Landmark,
  institutional:   Building2,
  news:            Newspaper,
  catalysts:       Zap,
};

const ALIGNMENT_CONFIG = {
  supports: {
    icon: CheckCircle2,
    badge: "text-emerald-300 border-emerald-500/30 bg-emerald-500/8",
    iconClass: "text-emerald-400",
    label: "Supports Thesis",
  },
  neutral: {
    icon: Minus,
    badge: "text-sky-300 border-sky-500/30 bg-sky-500/8",
    iconClass: "text-sky-400",
    label: "Neutral",
  },
  weakens: {
    icon: TrendingDown,
    badge: "text-amber-300 border-amber-500/30 bg-amber-500/8",
    iconClass: "text-amber-400",
    label: "Weakens Thesis",
  },
  unavailable: {
    icon: HelpCircle,
    badge: "text-muted-foreground border-border/30",
    iconClass: "text-muted-foreground/50",
    label: "Not Available",
  },
} as const;

// ---------------------------------------------------------------------------
// SupportingEvidenceCard
// ---------------------------------------------------------------------------

interface SupportingEvidenceCardProps {
  pkg: ResearchPackage;
  stars: EvidenceStars;
  snapshot?: MarketSnapshot;
}

export function SupportingEvidenceCard({ pkg, stars, snapshot }: SupportingEvidenceCardProps) {
  const sections = buildEvidenceSections(pkg, stars, snapshot);

  return (
    <Card className="border-border/40" data-testid="supporting-evidence-card">
      <CardHeader className="px-4 py-3 border-b border-border/30">
        <CardTitle className="text-[12px] font-semibold uppercase tracking-wider flex items-center gap-2 text-muted-foreground">
          <BarChart2 className="h-3.5 w-3.5 text-violet-400" />
          Supporting Evidence
        </CardTitle>
        <p className="text-[10px] text-muted-foreground/70 mt-0.5">
          Each section classified as Supports / Neutral / Weakens based on deterministic thresholds
        </p>
      </CardHeader>

      <CardContent className="px-4 py-4 space-y-3">
        {sections.map((section) => {
          const SectionIcon = SECTION_ICONS[section.id] ?? BarChart2;
          const alignCfg = ALIGNMENT_CONFIG[section.alignment];
          const AlignIcon = alignCfg.icon;

          return (
            <div
              key={section.id}
              className="rounded border border-border/30 p-3 space-y-2"
              data-testid={`evidence-section-${section.id}`}
            >
              {/* Header row */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <SectionIcon className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                  <span className="text-[11px] font-semibold text-foreground/80">
                    {section.label}
                  </span>
                </div>
                <Badge
                  variant="outline"
                  className={cn("gap-1 text-[9px] uppercase tracking-wide", alignCfg.badge)}
                  data-testid={`evidence-alignment-${section.id}`}
                >
                  <AlignIcon className={cn("h-2.5 w-2.5", alignCfg.iconClass)} />
                  {alignCfg.label}
                </Badge>
              </div>

              {/* Evidence bullets */}
              {section.items.length > 0 ? (
                <ul className="space-y-0.5 pl-1">
                  {section.items.map((item, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <div className="h-1 w-1 rounded-full bg-muted-foreground/40 mt-1.5 shrink-0" />
                      <span className="text-[10px] text-foreground/70 leading-relaxed">{item}</span>
                    </li>
                  ))}
                </ul>
              ) : section.alignment === "unavailable" ? (
                <p className="text-[10px] text-muted-foreground/50 italic pl-1">Not available.</p>
              ) : null}

              {/* Gap / weakness note */}
              {section.gap && (
                <p className="text-[10px] text-muted-foreground/60 italic leading-relaxed pl-1">
                  {section.gap}
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
