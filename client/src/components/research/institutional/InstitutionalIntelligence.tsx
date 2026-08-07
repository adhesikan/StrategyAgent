// InstitutionalIntelligence — Sprint 2.2.5.
//
// Full Institutional Intelligence tab component.
// Replaces the InstitutionalTab placeholder in opportunity-research.tsx.
//
// Sections:
//   A. Data Freshness and Limitations
//   B. Reported Holdings Trend
//   C. Reporting Manager Activity
//   D. Largest Reported Holders (sortable table)
//   E. Reported Holder Concentration
//   F. Evidence Alignment
//   G. Source and Methodology (expandable)
//
// RULES:
//   - No fake sample numbers.
//   - No predictive wording ("will", "should", "expect").
//   - No "Institutional Ownership" label (use "13F Reported Holdings").
//   - No "Smart Money" language.
//   - Limitations always visible.
//   - Denominator for concentration always explicit.
//   - Put/call and PRN rows never in share totals.
//   - Filing date vs period of report never swapped.

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Building2, AlertTriangle, RefreshCcw, ChevronDown, ChevronUp,
  ArrowUp, ArrowDown, Minus, ExternalLink, Info, TrendingUp, TrendingDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import type { InstitutionalData, LargestHolderEntry, HistoricalQuarterEntry } from "./types";
import {
  formatShares, formatValueThousands, formatPctChange, formatConcentrationPct,
  formatDate, formatPeriodOfReport, trendColorClass, alignmentColorClass,
  activityBadge, type TrendState,
} from "./types";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-2">
      {children}
    </p>
  );
}

