// /institutional/funds — Sprint 2.3.2
// Institutional Fund Explorer — publicly reported SEC Form 13F activity by manager.
//
// Compliance rules (non-negotiable):
//   - No "Smart Money", "Best Funds", "Top Funds to Follow", "Buy What They Buy",
//     "Conviction Buy", "Recommended Fund Trades"
//   - Use: "Reported Holdings", "Institutional Activity", "Quarter-over-Quarter Changes",
//     "Public Filing Research", "Newly Reported Position"
//   - Delayed-data disclosure visible on every view.
//   - No investment recommendations.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Building2,
  Search,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  ArrowUpDown,
  ExternalLink,
  AlertCircle,
  Info,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types (mirror /api/institutional/funds response)
// ---------------------------------------------------------------------------

interface FundSummary {
  managerId: string;
  managerName: string;
  latestQuarter: string;
  reportedPortfolioValue: number;
  reportedPositionCount: number;
  quarterChangePositionCount: number;
  newPositionsCount: number;
  exitedPositionsCount: number;
  increasedPositionsCount: number;
  reducedPositionsCount: number;
  lastFiledAt: string;
  hasPreviousQuarter: boolean;
}

interface FundDirectoryResult {
  funds: FundSummary[];
  total: number;
  page: number;
  pageSize: number;
}

