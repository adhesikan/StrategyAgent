// ActionCard — Primary action surface for the Research Package.
// Buttons: View Why, View Evidence, Congress Activity, Related Research,
// Save Research, Prepare InstaTrade™ (broker) or Connect Broker (no broker).
// No trade execution occurs. Read-only planning display only.

import { useState } from "react";
import { useLocation } from "wouter";
import {
  Zap,
  FileText,
  Users,
  BookOpen,
  BarChart2,
  CheckCircle2,
  ExternalLink,
  Info,
  Plug,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { track } from "@/lib/analytics";
import type { ResearchPackage } from "./types";

// ---------------------------------------------------------------------------
// Inline InstaTrade™ planning panel (read-only, no execution)
// ---------------------------------------------------------------------------

const REGIME_LABEL: Record<string, string> = {
  TRENDING: "Strong Bull",
  CHOPPY:   "Choppy",
  RISK_OFF: "Risk-Off",
};

function InstaTradePanel({ pkg, symbol }: { pkg: ResearchPackage; symbol: string }) {
  const [, navigate] = useLocation();
  const { candidate } = pkg;

  return (
    <div
      className="mt-3 rounded border border-primary/30 bg-primary/5 px-4 py-3 space-y-3"
      data-testid="action-instatrade-panel"
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-primary uppercase tracking-wider">
          InstaTrade™ Planning
        </span>
        <Badge
          variant="outline"
          className="text-[9px] text-muted-foreground border-border/40 uppercase"
        >
          Read-Only · Not an order
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        {[
          { label: "Symbol", value: symbol, mono: true },
          { label: "Strategy", value: candidate.strategy ?? "—", mono: false },
          {
            label: "Entry Zone",
            value: candidate.trigger ? `$${candidate.trigger}` : "—",
            mono: true,
            className: "text-emerald-300",
          },
          {
            label: "Stop / Invalidation",
            value: candidate.invalidation ? `$${candidate.invalidation}` : "—",
            mono: true,
            className: "text-rose-300",
          },
          {
            label: "Est. Max Risk",
            value:
              candidate.maxRisk != null
                ? `$${candidate.maxRisk.toLocaleString()}`
                : "—",
            mono: true,
          },
          {
            label: "Regime",
            value: pkg.marketRegime
              ? (REGIME_LABEL[pkg.marketRegime] ?? pkg.marketRegime)
              : "—",
            mono: false,
            className:
              pkg.marketRegime === "TRENDING"
                ? "text-emerald-300"
                : "text-amber-300",
          },
        ].map(({ label, value, mono, className }) => (
          <div key={label}>
            <div className="text-[10px] text-muted-foreground">{label}</div>
            <div className={cn(mono && "font-mono", "font-medium", className)}>
              {value}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-border/30 pt-2 space-y-1.5">
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          This planning display shows scanner-derived parameters only. No order
          has been created. Only the connected broker executes orders.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1"
          onClick={() => {
            track("action_card_instatrade_navigate" as any, { symbol });
            navigate("/instatrade");
          }}
        >
          Open InstaTrade™ <ExternalLink className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ActionCard
// ---------------------------------------------------------------------------

interface ActionCardProps {
  pkg: ResearchPackage;
  symbol: string;
  onNavigateTab: (tab: string) => void;
}

export function ActionCard({ pkg, symbol, onNavigateTab }: ActionCardProps) {
  const [, navigate] = useLocation();
  const [showInstatrade, setShowInstatrade] = useState(false);

  const askRoute = (prompt: string) =>
    `/ask?q=${encodeURIComponent(prompt)}`;

  // Secondary action buttons
  const secondaryActions = [
    {
      id: "view-why",
      label: "View Why",
      icon: CheckCircle2,
      onClick: () => {
        track("action_card_view_why" as any, { symbol });
        onNavigateTab("technical");
      },
    },
    {
      id: "view-evidence",
      label: "View Evidence",
      icon: BarChart2,
      onClick: () => {
        track("action_card_view_evidence" as any, { symbol });
        onNavigateTab("technical");
      },
    },
    {
      id: "congress-activity",
      label: "Congress Activity",
      icon: Users,
      onClick: () => {
        track("action_card_congress" as any, { symbol });
        onNavigateTab("congress");
      },
    },
    {
      id: "related-research",
      label: "Related Research",
      icon: BookOpen,
      onClick: () => {
        track("action_card_related_research" as any, { symbol });
        navigate(
          askRoute(`Show me research on ${symbol} and similar setups in the current scan`),
        );
      },
    },
    {
      id: "save-research",
      label: "Save Research",
      icon: FileText,
      onClick: () => {
        track("action_card_save_research" as any, { symbol });
        navigate(askRoute(`Research ${symbol} and save the analysis`));
      },
    },
  ];

  return (
    <Card className="border-border/40" data-testid="action-card">
      <CardHeader className="px-4 py-3 border-b border-border/30">
        <CardTitle className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Zap className="h-3.5 w-3.5 text-primary" />
          Actions
        </CardTitle>
      </CardHeader>

      <CardContent className="px-4 py-4 space-y-3">
        {/* Secondary actions grid */}
        <div className="grid grid-cols-2 gap-1.5">
          {secondaryActions.map(({ id, label, icon: Icon, onClick }) => (
            <Button
              key={id}
              size="sm"
              variant="outline"
              className="h-8 text-[11px] gap-1.5 justify-start border-border/40 hover:border-border/70"
              onClick={onClick}
              data-testid={`btn-action-${id}`}
            >
              <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
              {label}
            </Button>
          ))}
        </div>

        {/* Primary CTA — divider */}
        <div className="border-t border-border/30 pt-3">
          {pkg.brokerConnected ? (
            <>
              <Button
                size="sm"
                className="w-full gap-2 h-9 text-xs font-semibold"
                onClick={() => {
                  track("action_card_instatrade_toggle" as any, { symbol });
                  setShowInstatrade((v) => !v);
                }}
                data-testid="btn-prepare-instatrade"
              >
                <Zap className="h-3.5 w-3.5" />
                {showInstatrade ? "Hide" : "Prepare InstaTrade™"}
              </Button>
              {showInstatrade && (
                <InstaTradePanel pkg={pkg} symbol={symbol} />
              )}
            </>
          ) : (
            <div
              className="rounded border border-border/40 px-3 py-2.5 space-y-2"
              data-testid="action-connect-broker-prompt"
            >
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Info className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                <span>
                  Connect a brokerage account to use InstaTrade™ order planning.
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="w-full h-8 text-[11px] gap-1.5 border-sky-500/30 text-sky-300 hover:bg-sky-500/10"
                onClick={() => {
                  track("action_card_connect_broker" as any, { symbol });
                  navigate("/settings");
                }}
                data-testid="btn-connect-broker"
              >
                <Plug className="h-3 w-3" />
                Connect Broker
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
