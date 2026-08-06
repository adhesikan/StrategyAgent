// TradeStructureReasonCard — explains why a specific structure fits this research candidate.
// Covers: why it fits, advantages, trade-offs, capital required, defined risk,
// expected holding period, suitable market outlook.
// All deterministic. No AI. No fabricated values.

import { FileText, CheckCircle2, XCircle, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { StockStructure, OptionsStructure } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StructureReasonSummary {
  structureLabel: string;
  whyFits: string[];
  advantages: string[];
  tradeoffs: string[];
  capitalRequired: string;
  definedRisk: boolean;
  definedRiskNote: string;
  expectedHoldingPeriod: string;
  suitableMarketOutlook: string;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function buildStockStructureReason(stock: StockStructure): StructureReasonSummary {
  return {
    structureLabel: stock.label,
    whyFits: stock.whyFits,
    advantages: stock.advantages,
    tradeoffs: stock.disadvantages,
    capitalRequired: stock.capitalEfficiency,
    definedRisk: true,  // stock always has a stop-loss reference
    definedRiskNote: stock.riskProfile,
    expectedHoldingPeriod: stock.holdingHorizon,
    suitableMarketOutlook: buildStockOutlook(stock),
  };
}

function buildStockOutlook(stock: StockStructure): string {
  switch (stock.type) {
    case "breakout-entry":
      return "Bullish — expects confirmed price breakout and follow-through above resistance";
    case "pullback-entry":
      return "Bullish — expects controlled retracement to support followed by resumption of uptrend";
    case "swing-position":
      return "Bullish to moderately bullish — expects defined price move within a swing timeframe";
    case "position-trade":
      return "Bullish with a multi-week horizon — expects sustained trend continuation";
    case "long-stock":
      return "Directional bullish — expects short-to-medium term price appreciation";
  }
}

export function buildOptionsStructureReason(options: OptionsStructure): StructureReasonSummary {
  const tradeoffs = buildOptionsTradeoffs(options);
  return {
    structureLabel: options.label,
    whyFits: [options.reason],
    advantages: buildOptionsAdvantages(options),
    tradeoffs,
    capitalRequired: options.capitalEfficiency,
    definedRisk: options.isDefinedRisk,
    definedRiskNote: options.riskProfile,
    expectedHoldingPeriod: `Sized for ${options.preferredDTE} horizon (illustrative)`,
    suitableMarketOutlook: options.marketOutlook,
  };
}

function buildOptionsAdvantages(s: OptionsStructure): string[] {
  const adv: string[] = [];
  if (s.isDefinedRisk) adv.push("Maximum loss defined at entry (illustrative debit or spread width)");
  if (s.isIncome) adv.push("Collects illustrative income from time decay");
  if (s.timeDecay === "Works for") adv.push("Time decay benefits the position as expiry approaches");
  if (s.name === "bull-call-spread" || s.name === "call-debit-spread") {
    adv.push("Lower net cost versus a single long call option");
    adv.push("Risk/reward defined by spread width and net debit");
  }
  if (s.name === "long-call") {
    adv.push("Full upside participation with limited illustrative downside");
  }
  if (s.name === "iron-condor") {
    adv.push("Profits across a range of prices — not dependent on precise directional move");
  }
  if (s.name === "covered-call") {
    adv.push("Reduces effective cost basis of existing long shares");
  }
  if (!adv.length) adv.push("Structure appropriate for the current research thesis");
  return adv;
}

function buildOptionsTradeoffs(s: OptionsStructure): string[] {
  const t: string[] = [];
  if (s.timeDecay === "Works against") {
    t.push("Time decay reduces option value daily — position must move in the intended direction");
  }
  if (!s.isDefinedRisk) {
    t.push("Assignment risk: may result in acquiring or delivering 100 shares per contract");
  }
  if (s.name === "bull-call-spread" || s.name === "call-debit-spread") {
    t.push("Upside capped at the short strike — cannot benefit from large moves above it");
  }
  if (s.name === "iron-condor") {
    t.push("Directional moves beyond either short strike result in losses");
    t.push("Not suitable if expecting significant price movement in either direction");
  }
  if (s.name === "diagonal") {
    t.push("Requires active management as the short leg approaches expiration");
  }
  t.push("Complexity requires understanding of options mechanics before considering any trade");
  return t;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TradeStructureReasonCardProps {
  stockReason: StructureReasonSummary;
  optionsReason?: StructureReasonSummary;
}

export function TradeStructureReasonCard({
  stockReason,
  optionsReason,
}: TradeStructureReasonCardProps) {
  return (
    <Card className="border-border/40" data-testid="trade-structure-reason-card">
      <CardHeader className="px-4 py-3 border-b border-border/30">
        <CardTitle className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5" />
          Structure Rationale
        </CardTitle>
      </CardHeader>

      <CardContent className="px-4 py-3 space-y-4">
        <ReasonSection title={stockReason.structureLabel} reason={stockReason} />
        {optionsReason && (
          <>
            <div className="border-t border-border/20" />
            <ReasonSection title={optionsReason.structureLabel} reason={optionsReason} />
          </>
        )}

        <p className="text-[10px] text-muted-foreground/50 border-t border-border/20 pt-2">
          Illustrative structure rationale for educational planning only. Not investment advice.
        </p>
      </CardContent>
    </Card>
  );
}

function ReasonSection({
  title,
  reason,
}: {
  title: string;
  reason: StructureReasonSummary;
}) {
  return (
    <div className="space-y-3" data-testid={`reason-section-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-semibold text-foreground/90">{title}</p>
        <div className="flex items-center gap-1.5">
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] border",
              reason.definedRisk
                ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10"
                : "border-amber-500/30 text-amber-400 bg-amber-500/10",
            )}
          >
            {reason.definedRisk ? "Defined Risk" : "Undefined Risk"}
          </Badge>
        </div>
      </div>

      {/* Why it fits */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
          Why It Fits
        </p>
        <ul className="space-y-1">
          {reason.whyFits.map((item, i) => (
            <li key={i} className="text-[12px] text-foreground/80 flex items-start gap-1.5">
              <Info className="h-3 w-3 text-sky-400 shrink-0 mt-0.5" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* Metadata grid */}
      <div className="grid grid-cols-2 gap-2">
        <MetaCell label="Capital Required" value={reason.capitalRequired} />
        <MetaCell label="Holding Period" value={reason.expectedHoldingPeriod} />
        <MetaCell label="Risk Note" value={reason.definedRiskNote} cols={2} />
        <MetaCell label="Suitable Outlook" value={reason.suitableMarketOutlook} cols={2} />
      </div>

      {/* Advantages / Trade-offs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400/80 mb-1">
            Advantages
          </p>
          <ul className="space-y-1">
            {reason.advantages.map((a, i) => (
              <li key={i} className="text-[11px] text-foreground/70 flex items-start gap-1.5">
                <CheckCircle2 className="h-3 w-3 text-emerald-500/60 shrink-0 mt-0.5" />
                {a}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-400/80 mb-1">
            Trade-offs
          </p>
          <ul className="space-y-1">
            {reason.tradeoffs.map((t, i) => (
              <li key={i} className="text-[11px] text-foreground/70 flex items-start gap-1.5">
                <XCircle className="h-3 w-3 text-amber-500/60 shrink-0 mt-0.5" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function MetaCell({
  label,
  value,
  cols = 1,
}: {
  label: string;
  value: string;
  cols?: 1 | 2;
}) {
  return (
    <div className={cn("rounded-md bg-muted/20 px-2.5 py-1.5", cols === 2 && "col-span-2")}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">{label}</p>
      <p className="text-[11px] text-foreground/80">{value}</p>
    </div>
  );
}
