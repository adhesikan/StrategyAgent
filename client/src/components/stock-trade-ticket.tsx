import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
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
} from "lucide-react";

interface ScanResultData {
  ticker: string;
  price: number;
  resistance: number | null;
  stopLoss: number | null;
  stage: string;
  patternScore: number;
  rvol?: number;
  prefillTarget?: number | null;
  prefillQuantity?: number;
}

interface BrokerAccount {
  id: string;
  name: string;
  type: string;
  buyingPower: number;
  equity: number;
  currency: string;
}

interface StockTradeTicketProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scanResult: ScanResultData | null;
  brokerAccounts: BrokerAccount[];
  selectedAccount: BrokerAccount | null;
  onAccountChange: (account: BrokerAccount | null) => void;
}

export function StockTradeTicket({
  open,
  onOpenChange,
  scanResult,
  brokerAccounts,
  selectedAccount,
  onAccountChange,
}: StockTradeTicketProps) {
  const { toast } = useToast();
  const [entryType, setEntryType] = useState<"market" | "limit">("limit");
  const [limitPrice, setLimitPrice] = useState<string>("");
  const [quantity, setQuantity] = useState<number>(1);
  const [duration, setDuration] = useState<"day" | "gtc">("day");
  const [bracketEnabled, setBracketEnabled] = useState(false);
  const [targetPrice, setTargetPrice] = useState<string>("");
  const [stopPrice, setStopPrice] = useState<string>("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [livePrice, setLivePrice] = useState<number>(0);

  const needsQuote = open && scanResult && !scanResult.price;
  const { data: quoteData } = useQuery<{ last: number; symbol: string }>({
    queryKey: ["/api/broker/quote", scanResult?.ticker],
    enabled: !!needsQuote && !!scanResult?.ticker,
  });

  useEffect(() => {
    if (quoteData?.last && quoteData.last > 0) {
      setLivePrice(quoteData.last);
    }
  }, [quoteData]);

  const displayPrice = scanResult?.price || livePrice;

  useEffect(() => {
    if (open && scanResult) {
      const entry = scanResult.price || scanResult.resistance || 0;
      setEntryType(entry > 0 ? "limit" : "market");
      setLimitPrice(entry > 0 ? String(entry.toFixed(2)) : "");
      setQuantity(1);
      setDuration("day");
      setBracketEnabled(false);
      setAdvancedOpen(false);
      setLivePrice(0);

      if (scanResult.prefillTarget && scanResult.stopLoss) {
        setBracketEnabled(true);
        setStopPrice(String(scanResult.stopLoss.toFixed(2)));
        setTargetPrice(String(scanResult.prefillTarget.toFixed(2)));
      } else if (scanResult.resistance && scanResult.stopLoss) {
        const risk = scanResult.resistance - scanResult.stopLoss;
        setStopPrice(String(scanResult.stopLoss.toFixed(2)));
        setTargetPrice(String((scanResult.resistance + risk).toFixed(2)));
      } else {
        setTargetPrice("");
        setStopPrice("");
      }

      if (scanResult.prefillQuantity && scanResult.prefillQuantity > 0) {
        setQuantity(scanResult.prefillQuantity);
      }

      if (!selectedAccount && brokerAccounts.length > 0) {
        onAccountChange(brokerAccounts[0]);
      }
    }
  }, [open, scanResult?.ticker]);

  useEffect(() => {
    if (livePrice > 0 && entryType === "market" && !limitPrice) {
      setEntryType("limit");
      setLimitPrice(String(livePrice.toFixed(2)));
    }
  }, [livePrice]);

  const placeMutation = useMutation({
    mutationFn: async () => {
      if (!scanResult || !selectedAccount) throw new Error("Missing selection");

      const payload: Record<string, any> = {
        accountId: selectedAccount.id,
        symbol: scanResult.ticker,
        side: "buy",
        quantity,
        orderType: entryType,
        duration,
      };

      if (entryType === "limit") {
        const parsedPrice = parseFloat(limitPrice);
        if (!parsedPrice || parsedPrice <= 0) throw new Error("Enter a valid limit price");
        payload.price = parsedPrice;
      }

      if (bracketEnabled && targetPrice && stopPrice) {
        payload.bracketTarget = parseFloat(targetPrice);
        payload.bracketStop = parseFloat(stopPrice);
      }

      const res = await apiRequest("POST", "/api/trade/place-equity", payload);
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Order Placed",
        description: `Buy order for ${quantity} shares of ${scanResult?.ticker} submitted${data.hasBracket ? " with bracket exit" : ""}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/broker/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      onOpenChange(false);
    },
    onError: (error: any) => {
      let description = "Could not place order";
      try {
        const jsonMatch = error.message?.match(/\{.*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          description = parsed.error || description;
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

  if (!scanResult) return null;

  const entryPrice = entryType === "limit" && limitPrice ? parseFloat(limitPrice) : displayPrice;
  const totalCost = entryPrice * quantity;
  const riskPerShare = scanResult.resistance && scanResult.stopLoss
    ? (scanResult.resistance - scanResult.stopLoss)
    : null;

  const stageColor = scanResult.stage === "BREAKOUT"
    ? "text-chart-2"
    : scanResult.stage === "READY"
      ? "text-yellow-500"
      : "text-muted-foreground";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col" data-testid="stock-trade-ticket-sheet">
        <SheetHeader className="px-4 pt-4 pb-3 border-b">
          <SheetTitle className="flex items-center gap-2 text-base" data-testid="stock-trade-ticket-title">
            <Zap className="h-4 w-4 text-primary" />
            InstaTrade™ {scanResult.ticker}
          </SheetTitle>
          <SheetDescription className="text-xs" data-testid="stock-trade-ticket-description">
            Place a stock order with your broker
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="px-4 py-3 space-y-4">
            <div className="p-3 rounded-md bg-muted/50 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Trade Details</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Symbol:</span>
                  <span className="font-mono font-medium">{scanResult.ticker}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Stage:</span>
                  <span className={`font-medium ${stageColor}`}>{scanResult.stage}</span>
                </div>
                {scanResult.resistance && (
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground">Resistance:</span>
                    <span className="font-mono font-medium text-chart-2">${scanResult.resistance.toFixed(2)}</span>
                  </div>
                )}
                {displayPrice > 0 && (
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground">Current:</span>
                    <span className="font-mono font-medium">${displayPrice.toFixed(2)}</span>
                  </div>
                )}
                {scanResult.stopLoss && (
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground">Stop:</span>
                    <span className="font-mono font-medium text-destructive">${scanResult.stopLoss.toFixed(2)}</span>
                  </div>
                )}
                {riskPerShare && (
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground">Risk/Share:</span>
                    <span className="font-mono font-medium">${riskPerShare.toFixed(2)}</span>
                  </div>
                )}
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label className="text-xs">Account</Label>
              <Select
                value={selectedAccount?.id || ""}
                onValueChange={(v) => {
                  const acc = brokerAccounts.find((a) => a.id === v) || null;
                  onAccountChange(acc);
                }}
              >
                <SelectTrigger data-testid="select-stock-ticket-account">
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {brokerAccounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.name} (${acc.buyingPower.toLocaleString()} BP)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Shares</Label>
              <Input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                data-testid="input-stock-quantity"
              />
              {selectedAccount && (
                <p className="text-xs text-muted-foreground">
                  Buying Power: ${selectedAccount.buyingPower.toLocaleString()}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Entry Type</Label>
              <div className="flex gap-2">
                <Button
                  variant={entryType === "market" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setEntryType("market")}
                  className="flex-1"
                  data-testid="button-stock-entry-market"
                >
                  Market
                </Button>
                <Button
                  variant={entryType === "limit" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setEntryType("limit")}
                  className="flex-1"
                  data-testid="button-stock-entry-limit"
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
                  step="0.01"
                  value={limitPrice}
                  onChange={(e) => setLimitPrice(e.target.value)}
                  data-testid="input-stock-limit-price"
                />
                <div className="flex gap-1 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => displayPrice > 0 && setLimitPrice(String(displayPrice.toFixed(2)))}
                    disabled={!displayPrice}
                    data-testid="button-price-current"
                  >
                    Current
                  </Button>
                  {scanResult.resistance && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setLimitPrice(String(scanResult.resistance!.toFixed(2)))}
                      data-testid="button-price-resistance"
                    >
                      Resistance
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const adjusted = (displayPrice - 0.05);
                      if (adjusted > 0) setLimitPrice(String(adjusted.toFixed(2)));
                    }}
                    disabled={!displayPrice}
                    data-testid="button-price-minus5c"
                  >
                    -$0.05
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const adjusted = (displayPrice + 0.05);
                      setLimitPrice(String(adjusted.toFixed(2)));
                    }}
                    disabled={!displayPrice}
                    data-testid="button-price-plus5c"
                  >
                    +$0.05
                  </Button>
                </div>
              </div>
            )}

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  <Label className="text-xs font-medium">OCO Bracket Exit</Label>
                </div>
                <Switch
                  checked={bracketEnabled}
                  onCheckedChange={(checked) => {
                    setBracketEnabled(checked);
                    if (checked && scanResult.resistance && scanResult.stopLoss) {
                      const risk = scanResult.resistance - scanResult.stopLoss;
                      if (!stopPrice) setStopPrice(String(scanResult.stopLoss.toFixed(2)));
                      if (!targetPrice) setTargetPrice(String((scanResult.resistance + risk).toFixed(2)));
                    }
                  }}
                  data-testid="switch-stock-bracket"
                />
              </div>

              {bracketEnabled && (
                <div className="space-y-3 p-3 rounded-md border bg-muted/20">
                  <p className="text-xs text-muted-foreground">
                    Sends an OTOCO bracket order: entry triggers a profit target (limit sell) and stop loss (stop sell) as an OCO pair.
                  </p>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Target className="h-3 w-3 text-chart-2" />
                      <Label className="text-xs">Target (take profit)</Label>
                    </div>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="Profit target price"
                      value={targetPrice}
                      onChange={(e) => setTargetPrice(e.target.value)}
                      data-testid="input-stock-target-price"
                    />
                    {targetPrice && limitPrice && (
                      <p className="text-xs text-muted-foreground">
                        Sell at ${targetPrice} ({((parseFloat(targetPrice) / parseFloat(limitPrice) - 1) * 100).toFixed(1)}% gain, +${((parseFloat(targetPrice) - parseFloat(limitPrice)) * quantity).toFixed(2)} P&L)
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-3 w-3 text-destructive" />
                      <Label className="text-xs">Stop Loss</Label>
                    </div>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="Stop loss price"
                      value={stopPrice}
                      onChange={(e) => setStopPrice(e.target.value)}
                      data-testid="input-stock-stop-price"
                    />
                    {stopPrice && limitPrice && (
                      <p className="text-xs text-muted-foreground">
                        Stop at ${stopPrice} ({((1 - parseFloat(stopPrice) / parseFloat(limitPrice)) * 100).toFixed(1)}% loss, -${((parseFloat(limitPrice) - parseFloat(stopPrice)) * quantity).toFixed(2)} risk)
                      </p>
                    )}
                  </div>

                  {targetPrice && stopPrice && limitPrice && (
                    <div className="text-xs text-muted-foreground p-2 rounded bg-muted/30">
                      R:R = 1:{((parseFloat(targetPrice) - parseFloat(limitPrice)) / (parseFloat(limitPrice) - parseFloat(stopPrice))).toFixed(1)}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div
              className="flex items-center gap-1 cursor-pointer text-xs text-muted-foreground transition-colors"
              onClick={() => setAdvancedOpen(!advancedOpen)}
              data-testid="toggle-stock-advanced"
            >
              {advancedOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              <span>Advanced</span>
            </div>

            {advancedOpen && (
              <div className="space-y-3 p-3 rounded-md border bg-muted/20">
                <div className="space-y-2">
                  <Label className="text-xs">Time in Force</Label>
                  <Select value={duration} onValueChange={(v) => setDuration(v as "day" | "gtc")}>
                    <SelectTrigger data-testid="select-stock-tif">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="day">DAY</SelectItem>
                      <SelectItem value="gtc">GTC (Good Till Cancel)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            <div className="rounded-md border p-3 space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground mb-2">Order Summary</p>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Action:</span>
                <span className="font-medium">Buy {quantity} share{quantity > 1 ? "s" : ""} of {scanResult.ticker}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Order Type:</span>
                <span className="font-medium capitalize">{entryType}{entryType === "limit" && limitPrice ? ` @ $${limitPrice}` : ""}</span>
              </div>
              {entryType === "limit" && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Est. Cost:</span>
                  <span className="font-mono font-medium">${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              )}
              {bracketEnabled && targetPrice && stopPrice && (
                <>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Bracket:</span>
                    <Badge variant="outline" className="text-xs">OTOCO</Badge>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Target / Stop:</span>
                    <span className="font-mono text-xs">${targetPrice} / ${stopPrice}</span>
                  </div>
                </>
              )}
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">TIF:</span>
                <span className="font-medium uppercase">{duration}</span>
              </div>
            </div>
          </div>
        </ScrollArea>

        <SheetFooter className="px-4 py-3 border-t gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1"
            data-testid="button-stock-ticket-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={() => placeMutation.mutate()}
            disabled={
              placeMutation.isPending ||
              !selectedAccount ||
              (entryType === "limit" && (!limitPrice || parseFloat(limitPrice) <= 0)) ||
              (bracketEnabled && (!targetPrice || !stopPrice || parseFloat(targetPrice) <= 0 || parseFloat(stopPrice) <= 0))
            }
            className="flex-1"
            data-testid="button-stock-ticket-place"
          >
            {placeMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Zap className="h-4 w-4 mr-1" />
            )}
            {bracketEnabled ? "Place Bracket Order" : "Place Order"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