function StatCard({
  label, value, valueClass, sub,
}: {
  label: string;
  value: React.ReactNode;
  valueClass?: string;
  sub?: string;
}) {
  return (
    <div className="rounded border border-border/40 bg-muted/10 px-3 py-2">
      <p className="text-[10px] text-muted-foreground leading-none mb-1">{label}</p>
      <p className={cn("text-[14px] font-semibold leading-snug", valueClass)}>{value}</p>
      {sub && <p className="text-[9px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section A — Freshness and Limitations
// ---------------------------------------------------------------------------

function FreshnessLimitationsSection({
  data,
}: {
  data: InstitutionalData;
}) {
  const freshnessColor =
    data.freshness?.status === "stale"
      ? "text-rose-400"
      : data.freshness?.status === "prior_quarter"
      ? "text-amber-400"
      : "text-sky-300";

  return (
    <div className="space-y-3" data-testid="institutional-freshness">
      {/* Prominent disclosure banner */}
      <div className="rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 flex gap-2">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
        <p className="text-[11px] text-amber-200/90 leading-relaxed">
          Form 13F information is periodic and delayed. Holdings reflect the stated
          quarter-end reporting period and may have changed since then.
        </p>
      </div>

      {/* Freshness stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Period of Report"
          value={
            data.periodOfReport
              ? (() => {
                  const d = new Date(data.periodOfReport);
                  const y = d.getUTCFullYear();
                  const m = d.getUTCMonth() + 1;
                  const q = m <= 3 ? 1 : m <= 6 ? 2 : m <= 9 ? 3 : 4;
                  return `${y}-Q${q}`;
                })()
              : "N/A"
          }
          sub={data.periodOfReport ? formatDate(data.periodOfReport) : undefined}
        />
        <StatCard label="Latest Filing Date" value={formatDate(data.latestFilingDate)} />
        <StatCard
          label="Data Freshness"
          value={
            data.freshness?.status === "current_quarter"
              ? "Current"
              : data.freshness?.status === "prior_quarter"
              ? "Prior Quarter"
              : data.freshness?.status === "stale"
              ? "Stale"
              : "N/A"
          }
          valueClass={freshnessColor}
          sub={
            data.freshness
              ? `${data.freshness.daysSincePeriodEnd}d since period end`
              : undefined
          }
        />
        <StatCard label="Source" value="SEC Form 13F" sub="Public quarterly filing" />
      </div>

      {/* Coverage warnings */}
      {(data.coverage?.warnings ?? []).length > 0 && (
        <div className="space-y-1">
          {data.coverage!.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11px] text-amber-300">
              <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* Coverage stats */}
      <div className="text-[10px] text-muted-foreground">
        Mapping: {data.coverage?.eligibleHoldingCount ?? 0} eligible holding rows included •{" "}
        {data.coverage?.excludedHoldingCount ?? 0} excluded (put/call, PRN, unmapped)
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section B — Reported Holdings Trend
// ---------------------------------------------------------------------------

function TrendSection({ data }: { data: InstitutionalData }) {
  const { summary, historicalQuarters } = data;
  const trend = (summary?.trend ?? "unavailable") as TrendState;
  const trendLbl = summary?.trendLabel ?? "Unavailable";

  // Build chart data (chronological order, actual historical quarters only — no interpolation)
  const chartData = historicalQuarters.map((q) => ({
    name: q.periodLabel,
    shares: q.aggregateReportedShares ?? 0,
    managers: q.reportingManagerCount,
  }));

  const isCurrentTrendPositive = trend === "increasing";
  const isCurrentTrendNegative = trend === "decreasing";

  return (
    <div className="space-y-3" data-testid="institutional-trend">
      <SectionLabel>13F Reported Holdings Trend</SectionLabel>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="13F Reported Holdings Trend"
          value={trendLbl}
          valueClass={trendColorClass(trend)}
        />
        <StatCard
          label="Reported Shares Change"
          value={formatPctChange(summary?.reportedSharesChangePercent)}
          valueClass={
            summary?.reportedSharesChangePercent != null
              ? summary.reportedSharesChangePercent >= 0
                ? "text-emerald-400"
                : "text-rose-400"
              : ""
          }
          sub="Quarter-over-quarter"
        />
        <StatCard
          label="Current Quarter Shares"
          value={formatShares(summary?.aggregateReportedShares)}
          sub="Aggregate reported (eligible)"
        />
        <StatCard
          label="Prior Quarter Shares"
          value={formatShares(summary?.reportedSharesChange != null && summary?.aggregateReportedShares != null
            ? summary.aggregateReportedShares - summary.reportedSharesChange
            : null)}
          sub="Previous comparable quarter"
        />
      </div>

      {/* Historical chart — actual data only, no interpolation */}
      {chartData.length >= 2 && (
        <div>
          <p className="text-[10px] text-muted-foreground mb-2">
            Aggregate Reported Shares — up to 8 quarters (actual data only)
          </p>
          <div className="h-[120px]" data-testid="institutional-trend-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip
                  formatter={(v: any) => [formatShares(v), "Reported Shares"]}
                  labelStyle={{ fontSize: 10 }}
                  contentStyle={{ fontSize: 10, backgroundColor: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)" }}
                />
                <Bar dataKey="shares" radius={[2, 2, 0, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={
                        i === chartData.length - 1
                          ? isCurrentTrendPositive
                            ? "#34d399"
                            : isCurrentTrendNegative
                            ? "#f87171"
                            : "#60a5fa"
                          : "rgba(96, 165, 250, 0.4)"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {chartData.length < 2 && (
        <p className="text-[11px] text-muted-foreground">
          A minimum of two comparable quarters is required for a trend chart.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section C — Reporting Manager Activity
// ---------------------------------------------------------------------------

function ManagerActivitySection({ data }: { data: InstitutionalData }) {
  const activity = data.managerActivity;
  if (!activity) return null;

  const total = activity.new + activity.increased + activity.reduced + activity.exited + activity.unchanged;

  const bars: Array<{ label: string; count: number; color: string }> = [
    { label: "New", count: activity.new, color: "bg-emerald-500/70" },
    { label: "Increased", count: activity.increased, color: "bg-sky-500/70" },
    { label: "Unchanged", count: activity.unchanged, color: "bg-muted/50" },
    { label: "Reduced", count: activity.reduced, color: "bg-amber-500/70" },
    { label: "Exited", count: activity.exited, color: "bg-rose-500/70" },
  ];

  return (
    <div className="space-y-3" data-testid="institutional-manager-activity">
      <SectionLabel>Reporting Manager Activity</SectionLabel>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        These categories reflect changes between disclosed quarter-end positions, not known
        transaction dates. "New" means a manager had no prior comparable-quarter position.
        "Exited" means no current position where one existed previously.
      </p>

      <div className="grid grid-cols-5 gap-2">
        {bars.map((b) => (
          <div key={b.label} className="text-center">
            <div className={cn("h-8 rounded flex items-end justify-center", b.color, total > 0 ? "" : "opacity-30")}>
              <span className="text-[10px] font-bold text-white pb-1">{b.count}</span>
            </div>
            <p className="text-[9px] text-muted-foreground mt-1">{b.label}</p>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground">
        Total reporting managers with 13F eligible positions: {data.summary?.reportingManagerCount ?? 0}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section D — Largest Reported Holders
// ---------------------------------------------------------------------------

type SortKey = "shares" | "value" | "change";

function LargestHoldersSection({ data }: { data: InstitutionalData }) {
  const [sortKey, setSortKey] = useState<SortKey>("shares");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const arr = [...data.largestReportedHolders];
    return arr.sort((a, b) => {
      let va = 0, vb = 0;
      if (sortKey === "shares") { va = a.reportedShares; vb = b.reportedShares; }
      else if (sortKey === "value") { va = a.reportedValue ?? 0; vb = b.reportedValue ?? 0; }
      else { va = a.quarterChangeShares ?? -Infinity; vb = b.quarterChangeShares ?? -Infinity; }
      return sortDir === "desc" ? vb - va : va - vb;
    });
  }, [data.largestReportedHolders, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <Minus className="h-2.5 w-2.5 text-muted-foreground/40" />;
    return sortDir === "desc"
      ? <ArrowDown className="h-2.5 w-2.5 text-primary" />
      : <ArrowUp className="h-2.5 w-2.5 text-primary" />;
  }

  if (data.largestReportedHolders.length === 0) {
    return (
      <div data-testid="institutional-holders">
        <SectionLabel>Largest Reported Holders</SectionLabel>
        <p className="text-[11px] text-muted-foreground">No holder data available.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="institutional-holders">
      <SectionLabel>Largest Reported Holders</SectionLabel>
      <p className="text-[10px] text-muted-foreground">
        Reported value is the value as filed (thousands USD × 1,000), not necessarily current market value.
        Filings reflect position at quarter end, not the filing date.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-[11px]" aria-label="Largest reported 13F holders">
          <thead>
            <tr className="border-b border-border/30">
              <th className="text-left py-1.5 text-[10px] text-muted-foreground font-medium pr-3">Manager</th>
              <th className="text-right py-1.5">
                <button
                  className="flex items-center gap-0.5 ml-auto text-[10px] text-muted-foreground hover:text-foreground"
                  onClick={() => toggleSort("shares")}
                  aria-label="Sort by reported shares"
                >
                  Reported Shares <SortIcon k="shares" />
                </button>
              </th>
              <th className="text-right py-1.5 hidden sm:table-cell">
                <button
                  className="flex items-center gap-0.5 ml-auto text-[10px] text-muted-foreground hover:text-foreground"
                  onClick={() => toggleSort("value")}
                  aria-label="Sort by reported value"
                >
                  Reported Value <SortIcon k="value" />
                </button>
              </th>
              <th className="text-right py-1.5">
                <button
                  className="flex items-center gap-0.5 ml-auto text-[10px] text-muted-foreground hover:text-foreground"
                  onClick={() => toggleSort("change")}
                  aria-label="Sort by QoQ change"
                >
                  QoQ Change <SortIcon k="change" />
                </button>
              </th>
              <th className="text-right py-1.5 text-[10px] text-muted-foreground font-medium">Activity</th>
              <th className="text-right py-1.5 text-[10px] text-muted-foreground font-medium hidden sm:table-cell">Filing Date</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((h, i) => {
              const badge = activityBadge(h.activity);
              return (
                <tr key={i} className="border-b border-border/20 hover:bg-accent/10 transition-colors">
                  <td className="py-1.5 pr-3 max-w-[180px]">
                    <p className="truncate font-medium">{h.managerName}</p>
                    <p className="text-[9px] text-muted-foreground">CIK: {h.managerCik}</p>
                  </td>
                  <td className="py-1.5 text-right font-mono">{formatShares(h.reportedShares)}</td>
                  <td className="py-1.5 text-right hidden sm:table-cell">{formatValueThousands(h.reportedValue)}</td>
                  <td className={cn("py-1.5 text-right font-mono", (h.quarterChangeShares ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                    {h.quarterChangeShares != null
                      ? `${h.quarterChangeShares >= 0 ? "+" : ""}${formatShares(h.quarterChangeShares)}`
                      : "N/A"}
                  </td>
                  <td className="py-1.5 text-right">
                    <span className={cn("text-[9px] border rounded px-1 py-0.5", badge.className)}>
                      {badge.label}
                    </span>
                  </td>
                  <td className="py-1.5 text-right text-muted-foreground hidden sm:table-cell">
                    {formatDate(h.filingDate)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section E — Reported Holder Concentration
// ---------------------------------------------------------------------------

function ConcentrationSection({ data }: { data: InstitutionalData }) {
  const { concentration } = data;
  if (!concentration) return null;

  const classColor = (c: string) => {
    if (c === "high") return "text-rose-400";
    if (c === "moderate") return "text-amber-400";
    if (c === "low") return "text-emerald-400";
    return "text-muted-foreground";
  };

  return (
    <div className="space-y-3" data-testid="institutional-concentration">
      <SectionLabel>Reported Holder Concentration</SectionLabel>

      <p className="text-[10px] text-muted-foreground">
        Share of mapped eligible 13F-reported shares. Thresholds: Low &lt;40%, Moderate 40–70%, High &gt;70%.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Classification"
          value={concentration.classification.charAt(0).toUpperCase() + concentration.classification.slice(1)}
          valueClass={classColor(concentration.classification)}
        />
        <StatCard
          label="Top Holder"
          value={formatConcentrationPct(concentration.topHolderPercentOfReportedShares)}
          sub="Share of reported 13F shares"
        />
        <StatCard
          label="Top 5 Holders"
          value={formatConcentrationPct(concentration.top5PercentOfReportedShares)}
          sub="Share of reported 13F shares"
        />
        <StatCard
          label="Top 10 Holders"
          value={formatConcentrationPct(concentration.top10PercentOfReportedShares)}
          sub="Share of reported 13F shares"
        />
      </div>

      <p className="text-[10px] text-muted-foreground italic">
        Denominator: aggregate mapped eligible 13F-reported shares for {data.summary ? data.summary.reportingManagerCount + " reporting managers" : "this quarter"} —
        not total issued shares or total institutional ownership.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section F — Evidence Alignment
// ---------------------------------------------------------------------------

function EvidenceAlignmentSection({ data }: { data: InstitutionalData }) {
  const { evidenceAlignment } = data;

  return (
    <div className="space-y-3" data-testid="institutional-evidence-alignment">
      <SectionLabel>13F Evidence Alignment</SectionLabel>

      <div className="flex items-center gap-3">
        <span className={cn("text-[16px] font-semibold", alignmentColorClass(evidenceAlignment.state))}>
          {evidenceAlignment.label}
        </span>
      </div>

      {evidenceAlignment.reasons.length > 0 && (
        <ul className="space-y-1">
          {evidenceAlignment.reasons.map((r, i) => (
            <li key={i} className="flex items-start gap-2 text-[11px] text-muted-foreground">
              <Info className="h-3 w-3 shrink-0 mt-0.5 text-muted-foreground/50" />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[10px] text-muted-foreground italic">
        This assessment is deterministic and based solely on 13F reported holdings data.
        It does not constitute investment advice or a prediction of future returns.
        Institutional participation in a company's stock does not imply a recommendation to buy or sell.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section G — Source and Methodology
// ---------------------------------------------------------------------------

function MethodologySection({ data }: { data: InstitutionalData }) {
  const [open, setOpen] = useState(false);

  return (
    <div data-testid="institutional-methodology">
      <button
        className="flex items-center justify-between w-full text-left py-2"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Toggle source and methodology"
      >
        <SectionLabel>Source &amp; Methodology</SectionLabel>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>

      {open && (
        <div className="space-y-4 pt-1">
          <div className="space-y-2">
            <p className="text-[11px] font-medium">Form 13F</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Form 13F is a quarterly filing required from institutional investment managers with
              over $100 million in qualifying securities. Filers must report long positions in
              13F-reportable securities within 45 days of each calendar quarter end.
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] font-medium">Included / Excluded Holdings</p>
            <ul className="space-y-1 text-[11px] text-muted-foreground">
              <li>• Common stock positions (SH type) with exact or reviewed CUSIP mapping are included in share totals.</li>
              <li>• Put and call option entries are preserved separately and <strong>never</strong> mixed into common-stock share totals.</li>
              <li>• PRN (principal amount) entries are excluded from share-count aggregations.</li>
              <li>• Holdings with unmapped or ambiguous CUSIP are excluded from production aggregates.</li>
            </ul>
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] font-medium">Amendment Treatment</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              When a filer submits a 13F-HR/A amendment, the most recent effective filing for that
              filer and quarter supersedes earlier versions. Both the original and amendment are
              retained for auditability. Double-counting between original and amended filings is
              prevented by marking earlier filings as non-effective.
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] font-medium">Identifier Mapping</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              CUSIP identifiers are mapped to VCP Trader internal symbols. Only exact (CUSIP match)
              and reviewed (manually verified) mappings are used in production aggregates.
              Probable and ambiguous mappings are available for diagnostic use only.
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] font-medium">Period vs Filing Date</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              The "Period of Report" is the quarter-end date the holdings reflect.
              The "Filing Date" is when the form was submitted to SEC EDGAR.
              Holdings may have changed between these dates.
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] font-medium">Limitations</p>
            <ul className="space-y-1 text-[11px] text-muted-foreground">
              {data.limitations.map((l, i) => (
                <li key={i}>• {l}</li>
              ))}
            </ul>
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] font-medium">Source Links</p>
            <ul className="space-y-1">
              {data.sourceLinks.map((s, i) => (
                <li key={i}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[11px] text-primary hover:underline"
                  >
                    {s.label}
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading / error states
// ---------------------------------------------------------------------------

function LoadingState() {
  return (
    <div className="flex flex-col items-center gap-3 py-8" data-testid="institutional-loading">
      <RefreshCcw className="h-5 w-5 animate-spin text-muted-foreground" />
      <p className="text-[12px] text-muted-foreground">Loading 13F institutional data…</p>
    </div>
  );
}

function UnavailableState({ symbol, reasons }: { symbol: string; reasons: string[] }) {
  return (
    <div className="space-y-4" data-testid="institutional-unavailable">
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <Building2 className="h-8 w-8 text-muted-foreground/40" />
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            13F institutional data is not available for {symbol}.
          </p>
          {reasons.map((r, i) => (
            <p key={i} className="text-[11px] text-muted-foreground mt-1 max-w-sm mx-auto leading-relaxed">
              {r}
            </p>
          ))}
        </div>
      </div>

      <div className="rounded border border-border/40 bg-muted/20 px-4 py-3">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-2">
          About 13F Reported Holdings
        </p>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          SEC Form 13F requires institutional investment managers with over $100 million in qualifying
          securities to report their long positions quarterly. Holdings reflect the quarter-end date
          and are not real-time or complete.
        </p>
        <a
          href="https://efts.sec.gov/LATEST/search-index?q=%2213F-HR%22&forms=13F-HR"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 mt-2 text-[11px] text-primary hover:underline"
        >
          Search 13F filings on SEC EDGAR <ExternalLink className="h-2.5 w-2.5" />
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top summary bar
// ---------------------------------------------------------------------------

function TopSummaryBar({ data }: { data: InstitutionalData }) {
  const { summary, evidenceAlignment, freshness, periodOfReport, latestFilingDate } = data;
  const trend = summary?.trend ?? "unavailable";
  const trendLbl = summary?.trendLabel ?? "Unavailable";
  const pct = summary?.reportedSharesChangePercent;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="institutional-summary">
      <StatCard
        label="13F Reported Holdings Trend"
        value={trendLbl}
        valueClass={trendColorClass(trend)}
      />
      <StatCard
        label="Reporting Managers"
        value={summary?.reportingManagerCount ? summary.reportingManagerCount.toLocaleString() : "N/A"}
      />
      <StatCard
        label="Reported Shares Change"
        value={pct != null ? formatPctChange(pct) : "N/A"}
        valueClass={pct != null ? (pct >= 0 ? "text-emerald-400" : "text-rose-400") : ""}
        sub="QoQ"
      />
      <StatCard
        label="Data Through"
        value={periodOfReport
          ? (() => {
              const d = new Date(periodOfReport);
              const y = d.getUTCFullYear();
              const m = d.getUTCMonth() + 1;
              const q = m <= 3 ? 1 : m <= 6 ? 2 : m <= 9 ? 3 : 4;
              return `${y}-Q${q}`;
            })()
          : "N/A"}
        sub={periodOfReport ? formatDate(periodOfReport) : undefined}
      />
      <StatCard
        label="Latest Filing Used"
        value={formatDate(latestFilingDate)}
      />
      <StatCard
        label="Evidence Alignment"
        value={evidenceAlignment.label}
        valueClass={alignmentColorClass(evidenceAlignment.state)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

interface Props {
  symbol: string;
}

export function InstitutionalIntelligence({ symbol }: Props) {
  const { data, isLoading, isError } = useQuery<InstitutionalData>({
    queryKey: ["institutional", symbol],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/institutional/${symbol}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 15 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 1,
  });

  if (isLoading) {
    return (
      <Card className="border-border/40" data-testid="tab-institutional">
        <CardHeader className="px-4 py-3">
          <CardTitle className="text-[13px] font-medium flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
            Institutional Intelligence
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-6 pt-0">
          <LoadingState />
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card className="border-border/40" data-testid="tab-institutional">
        <CardHeader className="px-4 py-3">
          <CardTitle className="text-[13px] font-medium flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
            Institutional Intelligence
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-6 pt-0">
          <UnavailableState symbol={symbol} reasons={["Unable to load institutional data."]} />
        </CardContent>
      </Card>
    );
  }

  const isUnavailable = data.status === "unavailable";

  return (
    <Card className="border-border/40" data-testid="tab-institutional">
      <CardHeader className="px-4 py-3">
        <CardTitle className="text-[13px] font-medium flex items-center gap-1.5">
          <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
          Institutional Intelligence
          {data.source && (
            <Badge variant="outline" className="text-[9px] border-border/40 text-muted-foreground ml-1">
              {data.source}
            </Badge>
          )}
          {(data.status === "stale" || data.status === "partial") && (
            <Badge variant="outline" className="text-[9px] border-amber-500/40 text-amber-400 ml-1">
              {data.status}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-6 pt-0 space-y-6">
        {isUnavailable ? (
          <UnavailableState symbol={symbol} reasons={data.evidenceAlignment.reasons} />
        ) : (
          <>
            {/* Top summary */}
            <TopSummaryBar data={data} />
            <hr className="border-border/20" />

            {/* A. Freshness and Limitations */}
            <FreshnessLimitationsSection data={data} />
            <hr className="border-border/20" />

            {/* B. Trend */}
            <TrendSection data={data} />
            <hr className="border-border/20" />

            {/* C. Manager Activity */}
            <ManagerActivitySection data={data} />
            <hr className="border-border/20" />

            {/* D. Largest Holders */}
            <LargestHoldersSection data={data} />
            <hr className="border-border/20" />

            {/* E. Concentration */}
            <ConcentrationSection data={data} />
            <hr className="border-border/20" />

            {/* F. Evidence Alignment */}
            <EvidenceAlignmentSection data={data} />
            <hr className="border-border/20" />

            {/* G. Methodology */}
            <MethodologySection data={data} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
