import { useState } from "react";
import { ArrowUpDown, ChevronDown, ChevronUp, ExternalLink, Zap, Bell, Star, Info } from "lucide-react";
import { Link } from "wouter";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { getTradeStatus, getDistanceToEntry, getTradeStatusDisplay, isActionable } from "@/lib/trade-status";
import type { ScanResult } from "@shared/schema";

type SortField = "ticker" | "name" | "price" | "changePercent" | "rvol" | "patternScore" | "status" | "resistance" | "stopLoss" | "riskReward";
type SortDirection = "asc" | "desc";

function computeRiskReward(result: { price: number; resistance?: number | null; stopLoss?: number | null }): number {
  if (!result.resistance || !result.stopLoss || result.stopLoss >= result.price) return 0;
  const reward = result.resistance - result.price;
  const risk = result.price - result.stopLoss;
  if (risk <= 0) return 0;
  return reward / risk;
}

function formatRiskReward(result: { price: number; resistance?: number | null; stopLoss?: number | null }): string {
  const rr = computeRiskReward(result);
  if (rr <= 0) return "-";
  return `1:${rr.toFixed(1)}`;
}

const STAGE_ORDER: Record<string, number> = {
  "BREAKOUT": 4,
  "READY": 3,
  "APPROACHING": 2,
  "FORMING": 1,
};

interface ScannerTableProps {
  results: ScanResult[];
  isLoading?: boolean;
  onRowClick?: (result: ScanResult) => void;
  onInstaTrade?: (result: ScanResult, e?: React.MouseEvent) => void;
  isInstaTrading?: boolean;
  searchQuery?: string;
}

function formatVolume(vol: number | null | undefined): string {
  if (!vol) return "-";
  if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `${(vol / 1_000).toFixed(1)}K`;
  return vol.toFixed(0);
}

function formatPrice(price: number | null | undefined): string {
  if (!price) return "-";
  return `$${price.toFixed(2)}`;
}

