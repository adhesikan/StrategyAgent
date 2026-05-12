import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { formatDistanceToNow, format } from "date-fns";
import { Bot, Zap, AlertCircle, ArrowUpDown, Search, ChevronLeft, ChevronRight, X, RefreshCw, Ban, Shield, Target, TrendingUp, TrendingDown } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { StockTradeTicket } from "@/components/stock-trade-ticket";
import { useBrokerStatus } from "@/hooks/use-broker-status";
import { OpenBrokerButton } from "@/components/open-broker-button";

interface BrokerAccount {
  id: string;
  name: string;
  type: string;
  buyingPower: number;
  equity: number;
  currency: string;
}

interface BrokerPosition {
  symbol: string;
  qty: number;
  avgPrice: number;
  marketPrice: number;
  unrealizedPnl: number;
}

interface ExecutedTrade {
  id: string;
  symbol: string;
  source: "auto_agent" | "instatrade" | "broker";
  action?: string;
  side: string;
  quantity: number;
  filledQty?: number;
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
  partial_fill: "Partial Fill",
  pending: "Pending",
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

const ORDER_TYPE_LABELS: Record<string, string> = {
  market: "Market",
  limit: "Limit",
  stop: "Stop",
  stop_limit: "Stop Limit",
};

function formatOrderType(orderType: string): string {
  return ORDER_TYPE_LABELS[orderType] || orderType.charAt(0).toUpperCase() + orderType.slice(1);
}

type SortField = "date" | "symbol" | "status" | "quantity";
type SortDir = "asc" | "desc";

const PAGE_SIZE_OPTIONS = [10, 25, 50];

const CANCELLABLE_STATUSES = new Set(["sent_to_broker", "open", "queued", "received", "ack", "partial_fill"]);

function isCancellable(trade: ExecutedTrade): boolean {
  if (!trade.brokerOrderId) return false;
  return CANCELLABLE_STATUSES.has(trade.status);
}

function TradeCard({ trade, onInstaTrade, onCancel, isCancelling, position }: {
  trade: ExecutedTrade;
  onInstaTrade?: (trade: ExecutedTrade) => void;
  onCancel?: (trade: ExecutedTrade) => void;
  isCancelling?: boolean;
  position?: BrokerPosition | null;
}) {
  const cancellable = isCancellable(trade);
  const showPnl = trade.status === "filled" && position && trade.side === "buy" && !trade.strategy;

  return (
    <Card key={trade.id} data-testid={`trade-card-${trade.id}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Badge
              variant={trade.status === "error" ? "destructive" : trade.source === "auto_agent" ? "default" : trade.source === "broker" ? "outline" : "secondary"}
              className="text-xs shrink-0"
              data-testid={`badge-trade-source-${trade.id}`}
            >
              {trade.source === "auto_agent" ? (
                <><Bot className="h-3 w-3 mr-1" />{trade.status === "error" ? "Error" : trade.status === "pending" ? "Suggested" : "Auto Agent"}</>
              ) : trade.source === "broker" ? (
                trade.strategy === "Stop Loss" ? (
                  <><Shield className="h-3 w-3 mr-1" />Stop Loss</>
                ) : trade.strategy === "Profit Target" ? (
                  <><Target className="h-3 w-3 mr-1" />Take Profit</>
                ) : trade.strategy === "Exit" ? (
                  <><Shield className="h-3 w-3 mr-1" />Exit</>
                ) : (
                  <><ArrowUpDown className="h-3 w-3 mr-1" />Broker</>
                )
              ) : (
                <><Zap className="h-3 w-3 mr-1" />InstaTrade&trade;</>
              )}
            </Badge>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono font-bold text-sm" data-testid={`text-trade-sym-${trade.id}`}>
                  {trade.symbol}
                </span>
                <Badge variant="outline" className="text-xs uppercase">
                  {trade.action === "sell_short" || trade.action === "sellshort"
                    ? "Short"
                    : trade.action === "buy_to_cover" || trade.action === "buytocover"
                    ? "Cover"
                    : trade.action === "buy_to_open"
                    ? "Buy Open"
                    : trade.action === "buy_to_close"
                    ? "Buy Close"
                    : trade.action === "sell_to_open"
                    ? "Sell Open"
                    : trade.action === "sell_to_close"
                    ? "Sell Close"
                    : trade.side}
                </Badge>
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
              <div className="flex items-center gap-2 flex-wrap mt-1 text-xs text-muted-foreground">
                <span>Qty: {trade.filledQty !== undefined && trade.filledQty > 0 && trade.filledQty !== trade.quantity ? `${trade.filledQty}/${trade.quantity}` : trade.quantity}</span>
                {trade.price && <span>@ ${trade.price.toFixed(2)}</span>}
                <span>{formatOrderType(trade.orderType)}</span>
                {trade.brokerOrderId && (
                  <span className="font-mono">#{trade.brokerOrderId}</span>
                )}
              </div>
              {trade.reasons && trade.reasons.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {(trade.reasons as string[]).map((reason, i) => (
                    <p key={i} className="text-xs text-muted-foreground">
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
                trade.status === "partial_fill" ? "secondary" :
                trade.status === "pending" ? "outline" :
                trade.status === "cancelled" || trade.status === "error" || trade.status === "rejected" ? "destructive" : "secondary"
              }
              className={`text-xs ${trade.status === "partial_fill" ? "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border-yellow-500/30" : ""}`}
              data-testid={`badge-trade-status-${trade.id}`}
            >
              {formatStatus(trade.status)}
              {trade.status === "partial_fill" && trade.filledQty !== undefined && (
                <span className="ml-1">({trade.filledQty}/{trade.quantity})</span>
              )}
            </Badge>
            {showPnl && position && (
              <div className="flex items-center gap-1" data-testid={`text-trade-pnl-${trade.id}`}>
                {position.unrealizedPnl >= 0 ? (
                  <TrendingUp className="h-3.5 w-3.5 text-green-500" />
                ) : (
                  <TrendingDown className="h-3.5 w-3.5 text-red-500" />
                )}
                <span className={`text-sm font-semibold ${position.unrealizedPnl >= 0 ? "text-green-500" : "text-red-500"}`}>
                  {position.unrealizedPnl >= 0 ? "+" : ""}${position.unrealizedPnl.toFixed(2)}
                </span>
                {position.avgPrice > 0 && position.marketPrice > 0 && (
                  <span className={`text-xs ${position.unrealizedPnl >= 0 ? "text-green-500/70" : "text-red-500/70"}`}>
                    ({(((position.marketPrice - position.avgPrice) / position.avgPrice) * 100).toFixed(1)}%)
                  </span>
                )}
              </div>
            )}
            {showPnl && position && (
              <div className="text-[11px] text-muted-foreground" data-testid={`text-trade-prices-${trade.id}`}>
                Avg ${position.avgPrice.toFixed(2)} → Mkt ${position.marketPrice.toFixed(2)}
              </div>
            )}
            <div className="flex items-center gap-1">
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
              {cancellable && onCancel && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="text-xs gap-1"
                      disabled={isCancelling}
                      data-testid={`button-cancel-order-${trade.id}`}
                    >
                      <Ban className="h-3 w-3" />
                      {isCancelling ? "Cancelling..." : "Cancel"}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Cancel Order</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to cancel the {trade.side.toUpperCase()} order for{" "}
                        <span className="font-mono font-bold">{trade.symbol}</span>{" "}
                        (Qty: {trade.quantity})?
                        {trade.brokerOrderId && (
                          <span className="block mt-1 text-xs font-mono">Order #{trade.brokerOrderId}</span>
                        )}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel data-testid="button-cancel-dialog-dismiss">Keep Order</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => onCancel(trade)}
                        data-testid="button-cancel-dialog-confirm"
                      >
                        Yes, Cancel Order
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
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
  const { toast } = useToast();
  const { isConnected } = useBrokerStatus();
  const { data: allTrades, isLoading } = useQuery<ExecutedTrade[]>({
    queryKey: ["/api/all-trades"],
    refetchInterval: 10000,
  });

  const { data: brokerAccounts = [] } = useQuery<BrokerAccount[]>({
    queryKey: ["/api/broker/accounts"],
    refetchInterval: 30000,
  });

  const { data: brokerPositions = [] } = useQuery<BrokerPosition[]>({
    queryKey: ["/api/broker/positions"],
    refetchInterval: 15000,
    enabled: isConnected,
  });

  const positionMap = useMemo(() => {
    const map = new Map<string, BrokerPosition>();
    for (const pos of brokerPositions) {
      map.set(pos.symbol.toUpperCase(), pos);
    }
    return map;
  }, [brokerPositions]);

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/trades/sync-statuses");
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/all-trades"] });
      if (data.synced > 0) {
        toast({ title: `Updated ${data.synced} order status${data.synced > 1 ? "es" : ""}` });
      } else if (data.brokerOrderCount === 0) {
        toast({ title: "No broker orders found", description: "Make sure your broker is connected." });
      } else {
        toast({ title: "All statuses are up to date" });
      }
    },
    onError: () => {
      toast({ title: "Failed to sync statuses", variant: "destructive" });
    },
  });

  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);

  const cancelMutation = useMutation({
    mutationFn: async (orderId: string) => {
      setCancellingOrderId(orderId);
      const res = await apiRequest("POST", `/api/orders/${orderId}/cancel`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Cancel failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/all-trades"] });
      toast({ title: data.message || "Order cancelled successfully" });
      setCancellingOrderId(null);
    },
    onError: (error: any) => {
      toast({ title: "Failed to cancel order", description: error.message || "Please try again", variant: "destructive" });
      setCancellingOrderId(null);
    },
  });

  function handleCancelOrder(trade: ExecutedTrade) {
    const orderId = trade.brokerOrderId || trade.id.replace("broker-", "");
    cancelMutation.mutate(orderId);
  }

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
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <ArrowUpDown className="h-5 w-5" />
              Trade Activity
            </CardTitle>
            <CardDescription>
              Executed trades from Auto Agent and InstaTrade&trade;
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <OpenBrokerButton view="orders" testId="link-broker-orders-activity" />
            <OpenBrokerButton view="dashboard" testId="link-broker-dashboard" />
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              data-testid="button-sync-statuses"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncMutation.isPending ? "animate-spin" : ""}`} />
              {syncMutation.isPending ? "Syncing..." : "Sync Statuses"}
            </Button>
          </div>
        </div>
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
              <SelectItem value="broker">Broker</SelectItem>
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
              <TradeCard
                key={trade.id}
                trade={trade}
                onInstaTrade={handleInstaTrade}
                onCancel={handleCancelOrder}
                isCancelling={cancellingOrderId === (trade.brokerOrderId || trade.id.replace("broker-", ""))}
                position={positionMap.get(trade.symbol.toUpperCase()) || null}
              />
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
              Executed trades from Auto Agent and InstaTrade&trade; will appear here
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