type SortOption =
  | "reportedPortfolioValue"
  | "positionCount"
  | "newPositions"
  | "largestChanges"
  | "managerName";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUSD(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

const SORT_LABELS: Record<SortOption, string> = {
  reportedPortfolioValue: "Portfolio Value",
  positionCount:          "Positions",
  newPositions:           "New Positions",
  largestChanges:         "Most Changed",
  managerName:            "Name A–Z",
};

// ---------------------------------------------------------------------------
// Disclosure Banner
// ---------------------------------------------------------------------------

function DelayedDataBanner() {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-800/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-200/80">
      <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-400" aria-hidden />
      <span>
        13F filings are delayed and do not represent real-time institutional activity.
        Form 13F data is reported quarterly and may be filed up to 45 days after quarter-end.
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fund Card
// ---------------------------------------------------------------------------

function FundCard({ fund, onClick }: { fund: FundSummary; onClick: () => void }) {
  const hasQoQ = fund.hasPreviousQuarter;

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl border border-slate-800 bg-slate-900/60 hover:bg-slate-800/70 hover:border-slate-700 transition-all duration-150 p-4"
      data-testid={`fund-card-${fund.managerId}`}
      aria-label={`View reported holdings for ${fund.managerName}`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-100 truncate">{fund.managerName}</h3>
          <div className="flex items-center gap-2 mt-0.5">
            <Badge className="text-[9px] border bg-slate-800/60 text-slate-400 border-slate-700">
              {fund.latestQuarter}
            </Badge>
            <span className="text-[10px] text-slate-600">
              Filed {formatDate(fund.lastFiledAt)}
            </span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-base font-bold text-slate-100">
            {formatUSD(fund.reportedPortfolioValue)}
          </div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wide">Reported</div>
        </div>
      </div>

      <div className="flex items-center gap-4 text-[11px]">
        <div className="text-slate-400">
          <span className="font-mono font-medium text-slate-200">{fund.reportedPositionCount}</span>
          {" "}positions
        </div>

        {hasQoQ && (
          <div className="flex items-center gap-2 text-slate-500">
            {fund.newPositionsCount > 0 && (
              <span className="text-emerald-400 font-mono">
                +{fund.newPositionsCount} new
              </span>
            )}
            {fund.exitedPositionsCount > 0 && (
              <span className="text-rose-400 font-mono">
                −{fund.exitedPositionsCount} exited
              </span>
            )}
            {fund.increasedPositionsCount > 0 && (
              <span className="flex items-center gap-0.5 text-sky-400">
                <TrendingUp className="h-3 w-3" />{fund.increasedPositionsCount}
              </span>
            )}
            {fund.reducedPositionsCount > 0 && (
              <span className="flex items-center gap-0.5 text-orange-400">
                <TrendingDown className="h-3 w-3" />{fund.reducedPositionsCount}
              </span>
            )}
          </div>
        )}

        {!hasQoQ && (
          <span className="text-slate-600 text-[10px]">First quarter on record</span>
        )}

        <ExternalLink className="h-3 w-3 text-slate-600 ml-auto" aria-hidden />
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Fund Directory Table (desktop)
// ---------------------------------------------------------------------------

function SortableHeader({
  label,
  field,
  current,
  onSort,
}: {
  label: string;
  field: SortOption;
  current: SortOption;
  onSort: (f: SortOption) => void;
}) {
  return (
    <button
      className={cn(
        "flex items-center gap-1 text-[10px] uppercase tracking-wide font-medium hover:text-slate-200 transition-colors",
        current === field ? "text-slate-200" : "text-slate-500",
      )}
      onClick={() => onSort(field)}
    >
      {label}
      <ArrowUpDown className="h-3 w-3 opacity-60" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;

export default function InstitutionalFundsPage() {
  const [, navigate] = useLocation();
  const [search, setSearch]   = useState("");
  const [sort, setSort]       = useState<SortOption>("reportedPortfolioValue");
  const [page, setPage]       = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce search input to avoid rapid re-queries
  function handleSearchChange(val: string) {
    setSearch(val);
    clearTimeout((window as any).__fundSearchTimer);
    (window as any).__fundSearchTimer = setTimeout(() => {
      setDebouncedSearch(val);
      setPage(1);
    }, 350);
  }

  const queryKey = ["/api/institutional/funds", debouncedSearch, sort, page, PAGE_SIZE];
  const fundsQuery = useQuery<FundDirectoryResult>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({
        search:   debouncedSearch,
        sort,
        page:     String(page),
        pageSize: String(PAGE_SIZE),
      });
      const res = await apiRequest("GET", `/api/institutional/funds?${params}`);
      if (!res.ok) throw new Error("Failed to load fund directory");
      return res.json();
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const funds  = fundsQuery.data?.funds ?? [];
  const total  = fundsQuery.data?.total ?? 0;
  const pages  = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function handleSort(field: SortOption) {
    setSort(field);
    setPage(1);
  }

  function goToFund(managerId: string) {
    navigate(`/institutional/funds/${managerId}`);
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* ── Header ── */}
      <div className="border-b border-slate-800 bg-slate-950/95 backdrop-blur sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 md:px-6 py-4">
          <div className="flex items-center gap-3 mb-1">
            <Building2 className="h-5 w-5 text-sky-400" aria-hidden />
            <h1 className="text-xl font-bold text-slate-100">Institutional Fund Explorer</h1>
          </div>
          <p className="text-xs text-slate-400">
            Explore publicly reported SEC Form 13F holdings and quarter-over-quarter changes.
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 space-y-5">
        {/* Disclosure */}
        <DelayedDataBanner />

        {/* Search + Sort controls */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" aria-hidden />
            <input
              type="text"
              placeholder="Search institutions…"
              value={search}
              onChange={e => handleSearchChange(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-700"
              aria-label="Search institutions"
              data-testid="fund-search-input"
            />
          </div>

          {/* Sort pills */}
          <div className="flex flex-wrap gap-1.5 shrink-0">
            {(Object.entries(SORT_LABELS) as [SortOption, string][]).map(([field, label]) => (
              <button
                key={field}
                onClick={() => handleSort(field)}
                className={cn(
                  "text-[10px] px-2.5 py-1 rounded-full border transition-colors",
                  sort === field
                    ? "border-sky-700 bg-sky-900/40 text-sky-300"
                    : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600 hover:text-slate-300",
                )}
                data-testid={`sort-${field}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Results summary */}
        {!fundsQuery.isLoading && (
          <p className="text-[11px] text-slate-500">
            {total > 0
              ? `Showing ${Math.min((page - 1) * PAGE_SIZE + 1, total)}–${Math.min(page * PAGE_SIZE, total)} of ${total} institutional manager${total !== 1 ? "s" : ""}`
              : debouncedSearch
              ? `No managers found matching "${debouncedSearch}"`
              : "No institutional managers found"}
          </p>
        )}

        {/* Loading state */}
        {fundsQuery.isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl bg-slate-800/60" />
            ))}
          </div>
        )}

        {/* Error state */}
        {fundsQuery.isError && (
          <Card className="border-rose-800/40 bg-rose-950/20">
            <CardContent className="flex items-center gap-3 pt-4">
              <AlertCircle className="h-5 w-5 text-rose-400 shrink-0" />
              <div>
                <p className="text-sm font-medium text-rose-300">Failed to load fund directory</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  Institutional data may not be ingested yet. Check back after a data pipeline run.
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-2 text-xs"
                  onClick={() => fundsQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Fund list */}
        {!fundsQuery.isLoading && !fundsQuery.isError && funds.length > 0 && (
          <div className="space-y-2">
            {funds.map(fund => (
              <FundCard
                key={fund.managerId}
                fund={fund}
                onClick={() => goToFund(fund.managerId)}
              />
            ))}
          </div>
        )}

        {/* Empty data state */}
        {!fundsQuery.isLoading && !fundsQuery.isError && funds.length === 0 && (
          <div className="text-center py-16 text-slate-500">
            <Building2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium">No institutional managers found</p>
            <p className="text-xs mt-1">
              {debouncedSearch
                ? "Try a different search term."
                : "13F data may not have been ingested yet. Contact your administrator."}
            </p>
          </div>
        )}

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-between pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1 || fundsQuery.isLoading}
              className="text-xs gap-1 border-slate-700"
            >
              <ChevronLeft className="h-4 w-4" /> Previous
            </Button>
            <span className="text-xs text-slate-500">
              Page {page} of {pages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.min(pages, p + 1))}
              disabled={page >= pages || fundsQuery.isLoading}
              className="text-xs gap-1 border-slate-700"
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Footer */}
        <p className="text-[10px] text-slate-600 text-center pt-4 border-t border-slate-800">
          Public Filing Research — data sourced from SEC EDGAR. Not investment advice.
        </p>
      </div>
    </div>
  );
}
