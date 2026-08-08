// /institutional/funds/:managerId — Sprint 2.3.2
// Institutional Fund Detail Page — reported holdings, QoQ changes, history.
//
// Compliance rules:
//   - "Reported Holdings" not "Best Holdings"
//   - "Newly Reported Position" not "New Buy"
//   - "Increased Reported Position" not "Bought More"
//   - "Reduced Reported Position" not "Sold"
//   - "No Longer Reported" / "Exited Reported Position" not "Sold Out"
//   - Delayed-data disclosure on every section.
//   - No investment recommendations.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  Building2,
  TrendingUp,
  TrendingDown,
  Minus,
  Search,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Clock,
  AlertCircle,
  Info,
  BarChart2,
  History,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types (mirror /api/institutional/funds/:managerId response)
// ---------------------------------------------------------------------------

interface HoldingRow {
  ticker: string | null;
  issuerName: string;
  cusip: string;
  reportedShares: number;
  reportedValue: number;
  portfolioWeight: number;
  previousShares: number | null;
  shareChange: number | null;
  shareChangePct: number | null;
  changeType: "NEW" | "INCREASED" | "UNCHANGED" | "REDUCED" | "EXITED";
  mappingStatus: string;
}

interface FundDetail {
  managerId: string;
  managerName: string;
  latestQuarter: string;
  previousQuarter: string | null;
  latestPeriodEndDate: string;
  lastFiledAt: string;
  accessionNumber: string;
  sourceUrl: string | null;
  reportedPortfolioValue: number;
  reportedPositionCount: number;
  newPositionsCount: number;
  exitedPositionsCount: number;
  increasedPositionsCount: number;
  reducedPositionsCount: number;
  quarterChangePositionCount: number;
  topHoldings: HoldingRow[];
  newPositions: HoldingRow[];
  exitedPositions: HoldingRow[];
  increasedPositions: HoldingRow[];
  reducedPositions: HoldingRow[];
  dataQuality: {
    mappedCount: number;
    unmappedCount: number;
    totalCount: number;
    coveragePercent: number;
    hasPreviousQuarter: boolean;
    isAmended: boolean;
    filingFreshnessDays: number;
  };
  disclosure: {
    filingDelayDisclaimer: string;
    dataAsOf: string;
  };
}

interface HistoryEntry {
  quarter: string;
  periodEndDate: string;
  reportedPortfolioValue: number;
  positionCount: number;
  newPositions: number;
  exitedPositions: number;
  lastFiledAt: string;
}

interface HistoryResponse {
  managerId: string;
  history: HistoryEntry[];
}

