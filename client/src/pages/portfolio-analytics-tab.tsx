/**
 * Portfolio Analytics Tab — Sprint 2.6.2
 *
 * Renders the Analytics tab inside portfolio.tsx.
 * Sourced from GET /api/portfolio/:id/analytics.
 *
 * COMPLIANCE:
 *   - Never uses: "Return", "Alpha", "Performance", "CAGR", "Sharpe"
 *   - Uses: "Portfolio Value Change", "Unrealized Gain/Loss", "Market Value Trend"
 *   - Theme overlap disclosure on every theme chart
 *   - Disclaimer rendered on mount
 *   - Cash disclosure present when value history shown
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, Tooltip as ReTooltip, ResponsiveContainer,
  Cell, CartesianGrid, Legend,
} from "recharts";
import {
  TrendingUp, TrendingDown, Minus, BarChart2, PieChart,
  AlertCircle, RefreshCw, Info, Clock, Layers, Shield,
  Activity, Target, ChevronDown, ChevronUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type {
  PortfolioAnalyticsResult,
  AnalyticsPeriod,
  ValueHistoryPoint,
  SectorAllocationItem,
  ThemeAllocationItem,
  PositionAllocationItem,
} from "@shared/portfolio-analytics-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PortfolioAnalyticsResponse {
  available:   boolean;
  portfolioId: string;
  period:      AnalyticsPeriod;
  generatedAt: string;
  analytics:   PortfolioAnalyticsResult | null;
  message?:    string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PERIOD_LABELS: Record<AnalyticsPeriod, string> = {
  "7D": "7 Days", "30D": "30 Days", "90D": "90 Days",
  "YTD": "Year to Date", "1Y": "1 Year", "ALL": "All Time",
};
const PERIODS: AnalyticsPeriod[] = ["7D", "30D", "90D", "YTD", "1Y", "ALL"];

const SECTOR_COLORS = [
  "#3b82f6", "#8b5cf6", "#10b981", "#f59e0b",
  "#ef4444", "#06b6d4", "#ec4899", "#84cc16",
];
const THEME_COLORS = [
  "#6366f1", "#14b8a6", "#f97316", "#a855f7",
  "#22c55e", "#0ea5e9", "#fb923c", "#e11d48",
];

function fmt$(value: number | null): string {
  if (value == null) return "—";
  if (Math.abs(value) >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(value) >= 1_000_000)     return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000)         return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

function fmtPct(value: number | null, decimals = 1): string {
  if (value == null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(decimals)}%`;
}

function fmtDate(isoDate: string): string {
  try {
    const d = new Date(isoDate);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch { return isoDate.slice(0, 10); }
}

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit",
    });
  } catch { return iso; }
}

// ---------------------------------------------------------------------------
// AnalyticsChart — thin shared wrapper
// ---------------------------------------------------------------------------

interface ChartShellProps {
  title:        string;
  description?: string;
  disclosure?:  string;
  children?:    React.ReactNode;
  empty?:       boolean;
  emptyMsg?:    string;
  freshnessAt?: string | null;
}

function ChartShell({ title, description, disclosure, children, empty, emptyMsg, freshnessAt }: ChartShellProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        {description && <CardDescription className="text-xs">{description}</CardDescription>}
        {disclosure && (
          <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
            <Info className="h-3 w-3 mt-0.5 shrink-0 text-blue-400" aria-hidden="true" />
            {disclosure}
          </p>
        )}
      </CardHeader>
      <CardContent>
        {empty ? (
          <div className="flex items-center justify-center h-32 text-xs text-muted-foreground gap-2">
            <BarChart2 className="h-4 w-4" aria-hidden="true" />
            {emptyMsg ?? "Insufficient data for this chart."}
          </div>
        ) : children}
        {freshnessAt && (
          <p className="text-[10px] text-muted-foreground mt-2 flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" aria-hidden="true" />
            Data as of {fmtDateTime(freshnessAt)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Metric card
// ---------------------------------------------------------------------------

interface MetricCardProps {
  label:       string;
  value:       React.ReactNode;
  sub?:        React.ReactNode;
  icon?:       React.ReactNode;
  status?:     "positive" | "negative" | "neutral" | "warning";
  tooltip?:    string;
}

function MetricCard({ label, value, sub, icon, status, tooltip }: MetricCardProps) {
  const statusCls = status === "positive"
    ? "text-emerald-400"
    : status === "negative"
    ? "text-red-400"
    : status === "warning"
    ? "text-amber-400"
    : "text-foreground";

  const inner = (
    <Card className="flex-1 min-w-[140px]">
      <CardContent className="pt-4 pb-3">
        {icon && <div className="mb-1 text-muted-foreground">{icon}</div>}
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className={`text-lg font-semibold mt-0.5 ${statusCls}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );

  if (!tooltip) return inner;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{inner}</TooltipTrigger>
        <TooltipContent className="text-xs max-w-xs">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Section 1 — Value Change Summary
// ---------------------------------------------------------------------------

function ValueSummarySection({ analytics }: { analytics: PortfolioAnalyticsResult }) {
  const { valueChangeSummary: s, costBasisSummary: c } = analytics;
  const absChg     = s.absoluteChange;
  const pctChg     = s.percentChange;
  const chgStatus  = absChg == null ? "neutral" : absChg >= 0 ? "positive" : "negative";

  return (
    <section aria-label="Portfolio value summary">
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
        <TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        Portfolio Value Overview
      </h3>
      <div className="flex flex-wrap gap-3">
        <MetricCard
          label="Current Market Value"
          value={fmt$(s.endingValue)}
          sub="From tracked positions (no cash)"
          tooltip="Total market value of tracked positions at the latest snapshot. Cash is not tracked."
        />
        <MetricCard
          label="Portfolio Value Change"
          value={fmt$(absChg)}
          sub={fmtPct(pctChg) + " over period"}
          status={chgStatus}
          tooltip="Change in total market value over the selected period. Includes both market movement and changes in holdings — not a standalone investment return."
        />
        {c.totalCostBasis !== null && (
          <MetricCard
            label="Unrealized Gain / Loss"
            value={fmt$(c.unrealizedGainLoss)}
            sub={fmtPct(c.unrealizedGainLossPct) + (c.isPartial ? " (partial)" : "")}
            status={c.unrealizedGainLoss == null
              ? "neutral"
              : c.unrealizedGainLoss >= 0 ? "positive" : "negative"}
            tooltip={c.isPartial
              ? `Cost basis available for ${c.positionsWithCostBasis} of ${c.totalPositions} positions. Unrealized gain/loss is partial.`
              : "Unrealized gain/loss vs total cost basis. Not an investment return."}
          />
        )}
        <MetricCard
          label="Positions"
          value={String(analytics.concentration.positionCount)}
          sub={`${s.snapshotCount} snapshot${s.snapshotCount !== 1 ? "s" : ""} captured`}
        />
      </div>
      <p className="text-[10px] text-muted-foreground mt-2 flex items-start gap-1">
        <Info className="h-3 w-3 mt-0.5 shrink-0 text-blue-400" aria-hidden="true" />
        Portfolio Value Change reflects tracked positions only. Cash balances and securities
        outside this portfolio are not included. The percentage change combines market movement
        with any holdings changes in the period and is not an investment return.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section 2 — Market Value History Chart
// ---------------------------------------------------------------------------

function ValueHistoryChart({ analytics }: { analytics: PortfolioAnalyticsResult }) {
  const data = analytics.valueHistory;
  if (data.length < 2) {
    return (
      <ChartShell
        title="Market Value History"
        description="Portfolio market value over time (tracked positions only)"
        empty
        emptyMsg="At least 2 snapshots needed to display the value history chart."
      />
    );
  }

  const chartData = data.map(p => ({
    date:  fmtDate(p.snapshotDate),
    value: p.marketValue,
    cost:  p.costBasis,
  }));

  return (
    <ChartShell
      title="Market Value History"
      description="Portfolio market value over time (tracked positions only)"
      disclosure="Cash balances are not included. Portfolio Value Change is not an investment return — it combines market movement with changes in holdings."
      freshnessAt={analytics.freshness.latestSnapshotAt}
    >
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="pa-value-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} tickFormatter={v => fmt$(v)} width={70} />
          <ReTooltip
            formatter={(v: any) => [fmt$(v), "Market Value"]}
            contentStyle={{ fontSize: 11, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#3b82f6"
            strokeWidth={2}
            fill="url(#pa-value-grad)"
            dot={false}
            name="Market Value"
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}

// ---------------------------------------------------------------------------
// Section 3 — Position Allocation
// ---------------------------------------------------------------------------

function PositionAllocationChart({ items, totalMV }: {
  items:   PositionAllocationItem[];
  totalMV: number | null;
}) {
  if (items.length === 0) {
    return (
      <ChartShell title="Position Allocation" empty emptyMsg="No position data available." />
    );
  }

  const top10 = items.slice(0, 10);
  const chartData = top10.map((item, i) => ({
    symbol:  item.symbol,
    percent: item.portfolioPercent ?? 0,
    value:   item.marketValue,
    color:   SECTOR_COLORS[i % SECTOR_COLORS.length],
  }));

  return (
    <ChartShell
      title="Position Allocation"
      description="Portfolio weight by position (top 10 shown)"
    >
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
          <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v.toFixed(0)}%`} />
          <YAxis type="category" dataKey="symbol" tick={{ fontSize: 11 }} width={52} />
          <ReTooltip
            formatter={(v: any, _name: any, props: any) => [
              `${Number(v).toFixed(1)}% (${fmt$(props.payload.value)})`,
              "Weight",
            ]}
            contentStyle={{ fontSize: 11 }}
          />
          <Bar dataKey="percent" radius={[0, 3, 3, 0]}>
            {chartData.map((entry, i) => (
              <Cell key={entry.symbol} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {items.length > 10 && (
        <p className="text-[10px] text-muted-foreground mt-1">
          +{items.length - 10} additional position{items.length - 10 !== 1 ? "s" : ""} not shown.
        </p>
      )}
    </ChartShell>
  );
}

// ---------------------------------------------------------------------------
// Section 4 — Sector Allocation
// ---------------------------------------------------------------------------

function SectorAllocationChart({ items }: { items: SectorAllocationItem[] }) {
  if (items.length === 0) {
    return (
      <ChartShell
        title="Sector Allocation"
        empty
        emptyMsg="Sector data not yet available. Sector allocation appears after Portfolio Intelligence has run."
      />
    );
  }

  const chartData = items.map((s, i) => ({
    sector:  s.sector,
    percent: s.portfolioPercent ?? 0,
    change:  s.changePP,
    color:   SECTOR_COLORS[i % SECTOR_COLORS.length],
  }));

  return (
    <ChartShell
      title="Sector Allocation"
      description="Portfolio market value by sector"
    >
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 60, top: 4, bottom: 4 }}>
          <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v.toFixed(0)}%`} />
          <YAxis type="category" dataKey="sector" tick={{ fontSize: 10 }} width={100} />
          <ReTooltip
            formatter={(v: any, _n: any, props: any) => [
              `${Number(v).toFixed(1)}%${props.payload.change != null ? ` (${props.payload.change >= 0 ? "+" : ""}${props.payload.change.toFixed(1)}pp vs prev)` : ""}`,
              "Sector Weight",
            ]}
            contentStyle={{ fontSize: 11 }}
          />
          <Bar dataKey="percent" radius={[0, 3, 3, 0]}>
            {chartData.map((entry, i) => (
              <Cell key={entry.sector} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}

// ---------------------------------------------------------------------------
// Section 5 — Theme Allocation
// ---------------------------------------------------------------------------

function ThemeAllocationChart({ items }: { items: ThemeAllocationItem[] }) {
  if (items.length === 0) {
    return (
      <ChartShell
        title="Theme Allocation"
        disclosure="Theme memberships may overlap, so theme percentages may not sum to 100%. This is by design."
        empty
        emptyMsg="Theme data not yet available. Theme allocation appears after Portfolio Intelligence has run."
      />
    );
  }

  const chartData = items.slice(0, 8).map((t, i) => ({
    theme:   t.themeName,
    percent: t.portfolioPercent ?? 0,
    color:   THEME_COLORS[i % THEME_COLORS.length],
  }));

  return (
    <ChartShell
      title="Theme Allocation"
      description="Portfolio market value by research theme"
      disclosure="Theme memberships may overlap — a holding may belong to multiple themes. Theme percentages may not sum to 100%. This is by design."
    >
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 60, top: 4, bottom: 4 }}>
          <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v.toFixed(0)}%`} />
          <YAxis type="category" dataKey="theme" tick={{ fontSize: 10 }} width={120} />
          <ReTooltip
            formatter={(v: any) => [`${Number(v).toFixed(1)}%`, "Theme Weight"]}
            contentStyle={{ fontSize: 11 }}
          />
          <Bar dataKey="percent" radius={[0, 3, 3, 0]}>
            {chartData.map((entry, i) => (
              <Cell key={entry.theme} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}

// ---------------------------------------------------------------------------
// Section 6 — Concentration
// ---------------------------------------------------------------------------

function ConcentrationSection({ analytics }: { analytics: PortfolioAnalyticsResult }) {
  const c = analytics.concentration;

  function labelBadge(label: string | null) {
    if (!label) return null;
    const cls = label === "High"
      ? "bg-red-500/10 text-red-400 border-red-500/20"
      : label === "Moderate"
      ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
      : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    return (
      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${cls}`}>
        {label}
      </Badge>
    );
  }

  return (
    <section aria-label="Concentration analysis">
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
        <Layers className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        Concentration Analysis
      </h3>
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {/* Largest position */}
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Largest Position</p>
              <p className="text-base font-semibold mt-0.5">
                {c.largestPositionPercent != null ? `${c.largestPositionPercent.toFixed(1)}%` : "—"}
              </p>
              {c.largestPositionSymbol && (
                <p className="text-xs text-muted-foreground">{c.largestPositionSymbol}</p>
              )}
              {labelBadge(c.largestPositionLabel)}
            </div>
            {/* Top 3 */}
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Top 3 Positions</p>
              <p className="text-base font-semibold mt-0.5">
                {c.top3PositionPercent != null ? `${c.top3PositionPercent.toFixed(1)}%` : "—"}
              </p>
              {labelBadge(c.top3Label)}
            </div>
            {/* Largest sector */}
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Largest Sector</p>
              <p className="text-base font-semibold mt-0.5">
                {c.largestSectorPercent != null ? `${c.largestSectorPercent.toFixed(1)}%` : "—"}
              </p>
              {c.largestSectorName && (
                <p className="text-xs text-muted-foreground">{c.largestSectorName}</p>
              )}
              {labelBadge(c.sectorLabel)}
            </div>
            {/* Largest theme */}
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Largest Theme</p>
              <p className="text-base font-semibold mt-0.5">
                {c.largestThemePercent != null ? `${c.largestThemePercent.toFixed(1)}%` : "—"}
              </p>
              {c.largestThemeName && (
                <p className="text-xs text-muted-foreground">{c.largestThemeName}</p>
              )}
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-3 flex items-start gap-1">
            <Info className="h-3 w-3 mt-0.5 shrink-0 text-blue-400" aria-hidden="true" />
            Concentration labels (Low / Moderate / High) are descriptive. They are not
            suitability determinations. Appropriate concentration levels vary by investment strategy.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section 7 — Research Coverage Trend
