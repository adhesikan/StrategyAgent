import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useBrokerStatus } from "@/hooks/use-broker-status";
import { usePositionUpdates } from "@/hooks/use-position-updates";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { OpenBrokerButton } from "@/components/open-broker-button";
import { Briefcase, TrendingUp, TrendingDown, Radio, X, Loader2 } from "lucide-react";

interface BrokerPosition {
  symbol: string;
  qty: number;
  avgPrice: number;
  marketPrice: number;
  unrealizedPnl: number;
}

export function LivePositionsPanel() {
  const { isConnected } = useBrokerStatus();
  const { toast } = useToast();
  const [closingSymbol, setClosingSymbol] = useState<string | null>(null);

  const { data: positions = [], isLoading } = useQuery<BrokerPosition[]>({
    queryKey: ["/api/broker/positions"],
    enabled: isConnected,
    refetchInterval: 30000,
  });

  usePositionUpdates(isConnected);

  const closeMutation = useMutation({
    mutationFn: async (symbol: string) => {
      setClosingSymbol(symbol);
      const res = await apiRequest("POST", `/api/broker/positions/${encodeURIComponent(symbol)}/close`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Close failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: (data: any, symbol) => {
      toast({
        title: `Close order sent for ${symbol}`,
        description: data.brokerOrderId ? `Order #${data.brokerOrderId}` : "Sent to your broker.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/broker/positions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/all-trades"] });
      setClosingSymbol(null);
    },
    onError: (err: any) => {
      toast({
        title: "Could not close position",
        description: err.message || "Please try again.",
        variant: "destructive",
      });
      setClosingSymbol(null);
    },
  });

  if (!isConnected) return null;

  return (
    <Card data-testid="section-live-positions">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Briefcase className="h-5 w-5" />
              Live Positions
              <Badge variant="outline" className="text-[10px] gap-1 border-emerald-500/40 text-emerald-400 bg-emerald-500/5">
                <Radio className="h-2.5 w-2.5 animate-pulse" />
                Live
              </Badge>
            </CardTitle>
            <CardDescription>
              Streaming from your broker. Close any position with one tap (sends a market order).
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <OpenBrokerButton view="positions" testId="link-broker-positions" />
            <OpenBrokerButton view="orders" testId="link-broker-orders" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : positions.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground" data-testid="text-no-positions">
            No open positions in your connected account.
          </div>
        ) : (
          <div className="overflow-x-auto -mx-4 md:mx-0">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th className="text-left py-2 px-2 font-medium">Symbol</th>
                  <th className="text-right py-2 px-2 font-medium">Qty</th>
                  <th className="text-right py-2 px-2 font-medium">Avg</th>
                  <th className="text-right py-2 px-2 font-medium">Mkt</th>
                  <th className="text-right py-2 px-2 font-medium">P/L</th>
                  <th className="text-right py-2 px-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => {
                  const pct =
                    pos.avgPrice > 0 && pos.marketPrice > 0
                      ? ((pos.marketPrice - pos.avgPrice) / pos.avgPrice) * 100 * Math.sign(pos.qty || 1)
                      : 0;
                  const isPositive = pos.unrealizedPnl >= 0;
                  const isClosing = closingSymbol === pos.symbol;
                  return (
                    <tr
                      key={pos.symbol}
                      className="border-b last:border-b-0"
                      data-testid={`row-position-${pos.symbol}`}
                    >
                      <td className="py-2 px-2 font-mono font-bold">{pos.symbol}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{pos.qty}</td>
                      <td className="py-2 px-2 text-right tabular-nums">${pos.avgPrice.toFixed(2)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">${pos.marketPrice.toFixed(2)}</td>
                      <td className="py-2 px-2 text-right">
                        <div
                          className={`inline-flex items-center gap-1 tabular-nums ${
                            isPositive ? "text-green-500" : "text-red-500"
                          }`}
                          data-testid={`text-pnl-${pos.symbol}`}
                        >
                          {isPositive ? (
                            <TrendingUp className="h-3.5 w-3.5" />
                          ) : (
                            <TrendingDown className="h-3.5 w-3.5" />
                          )}
                          <span className="font-semibold">
                            {isPositive ? "+" : ""}${pos.unrealizedPnl.toFixed(2)}
                          </span>
                          <span className="text-xs opacity-70">({pct.toFixed(1)}%)</span>
                        </div>
                      </td>
                      <td className="py-2 px-2 text-right">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="text-xs gap-1 h-7"
                              disabled={isClosing || pos.qty === 0}
                              data-testid={`button-close-position-${pos.symbol}`}
                            >
                              {isClosing ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <X className="h-3 w-3" />
                              )}
                              Close
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Close position in {pos.symbol}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This sends a <span className="font-semibold">{pos.qty > 0 ? "SELL" : "BUY"} {Math.abs(pos.qty)}</span>{" "}
                                market order for <span className="font-mono font-bold">{pos.symbol}</span> to your connected
                                broker. Fill price is not guaranteed and may differ from the last shown price
                                (${pos.marketPrice.toFixed(2)}).
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel data-testid={`button-cancel-close-${pos.symbol}`}>
                                Keep Position
                              </AlertDialogCancel>
                              <AlertDialogAction
                                disabled={isClosing || closeMutation.isPending}
                                onClick={(e) => {
                                  if (isClosing || closeMutation.isPending) {
                                    e.preventDefault();
                                    return;
                                  }
                                  closeMutation.mutate(pos.symbol);
                                }}
                                data-testid={`button-confirm-close-${pos.symbol}`}
                              >
                                {isClosing ? "Sending..." : "Send Close Order"}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground/70">
          Software-generated view of broker data. Confirm fills and current positions in your broker portal.
          Close orders are placed as standard market orders for the full quantity.
        </p>
      </CardContent>
    </Card>
  );
}
