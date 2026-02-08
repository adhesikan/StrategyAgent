import { useState } from "react";
import { ArrowUpDown, ChevronDown, ChevronUp, ExternalLink, Zap, Bell, Star } from "lucide-react";
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
import type { ScanResult, PatternStageType } from "@shared/schema";

type SortField = "ticker" | "price" | "changePercent" | "volume" | "rvol" | "patternScore" | "stage" | "status" | "resistance" | "stopLoss";
type SortDirection = "asc" | "desc";

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

function getStageBadgeVariant(stage: PatternStageType): "default" | "secondary" | "destructive" | "outline" {
  switch (stage) {
    case "BREAKOUT":
      return "default";
    case "READY":
      return "secondary";
    case "FORMING":
      return "outline";
    default:
      return "outline";
  }
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
  const [sortField, setSortField] = useState<SortField>("stage");
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
      if (sortField === "stage") {
        const aOrder = STAGE_ORDER[a.stage] ?? 0;
        const bOrder = STAGE_ORDER[b.stage] ?? 0;
        return (aOrder - bOrder) * modifier;
      }
      if (sortField === "status") {
        const aStatus = getTradeStatus(a);
        const bStatus = getTradeStatus(b);
        return ((STATUS_ORDER[aStatus] ?? 0) - (STATUS_ORDER[bStatus] ?? 0)) * modifier;
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
              <TableHead className="w-[100px]">Symbol</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Change</TableHead>
              <TableHead className="text-right">Volume</TableHead>
              <TableHead className="text-right">RVOL</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Resistance</TableHead>
              <TableHead className="text-right">Stop</TableHead>
              <TableHead className="text-right">Score</TableHead>
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
          {result.name && (
            <span className="ml-4 text-xs text-muted-foreground font-normal">
              {result.name.length > 15 ? result.name.slice(0, 15) + "..." : result.name}
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
          {formatVolume(result.volume)}
        </TableCell>
        <TableCell className="text-right font-mono">
          {result.rvol ? `${result.rvol.toFixed(1)}x` : "-"}
        </TableCell>
        <TableCell>
          <Badge variant={getStageBadgeVariant(result.stage as PatternStageType)}>
            {result.stage}
          </Badge>
        </TableCell>
        <TableCell>
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
        </TableCell>
        <TableCell className="text-right font-mono text-muted-foreground">
          {formatPrice(result.resistance)}
          {distanceToEntry !== null && (
            <span className="block text-[10px] text-yellow-600 dark:text-yellow-400">
              +{distanceToEntry.toFixed(1)}%
            </span>
          )}
        </TableCell>
        <TableCell className="text-right font-mono text-destructive">
          {formatPrice(result.stopLoss)}
        </TableCell>
        <TableCell className="text-right">
          <div className="flex items-center justify-end gap-1">
            <div className="h-1.5 w-12 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${Math.min(100, result.patternScore ?? 0)}%` }}
              />
            </div>
            <span className="font-mono text-xs w-6 text-right">
              {result.patternScore ?? 0}
            </span>
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
        <TableHead className="w-[100px]">
          <SortHeader field="ticker">Symbol</SortHeader>
        </TableHead>
        <TableHead className="text-right">
          <SortHeader field="price">Price</SortHeader>
        </TableHead>
        <TableHead className="text-right">
          <SortHeader field="changePercent">Change</SortHeader>
        </TableHead>
        <TableHead className="text-right">
          <SortHeader field="volume">Volume</SortHeader>
        </TableHead>
        <TableHead className="text-right">
          <SortHeader field="rvol">RVOL</SortHeader>
        </TableHead>
        <TableHead>
          <SortHeader field="stage">Stage</SortHeader>
        </TableHead>
        <TableHead>
          <SortHeader field="status">Status</SortHeader>
        </TableHead>
        <TableHead className="text-right">
          <SortHeader field="resistance">Entry</SortHeader>
        </TableHead>
        <TableHead className="text-right">
          <SortHeader field="stopLoss">Stop</SortHeader>
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