// ---------------------------------------------------------------------------

function ResearchCoverageTrendChart({ analytics }: { analytics: PortfolioAnalyticsResult }) {
  const data = analytics.researchCoverageTrend;
  if (data.length < 2) {
    return (
      <ChartShell
        title="Research Coverage Trend"
        empty
        emptyMsg="At least 2 snapshots needed to show coverage trend."
      />
    );
  }
  const chartData = data.map(p => ({
    date:    fmtDate(p.snapshotDate),
    pct:     p.coveragePercent,
    count:   p.positionsWithOpportunityIntelligence,
    total:   p.positionCount,
  }));
  return (
    <ChartShell
      title="Research Coverage Trend"
      description="% of holdings with Opportunity Intelligence over time"
    >
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} tickFormatter={v => `${v}%`} width={40} />
          <ReTooltip
            formatter={(v: any, _n: any, props: any) => [
              `${Number(v).toFixed(0)}% (${props.payload.count}/${props.payload.total} positions)`,
              "Coverage",
            ]}
            contentStyle={{ fontSize: 11 }}
          />
          <Line type="monotone" dataKey="pct" stroke="#6366f1" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}

// ---------------------------------------------------------------------------
// Section 8 — Opportunity Overlap Trend
// ---------------------------------------------------------------------------

