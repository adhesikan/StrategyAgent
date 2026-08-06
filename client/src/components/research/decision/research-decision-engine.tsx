// ResearchDecisionEngine — full Decision tab orchestrator.
// Composes all decision engine cards into an institutional research workspace.
// Answers the 6 core research questions for every qualified candidate.

import { useLocation } from "wouter";
import {
  BarChart2,
  Landmark,
  Newspaper,
  Building2,
  BookOpen,
  GitCompare,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { track } from "@/lib/analytics";
import type { ResearchPackage, EvidenceStars, MarketSnapshot } from "../types";
import { ResearchDecisionCard } from "./research-decision-card";
import { QualificationSummaryCard } from "./qualification-summary-card";
import { ScoreBreakdownCard } from "./score-breakdown-card";
import { SupportingEvidenceCard } from "./supporting-evidence-card";
import { InvalidationCard } from "./invalidation-card";
import { CatalystTimelineCard } from "./catalyst-timeline-card";

// ---------------------------------------------------------------------------
// Navigation buttons panel
// ---------------------------------------------------------------------------

interface NavButtonsProps {
  symbol: string;
  onNavigateTab: (tab: string) => void;
}

function DecisionNavButtons({ symbol, onNavigateTab }: NavButtonsProps) {
  const [, navigate] = useLocation();

  const buttons = [
    {
      id: "technical",
      label: "View Technical Detail",
      icon: BarChart2,
      onClick: () => {
        track("decision_engine_nav_technical" as any, { symbol });
        onNavigateTab("technical");
      },
    },
    {
      id: "congress",
      label: "View Congress Detail",
      icon: Landmark,
      onClick: () => {
        track("decision_engine_nav_congress" as any, { symbol });
        onNavigateTab("congress");
      },
    },
    {
      id: "news",
      label: "View News",
      icon: Newspaper,
      onClick: () => {
        track("decision_engine_nav_news" as any, { symbol });
        onNavigateTab("news");
      },
    },
    {
      id: "institutional",
      label: "View Institutional",
      icon: Building2,
      onClick: () => {
        track("decision_engine_nav_institutional" as any, { symbol });
        onNavigateTab("institutional");
      },
    },
    {
      id: "fundamentals",
      label: "View Fundamentals",
      icon: BookOpen,
      onClick: () => {
        track("decision_engine_nav_fundamentals" as any, { symbol });
        navigate(`/ask?q=${encodeURIComponent(`Research fundamental data for ${symbol} — earnings, revenue trends, and sector context`)}`);
      },
    },
    {
      id: "compare",
      label: "Compare With Top Ranked",
      icon: GitCompare,
      onClick: () => {
        track("decision_engine_nav_compare" as any, { symbol });
        navigate(`/ask?q=${encodeURIComponent(`Compare ${symbol} to the top-ranked opportunities in the current scan`)}`);
      },
    },
  ];

  return (
    <Card className="border-border/40" data-testid="decision-nav-buttons">
      <CardHeader className="px-4 py-3 border-b border-border/30">
        <CardTitle className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/60" />
          Explore Further
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 py-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {buttons.map(({ id, label, icon: Icon, onClick }) => (
            <Button
              key={id}
              size="sm"
              variant="outline"
              className="h-8 text-[11px] gap-1.5 justify-start border-border/40 hover:border-border/70"
              onClick={onClick}
              data-testid={`decision-nav-${id}`}
            >
              <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
              {label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// ResearchDecisionEngine
// ---------------------------------------------------------------------------

interface ResearchDecisionEngineProps {
  pkg: ResearchPackage;
  stars: EvidenceStars;
  snapshot?: MarketSnapshot;
  onNavigateTab: (tab: string) => void;
}

export function ResearchDecisionEngine({
  pkg,
  stars,
  snapshot,
  onNavigateTab,
}: ResearchDecisionEngineProps) {
  return (
    <div className="space-y-4" data-testid="research-decision-engine">
      {/* Q1 + Q2: Why qualified? Why ranked? */}
      <ResearchDecisionCard pkg={pkg} stars={stars} />

      {/* Q1 detail + Q2 detail side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        <QualificationSummaryCard pkg={pkg} />
        <ScoreBreakdownCard pkg={pkg} stars={stars} />
      </div>

      {/* Q3 + Q4: Supports / Weakens thesis */}
      <SupportingEvidenceCard pkg={pkg} stars={stars} snapshot={snapshot} />

      {/* Q5 + Q6: Invalidation + Improvement side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        <InvalidationCard pkg={pkg} snapshot={snapshot} />
        <CatalystTimelineCard pkg={pkg} stars={stars} snapshot={snapshot} />
      </div>

      {/* Navigation buttons */}
      <DecisionNavButtons symbol={pkg.symbol} onNavigateTab={onNavigateTab} />
    </div>
  );
}
