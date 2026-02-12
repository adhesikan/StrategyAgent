import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2,
  Zap,
  Target,
  Shield,
  ChevronDown,
  ChevronUp,
  DollarSign,
  TrendingUp,
  TrendingDown,
} from "lucide-react";

interface FuturesOpportunity {
  symbol: string;
  setup: string;
  score: number;
  entry: number;
  stop: number;
  target: number;
  side: "buy" | "sell";
  timeframe: string;
  reason: string;
}

interface FuturesTradeTicketProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opportunity: FuturesOpportunity | null;
  lastPrice?: number | null;
}

export function FuturesTradeTicket({
  open,
  onOpenChange,
  opportunity,
  lastPrice,
}: FuturesTradeTicketProps) {
  const { toast } = useToast();
  const [entryType, setEntryType] = useState<"market" | "limit">("market");
  const [limitPrice, setLimitPrice] = useState<string>("");
  const [quantity, setQuantity] = useState<number>(1);
  const [bracketEnabled, setBracketEnabled] = useState(false);
  const [targetPrice, setTargetPrice] = useState<string>("");
  const [stopPrice, setStopPrice] = useState<string>("");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (open && opportunity) {
      setEntryType("market");
      setLimitPrice(String(opportunity.entry.toFixed(2)));
      setQuantity(1);
      setBracketEnabled(false);
      setAdvancedOpen(false);
      setStopPrice(String(opportunity.stop.toFixed(2)));
      setTargetPrice(String(opportunity.target.toFixed(2)));
    }
  }, [open, opportunity?.symbol, opportunity?.setup]);

  const placeMutation = useMutation({
    mutationFn: async () => {
      if (!opportunity) throw new Error("No opportunity selected");

      const payload: Record<string, any> = {
        commandType: "placeOrder",
        symbol: opportunity.symbol,
        side: opportunity.side,
        qty: quantity,
        orderType: entryType,
      };

      if (entryType === "limit") {
        payload.limitPrice = parseFloat(limitPrice);
      }

      const res = await apiRequest("POST", "/api/futures/command", payload);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Order Placed",
        description: `${opportunity?.side.toUpperCase()} ${quantity} ${opportunity?.symbol} contract${quantity > 1 ? "s" : ""} submitted`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/futures/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/futures/positions"] });
      onOpenChange(false);
    },
    onError: (error: any) => {
      let description = "Could not place order";
      try {
        const jsonMatch = error.message?.match(/\{.*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          description = parsed.error || parsed.message || description;
        } else {
          description = error.message || description;
        }
      } catch {
        description = error.message || description;
      }
      toast({
        title: "Order Failed",
        description,
        variant: "destructive",
      });
    },
  });

  if (!opportunity) return null;

  const currentPrice = lastPrice ?? opportunity.entry;
  const isBuy = opportunity.side === "buy";
  const riskPerContract = Math.abs(opportunity.entry - opportunity.stop);
  const rewardPerContract = Math.abs(opportunity.target - opportunity.entry);
  const rrRatio = riskPerContract > 0 ? (rewardPerContract / riskPerContract).toFixed(1) : "N/A";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col" data-testid="futures-trade-ticket-sheet">
        <SheetHeader className="px-4 pt-4 pb-3 border-b">
          <SheetTitle className="flex items-center gap-2 text-base" data-testid="futures-trade-ticket-title">
            <Zap className="h-4 w-4 text-primary" />
            InstaTrade™ {opportunity.symbol}
          </SheetTitle>
          <SheetDescription className="text-xs" data-testid="futures-trade-ticket-description">
            Place a futures mock order
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="px-4 py-3 space-y-4">
            <div className="p-3 rounded-md bg-muted/50 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Trade Details</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Symbol:</span>
                  <span className="font-mono font-medium">{opportunity.symbol}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Side:</span>
                  <span className={`font-medium flex items-center gap-0.5 ${isBuy ? "text-green-500" : "text-red-500"}`}>
                    {isBuy ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {opportunity.side.toUpperCase()}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Setup:</span>
                  <span className="font-medium">{opportunity.setup}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Score:</span>
                  <Badge variant={opportunity.score >= 80 ? "default" : "secondary"} className="text-xs">
                    {opportunity.score}
                  </Badge>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Entry:</span>
                  <span className="font-mono font-medium text-chart-2">${opportunity.entry.toFixed(2)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Current:</span>
                  <span className="font-mono font-medium">${currentPrice.toFixed(2)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Stop:</span>
                  <span className="font-mono font-medium text-destructive">${opportunity.stop.toFixed(2)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Target:</span>
                  <span className="font-mono font-medium text-chart-2">${opportunity.target.toFixed(2)}</span>
                </div>
              </div>
              <div className="text-xs text-muted-foreground mt-1 p-2 rounded bg-muted/30">
                R:R = 1:{rrRatio} &middot; Risk: ${riskPerContract.toFixed(2)}/contract
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label className="text-xs">Contracts</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                data-testid="input-futures-quantity"
              />
              <p className="text-xs text-muted-foreground">
                Max 10 contracts per order (mock mode)
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Entry Type</Label>
              <div className="flex gap-2">
                <Button
                  variant={entryType === "market" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setEntryType("market")}
                  className="flex-1"
                  data-testid="button-futures-entry-market"
                >
                  Market
                </Button>
                <Button
                  variant={entryType === "limit" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setEntryType("limit")}
                  className="flex-1"
                  data-testid="button-futures-entry-limit"
                >
                  Limit
                </Button>
              </div>
            </div>

            {entryType === "limit" && (
              <div className="space-y-2">
                <Label className="text-xs">Limit Price</Label>
                <Input
                  type="number"
                  step="0.25"
                  value={limitPrice}
                  onChange={(e) => setLimitPrice(e.target.value)}
                  data-testid="input-futures-limit-price"
                />
                <div className="flex gap-1 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setLimitPrice(String(currentPrice.toFixed(2)))}
                    data-testid="button-futures-price-current"
                  >
                    Current
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setLimitPrice(String(opportunity.entry.toFixed(2)))}
                    data-testid="button-futures-price-entry"
                  >
                    Entry
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const adj = isBuy ? currentPrice - 0.25 : currentPrice + 0.25;
                      setLimitPrice(String(adj.toFixed(2)));
                    }}
                    data-testid="button-futures-price-adjust"
                  >
                    {isBuy ? "-$0.25" : "+$0.25"}
                  </Button>
                </div>
              </div>
            )}

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  <Label className="text-xs font-medium">Bracket Exit</Label>
                </div>
                <Switch
                  checked={bracketEnabled}
                  onCheckedChange={(checked) => {
                    setBracketEnabled(checked);
                    if (checked) {
                      if (!stopPrice) setStopPrice(String(opportunity.stop.toFixed(2)));
                      if (!targetPrice) setTargetPrice(String(opportunity.target.toFixed(2)));
                    }
                  }}
                  data-testid="switch-futures-bracket"
                />
              </div>

              {bracketEnabled && (
                <div className="space-y-3 p-3 rounded-md border bg-muted/20">
                  <p className="text-xs text-muted-foreground">
                    Set target and stop levels for this futures position.
                  </p>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Target className="h-3 w-3 text-chart-2" />
                      <Label className="text-xs">Target (take profit)</Label>
                    </div>
                    <Input
                      type="number"
                      step="0.25"
                      placeholder="Profit target price"
                      value={targetPrice}
                      onChange={(e) => setTargetPrice(e.target.value)}
                      data-testid="input-futures-target-price"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-3 w-3 text-destructive" />
                      <Label className="text-xs">Stop Loss</Label>
                    </div>
                    <Input
                      type="number"
                      step="0.25"
                      placeholder="Stop loss price"
                      value={stopPrice}
                      onChange={(e) => setStopPrice(e.target.value)}
                      data-testid="input-futures-stop-price"
                    />
                  </div>

                  {targetPrice && stopPrice && (
                    <div className="text-xs text-muted-foreground p-2 rounded bg-muted/30">
                      Target: ${targetPrice} &middot; Stop: ${stopPrice} &middot; R:R = 1:{
                        Math.abs(parseFloat(targetPrice) - opportunity.entry) > 0 && Math.abs(opportunity.entry - parseFloat(stopPrice)) > 0
                          ? (Math.abs(parseFloat(targetPrice) - opportunity.entry) / Math.abs(opportunity.entry - parseFloat(stopPrice))).toFixed(1)
                          : "N/A"
                      }
                    </div>
                  )}
                </div>
              )}
            </div>

            <div
              className="flex items-center gap-1 cursor-pointer text-xs text-muted-foreground transition-colors"
              onClick={() => setAdvancedOpen(!advancedOpen)}
              data-testid="toggle-futures-advanced"
            >
              {advancedOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              <span>Advanced</span>
            </div>

            {advancedOpen && (
              <div className="space-y-3 p-3 rounded-md border bg-muted/20">
                <p className="text-xs text-muted-foreground">
                  Futures orders are executed via the mock adapter. In production, orders would be routed to your connected futures broker.
                </p>
                <div className="text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Rate Limit:</span>
                    <span>10 orders/min</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Max Position:</span>
                    <span>10 contracts/symbol</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Fill Simulation:</span>
                    <span>500ms-1s delay with slippage</span>
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-md border p-3 space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground mb-2">Order Summary</p>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Action:</span>
                <span className={`font-medium ${isBuy ? "text-green-500" : "text-red-500"}`}>
                  {opportunity.side.toUpperCase()} {quantity} {opportunity.symbol}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Order Type:</span>
                <span className="font-medium capitalize">
                  {entryType}{entryType === "limit" && limitPrice ? ` @ $${limitPrice}` : ""}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Setup:</span>
                <span className="font-medium">{opportunity.setup}</span>
              </div>
              {bracketEnabled && targetPrice && stopPrice && (
                <>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Bracket:</span>
                    <Badge variant="outline" className="text-xs">OCO</Badge>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Target / Stop:</span>
                    <span className="font-mono text-xs">${targetPrice} / ${stopPrice}</span>
                  </div>
                </>
              )}
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Mode:</span>
                <Badge variant="secondary" className="text-xs">Mock</Badge>
              </div>
            </div>
          </div>
        </ScrollArea>

        <SheetFooter className="px-4 py-3 border-t gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1"
            data-testid="button-futures-ticket-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={() => placeMutation.mutate()}
            disabled={
              placeMutation.isPending ||
              (entryType === "limit" && (!limitPrice || parseFloat(limitPrice) <= 0))
            }
            className="flex-1"
            data-testid="button-futures-ticket-place"
          >
            {placeMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Zap className="h-4 w-4 mr-1" />
            )}
            Place {opportunity.side.toUpperCase()} Order
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
