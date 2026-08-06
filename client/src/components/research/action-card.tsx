// ActionCard — Primary action surface for the Research Package.
// Sprint 2.2.1: primary CTA is now visually dominant (first, not buried below
// secondary actions). Connected/disconnected copy clarifies what happens next.
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
  Link2,
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
          { label: "Symbol",              value: symbol,                                         mono: true  },
          { label: "Strategy",            value: candidate.strategy ?? "Not supplied",            mono: false },
          { label: "Entry Framework",     value: candidate.trigger ? `$${candidate.trigger}` : "Not resolved", mono: true, className: candidate.trigger ? "text-emerald-300" : undefined },
          { label: "Invalidation",        value: candidate.invalidation ? `$${candidate.invalidation}` : "Not resolved", mono: true, className: candidate.invalidation ? "text-rose-300" : undefined },
          { label: "Est. Max Risk",       value: candidate.maxRisk != null ? `$${candidate.maxRisk.toLocaleString()}` : "Not supplied", mono: true },
          { label: "Regime",              value: pkg.marketRegime ? (REGIME_LABEL[pkg.marketRegime] ?? pkg.marketRegime) : "Unavailable", mono: false, className: pkg.marketRegime === "TRENDING" ? "text-emerald-300" : "text-amber-300" },
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
          This planning display shows scanner-derived parameters only.
          No order has been created. User confirmation is required before
          any order is submitted through the connected broker.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1"
          onClick={() => {
            track("action_card_instatrade_navigate" as any, { symbol });
            navigate("/instatrade");
          }}
          aria-label="Open InstaTrade order review workflow"
        >
          Open InstaTrade™ <ExternalLink className="h-3 w-3" aria-hidden="true" />
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
      ariaLabel: "View why this candidate qualified",
      onClick: () => {
        track("action_card_view_why" as any, { symbol });
        onNavigateTab("decision");
      },
    },
    {
      id: "view-evidence",
      label: "View Evidence",
      icon: BarChart2,
      ariaLabel: "View full evidence breakdown",
      onClick: () => {
        track("action_card_view_evidence" as any, { symbol });
        onNavigateTab("technical");
      },
    },
    {
      id: "congress-activity",
      label: "Congress",
      icon: Users,
      ariaLabel: "View congressional disclosures",
      onClick: () => {
        track("action_card_congress" as any, { symbol });
        onNavigateTab("congress");
      },
    },
    {
      id: "related-research",
      label: "Related Research",
      icon: BookOpen,
      ariaLabel: "Find related research",
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
      ariaLabel: "Save this research analysis",
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
          <Zap className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          Actions
        </CardTitle>
      </CardHeader>

      <CardContent className="px-4 py-4 space-y-3">
        {/* ── Primary CTA — visually dominant, rendered first ── */}
        {pkg.brokerConnected ? (
          <div>
            <Button
              size="sm"
              className="w-full gap-2 h-10 text-[13px] font-semibold"
              onClick={() => {
                track("action_card_instatrade_toggle" as any, { symbol });
                setShowInstatrade((v) => !v);
              }}
              data-testid="btn-prepare-instatrade"
              aria-label="Review with InstaTrade — opens order preparation workflow"
              aria-expanded={showInstatrade}
            >
              <Zap className="h-4 w-4" aria-hidden="true" />
              Review with InstaTrade™
            </Button>
            <p className="text-[10px] text-muted-foreground mt-1.5 px-0.5 leading-relaxed">
              Prepare a broker-connected order for review.
              Nothing is submitted without your explicit confirmation.
            </p>
            {showInstatrade && (
              <InstaTradePanel pkg={pkg} symbol={symbol} />
            )}
          </div>
        ) : (
          <div
            className="rounded border border-border/40 px-3 py-3 space-y-2"
            data-testid="action-connect-broker-prompt"
          >
            <Button
              size="sm"
              className="w-full h-9 text-[12px] font-semibold gap-2"
              variant="outline"
              style={{ borderColor: "hsl(var(--sky-500) / 0.4)" }}
              onClick={() => {
                track("action_card_connect_broker" as any, { symbol });
                navigate("/settings");
              }}
              data-testid="btn-connect-broker"
              aria-label="Connect broker to enable InstaTrade order review"
            >
              <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
              Connect Broker
            </Button>
            <div className="flex items-start gap-2 text-[10px] text-muted-foreground leading-relaxed">
              <Info className="h-3.5 w-3.5 shrink-0 text-sky-400 mt-0.5" aria-hidden="true" />
              <span>
                Connect a brokerage account to verify live option contracts,
                access account context, and prepare an InstaTrade™ order review.
              </span>
            </div>
          </div>
        )}

        {/* ── Secondary actions ── */}
        <div className="border-t border-border/20 pt-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-2">
            Research Tools
          </p>
          <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Secondary research actions">
            {secondaryActions.map(({ id, label, icon: Icon, ariaLabel, onClick }) => (
              <Button
                key={id}
                size="sm"
                variant="ghost"
                className="h-8 text-[11px] gap-1.5 justify-start text-muted-foreground hover:text-foreground border border-transparent hover:border-border/40"
                onClick={onClick}
                data-testid={`btn-action-${id}`}
                aria-label={ariaLabel}
              >
                <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
                {label}
              </Button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
