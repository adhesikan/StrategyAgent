// InstitutionalWorkspaceCompact — Sprint 2.2.5.
//
// Compact institutional 13F summary for the AI Trading Workspace Evidence area.
// Does NOT add a large card to the Workspace — compact only.
//
// When data is unavailable: shows "Institutional 13F data unavailable" with methodology link.
// When available: shows trend, shares change, manager count, period, alignment.
//
// No fake sample numbers. No predictive wording.

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Building2, ExternalLink, RefreshCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { InstitutionalData } from "./types";
import {
  formatPctChange,
  formatShares,
  trendColorClass,
  alignmentColorClass,
  formatDate,
} from "./types";

interface Props {
  symbol: string;
}

export function InstitutionalWorkspaceCompact({ symbol }: Props) {
  const { data, isLoading, isError } = useQuery<InstitutionalData>({
    queryKey: ["institutional", symbol],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/institutional/${symbol}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 15 * 60 * 1000,     // 15 min — institutional data changes infrequently
    gcTime: 60 * 60 * 1000,        // 1 hr cache
    retry: 1,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground py-1" data-testid="institutional-compact-loading">
        <RefreshCcw className="h-3 w-3 animate-spin" />
        Loading 13F data…
      </div>
    );
  }

  if (isError || !data || data.status === "unavailable") {
    return (
      <div className="text-[11px] text-muted-foreground py-1 space-y-0.5" data-testid="institutional-compact-unavailable">
        <p className="font-medium">Institutional — 13F</p>
        <p>Data unavailable —{" "}
          <a
            href="https://www.sec.gov/edgar/search/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
            data-testid="institutional-compact-sec-link"
          >
            Search SEC EDGAR
          </a>
        </p>
      </div>
    );
  }

  const { summary, evidenceAlignment, coverage } = data;
  const trend = summary?.trend ?? "unavailable";
  const trendLbl = summary?.trendLabel ?? "Unavailable";
  const pctChange = summary?.reportedSharesChangePercent ?? null;
  const managerCount = summary?.reportingManagerCount ?? 0;
  const period = data.periodOfReport;
  const alignment = evidenceAlignment.state;
  const alignmentLbl = evidenceAlignment.label;

  // Derive quarter label from period date
  let periodLabel = "N/A";
  if (period) {
    const d = new Date(period);
    if (!isNaN(d.getTime())) {
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth() + 1;
      const q = m <= 3 ? 1 : m <= 6 ? 2 : m <= 9 ? 3 : 4;
      periodLabel = `${y}-Q${q}`;
    }
  }

  return (
    <div className="space-y-1" data-testid="institutional-compact">
      {/* Header */}
      <div className="flex items-center gap-1.5">
        <Building2 className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
        <span className="text-[11px] font-semibold">Institutional — 13F</span>
        {data.status === "stale" && (
          <span className="text-[9px] text-amber-400 uppercase tracking-wide">(stale)</span>
        )}
        {data.status === "partial" && (
          <span className="text-[9px] text-amber-400 uppercase tracking-wide">(partial)</span>
        )}
      </div>

      {/* Compact stat grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 pl-4">
        <span className="text-[10px] text-muted-foreground">Trend</span>
        <span className={cn("text-[10px] font-medium", trendColorClass(trend))} data-testid="institutional-compact-trend">
          {trendLbl}
        </span>

        <span className="text-[10px] text-muted-foreground">Shares change</span>
        <span className={cn("text-[10px] font-medium", pctChange != null ? (pctChange >= 0 ? "text-emerald-400" : "text-rose-400") : "text-muted-foreground")} data-testid="institutional-compact-shares-change">
          {pctChange != null ? formatPctChange(pctChange) : "N/A"}
        </span>

        <span className="text-[10px] text-muted-foreground">Reporting managers</span>
        <span className="text-[10px] font-medium" data-testid="institutional-compact-managers">
          {managerCount > 0 ? managerCount.toLocaleString() : "N/A"}
        </span>

        <span className="text-[10px] text-muted-foreground">Period</span>
        <span className="text-[10px] font-medium" data-testid="institutional-compact-period">
          {periodLabel}
        </span>

        <span className="text-[10px] text-muted-foreground">Alignment</span>
        <span className={cn("text-[10px] font-medium", alignmentColorClass(alignment))} data-testid="institutional-compact-alignment">
          {alignmentLbl}
        </span>
      </div>

      {/* CTA */}
      <div className="pl-4 pt-0.5">
        <a
          href={`/opportunity/${symbol}?tab=institutional`}
          className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
          data-testid="institutional-compact-cta"
        >
          Open Institutional Details
          <ExternalLink className="h-2.5 w-2.5" />
        </a>
      </div>

      {/* Data-quality note */}
      <p className="pl-4 text-[9px] text-muted-foreground leading-relaxed">
        SEC Form 13F — periodic, delayed. Data through {period ? formatDate(period) : "N/A"}.
      </p>
    </div>
  );
}