function formatPercent(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return "-";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function splitStockTopPicks(results: ScanResult[]): { topPicks: ScanResult[]; others: ScanResult[] } {
  if (results.length <= 6) {
    return { topPicks: results, others: [] };
  }

  const scored = results.map(r => {
    const stageScore = STAGE_ORDER[r.stage] ?? 0;
    const patternWeight = (r.patternScore ?? 0) * 0.4;
    const stageWeight = stageScore * 20;
    const actionableBonus = isActionable(r) ? 15 : 0;
    const rvolBonus = (r.rvol ?? 0) > 2 ? 10 : (r.rvol ?? 0) > 1.5 ? 5 : 0;
    return { result: r, compositeScore: patternWeight + stageWeight + actionableBonus + rvolBonus };
  });

  scored.sort((a, b) => b.compositeScore - a.compositeScore);

  const MIN_TOP = 3;
  const MAX_TOP = Math.min(15, Math.ceil(results.length * 0.1));
  const count = Math.max(MIN_TOP, MAX_TOP);

  const topIds = new Set(scored.slice(0, count).map(s => s.result.id));

  return {
    topPicks: results.filter(r => topIds.has(r.id)),
    others: results.filter(r => !topIds.has(r.id)),
  };
}

export function ScannerTable({ results, isLoading, onRowClick, onInstaTrade, isInstaTrading, searchQuery = "" }: ScannerTableProps) {
  const [sortField, setSortField] = useState<SortField>("patternScore");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [showOthers, setShowOthers] = useState(false);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const filteredResults = results.filter((r) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      r.ticker.toLowerCase().includes(query) ||
      (r.name && r.name.toLowerCase().includes(query))
    );
  });

  const STATUS_ORDER: Record<string, number> = {
    "IN_ENTRY_ZONE": 3,
    "AWAITING_BREAKOUT": 2,
    "EXTENDED": 1,
  };

  const sortResults = (items: ScanResult[]) => {
    return [...items].sort((a, b) => {
      const modifier = sortDirection === "asc" ? 1 : -1;
      if (sortField === "status") {
        const aStatus = getTradeStatus(a);
        const bStatus = getTradeStatus(b);
        return ((STATUS_ORDER[aStatus] ?? 0) - (STATUS_ORDER[bStatus] ?? 0)) * modifier;
      }
      if (sortField === "riskReward") {
        return (computeRiskReward(a) - computeRiskReward(b)) * modifier;
      }
      if (sortField === "name") {
        const aName = a.name ?? "";
        const bName = b.name ?? "";
        return aName.localeCompare(bName) * modifier;
      }
      const aVal = a[sortField] ?? 0;
      const bVal = b[sortField] ?? 0;
      if (typeof aVal === "string" && typeof bVal === "string") {
        return aVal.localeCompare(bVal) * modifier;
      }
      return ((aVal as number) - (bVal as number)) * modifier;
    });
  };

  const SortHeader = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3 gap-1 font-medium"
      onClick={() => handleSort(field)}
      data-testid={`sort-${field}`}
    >
      {children}
      {sortField === field ? (
        sortDirection === "asc" ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )
      ) : (
        <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
      )}
    </Button>
  );

  if (isLoading) {
    return (
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[80px]">Ticker</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Change</TableHead>
              <TableHead className="text-right">Resist.</TableHead>
              <TableHead className="text-right">Stop</TableHead>
              <TableHead className="text-right">R:R</TableHead>
              <TableHead className="text-right">RVOL</TableHead>
              <TableHead className="text-right">Score</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 8 }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: 10 }).map((_, j) => (
                  <TableCell key={j}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-md border border-dashed py-16">
        <div className="text-center">
          <p className="text-lg font-medium">No patterns found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Run a scan to find VCP setups
          </p>
        </div>
      </div>
    );
  }

  const { topPicks, others } = splitStockTopPicks(filteredResults);
  const sortedTopPicks = sortResults(topPicks);
  const sortedOthers = sortResults(others);

  const renderRow = (result: ScanResult, isTopPick?: boolean) => {
    const isExpanded = expandedRow === result.id;
    const changeColor = (result.changePercent ?? 0) >= 0 
      ? "text-chart-2" 
      : "text-destructive";
    const tradeStatus = getTradeStatus(result);
    const statusBadge = getTradeStatusDisplay(tradeStatus);
    const actionable = isActionable(result);
    const distPct = getDistanceToEntry(result);
    const distanceToEntry = distPct !== null && distPct > 0 ? distPct : null;

    return (
      <TableRow
        key={result.id}
        className={cn("cursor-pointer hover-elevate", isTopPick && "bg-primary/[0.02]")}
        onClick={() => {
          setExpandedRow(isExpanded ? null : result.id);
          onRowClick?.(result);
        }}
        data-testid={`row-${result.ticker}`}
      >
        <TableCell className="font-mono font-semibold">
          <div className="flex items-center gap-1">
            {isTopPick && <Star className="h-3 w-3 text-primary fill-primary shrink-0" />}
            <span>{result.ticker}</span>
          </div>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2 flex-wrap">
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge 
                  variant={statusBadge.variant} 
                  className={cn("text-xs cursor-help", statusBadge.className)}
                  data-testid={`badge-table-status-${result.ticker}`}
                >
                  {statusBadge.shortLabel}
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                {tradeStatus === "AWAITING_BREAKOUT" && distanceToEntry !== null 
                  ? `Entry activates +${distanceToEntry.toFixed(1)}% above current price`
                  : tradeStatus === "IN_ENTRY_ZONE" 
                  ? "Price is within 3% of entry — trade is actionable"
                  : "Price has moved more than 3% past entry — extended"
                }
              </TooltipContent>
            </Tooltip>
            {distanceToEntry !== null && (
              <span className="text-xs text-yellow-600 dark:text-yellow-400">
                +{distanceToEntry.toFixed(1)}% to entry
              </span>
            )}
          </div>
          {result.name && (
            <span className="text-xs text-muted-foreground truncate block max-w-[200px]">
              {result.name}
            </span>
          )}
        </TableCell>
        <TableCell className="text-right font-mono">
          {formatPrice(result.price)}
        </TableCell>
        <TableCell className={`text-right font-mono ${changeColor}`}>
          {formatPercent(result.changePercent)}
        </TableCell>
        <TableCell className="text-right font-mono text-muted-foreground">
          {formatPrice(result.resistance)}
        </TableCell>
        <TableCell className="text-right font-mono text-destructive">
          {formatPrice(result.stopLoss)}
        </TableCell>
        <TableCell className="text-right font-mono text-muted-foreground">
          {formatRiskReward(result)}
        </TableCell>
        <TableCell className="text-right font-mono">
          {result.rvol ? `${result.rvol.toFixed(1)}x` : "-"}
        </TableCell>
        <TableCell className="text-right">
          <div className="flex items-center justify-end gap-1">
            <Badge variant="secondary" className="text-xs font-mono">
              {result.patternScore ?? 0}%
            </Badge>
          </div>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1">
            {onInstaTrade && actionable ? (
              <Button 
                variant="default" 
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onInstaTrade(result, e);
                }}
                disabled={isInstaTrading}
                data-testid={`button-instatrade-${result.ticker}`}
              >
                <Zap className="h-3.5 w-3.5" />
              </Button>
            ) : onInstaTrade ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href="/alerts">
                    <Button 
                      variant="outline" 
                      size="icon"
                      data-testid={`button-alert-${result.ticker}`}
                    >
                      <Bell className="h-3.5 w-3.5" />
                    </Button>
                  </Link>
                </TooltipTrigger>
                <TooltipContent className="text-xs">Set breakout alert</TooltipContent>
              </Tooltip>
            ) : null}
            <Link href={`/charts/${result.ticker}`}>
              <Button 
                variant="ghost" 
                size="icon"
                data-testid={`button-chart-${result.ticker}`}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        </TableCell>
      </TableRow>
    );
  };

  const tableHeader = (
    <TableHeader className="sticky top-0 z-10 bg-card">
      <TableRow>
        <TableHead className="w-[80px]">
          <SortHeader field="ticker">Ticker</SortHeader>
        </TableHead>
        <TableHead>
          <SortHeader field="name">Name</SortHeader>
        </TableHead>
        <TableHead className="text-right">
          <SortHeader field="price">Price</SortHeader>
        </TableHead>
        <TableHead className="text-right">
          <SortHeader field="changePercent">Change</SortHeader>
        </TableHead>
        <TableHead className="text-right">
          <SortHeader field="resistance">Resist.</SortHeader>
        </TableHead>
        <TableHead className="text-right">
          <SortHeader field="stopLoss">Stop</SortHeader>
        </TableHead>
        <TableHead className="text-right">
          <SortHeader field="riskReward">R:R</SortHeader>
        </TableHead>
        <TableHead className="text-right">
          <SortHeader field="rvol">RVOL</SortHeader>
        </TableHead>
        <TableHead className="text-right">
          <SortHeader field="patternScore">Score</SortHeader>
        </TableHead>
        <TableHead className="w-[40px]"></TableHead>
      </TableRow>
    </TableHeader>
  );

  return (
    <div className="space-y-3" data-testid="scanner-table">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Star className="h-4 w-4 text-primary fill-primary" />
          <h3 className="text-sm font-semibold">Top Picks</h3>
          <Badge variant="secondary" className="text-xs" data-testid="badge-stock-top-picks-count">
            {sortedTopPicks.length}
          </Badge>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" data-testid="icon-stock-top-picks-info" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              Ranked by a composite score: pattern confidence (40%), breakout stage (BREAKOUT &gt; READY &gt; FORMING), actionability (price near entry zone), and relative volume (RVOL &gt; 1.5x). Top 3-15 setups are highlighted.
            </TooltipContent>
          </Tooltip>
          <span className="text-xs text-muted-foreground">Best setups by stage, score, and actionability</span>
        </div>
        <div className="rounded-md border">
          <Table>
            {tableHeader}
            <TableBody>
              {sortedTopPicks.map((result) => renderRow(result, true))}
            </TableBody>
          </Table>
        </div>
      </div>

      {sortedOthers.length > 0 && (
        <Collapsible open={showOthers} onOpenChange={setShowOthers}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="w-full justify-between gap-2"
              data-testid="button-toggle-other-stocks"
            >
              <span className="flex items-center gap-2 text-sm">
                More Results
                <Badge variant="outline" className="text-xs">{sortedOthers.length}</Badge>
              </span>
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", showOthers && "rotate-180")} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="rounded-md border mt-2">
              <Table>
                {tableHeader}
                <TableBody>
                  {sortedOthers.map((result) => renderRow(result))}
                </TableBody>
              </Table>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