function OpportunityOverlapTrendChart({ analytics }: { analytics: PortfolioAnalyticsResult }) {
  const data = analytics.opportunityOverlapTrend;
  if (data.length < 2) {
    return (
      <ChartShell
        title="Opportunity Overlap Trend"
        empty
        emptyMsg="At least 2 snapshots needed to show overlap trend."
      />
    );
  }
  const chartData = data.map(p => ({
    date:      fmtDate(p.snapshotDate),
    qualified: p.qualifiedCount,
    approaching: p.approachingCount,
    notRanked: p.notRankedCount,
  }));
  return (
    <ChartShell
      title="Opportunity Overlap Trend"
      description="How holdings align with the Opportunity Intelligence snapshot over time"
    >
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} allowDecimals={false} width={30} />
          <ReTooltip contentStyle={{ fontSize: 11 }} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Bar dataKey="qualified"   name="Qualified"   stackId="a" fill="#10b981" />
          <Bar dataKey="approaching" name="Approaching" stackId="a" fill="#f59e0b" />
          <Bar dataKey="notRanked"   name="Not Ranked"  stackId="a" fill="#6b7280" />
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}

// ---------------------------------------------------------------------------
// Section 9 — Research Change Trend
// ---------------------------------------------------------------------------

function ResearchChangeTrendChart({ analytics }: { analytics: PortfolioAnalyticsResult }) {
  const data = analytics.researchChangeTrend;
  const hasAny = data.some(p =>
    p.strengthenedCount > 0 || p.weakenedCount > 0 ||
    p.newlyQualifiedCount > 0 || p.noLongerQualifiedCount > 0,
  );
  if (!hasAny || data.length < 2) {
    return (
      <ChartShell
        title="Research Change Activity"
        empty
        emptyMsg="No research change events recorded in this period."
      />
    );
  }
  const chartData = data.map(p => ({
    date:            fmtDate(p.snapshotDate),
    strengthened:    p.strengthenedCount,
    weakened:        p.weakenedCount,
    newlyQualified:  p.newlyQualifiedCount,
    noLongerQual:    p.noLongerQualifiedCount,
  }));
  return (
    <ChartShell
      title="Research Change Activity"
      description="Research evidence changes per snapshot period"
    >
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} allowDecimals={false} width={25} />
          <ReTooltip contentStyle={{ fontSize: 11 }} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Bar dataKey="strengthened"   name="Strengthened"    fill="#10b981" />
          <Bar dataKey="weakened"       name="Weakened"        fill="#ef4444" />
          <Bar dataKey="newlyQualified" name="Newly Qualified" fill="#6366f1" />
          <Bar dataKey="noLongerQual"   name="No Longer Qual." fill="#9ca3af" />
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}

