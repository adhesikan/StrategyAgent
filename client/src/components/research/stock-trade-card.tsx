// StockTradeCard — Professional institutional-style stock trade parameter display.
// All fields are scanner-derived. No AI-generated numbers. Educational only.

import { Shield, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ResearchPackage } from "./types";

// ---------------------------------------------------------------------------
// Pure, exported helper — deterministic, testable
// ---------------------------------------------------------------------------

/** Infer holding period label from strategy string. */
export function deriveHoldingPeriod(strategy?: string): string {
  if (!strategy) return "Verify with your research";
  const s = strategy.toUpperCase();
  if (s.includes("INTRADAY") || s.includes("ORB") || s.includes("GAP")) {
    return "Intraday — same session";
  }
  if (s.includes("SWING") || s.includes("VCP") || s.includes("PULLBACK")) {
    return "Swing — days to weeks";
  }
  if (s.includes("POSITION") || s.includes("TREND")) {
    return "Position — weeks to months";
  }
  return "Swing — days to weeks";
}

// ---------------------------------------------------------------------------
// Sub-component: single metric cell
// ---------------------------------------------------------------------------

interface MetricCellProps {
  label: string;
  value: string;
  valueClass?: string;
  sub?: string;
  mono?: boolean;
  "data-testid"?: string;
}

