import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subDays, startOfDay } from "date-fns";
import { getStrategyDisplayName } from "@shared/strategies";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Download,
  TrendingUp,
  TrendingDown,
  Clock,
  Target,
  AlertTriangle,
  Filter,
  ChevronLeft,
  ChevronRight,
  BarChart3,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
  Info,
  ChevronDown,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Link } from "wouter";

interface Opportunity {
  id: string;
  userId: string;
  symbol: string;
  strategyId: string;
  strategyName: string;
  timeframe: string;
  stageAtDetection: string;
  detectedAt: string;
  detectedPrice: number;
  resistancePrice: number | null;
  stopReferencePrice: number | null;
  entryTriggerPrice: number | null;
  status: string;
  resolutionOutcome: string | null;
  resolvedAt: string | null;
  resolutionPrice: number | null;
  pnlPercent: number | null;
  daysToResolution: number | null;
  dedupeKey: string;
}

interface OpportunitySummary {
  total: number;
  active: number;
  resolved: number;
  brokeResistanceCount: number;
  invalidatedCount: number;
  expiredCount: number;
  avgActiveDurationMinutes: number | null;
  avgMaxFavorableMovePercent: number | null;
  avgMaxAdverseMovePercent: number | null;
}

const OUTCOMES = [
  { value: "all", label: "All Outcomes" },
  { value: "BROKE_RESISTANCE", label: "Broke Resistance" },
  { value: "INVALIDATED", label: "Invalidated" },
  { value: "EXPIRED", label: "Expired" },
];

const STATUS_OPTIONS = [
  { value: "all", label: "All Status" },
  { value: "ACTIVE", label: "Active" },
  { value: "RESOLVED", label: "Resolved" },
];

const STAGE_OPTIONS = [
  { value: "all", label: "All Stages" },
  { value: "FORMING", label: "Forming" },
  { value: "READY", label: "Ready" },
  { value: "BREAKOUT", label: "Breakout" },
];

const TIMEFRAME_OPTIONS = [
  { value: "all", label: "All Timeframes" },
  { value: "5m", label: "5 Min" },
  { value: "15m", label: "15 Min" },
  { value: "1h", label: "1 Hour" },
  { value: "1d", label: "Daily" },
];

const DATE_RANGE_OPTIONS = [
  { value: "7d", label: "Last 7 Days" },
  { value: "30d", label: "Last 30 Days" },
  { value: "90d", label: "Last 90 Days" },
  { value: "all", label: "All Time" },
];

function getOutcomeBadgeVariant(outcome: string | null): "default" | "destructive" | "secondary" | "outline" {
  switch (outcome) {
    case "BROKE_RESISTANCE": return "default";
    case "INVALIDATED": return "destructive";
    case "EXPIRED": return "secondary";
    default: return "outline";
  }
}

function getOutcomeIcon(outcome: string | null) {
  switch (outcome) {
    case "BROKE_RESISTANCE": return <TrendingUp className="h-3 w-3 mr-1" />;
    case "INVALIDATED": return <AlertTriangle className="h-3 w-3 mr-1" />;
    case "EXPIRED": return <Clock className="h-3 w-3 mr-1" />;
    default: return <Target className="h-3 w-3 mr-1" />;
  }
}

function formatOutcome(outcome: string | null, status: string): string {
  if (status === "ACTIVE") return "Active";
  switch (outcome) {
    case "BROKE_RESISTANCE": return "Broke Resistance";
    case "INVALIDATED": return "Invalidated";
    case "EXPIRED": return "Expired";
    default: return outcome || "Unknown";
  }
}

function formatPrice(price: number | null): string {
  if (price === null || price === undefined) return "-";
  return `$${price.toFixed(2)}`;
}

function formatPercent(pct: number | null): string {
  if (pct === null || pct === undefined) return "-";
  const prefix = pct > 0 ? "+" : "";
  return `${prefix}${pct.toFixed(2)}%`;
}