// ---------------------------------------------------------------------------
// Section 10 — Coverage & Limitations
// ---------------------------------------------------------------------------

function CoverageLimitationsSection({ analytics }: { analytics: PortfolioAnalyticsResult }) {
  const c = analytics.coverage;
  const [open, setOpen] = useState(false);

  return (
    <section aria-label="Data coverage and limitations">
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
        <Shield className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        Data Coverage & Limitations
      </h3>
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 text-xs">
            <div>
              <p className="text-muted-foreground">Snapshots ({analytics.period})</p>
              <p className="font-medium">{c.snapshotCount}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Market Data Coverage</p>
              <p className="font-medium">
                {c.positionsTotal > 0
                  ? `${c.positionsWithMarketData}/${c.positionsTotal}`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Research Coverage</p>
              <p className="font-medium">
                {c.positionsTotal > 0
                  ? `${c.positionsWithOpportunityIntelligence}/${c.positionsTotal}`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Cost Basis Coverage</p>
              <p className="font-medium">
                {c.positionsTotal > 0
                  ? `${c.positionsWithCostBasis}/${c.positionsTotal}`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Sector Coverage</p>
              <p className="font-medium">
                {c.positionsTotal > 0
                  ? `${c.positionsWithSector}/${c.positionsTotal}`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Theme Coverage</p>
              <p className="font-medium">
                {c.positionsTotal > 0
                  ? `${c.positionsWithTheme}/${c.positionsTotal}`
                  : "—"}
              </p>
            </div>
          </div>

          {analytics.limitations.length > 0 && (
            <div className="mt-3 border-t pt-3">
              <button
                onClick={() => setOpen(o => !o)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                aria-expanded={open}
              >
                <AlertCircle className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                {analytics.limitations.length} limitation{analytics.limitations.length !== 1 ? "s" : ""} noted
                {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
              {open && (
                <ul className="mt-2 space-y-1">
                  {analytics.limitations.map((l, i) => (
                    <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                      <Minus className="h-3 w-3 mt-0.5 shrink-0" aria-hidden="true" />
                      {l}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Disclaimer footer
// ---------------------------------------------------------------------------

function AnalyticsDisclaimer({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-[10px] text-muted-foreground leading-relaxed">
      <Shield className="inline h-3 w-3 mr-1 text-muted-foreground" aria-hidden="true" />
      {text}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Period selector
// ---------------------------------------------------------------------------

function PeriodSelector({
  value,
  onChange,
}: {
  value:    AnalyticsPeriod;
  onChange: (p: AnalyticsPeriod) => void;
}) {
  return (
    <div className="flex gap-1 flex-wrap" role="group" aria-label="Analytics period">
      {PERIODS.map(p => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={`px-2 py-1 text-xs rounded font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            value === p
              ? "bg-primary text-primary-foreground border-primary"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
          aria-pressed={value === p}
        >
          {p}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function PortfolioAnalyticsTab({ portfolioId }: { portfolioId: string }) {
  const [period, setPeriod] = useState<AnalyticsPeriod>("30D");

  const { data, isLoading, isError, refetch } = useQuery<PortfolioAnalyticsResponse>({
    queryKey: [`/api/portfolio/${portfolioId}/analytics`, period],
    queryFn:  async () => {
      const res = await fetch(`/api/portfolio/${portfolioId}/analytics?period=${period}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 4 * 60 * 1000, // 4 min — slightly under 5-min server cache
    retry:     1,
  });

  // ── Loading ───────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-16 gap-2">
        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading analytics…" />
        <span className="text-sm text-muted-foreground">Loading analytics…</span>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (isError || !data?.available) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4 text-center px-4">
        <AlertCircle className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium">Analytics Unavailable</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm">
            {data?.message ?? "Portfolio analytics could not be loaded. Capture a snapshot from the History tab to enable analytics."}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" aria-hidden="true" /> Retry
        </Button>
      </div>
    );
  }

  const analytics = data.analytics!;

  return (
    <div className="space-y-8 py-4">
      {/* Period selector */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-sm font-semibold">Portfolio Analytics</h2>
          <p className="text-xs text-muted-foreground">
            {analytics.portfolioName} · {PERIOD_LABELS[period]} view
          </p>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {/* §1 — Value Summary */}
      <ValueSummarySection analytics={analytics} />

      {/* §2 — Value History Chart */}
      <ValueHistoryChart analytics={analytics} />

      {/* §3 & §4 — Position + Sector allocation (side by side on wide screens) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PositionAllocationChart
          items={analytics.positionAllocation}
          totalMV={analytics.valueChangeSummary.endingValue}
        />
        <SectorAllocationChart items={analytics.sectorAllocation} />
      </div>

      {/* §5 — Theme Allocation */}
      <ThemeAllocationChart items={analytics.themeAllocation} />

      {/* §6 — Concentration */}
      <ConcentrationSection analytics={analytics} />

      {/* §7 — Research Coverage Trend */}
      <ResearchCoverageTrendChart analytics={analytics} />

      {/* §8 & §9 — Overlap + Research Change trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <OpportunityOverlapTrendChart analytics={analytics} />
        <ResearchChangeTrendChart analytics={analytics} />
      </div>

      {/* §10 — Coverage & Limitations */}
      <CoverageLimitationsSection analytics={analytics} />

      {/* Disclaimer */}
      <AnalyticsDisclaimer text={analytics.disclaimer} />

      {/* Freshness footer */}
      <p className="text-[10px] text-muted-foreground text-center">
        Analytics generated {fmtDateTime(analytics.generatedAt)} ·{" "}
        {analytics.freshness.snapshotCount} snapshot{analytics.freshness.snapshotCount !== 1 ? "s" : ""} in period ·{" "}
        {analytics.freshness.institutionalDataNote}
      </p>
    </div>
  );
}

export default PortfolioAnalyticsTab;
