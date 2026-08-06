// TradeStructureEngine — full Trade Planning tab orchestrator.
// Composes all structure components, comparison ranking, and InstaTrade™ CTA.
//
// Inputs: ResearchPackage + EvidenceStars + thesis from Decision Engine.
// No new API calls. No broker execution. No live contract resolution.
// Everything is illustrative educational research planning.
//
// Sprint 2.2.1 will add: Live Contract Resolver (premiums, Greeks, bid/ask).

import { useState } from "react";
import {
  Layers,
  CandlestickChart,
  GitCompare,
  Cpu,
  Link2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ResearchPackage, EvidenceStars, MarketSnapshot } from "./types";
import type { Thesis } from "../decision/types";
import { deriveThesis } from "../decision/research-decision-card";
import { deriveStockStructure } from "./stock-structure-card";
import { deriveOptionsStructures } from "./options-structure-card";
import { buildStructureComparisons } from "./trade-comparison-card";
import { TradeStructureCard } from "./trade-structure-card";
import { TradeComparisonCard } from "./trade-comparison-card";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TradeStructureEngineProps {
  pkg: ResearchPackage;
  stars: EvidenceStars;
  snapshot?: MarketSnapshot;
  onNavigateTab: (tab: string) => void;
}

// ---------------------------------------------------------------------------
// InstaTrade CTA
// ---------------------------------------------------------------------------

function InstaTradePanel({
  pkg,
  onNavigateTab,
}: {
  pkg: ResearchPackage;
  onNavigateTab: (tab: string) => void;
}) {
  const connected = pkg.brokerConnected;

  return (
    <Card
      className={cn(
        "border",
        connected
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-border/40",
      )}
      data-testid="instatrade-panel"
    >
      <CardContent className="px-4 py-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-emerald-400" />
              <p className="text-[13px] font-semibold text-foreground">
                Review with InstaTrade™
              </p>
              <Badge
                variant="outline"
                className="text-[9px] border-amber-500/30 text-amber-400 bg-amber-500/10"
              >
                Sprint 2.2.1
              </Badge>
            </div>
            <p className="text-[12px] text-muted-foreground max-w-lg">
              {connected
                ? "Broker connected. Live contract resolution and order preparation will be available in the next release."
                : "Connect a broker to enable live option contract resolution, live bid/ask pricing, and order preparation. No trades are submitted without your explicit confirmation."}
            </p>
          </div>

          {connected ? (
            <Button
              variant="outline"
              size="sm"
              className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 shrink-0"
              disabled
              data-testid="instatrade-broker-review-btn"
            >
              <Cpu className="h-3.5 w-3.5 mr-1.5" />
              Prepare Broker Review
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="border-border/50 hover:border-border/80 shrink-0"
              onClick={() => onNavigateTab("overview")}
              data-testid="instatrade-connect-btn"
            >
              <Link2 className="h-3.5 w-3.5 mr-1.5" />
              Connect Broker to Verify Live Contracts
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
  collapsed,
  onToggle,
}: {
  icon: typeof Layers;
  title: string;
  subtitle?: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between gap-2 text-left group"
      data-testid={`section-header-${title.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <div>
          <p className="text-[13px] font-semibold text-foreground/90">{title}</p>
          {subtitle && (
            <p className="text-[11px] text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </div>
      <div className="text-muted-foreground/50 group-hover:text-muted-foreground transition-colors">
        {collapsed ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronUp className="h-4 w-4" />
        )}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main engine
// ---------------------------------------------------------------------------

export function TradeStructureEngine({
  pkg,
  stars,
  snapshot,
  onNavigateTab,
}: TradeStructureEngineProps) {
  const thesis: Thesis = deriveThesis(pkg, stars);
  const stockStructure = deriveStockStructure(pkg);
  const optionsStructures = deriveOptionsStructures(pkg, thesis);
  const comparisons = buildStructureComparisons(pkg, stockStructure, optionsStructures, thesis);

  const [structureCollapsed, setStructureCollapsed] = useState(false);
  const [comparisonCollapsed, setComparisonCollapsed] = useState(false);

  const hasOptions = optionsStructures.length > 0;

  return (
    <div className="space-y-5" data-testid="trade-structure-engine">
      {/* ── Header summary ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">
            Trade Planning
          </h2>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            Illustrative trade structures for{" "}
            <span className="font-medium text-foreground/80">{pkg.symbol}</span>
            {" — "}
            educational research planning only. No broker execution.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={cn(
              "text-[11px] border font-semibold",
              thesis === "bullish"
                ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                : thesis === "bearish"
                  ? "border-red-500/40 text-red-400 bg-red-500/10"
                  : "border-slate-500/40 text-slate-400 bg-slate-500/10",
            )}
          >
            {thesis === "bullish" ? "▲" : thesis === "bearish" ? "▼" : "◆"}{" "}
            {thesis.charAt(0).toUpperCase() + thesis.slice(1)} Thesis
          </Badge>
          {hasOptions ? (
            <Badge
              variant="outline"
              className="text-[11px] border border-violet-500/30 text-violet-400 bg-violet-500/10"
            >
              <CandlestickChart className="h-3 w-3 mr-1" />
              Options Eligible
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="text-[11px] border border-slate-500/30 text-slate-400 bg-slate-500/10"
            >
              Stock Only
            </Badge>
          )}
        </div>
      </div>

      {/* ── Section 1: Trade Structures ── */}
      <div className="space-y-3">
        <SectionHeader
          icon={Layers}
          title="Illustrative Trade Structures"
          subtitle={`${stockStructure.label}${hasOptions ? ` · ${optionsStructures[0].label}` : ""}`}
          collapsed={structureCollapsed}
          onToggle={() => setStructureCollapsed((c) => !c)}
        />
        {!structureCollapsed && (
          <TradeStructureCard
            pkg={pkg}
            stars={stars}
            thesis={thesis}
            stockStructure={stockStructure}
            optionsStructures={optionsStructures}
          />
        )}
      </div>

      {/* ── Section 2: Structure Comparison ── */}
      <div className="space-y-3">
        <SectionHeader
          icon={GitCompare}
          title="Structure Comparison"
          subtitle={
            comparisons.length > 0
              ? `${comparisons.length} structures ranked`
              : "No comparison available"
          }
          collapsed={comparisonCollapsed}
          onToggle={() => setComparisonCollapsed((c) => !c)}
        />
        {!comparisonCollapsed && (
          <TradeComparisonCard comparisons={comparisons} />
        )}
      </div>

      {/* ── InstaTrade™ CTA ── */}
      <InstaTradePanel pkg={pkg} onNavigateTab={onNavigateTab} />
    </div>
  );
}