function formatStrategyName(name: string): string {
  const legacyNameMap: Record<string, string> = {
    "VCP Pattern": "VCP",
    "VCP Multi-Day": "VCP_MULTIDAY",
    "5-Min Opening Range": "ORB5",
    "15-Min Opening Range": "ORB15",
    "Open Drive 5m": "ORB5",
    "Open Drive 15m": "ORB15",
    "Gap & Go": "GAP_AND_GO",
    "High RVOL": "HIGH_RVOL",
    "VWAP Reclaim": "VWAP_RECLAIM",
    "Classic Pullback": "CLASSIC_PULLBACK",
    "Trend Continuation": "TREND_CONTINUATION",
    "Volatility Squeeze": "VOLATILITY_SQUEEZE",
  };
  const strategyId = legacyNameMap[name] || name;
  return getStrategyDisplayName(strategyId);
}

type SortField = "detectedAt" | "symbol" | "strategyName" | "pnlPercent" | "daysToResolution";
type SortOrder = "asc" | "desc";

export default function OpportunitiesPage() {
  const [dateRange, setDateRange] = useState("30d");
  const [strategyFilter, setStrategyFilter] = useState("all");
  const [timeframeFilter, setTimeframeFilter] = useState("all");
  const [outcomeFilter, setOutcomeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [symbolFilter, setSymbolFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sortBy, setSortBy] = useState<SortField>("detectedAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [page, setPage] = useState(0);
  const [selectedOpportunity, setSelectedOpportunity] = useState<Opportunity | null>(null);
  const pageSize = 20;

  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }
    setPage(0);
  };

  const getSortIcon = (field: SortField) => {
    if (sortBy !== field) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-50" />;
    return sortOrder === "asc" 
      ? <ArrowUp className="h-3 w-3 ml-1" /> 
      : <ArrowDown className="h-3 w-3 ml-1" />;
  };

  const handleSearch = () => {
    setSymbolFilter(searchInput);
    setPage(0);
  };

  const getDateRange = () => {
    const now = new Date();
    switch (dateRange) {
      case "7d": return { start: startOfDay(subDays(now, 7)), end: now };
      case "30d": return { start: startOfDay(subDays(now, 30)), end: now };
      case "90d": return { start: startOfDay(subDays(now, 90)), end: now };
      default: return { start: undefined, end: undefined };
    }
  };

  const buildQueryParams = (includeStatus = true) => {
    const { start, end } = getDateRange();
    const params = new URLSearchParams();
    if (start) params.set("startDate", start.toISOString());
    if (end) params.set("endDate", end.toISOString());
    if (strategyFilter !== "all") params.set("strategyId", strategyFilter);
    if (timeframeFilter !== "all") params.set("timeframe", timeframeFilter);
    if (outcomeFilter !== "all") params.set("outcome", outcomeFilter);
    if (includeStatus && statusFilter !== "all") params.set("status", statusFilter);
    if (stageFilter !== "all") params.set("stage", stageFilter);
    if (symbolFilter.trim()) params.set("symbol", symbolFilter.trim().toUpperCase());
    return params;
  };

  const { data: opportunities, isLoading: loadingOpportunities } = useQuery<Opportunity[]>({
    queryKey: ["/api/opportunities", dateRange, strategyFilter, timeframeFilter, outcomeFilter, statusFilter, stageFilter, symbolFilter, sortBy, sortOrder, page],
    queryFn: async () => {
      const params = buildQueryParams();
      params.set("limit", String(pageSize));
      params.set("offset", String(page * pageSize));
      params.set("sortBy", sortBy);
      params.set("sortOrder", sortOrder);
      const res = await fetch(`/api/opportunities?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch opportunities");
      return res.json();
    },
  });

  const { data: summary, isLoading: loadingSummary } = useQuery<OpportunitySummary>({
    queryKey: ["/api/opportunities/summary", dateRange, strategyFilter, timeframeFilter, stageFilter, symbolFilter],
    queryFn: async () => {
      const params = buildQueryParams(false);
      const res = await fetch(`/api/opportunities/summary?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch summary");
      return res.json();
    },
  });

  const { data: strategies } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/strategies"],
  });

  const handleExportCSV = () => {
    const params = buildQueryParams();
    window.open(`/api/opportunities/export.csv?${params.toString()}`, "_blank");
  };

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold" data-testid="text-page-title">Trade Outcomes</h1>
            <p className="text-sm text-muted-foreground">Summaries of detected opportunities and system activity</p>
          </div>
          <Button variant="outline" size="sm" onClick={handleExportCSV} data-testid="button-export-csv">
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <Collapsible>
          <Card>
            <CollapsibleTrigger className="w-full" data-testid="button-toggle-info">
              <CardHeader className="pb-3 cursor-pointer hover-elevate">
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Info className="h-4 w-4" />
                    How Trade Outcomes Work
                  </span>
                  <ChevronDown className="h-4 w-4 transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
                </CardTitle>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0 pb-4">
                <div className="grid md:grid-cols-2 gap-4 text-sm">
                  <div className="space-y-3">
                    <div>
                      <h4 className="font-medium mb-1">Status: Active vs Resolved</h4>
                      <ul className="space-y-1 text-muted-foreground">
                        <li><strong className="text-foreground">Active</strong> - Opportunity is still being tracked, waiting for an outcome</li>
                        <li><strong className="text-foreground">Resolved</strong> - Opportunity has concluded with one of the outcomes below</li>
                      </ul>
                    </div>
                    <div>
                      <h4 className="font-medium mb-1">Outcome Types</h4>
                      <ul className="space-y-1 text-muted-foreground">
                        <li className="flex items-start gap-2">
                          <TrendingUp className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                          <span><strong className="text-foreground">Broke Resistance</strong> - Price broke above the resistance level (winning trade)</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <TrendingDown className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                          <span><strong className="text-foreground">Invalidated</strong> - Price hit the stop level and stayed below entry (losing trade)</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                          <span><strong className="text-foreground">Expired</strong> - Time ran out without hitting resistance or stop (neutral)</span>
                        </li>
                      </ul>
                    </div>
                    <div>
                      <h4 className="font-medium mb-1">P&L Calculation</h4>
                      <p className="text-muted-foreground">
                        P&L shows the percentage gain/loss from entry price. For winning trades, it uses the max price reached. 
                        For losing trades, it uses the min price or stop level.
                      </p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <h4 className="font-medium mb-1">Expiration by Strategy</h4>
                      <ul className="space-y-1 text-muted-foreground">
                        <li><strong className="text-foreground">Open Drive (5m), Open Drive (15m), Gap Force</strong> - 1 day</li>
                        <li><strong className="text-foreground">Institutional Reclaim, Volume Surge</strong> - 3 days</li>
                        <li><strong className="text-foreground">Momentum Breakout, Power Breakout, Precision Pullback, Trend Pilot, Pressure Break</strong> - 10 days</li>
                      </ul>
                    </div>
                    <div>
                      <h4 className="font-medium mb-1">Pattern Stages</h4>
                      <ul className="space-y-1 text-muted-foreground">
                        <li><strong className="text-foreground">Forming</strong> - Pattern is developing but not yet ready</li>
                        <li><strong className="text-foreground">Ready</strong> - Pattern complete, waiting for breakout trigger</li>
                        <li><strong className="text-foreground">Breakout</strong> - Price has broken out of the pattern</li>
                      </ul>
                    </div>
                    <div>
                      <h4 className="font-medium mb-1">Days to Resolution</h4>
                      <p className="text-muted-foreground">
                        Shows how long from detection until the opportunity resolved. 
                        "{'<'} 1" means it resolved the same day it was detected.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Filters
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
              <div>
                <Label className="text-xs">Date Range</Label>
                <Select value={dateRange} onValueChange={(v) => { setDateRange(v); setPage(0); }}>
                  <SelectTrigger data-testid="select-date-range">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DATE_RANGE_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Strategy</Label>
                <Select value={strategyFilter} onValueChange={(v) => { setStrategyFilter(v); setPage(0); }}>
                  <SelectTrigger data-testid="select-strategy">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Strategies</SelectItem>
                    {strategies?.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Timeframe</Label>
                <Select value={timeframeFilter} onValueChange={(v) => { setTimeframeFilter(v); setPage(0); }}>
                  <SelectTrigger data-testid="select-timeframe">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEFRAME_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Outcome</Label>
                <Select value={outcomeFilter} onValueChange={(v) => { setOutcomeFilter(v); setPage(0); }}>
                  <SelectTrigger data-testid="select-outcome">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OUTCOMES.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Status</Label>
                <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
                  <SelectTrigger data-testid="select-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Stage</Label>
                <Select value={stageFilter} onValueChange={(v) => { setStageFilter(v); setPage(0); }}>
                  <SelectTrigger data-testid="select-stage">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STAGE_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Symbol</Label>
                <Input
                  placeholder="e.g. AAPL"
                  value={symbolFilter}
                  onChange={(e) => setSymbolFilter(e.target.value)}
                  onBlur={() => setPage(0)}
                  data-testid="input-symbol-filter"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold" data-testid="text-total-opportunities">
                {loadingSummary ? <Skeleton className="h-8 w-16" /> : summary?.total ?? 0}
              </div>
              <p className="text-xs text-muted-foreground">Total Opportunities</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-broke-resistance">
                {loadingSummary ? <Skeleton className="h-8 w-16" /> : summary?.brokeResistanceCount ?? 0}
              </div>
              <p className="text-xs text-muted-foreground">Broke Resistance</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-red-600 dark:text-red-400" data-testid="text-invalidated">
                {loadingSummary ? <Skeleton className="h-8 w-16" /> : summary?.invalidatedCount ?? 0}
              </div>
              <p className="text-xs text-muted-foreground">Invalidated</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-muted-foreground" data-testid="text-expired">
                {loadingSummary ? <Skeleton className="h-8 w-16" /> : summary?.expiredCount ?? 0}
              </div>
              <p className="text-xs text-muted-foreground">Expired</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-amber-600 dark:text-amber-400" data-testid="text-active">
                {loadingSummary ? <Skeleton className="h-8 w-16" /> : summary?.active ?? 0}
              </div>
              <p className="text-xs text-muted-foreground">Active</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold" data-testid="text-avg-favorable-move">
                {loadingSummary ? <Skeleton className="h-8 w-16" /> : 
                  summary && summary.avgMaxFavorableMovePercent !== null 
                    ? `+${summary.avgMaxFavorableMovePercent.toFixed(1)}%` 
                    : "-"}
              </div>
              <p className="text-xs text-muted-foreground">Avg Best Move</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base">Opportunities</CardTitle>
              <CardDescription>
                Click on a row to view details. Click column headers to sort.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search symbol..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="pl-8 w-40"
                  data-testid="input-search-symbol"
                />
              </div>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleSearch}
                data-testid="button-search"
              >
                Search
              </Button>
              {symbolFilter && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => { setSearchInput(""); setSymbolFilter(""); setPage(0); }}
                  data-testid="button-clear-search"
                >
                  Clear
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead 
                      className="cursor-pointer hover:bg-muted/50" 
                      onClick={() => handleSort("symbol")}
                      data-testid="sort-symbol"
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="flex items-center">Symbol {getSortIcon("symbol")}</span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Stock ticker symbol</p>
                        </TooltipContent>
                      </Tooltip>
                    </TableHead>
                    <TableHead 
                      className="cursor-pointer hover:bg-muted/50" 
                      onClick={() => handleSort("strategyName")}
                      data-testid="sort-strategy"
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="flex items-center">Strategy {getSortIcon("strategyName")}</span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Trading strategy that detected this opportunity</p>
                        </TooltipContent>
                      </Tooltip>
                    </TableHead>
                    <TableHead>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>Stage</span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Pattern stage: Forming, Ready, or Breakout</p>
                        </TooltipContent>
                      </Tooltip>
                    </TableHead>
                    <TableHead 
                      className="cursor-pointer hover:bg-muted/50" 
                      onClick={() => handleSort("detectedAt")}
                      data-testid="sort-detected"
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="flex items-center">Detected {getSortIcon("detectedAt")}</span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Date and time when the opportunity was first detected</p>
                        </TooltipContent>
                      </Tooltip>
                    </TableHead>
                    <TableHead className="text-right">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>Resistance</span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Price level where breakout is confirmed</p>
                        </TooltipContent>
                      </Tooltip>
                    </TableHead>
                    <TableHead className="text-right">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>Stop</span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Stop loss reference price for risk management</p>
                        </TooltipContent>
                      </Tooltip>
                    </TableHead>
                    <TableHead className="text-right">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>Price</span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Current or last traded price of the stock</p>
                        </TooltipContent>
                      </Tooltip>
                    </TableHead>
                    <TableHead>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>Outcome</span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Current status: Active, Broke Resistance, Invalidated, or Expired</p>
                        </TooltipContent>
                      </Tooltip>
                    </TableHead>
                    <TableHead 
                      className="text-right cursor-pointer hover:bg-muted/50" 
                      onClick={() => handleSort("pnlPercent")}
                      data-testid="sort-pnl"
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="flex items-center justify-end">P&L % {getSortIcon("pnlPercent")}</span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Profit/Loss percentage from detection price to resolution</p>
                        </TooltipContent>
                      </Tooltip>
                    </TableHead>
                    <TableHead 
                      className="text-right cursor-pointer hover:bg-muted/50" 
                      onClick={() => handleSort("daysToResolution")}
                      data-testid="sort-days"
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="flex items-center justify-end">Days {getSortIcon("daysToResolution")}</span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Number of trading days from detection to resolution</p>
                        </TooltipContent>
                      </Tooltip>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingOpportunities ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 10 }).map((_, j) => (
                          <TableCell key={j}><Skeleton className="h-4 w-16" /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : opportunities && opportunities.length > 0 ? (
                    opportunities.map((opp) => (
                      <TableRow
                        key={opp.id}
                        className="cursor-pointer hover-elevate"
                        onClick={() => setSelectedOpportunity(opp)}
                        data-testid={`row-opportunity-${opp.id}`}
                      >
                        <TableCell className="font-medium">
                          <Link 
                            href={`/charts/${opp.symbol}`} 
                            onClick={(e) => e.stopPropagation()}
                            className="text-primary hover:underline"
                            data-testid={`link-chart-${opp.symbol}`}
                          >
                            {opp.symbol}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm">{formatStrategyName(opp.strategyName)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{opp.stageAtDetection}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(new Date(opp.detectedAt), "MMM d, HH:mm")}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">{formatPrice(opp.resistancePrice)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{formatPrice(opp.stopReferencePrice)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{formatPrice(opp.detectedPrice)}</TableCell>
                        <TableCell>
                          <Badge variant={getOutcomeBadgeVariant(opp.resolutionOutcome)} className="text-xs">
                            {getOutcomeIcon(opp.resolutionOutcome)}
                            {formatOutcome(opp.resolutionOutcome, opp.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className={`text-right font-mono text-sm ${
                          opp.pnlPercent && opp.pnlPercent > 0 ? "text-green-600 dark:text-green-400" : 
                          opp.pnlPercent && opp.pnlPercent < 0 ? "text-red-600 dark:text-red-400" : ""
                        }`}>
                          {formatPercent(opp.pnlPercent)}
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {opp.daysToResolution === null ? "-" : 
                           opp.daysToResolution === 0 ? "< 1" : 
                           opp.daysToResolution}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                        No opportunities found for the selected filters
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between px-4 py-3 border-t">
              <div className="text-sm text-muted-foreground">
                Showing {page * pageSize + 1} - {page * pageSize + (opportunities?.length ?? 0)}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  data-testid="button-prev-page"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={(opportunities?.length ?? 0) < pageSize}
                  onClick={() => setPage(p => p + 1)}
                  data-testid="button-next-page"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Sheet open={!!selectedOpportunity} onOpenChange={() => setSelectedOpportunity(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {selectedOpportunity && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <span className="text-xl font-bold">{selectedOpportunity.symbol}</span>
                  <Badge variant={getOutcomeBadgeVariant(selectedOpportunity.resolutionOutcome)}>
                    {formatOutcome(selectedOpportunity.resolutionOutcome, selectedOpportunity.status)}
                  </Badge>
                </SheetTitle>
                <SheetDescription>
                  {formatStrategyName(selectedOpportunity.strategyName)} - {selectedOpportunity.stageAtDetection}
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-4 mt-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">Detected At</Label>
                    <p className="text-sm font-medium">
                      {format(new Date(selectedOpportunity.detectedAt), "MMM d, yyyy HH:mm")}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Timeframe</Label>
                    <p className="text-sm font-medium">{selectedOpportunity.timeframe}</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">Detected Price</Label>
                    <p className="text-sm font-mono font-medium">{formatPrice(selectedOpportunity.detectedPrice)}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Resistance</Label>
                    <p className="text-sm font-mono font-medium text-green-600 dark:text-green-400">
                      {formatPrice(selectedOpportunity.resistancePrice)}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Stop Level</Label>
                    <p className="text-sm font-mono font-medium text-red-600 dark:text-red-400">
                      {formatPrice(selectedOpportunity.stopReferencePrice)}
                    </p>
                  </div>
                </div>

                {selectedOpportunity.status === "RESOLVED" && (
                  <>
                    <div className="border-t pt-4">
                      <h4 className="text-sm font-medium mb-3">Resolution Details</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label className="text-xs text-muted-foreground">Resolved At</Label>
                          <p className="text-sm font-medium">
                            {selectedOpportunity.resolvedAt 
                              ? format(new Date(selectedOpportunity.resolvedAt), "MMM d, yyyy HH:mm")
                              : "-"}
                          </p>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Days to Resolution</Label>
                          <p className="text-sm font-medium">
                            {selectedOpportunity.daysToResolution === null ? "-" : 
                             selectedOpportunity.daysToResolution === 0 ? "< 1" : 
                             selectedOpportunity.daysToResolution}
                          </p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4 mt-3">
                        <div>
                          <Label className="text-xs text-muted-foreground">Resolution Price</Label>
                          <p className="text-sm font-mono font-medium">
                            {formatPrice(selectedOpportunity.resolutionPrice)}
                          </p>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">P&L</Label>
                          <p className={`text-sm font-mono font-medium ${
                            selectedOpportunity.pnlPercent && selectedOpportunity.pnlPercent > 0 
                              ? "text-green-600 dark:text-green-400" 
                              : selectedOpportunity.pnlPercent && selectedOpportunity.pnlPercent < 0 
                                ? "text-red-600 dark:text-red-400" 
                                : ""
                          }`}>
                            {formatPercent(selectedOpportunity.pnlPercent)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                <div className="pt-4">
                  <Button asChild className="w-full" data-testid="button-view-chart">
                    <Link href={`/charts/${selectedOpportunity.symbol}`}>
                      <BarChart3 className="h-4 w-4 mr-2" />
                      View Chart
                    </Link>
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
