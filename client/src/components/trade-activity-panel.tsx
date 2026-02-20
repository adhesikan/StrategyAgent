import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow, format } from "date-fns";
import { Bot, Zap, AlertCircle, ArrowUpDown, Search, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StockTradeTicket } from "@/components/stock-trade-ticket";

interface BrokerAccount {
  id: string;
  name: string;
  type: string;
  buyingPower: number;
  equity: number;
  currency: string;
}

interface ExecutedTrade {
  id: string;
  symbol: string;
  source: "auto_agent" | "instatrade";
  action?: string;
  side: string;
  quantity: number;
  orderType: string;
  price: number | null;
  status: string;
  brokerOrderId: string | null;
  isOptions: boolean;
  optionDetails: {
    optionType: string;
    strike: number;
    expiration: string;
  } | null;
  strategy: string | null;
  reasons: string[] | null;
  createdAt: string;
  stopLoss: number | null;
  target: number | null;
}

const STATUS_LABELS: Record<string, string> = {
  sent_to_broker: "Sent to Broker",
  filled: "Filled",
  pending: "Pending",
  skipped: "Skipped",
  cancelled: "Cancelled",
  rejected: "Rejected",
  error: "Error",
};

function formatStatus(status: string): string {
  return STATUS_LABELS[status] || status.charAt(0).toUpperCase() + status.slice(1);
}