function MetricCell({
  label,
  value,
  valueClass,
  sub,
  mono = true,
  "data-testid": testId,
}: MetricCellProps) {
  return (
    <div className="p-3 space-y-1" data-testid={testId}>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
        {label}
      </div>
      <div
        className={cn(
          "text-[15px] font-semibold leading-tight",
          mono && "font-mono",
          valueClass ?? "text-foreground",
        )}
      >
        {value}
      </div>
      {sub && (
        <div className="text-[10px] text-muted-foreground leading-tight">{sub}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confidence dot indicator
// ---------------------------------------------------------------------------

function ConfidencePips({ level }: { level: string }) {
  const lower = level.toLowerCase();
  const filled = lower === "high" ? 4 : lower === "medium" ? 2 : 1;
  const color =
    lower === "high"
      ? "bg-emerald-400"
      : lower === "medium"
      ? "bg-amber-400"
      : "bg-rose-400";
  const label =
    lower === "high" ? "High" : lower === "medium" ? "Medium" : "Low";

  return (
    <div className="flex items-center gap-1.5" data-testid="confidence-pips">
      <span
        className={cn(
          "text-[15px] font-semibold capitalize",
          lower === "high"
            ? "text-emerald-400"
            : lower === "medium"
            ? "text-amber-400"
            : "text-rose-400",
        )}
      >
        {label}
      </span>
      <div className="flex gap-0.5 items-center">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              i <= filled ? color : "bg-border/50",
            )}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StockTradeCard
// ---------------------------------------------------------------------------

interface StockTradeCardProps {
  pkg: ResearchPackage;
}

export function StockTradeCard({ pkg }: StockTradeCardProps) {
  const { candidate, marketRegime } = pkg;
  const holdingPeriod = deriveHoldingPeriod(candidate.strategy);

  const rrValue =
    candidate.rewardRisk != null ? `${candidate.rewardRisk.toFixed(1)}:1` : "—";
  const rrClass =
    candidate.rewardRisk == null
      ? "text-muted-foreground"
      : candidate.rewardRisk >= 2
      ? "text-amber-400"
      : "text-orange-400";

  const maxRiskDisplay =
    candidate.maxRisk != null
      ? `$${candidate.maxRisk.toLocaleString()}`
      : "—";

  const positionDisplay =
    candidate.quantity != null
      ? `${candidate.quantity} shares`
      : candidate.fitsRiskBudget != null
      ? candidate.fitsRiskBudget
        ? "Fits budget"
        : "Exceeds budget"
      : "Verify sizing";

  const regimeLabel =
    marketRegime === "TRENDING"
      ? "Trending ▲"
      : marketRegime === "CHOPPY"
      ? "Choppy ≈"
      : marketRegime === "RISK_OFF"
      ? "Risk-Off ▼"
      : null;

  const regimeClass =
    marketRegime === "TRENDING"
      ? "text-emerald-400"
      : marketRegime === "RISK_OFF"
      ? "text-rose-400"
      : "text-amber-400";

  return (
    <Card className="border-border/40 overflow-hidden" data-testid="stock-trade-card">
      {/* Header */}
      <CardHeader className="px-4 py-3 border-b border-border/30">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-[12px] font-semibold uppercase tracking-wider flex items-center gap-2 text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
            Stock Trade Parameters
          </CardTitle>
          <div className="flex items-center gap-2">
            {regimeLabel && (
              <span className={cn("text-[10px] font-mono", regimeClass)}>
                Regime: {regimeLabel}
              </span>
            )}
            <Badge
              variant="outline"
              className="text-[9px] text-muted-foreground border-border/40 uppercase tracking-wide"
            >
              Educational Only
            </Badge>
          </div>
        </div>
      </CardHeader>

      {/* Primary metric grid — row 1 */}
      <CardContent className="p-0">
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y divide-border/20 border-b border-border/20">
          <MetricCell
            label="Entry Zone"
            value={candidate.trigger ? `$${candidate.trigger}` : "—"}
            valueClass={candidate.trigger ? "text-emerald-400" : "text-muted-foreground"}
            sub="Scanner pivot level"
            data-testid="metric-entry"
          />
          <MetricCell
            label="Stop Level"
            value={candidate.invalidation ? `$${candidate.invalidation}` : "—"}
            valueClass={candidate.invalidation ? "text-rose-400" : "text-muted-foreground"}
            sub="Invalidation price"
            data-testid="metric-stop"
          />
          <MetricCell
            label="Objective"
            value={candidate.objective ? `$${candidate.objective}` : "—"}
            valueClass={candidate.objective ? "text-sky-400" : "text-muted-foreground"}
            sub="Scanner target zone"
            data-testid="metric-objective"
          />
          <div className="p-3 space-y-1" data-testid="metric-rr">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
              Risk / Reward
            </div>
            <div className={cn("text-[15px] font-mono font-semibold", rrClass)}>
              {rrValue}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {candidate.rewardRisk != null && candidate.rewardRisk >= 2
                ? "Meets 2:1 threshold"
                : candidate.rewardRisk != null
                ? "Below 2:1"
                : "Not calculated"}
            </div>
          </div>
        </div>

        {/* Secondary metric grid — row 2 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y divide-border/20">
          <MetricCell
            label="Max Risk Est."
            value={maxRiskDisplay}
            valueClass="text-foreground"
            sub={candidate.fitsRiskBudget ? "✓ Fits risk budget" : undefined}
            data-testid="metric-max-risk"
          />
          <MetricCell
            label="Position Size"
            value={positionDisplay}
            valueClass="text-foreground"
            sub="Verify with your process"
            data-testid="metric-position-size"
          />
          <MetricCell
            label="Holding Period"
            value={holdingPeriod}
            valueClass="text-foreground"
            mono={false}
            data-testid="metric-holding"
          />
          <div className="p-3 space-y-1.5" data-testid="metric-confidence">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
              Confidence
            </div>
            {candidate.confidence ? (
              <ConfidencePips level={candidate.confidence} />
            ) : (
              <span className="text-[15px] text-muted-foreground">—</span>
            )}
          </div>
        </div>

        {/* Invalidation callout — only if present */}
        {candidate.invalidation && (
          <div
            className="flex items-start gap-2 px-4 py-2.5 border-t border-rose-500/20 bg-rose-500/5"
            data-testid="stock-invalidation-callout"
          >
            <Shield className="h-3 w-3 text-rose-400 shrink-0 mt-0.5" />
            <p className="text-[10px] text-rose-300 leading-relaxed">
              <span className="font-medium">Invalidation: </span>
              Setup is considered invalidated if price closes below{" "}
              <span className="font-mono">${candidate.invalidation}</span>.
              Educational planning only — verify with your broker.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