type Section = "overview" | "top" | "new" | "increased" | "reduced" | "exited" | "history";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUSD(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function formatShares(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch { return dateStr; }
}

function formatPct(n: number | null): string {
  if (n === null) return "—";
  return (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
}

const CHANGE_BADGE: Record<HoldingRow["changeType"], { label: string; cls: string }> = {
  NEW:       { label: "Newly Reported",   cls: "border-emerald-700 bg-emerald-950/40 text-emerald-300" },
  INCREASED: { label: "Increased",        cls: "border-sky-700 bg-sky-950/40 text-sky-300" },
  UNCHANGED: { label: "Unchanged",        cls: "border-slate-700 bg-slate-900 text-slate-400" },
  REDUCED:   { label: "Reduced",          cls: "border-orange-700 bg-orange-950/40 text-orange-300" },
  EXITED:    { label: "No Longer Reported", cls: "border-rose-700 bg-rose-950/40 text-rose-300" },
};

// ---------------------------------------------------------------------------
// Disclosure Banner
// ---------------------------------------------------------------------------

function DelayedDataBanner({ disclaimer }: { disclaimer: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-800/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-200/80">
      <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-400" aria-hidden />
      <span>{disclaimer}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Holdings Table
// ---------------------------------------------------------------------------

function HoldingRow({
  row,
  showQoQ,
  onTickerClick,
}: {
  row: HoldingRow;
  showQoQ: boolean;
  onTickerClick?: (ticker: string) => void;
}) {
  const badge = CHANGE_BADGE[row.changeType];

  return (
    <tr className="border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors">
      <td className="py-2.5 pr-3 text-sm">
        {row.ticker ? (
          <button
            onClick={() => onTickerClick?.(row.ticker!)}
            className="font-mono font-semibold text-sky-400 hover:text-sky-300 transition-colors"
            aria-label={`View ${row.ticker} research`}
          >
            {row.ticker}
          </button>
        ) : (
          <span className="font-mono text-slate-500 text-xs" title={`CUSIP: ${row.cusip}`}>
            {row.cusip}
          </span>
        )}
      </td>
      <td className="py-2.5 pr-3 text-xs text-slate-400 max-w-[180px] truncate">
        {row.issuerName}
      </td>
      <td className="py-2.5 pr-3 text-sm font-mono text-slate-200 text-right">
        {formatUSD(row.reportedValue)}
      </td>
      <td className="py-2.5 pr-3 text-xs text-slate-400 text-right">
        {row.portfolioWeight > 0 ? row.portfolioWeight.toFixed(2) + "%" : "—"}
      </td>
      <td className="py-2.5 pr-3 text-xs font-mono text-slate-400 text-right">
        {formatShares(row.reportedShares)}
      </td>
      {showQoQ && (
        <>
          <td className="py-2.5 pr-3 text-xs font-mono text-right">
            {row.shareChange === null ? (
              <span className="text-slate-600">—</span>
            ) : (
              <span className={row.shareChange >= 0 ? "text-emerald-400" : "text-rose-400"}>
                {row.shareChange >= 0 ? "+" : ""}{formatShares(row.shareChange)}
              </span>
            )}
          </td>
          <td className="py-2.5 text-right">
            <span className={cn("text-[9px] rounded border px-1.5 py-0.5", badge.cls)}>
              {badge.label}
            </span>
          </td>
        </>
      )}
    </tr>
  );
}

function HoldingsTable({
  holdings,
  showQoQ,
  emptyLabel,
  onTickerClick,
}: {
  holdings: HoldingRow[];
  showQoQ: boolean;
  emptyLabel: string;
  onTickerClick?: (ticker: string) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = search
    ? holdings.filter(
        h =>
          h.issuerName.toLowerCase().includes(search.toLowerCase()) ||
          (h.ticker ?? "").toLowerCase().includes(search.toLowerCase()) ||
          h.cusip.toLowerCase().includes(search.toLowerCase()),
      )
    : holdings;

  if (holdings.length === 0) {
    return (
      <p className="text-sm text-slate-500 py-6 text-center">{emptyLabel}</p>
    );
  }

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" aria-hidden />
        <input
          type="text"
          placeholder="Filter by ticker or issuer…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-8 pr-3 py-1.5 rounded-md bg-slate-900 border border-slate-700 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-sky-700"
          aria-label="Filter holdings"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="pb-2 pr-3 text-[10px] uppercase tracking-wide text-slate-500 font-medium">Ticker</th>
              <th className="pb-2 pr-3 text-[10px] uppercase tracking-wide text-slate-500 font-medium">Issuer</th>
              <th className="pb-2 pr-3 text-[10px] uppercase tracking-wide text-slate-500 font-medium text-right">Reported Value</th>
              <th className="pb-2 pr-3 text-[10px] uppercase tracking-wide text-slate-500 font-medium text-right">Weight</th>
              <th className="pb-2 pr-3 text-[10px] uppercase tracking-wide text-slate-500 font-medium text-right">Shares</th>
              {showQoQ && (
                <>
                  <th className="pb-2 pr-3 text-[10px] uppercase tracking-wide text-slate-500 font-medium text-right">QoQ Change</th>
                  <th className="pb-2 text-[10px] uppercase tracking-wide text-slate-500 font-medium text-right">Type</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, i) => (
              <HoldingRow
                key={`${row.cusip}-${i}`}
                row={row}
                showQoQ={showQoQ}
                onTickerClick={onTickerClick}
              />
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && search && (
          <p className="text-xs text-slate-500 text-center py-4">No holdings match "{search}"</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview section
// ---------------------------------------------------------------------------

function OverviewSection({ detail }: { detail: FundDetail }) {
  const dq = detail.dataQuality;
  const hasQoQ = dq.hasPreviousQuarter;

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg bg-slate-900 border border-slate-800 p-3">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Reported Value</p>
          <p className="text-xl font-bold text-slate-100">{formatUSD(detail.reportedPortfolioValue)}</p>
        </div>
        <div className="rounded-lg bg-slate-900 border border-slate-800 p-3">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Positions</p>
          <p className="text-xl font-bold text-slate-100">{detail.reportedPositionCount}</p>
        </div>
        {hasQoQ && (
          <>
            <div className="rounded-lg bg-slate-900 border border-slate-800 p-3">
              <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">New Reported</p>
              <p className="text-xl font-bold text-emerald-400">{detail.newPositionsCount}</p>
            </div>
            <div className="rounded-lg bg-slate-900 border border-slate-800 p-3">
              <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Exited</p>
              <p className="text-xl font-bold text-rose-400">{detail.exitedPositionsCount}</p>
            </div>
          </>
        )}
      </div>

      {/* QoQ summary */}
      {hasQoQ && detail.quarterChangePositionCount > 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
          <p className="text-xs font-medium text-slate-300 mb-2">Quarter-over-Quarter Activity</p>
          <div className="flex flex-wrap gap-3 text-xs">
            <span className="text-emerald-400">{detail.newPositionsCount} newly reported</span>
            <span className="text-sky-400">{detail.increasedPositionsCount} increased reported</span>
            <span className="text-orange-400">{detail.reducedPositionsCount} reduced reported</span>
            <span className="text-rose-400">{detail.exitedPositionsCount} no longer reported</span>
          </div>
          <p className="text-[10px] text-slate-600 mt-2">
            Compared to {detail.previousQuarter}. Reflects changes in Form 13F reporting only.
          </p>
        </div>
      )}

      {/* Data quality */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-3 text-xs">
        <p className="text-slate-400 font-medium mb-2">Data Quality</p>
        <div className="space-y-1 text-slate-500">
          <div className="flex justify-between">
            <span>Mapped tickers</span>
            <span className={cn("font-mono", dq.coveragePercent >= 75 ? "text-emerald-400" : dq.coveragePercent >= 50 ? "text-amber-400" : "text-rose-400")}>
              {dq.mappedCount}/{dq.totalCount} ({dq.coveragePercent}%)
            </span>
          </div>
          <div className="flex justify-between">
            <span>Filing freshness</span>
            <span className={cn("font-mono", dq.filingFreshnessDays <= 90 ? "text-emerald-400" : "text-amber-400")}>
              {dq.filingFreshnessDays >= 0 ? `${dq.filingFreshnessDays} days ago` : "Unknown"}
            </span>
          </div>
          {dq.isAmended && (
            <div className="flex justify-between">
              <span>Filing type</span>
              <Badge className="text-[9px] border border-amber-700 bg-amber-950/40 text-amber-300">Amended</Badge>
            </div>
          )}
          {detail.sourceUrl && (
            <div className="flex justify-between items-center pt-1">
              <span>Source</span>
              <a
                href={detail.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sky-400 hover:text-sky-300 transition-colors"
              >
                SEC EDGAR <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// History section
// ---------------------------------------------------------------------------

function HistorySection({ managerId }: { managerId: string }) {
  const histQuery = useQuery<HistoryResponse>({
    queryKey: ["/api/institutional/funds/history", managerId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/institutional/funds/${managerId}/history`);
      if (!res.ok) throw new Error("Failed to load history");
      return res.json();
    },
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });

  if (histQuery.isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full bg-slate-800/60" />)}
      </div>
    );
  }

  if (histQuery.isError) {
    return <p className="text-sm text-slate-500 py-4">Failed to load quarterly history.</p>;
  }

  const history = histQuery.data?.history ?? [];

  if (history.length === 0) {
    return <p className="text-sm text-slate-500 py-4">No quarterly history available.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-slate-800">
            <th className="pb-2 pr-4 text-[10px] uppercase tracking-wide text-slate-500 font-medium">Quarter</th>
            <th className="pb-2 pr-4 text-[10px] uppercase tracking-wide text-slate-500 font-medium text-right">Reported Value</th>
            <th className="pb-2 pr-4 text-[10px] uppercase tracking-wide text-slate-500 font-medium text-right">Positions</th>
            <th className="pb-2 pr-4 text-[10px] uppercase tracking-wide text-slate-500 font-medium text-right">New</th>
            <th className="pb-2 text-[10px] uppercase tracking-wide text-slate-500 font-medium text-right">Exited</th>
          </tr>
        </thead>
        <tbody>
          {history.map((h, i) => (
            <tr key={h.quarter} className={cn("border-b border-slate-800/60", i === 0 && "font-medium")}>
              <td className="py-2.5 pr-4 text-sm text-slate-200">
                {h.quarter}
                {i === 0 && <span className="ml-2 text-[9px] text-sky-400 uppercase">Latest</span>}
              </td>
              <td className="py-2.5 pr-4 text-sm font-mono text-slate-300 text-right">
                {formatUSD(h.reportedPortfolioValue)}
              </td>
              <td className="py-2.5 pr-4 text-sm font-mono text-slate-400 text-right">
                {h.positionCount}
              </td>
              <td className="py-2.5 pr-4 text-sm font-mono text-emerald-400 text-right">
                {h.newPositions > 0 ? `+${h.newPositions}` : "—"}
              </td>
              <td className="py-2.5 text-sm font-mono text-rose-400 text-right">
                {h.exitedPositions > 0 ? `−${h.exitedPositions}` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section nav pill
// ---------------------------------------------------------------------------

function NavPill({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap",
        active
          ? "bg-sky-900/60 border border-sky-700 text-sky-300"
          : "border border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600 hover:text-slate-300",
      )}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span className={cn(
          "rounded-full px-1.5 py-0.5 text-[9px] font-mono tabular-nums",
          active ? "bg-sky-800/60 text-sky-200" : "bg-slate-800 text-slate-400",
        )}>
          {count}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function InstitutionalFundDetailPage() {
  const { managerId } = useParams<{ managerId: string }>();
  const [, navigate]  = useLocation();
  const [section, setSection] = useState<Section>("overview");

  const detailQuery = useQuery<FundDetail>({
    queryKey: ["/api/institutional/funds/detail", managerId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/institutional/funds/${managerId}`);
      if (!res.ok) throw new Error(`Failed to load fund: ${res.status}`);
      return res.json();
    },
    enabled: !!managerId,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  function handleTickerClick(ticker: string) {
    navigate(`/opportunities/${ticker}`);
  }

  // ── Loading ──
  if (detailQuery.isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 p-4 sm:p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          <Skeleton className="h-10 w-48 bg-slate-800/60" />
          <Skeleton className="h-24 w-full bg-slate-800/60" />
          <Skeleton className="h-40 w-full bg-slate-800/60" />
        </div>
      </div>
    );
  }

  // ── Error ──
  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="min-h-screen bg-slate-950 p-4 sm:p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/institutional/funds")} className="text-slate-400 -ml-2">
            <ArrowLeft className="h-4 w-4 mr-1" /> Fund Explorer
          </Button>
          <Card className="border-rose-800/40 bg-rose-950/20">
            <CardContent className="flex items-center gap-3 pt-4">
              <AlertCircle className="h-5 w-5 text-rose-400 shrink-0" />
              <div>
                <p className="text-sm font-medium text-rose-300">
                  {detailQuery.error instanceof Error && detailQuery.error.message.includes("404")
                    ? "Manager not found or no effective filings"
                    : "Failed to load fund data"}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  This manager may not have any ingested 13F data.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const detail  = detailQuery.data;
  const hasQoQ  = detail.dataQuality.hasPreviousQuarter;

  // ── Full page ──
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <div className="border-b border-slate-800 bg-slate-950/95 backdrop-blur sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4 md:px-6 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/institutional/funds")}
            className="text-slate-400 -ml-2 mb-2"
          >
            <ArrowLeft className="h-4 w-4 mr-1" /> Fund Explorer
          </Button>

          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Building2 className="h-4 w-4 text-sky-400 shrink-0" aria-hidden />
                <h1 className="text-lg font-bold text-slate-100 truncate">{detail.managerName}</h1>
                <Badge className="text-[9px] border border-amber-700 bg-amber-950/30 text-amber-300">
                  13F Delayed Data
                </Badge>
                {detail.dataQuality.isAmended && (
                  <Badge className="text-[9px] border border-slate-600 bg-slate-800 text-slate-400">
                    Amended
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-500">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {detail.latestQuarter}
                </span>
                <span>Filed {formatDate(detail.lastFiledAt)}</span>
                <span className="text-slate-600">CIK: {detail.managerId}</span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-2xl font-black text-slate-100">
                {formatUSD(detail.reportedPortfolioValue)}
              </div>
              <div className="text-[10px] text-slate-500">Reported Value</div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 md:px-6 py-5 space-y-5">
        {/* Delayed disclosure */}
        <DelayedDataBanner disclaimer={detail.disclosure.filingDelayDisclaimer} />

        {/* Section navigation */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          <NavPill label="Overview"   active={section === "overview"}  onClick={() => setSection("overview")} />
          <NavPill label="Top Holdings" count={detail.topHoldings.length} active={section === "top"} onClick={() => setSection("top")} />
          {hasQoQ && (
            <>
              <NavPill label="Newly Reported"   count={detail.newPositionsCount}       active={section === "new"}      onClick={() => setSection("new")} />
              <NavPill label="Increased"         count={detail.increasedPositionsCount} active={section === "increased"} onClick={() => setSection("increased")} />
              <NavPill label="Reduced"           count={detail.reducedPositionsCount}   active={section === "reduced"}   onClick={() => setSection("reduced")} />
              <NavPill label="No Longer Reported" count={detail.exitedPositionsCount}   active={section === "exited"}    onClick={() => setSection("exited")} />
            </>
          )}
          <NavPill label="History" active={section === "history"} onClick={() => setSection("history")} />
        </div>

        {/* Section content */}
        <Card className="border-slate-800 bg-slate-900/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
              {section === "overview"   && <><BarChart2 className="h-4 w-4 text-sky-400" /> Overview</>}
              {section === "top"       && <><BarChart2 className="h-4 w-4 text-sky-400" /> Top Reported Holdings — {detail.latestQuarter}</>}
              {section === "new"       && <><TrendingUp className="h-4 w-4 text-emerald-400" /> Newly Reported Positions</>}
              {section === "increased" && <><TrendingUp className="h-4 w-4 text-sky-400" /> Increased Reported Positions</>}
              {section === "reduced"   && <><TrendingDown className="h-4 w-4 text-orange-400" /> Reduced Reported Positions</>}
              {section === "exited"    && <><Minus className="h-4 w-4 text-rose-400" /> No Longer Reported</>}
              {section === "history"   && <><History className="h-4 w-4 text-slate-400" /> Quarterly History</>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {section === "overview" && (
              <OverviewSection detail={detail} />
            )}

            {section === "top" && (
              <>
                <p className="text-xs text-slate-500 mb-4">
                  Top reported holdings by value as of {detail.latestQuarter}.
                  Reflects only what was reported in this manager's effective Form 13F filing.
                  Not a recommendation.
                </p>
                <HoldingsTable
                  holdings={detail.topHoldings}
                  showQoQ={hasQoQ}
                  emptyLabel="No holdings data available."
                  onTickerClick={handleTickerClick}
                />
              </>
            )}

            {section === "new" && (
              <>
                <p className="text-xs text-slate-500 mb-4">
                  Positions reported in {detail.latestQuarter} that were not reported in {detail.previousQuarter ?? "the prior quarter"}.
                  "Newly Reported Position" reflects the Form 13F reporting date — it does not
                  indicate when the position was actually established.
                </p>
                <HoldingsTable
                  holdings={detail.newPositions}
                  showQoQ={false}
                  emptyLabel="No newly reported positions this quarter."
                  onTickerClick={handleTickerClick}
                />
              </>
            )}

            {section === "increased" && (
              <>
                <p className="text-xs text-slate-500 mb-4">
                  Positions with more reported shares in {detail.latestQuarter} vs {detail.previousQuarter ?? "the prior quarter"}.
                  "Increased Reported Position" does not imply a buy decision — filing timing
                  and amendment effects may affect the reported share count.
                </p>
                <HoldingsTable
                  holdings={detail.increasedPositions}
                  showQoQ
                  emptyLabel="No increased positions this quarter."
                  onTickerClick={handleTickerClick}
                />
              </>
            )}

            {section === "reduced" && (
              <>
                <p className="text-xs text-slate-500 mb-4">
                  Positions with fewer reported shares in {detail.latestQuarter} vs {detail.previousQuarter ?? "the prior quarter"}.
                  "Reduced Reported Position" reflects the quarter-over-quarter filing difference.
                </p>
                <HoldingsTable
                  holdings={detail.reducedPositions}
                  showQoQ
                  emptyLabel="No reduced positions this quarter."
                  onTickerClick={handleTickerClick}
                />
              </>
            )}

            {section === "exited" && (
              <>
                <p className="text-xs text-slate-500 mb-4">
                  Positions reported in {detail.previousQuarter ?? "the prior quarter"} but absent from
                  {" "}{detail.latestQuarter} effective filing. This reflects Form 13F reporting
                  and may not represent current holdings. The position may still be held below
                  the 13F reporting threshold.
                </p>
                <HoldingsTable
                  holdings={detail.exitedPositions}
                  showQoQ={false}
                  emptyLabel="No exited positions this quarter."
                  onTickerClick={handleTickerClick}
                />
              </>
            )}

            {section === "history" && (
              <HistorySection managerId={detail.managerId} />
            )}
          </CardContent>
        </Card>

        {/* Footer */}
        <p className="text-[10px] text-slate-600 text-center pt-2 border-t border-slate-800">
          {detail.disclosure.filingDelayDisclaimer}{" "}
          Public Filing Research — not investment advice.
          Data as of {detail.disclosure.dataAsOf}.
        </p>
      </div>
    </div>
  );
}