function formatStrategy(strategy: string | null): string | null {
  if (!strategy) return null;
  return strategy
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

type SortField = "date" | "symbol" | "status" | "quantity";
type SortDir = "asc" | "desc";

const PAGE_SIZE_OPTIONS = [10, 25, 50];

function TradeCard({ trade, onInstaTrade }: { trade: ExecutedTrade; onInstaTrade?: (trade: ExecutedTrade) => void }) {
  return (
    <Card key={trade.id} data-testid={`trade-card-${trade.id}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Badge
              variant={trade.status === "skipped" || trade.status === "error" ? "destructive" : trade.source === "auto_agent" ? "default" : "secondary"}
              className="text-xs shrink-0"
              data-testid={`badge-trade-source-${trade.id}`}
            >
              {trade.source === "auto_agent" ? (
                <><Bot className="h-3 w-3 mr-1" />{trade.status === "skipped" ? "Skipped" : trade.status === "error" ? "Error" : trade.status === "pending" ? "Suggested" : "Auto Agent"}</>
              ) : (
                <><Zap className="h-3 w-3 mr-1" />InstaTrade&trade;</>
              )}
            </Badge>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono font-bold text-sm" data-testid={`text-trade-sym-${trade.id}`}>
                  {trade.symbol}
                </span>
                {trade.status !== "skipped" && (
                  <Badge variant="outline" className="text-xs uppercase">
                    {trade.side}
                  </Badge>
                )}
                {formatStrategy(trade.strategy) && (
                  <Badge variant="secondary" className="text-xs" data-testid={`badge-trade-strategy-${trade.id}`}>
                    {formatStrategy(trade.strategy)}
                  </Badge>
                )}
                {trade.isOptions && trade.optionDetails && (
                  <span className="text-xs text-muted-foreground">
                    {trade.optionDetails.optionType?.toUpperCase()} ${trade.optionDetails.strike} exp {trade.optionDetails.expiration}
                  </span>
                )}
              </div>
              {trade.status !== "skipped" && (
                <div className="flex items-center gap-2 flex-wrap mt-1 text-xs text-muted-foreground">
                  <span>Qty: {trade.quantity}</span>
                  {trade.price && <span>@ ${trade.price.toFixed(2)}</span>}
                  <span>{trade.orderType}</span>
                  {trade.brokerOrderId && (
                    <span className="font-mono">#{trade.brokerOrderId}</span>
                  )}
                </div>
              )}
              {trade.reasons && trade.reasons.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {(trade.reasons as string[]).map((reason, i) => (
                    <p key={i} className={`text-xs ${trade.status === "skipped" ? "text-destructive/80" : "text-muted-foreground"}`}>
                      {trade.status === "skipped" && <AlertCircle className="h-3 w-3 inline mr-1 -mt-0.5" />}
                      {reason}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <Badge
              variant={
                trade.status === "filled" || trade.status === "sent_to_broker" ? "default" :
                trade.status === "pending" ? "outline" :
                trade.status === "skipped" || trade.status === "cancelled" || trade.status === "error" || trade.status === "rejected" ? "destructive" : "secondary"
              }
              className="text-xs"
              data-testid={`badge-trade-status-${trade.id}`}
            >
              {formatStatus(trade.status)}
            </Badge>
            {trade.status === "pending" && onInstaTrade && (
              <Button
                size="sm"
                variant="default"
                className="text-xs gap-1"
                onClick={() => onInstaTrade(trade)}
                data-testid={`button-instatrade-${trade.id}`}
              >
                <Zap className="h-3 w-3" />
                InstaTrade&trade;
              </Button>
            )}
            <div className="flex flex-col items-end gap-0.5" data-testid={`text-trade-time-${trade.id}`}>
              {trade.createdAt && (
                <>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(trade.createdAt), "MMM d, yyyy h:mm a")}
                  </span>
                  <span className="text-[11px] text-muted-foreground/70">
                    {formatDistanceToNow(new Date(trade.createdAt), { addSuffix: true })}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function TradeActivityPanel() {
  const { data: allTrades, isLoading } = useQuery<ExecutedTrade[]>({
    queryKey: ["/api/all-trades"],
  });

  const { data: brokerAccounts = [] } = useQuery<BrokerAccount[]>({
    queryKey: ["/api/broker/accounts"],
  });

  const [selectedBrokerAccount, setSelectedBrokerAccount] = useState<BrokerAccount | null>(null);

  useEffect(() => {
    if (!selectedBrokerAccount && brokerAccounts.length > 0) {
      setSelectedBrokerAccount(brokerAccounts[0]);
    }
  }, [brokerAccounts]);

  const [showTradeTicket, setShowTradeTicket] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState<ExecutedTrade | null>(null);

  function handleInstaTrade(trade: ExecutedTrade) {
    setSelectedTrade(trade);
    setShowTradeTicket(true);
  }

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const statusOptions = useMemo(() => {
    if (!allTrades) return [];
    const unique = Array.from(new Set(allTrades.map((t) => t.status)));
    return unique.sort();
  }, [allTrades]);

  const filtered = useMemo(() => {
    if (!allTrades) return [];
    let results = [...allTrades];

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toUpperCase();
      results = results.filter(
        (t) =>
          t.symbol.toUpperCase().includes(q) ||
          t.brokerOrderId?.toUpperCase().includes(q)
      );
    }

    if (statusFilter !== "all") {
      results = results.filter((t) => t.status === statusFilter);
    }

    if (sourceFilter !== "all") {
      results = results.filter((t) => t.source === sourceFilter);
    }

    results.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "date":
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case "symbol":
          cmp = a.symbol.localeCompare(b.symbol);
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
        case "quantity":
          cmp = a.quantity - b.quantity;
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return results;
  }, [allTrades, searchQuery, statusFilter, sourceFilter, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const hasActiveFilters = searchQuery.trim() !== "" || statusFilter !== "all" || sourceFilter !== "all";

  function clearFilters() {
    setSearchQuery("");
    setStatusFilter("all");
    setSourceFilter("all");
    setPage(1);
  }

  function handlePageChange(newPage: number) {
    setPage(Math.max(1, Math.min(newPage, totalPages)));
  }

  return (
    <Card data-testid="section-trade-activity">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <ArrowUpDown className="h-5 w-5" />
          Trade Activity
        </CardTitle>
        <CardDescription>
          Executed and skipped trades from Auto Agent and InstaTrade&trade;
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search symbol or order ID..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              className="pl-9"
              data-testid="input-trade-search"
            />
          </div>

          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-[160px]" data-testid="select-trade-status-filter">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="sent_to_broker">Sent to Broker</SelectItem>
              <SelectItem value="filled">Filled</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="skipped">Skipped</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sourceFilter} onValueChange={(v) => { setSourceFilter(v); setPage(1); }}>
            <SelectTrigger className="w-[150px]" data-testid="select-trade-source-filter">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              <SelectItem value="auto_agent">Auto Agent</SelectItem>
              <SelectItem value="instatrade">InstaTrade</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={`${sortField}_${sortDir}`}
            onValueChange={(v) => {
              const [field, dir] = v.split("_") as [SortField, SortDir];
              setSortField(field);
              setSortDir(dir);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[170px]" data-testid="select-trade-sort">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date_desc">Newest First</SelectItem>
              <SelectItem value="date_asc">Oldest First</SelectItem>
              <SelectItem value="symbol_asc">Symbol A-Z</SelectItem>
              <SelectItem value="symbol_desc">Symbol Z-A</SelectItem>
              <SelectItem value="status_asc">Status A-Z</SelectItem>
              <SelectItem value="status_desc">Status Z-A</SelectItem>
              <SelectItem value="quantity_desc">Qty High-Low</SelectItem>
              <SelectItem value="quantity_asc">Qty Low-High</SelectItem>
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-clear-filters">
              <X className="h-4 w-4 mr-1" />
              Clear
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        ) : paginated.length > 0 ? (
          <div className="flex flex-col gap-3">
            {paginated.map((trade) => (
              <TradeCard key={trade.id} trade={trade} onInstaTrade={handleInstaTrade} />
            ))}
          </div>
        ) : allTrades && allTrades.length > 0 && hasActiveFilters ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Search className="h-10 w-10 text-muted-foreground/50 mb-3" />
            <p className="text-sm font-medium">No matching trades</p>
            <p className="text-xs text-muted-foreground mt-1">
              Try adjusting your search or filters
            </p>
            <Button variant="outline" size="sm" className="mt-3" onClick={clearFilters} data-testid="button-clear-filters-empty">
              Clear Filters
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <ArrowUpDown className="h-10 w-10 text-muted-foreground/50 mb-3" />
            <p className="text-sm font-medium">No trade activity yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Executed and skipped trades from Auto Agent and InstaTrade&trade; will appear here
            </p>
          </div>
        )}

        {filtered.length > 0 && (
          <div className="flex items-center justify-between flex-wrap gap-3 pt-2 border-t">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span data-testid="text-trade-count">
                {filtered.length} trade{filtered.length !== 1 ? "s" : ""}
                {hasActiveFilters && allTrades ? ` of ${allTrades.length}` : ""}
              </span>
              <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
                <SelectTrigger className="h-7 w-[70px] text-xs" data-testid="select-page-size">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}/pg</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  disabled={safePage <= 1}
                  onClick={() => handlePageChange(safePage - 1)}
                  data-testid="button-prev-page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs text-muted-foreground px-2" data-testid="text-page-info">
                  {safePage} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  disabled={safePage >= totalPages}
                  onClick={() => handlePageChange(safePage + 1)}
                  data-testid="button-next-page"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>

      <StockTradeTicket
        open={showTradeTicket}
        onOpenChange={(open) => {
          setShowTradeTicket(open);
          if (!open) setSelectedTrade(null);
        }}
        scanResult={selectedTrade ? {
          ticker: selectedTrade.symbol,
          price: selectedTrade.price ?? 0,
          resistance: selectedTrade.price ?? null,
          stopLoss: selectedTrade.stopLoss ?? null,
          stage: "",
          patternScore: 0,
          prefillTarget: selectedTrade.target ?? null,
          prefillQuantity: selectedTrade.quantity > 0 ? selectedTrade.quantity : undefined,
        } : null}
        brokerAccounts={brokerAccounts}
        selectedAccount={selectedBrokerAccount}
        onAccountChange={setSelectedBrokerAccount}
      />
    </Card>
  );
}
