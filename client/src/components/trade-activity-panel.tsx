import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow, format } from "date-fns";
import { Bot, Zap, AlertCircle, ArrowUpDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

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
  reasons: string[] | null;
  createdAt: string;
}

function TradeCard({ trade }: { trade: ExecutedTrade }) {
  return (
    <Card key={trade.id} data-testid={`trade-card-${trade.id}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Badge
              variant={trade.status === "skipped" ? "destructive" : trade.source === "auto_agent" ? "default" : "secondary"}
              className="text-xs shrink-0"
              data-testid={`badge-trade-source-${trade.id}`}
            >
              {trade.source === "auto_agent" ? (
                <><Bot className="h-3 w-3 mr-1" />{trade.status === "skipped" ? "Skipped" : "Auto Agent"}</>
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
                trade.status === "filled" || trade.status === "executed" ? "default" :
                trade.status === "pending" ? "outline" :
                trade.status === "skipped" || trade.status === "cancelled" ? "destructive" : "secondary"
              }
              className="text-xs"
              data-testid={`badge-trade-status-${trade.id}`}
            >
              {trade.status}
            </Badge>
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
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        ) : allTrades && allTrades.length > 0 ? (
          <div className="flex flex-col gap-3">
            {allTrades.map((trade) => (
              <TradeCard key={trade.id} trade={trade} />
            ))}
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
      </CardContent>
    </Card>
  );
}
