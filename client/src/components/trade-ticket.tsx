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
  AlertTriangle,
} from "lucide-react";

interface OptionLeg {
  side: "buy" | "sell";
  optionType: "call" | "put";
  strike: number;
  expiration: string;
  bid: number;
  ask: number;
  mid: number;
  delta: number;
  theta: number;
  impliedVol: number;
  openInterest: number;
  volume: number;
}

interface OptionCandidate {
  rank: number;
  symbol: string;
  underlying: string;
  expiration: string;
  strike: number;
  optionType: "call" | "put";
  strategyVariant: string;
  strategy: string;
  bid: number;
  ask: number;
  mid: number;
  impliedVol: number;
  delta: number;
  theta: number;
  openInterest: number;
  volume: number;
  score: number;
  rationale: string;
  dte: number;
  premiumPct: number;
  maxProfit: number;
  maxLoss: number;
  breakeven: number;
  legs: OptionLeg[];
  pop: number;
  stockPrice: number;
}

interface BrokerAccount {
  id: string;
  name: string;
  type: string;
  buyingPower: number;
  equity: number;
  currency: string;
}

interface PreviewData {
  bid: number;
  ask: number;
  mid: number;
  last: number;
  nat: number;
  suggestedLimit: number;
  suggestedTarget: number | null;
  suggestedStop: number | null;
  isCreditStrategy: boolean;
}

interface TradeTicketProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidate: OptionCandidate | null;
  brokerAccounts: BrokerAccount[];
  selectedAccount: BrokerAccount | null;
  onAccountChange: (account: BrokerAccount | null) => void;
  brokerProvider?: string | null;
}

function buildOccSymbol(candidate: OptionCandidate): string {
  const underlying = candidate.underlying.toUpperCase();
  const [expY, expM, expD] = candidate.expiration.split("-");
  const yy = expY.slice(-2);
  const mm = expM.padStart(2, "0");
  const dd = expD.padStart(2, "0");
  const cp = candidate.optionType === "call" ? "C" : "P";
  const strikeInt = Math.round(candidate.strike * 1000);
  const strikePart = String(strikeInt).padStart(8, "0");
  return `${underlying}${yy}${mm}${dd}${cp}${strikePart}`;
}

export function TradeTicket({
  open,
  onOpenChange,
  candidate,
  brokerAccounts,
  selectedAccount,
  onAccountChange,
  brokerProvider,
}: TradeTicketProps) {
  const { toast } = useToast();
  const [entryType, setEntryType] = useState<"market" | "limit">("limit");
  const [limitPrice, setLimitPrice] = useState<string>("");
  const [quantity, setQuantity] = useState<number>(1);
  const [duration, setDuration] = useState<"day" | "gtc">("day");
  const [bracketEnabled, setBracketEnabled] = useState(false);
  const [targetPrice, setTargetPrice] = useState<string>("");
  const [stopPrice, setStopPrice] = useState<string>("");
  const [stopType, setStopType] = useState<"stop" | "stop_limit">("stop");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);

  const occSymbol = candidate ? buildOccSymbol(candidate) : "";
  const primaryLeg = candidate?.legs[0];
  const isSell = primaryLeg?.side === "sell";
  const optionSide = isSell ? "sell_to_open" : "buy_to_open";

  const previewMutation = useMutation({
    mutationFn: async (c: OptionCandidate) => {
      const res = await apiRequest("POST", "/api/trade/preview", {
        optionSymbol: buildOccSymbol(c),
        underlying: c.underlying,
        strike: c.strike,
        expiration: c.expiration,
        optionType: c.optionType,
        strategyVariant: c.strategyVariant,
        mid: c.mid,
      });
      return res.json() as Promise<PreviewData>;
    },
    onSuccess: (data) => {
      setPreview(data);
      setLimitPrice(String(data.suggestedLimit));
      if (data.suggestedTarget) setTargetPrice(String(data.suggestedTarget));
      if (data.suggestedStop) setStopPrice(String(data.suggestedStop));
    },
  });

  useEffect(() => {
    if (open && candidate) {
      setEntryType("limit");
      setQuantity(1);
      setDuration("day");
      setBracketEnabled(false);
      setAdvancedOpen(false);
      setStopType("stop");
      setLimitPrice(String(candidate.mid));
      setTargetPrice("");
      setStopPrice("");
      setPreview(null);
      previewMutation.mutate(candidate);
    }
  }, [open, candidate?.symbol]);

  const placeMutation = useMutation({
    mutationFn: async () => {
      if (!candidate || !selectedAccount) throw new Error("Missing selection");

      const payload: Record<string, any> = {
        accountId: selectedAccount.id,
        symbol: candidate.underlying,
        optionSymbol: occSymbol,
        optionSide,
        quantity,
        orderType: entryType,
        duration,
        strike: candidate.strike,
        expiration: candidate.expiration,
        optionType: candidate.optionType,
        strategyKey: candidate.strategy,
        strategyVariant: candidate.strategyVariant,
      };

      if (entryType === "limit") {
        payload.limitPrice = parseFloat(limitPrice);
      }

      if (bracketEnabled && (targetPrice || stopPrice)) {
        payload.exitPlan = {
          targetPrice: targetPrice ? parseFloat(targetPrice) : null,
          stopPrice: stopPrice ? parseFloat(stopPrice) : null,
          stopType,
        };
      }

      const res = await apiRequest("POST", "/api/trade/place", payload);
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Order Placed",
        description: `${candidate?.underlying} options order submitted${data.managedExitId ? " with managed exit" : ""}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/broker/orders"] });
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

  const setQuickPrice = (type: "mid" | "mid+0.02" | "mid-0.02" | "nat") => {
    if (!preview) return;
    switch (type) {
      case "mid": setLimitPrice(String(preview.mid)); break;
      case "mid+0.02": setLimitPrice(String(parseFloat((preview.mid + 0.02).toFixed(2)))); break;
      case "mid-0.02": setLimitPrice(String(parseFloat((preview.mid - 0.02).toFixed(2)))); break;
      case "nat": setLimitPrice(String(preview.nat)); break;
    }
  };

  if (!candidate) return null;

  const totalCost = entryType === "limit" && limitPrice
    ? parseFloat(limitPrice) * quantity * 100
    : candidate.mid * quantity * 100;

  const isCallish = candidate.optionType === "call" ||
    candidate.strategyVariant.toLowerCase().includes("call") ||
    candidate.strategyVariant.toLowerCase().includes("bull");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col" data-testid="trade-ticket-sheet">
        <SheetHeader className="px-4 pt-4 pb-3 border-b">
          <SheetTitle className="flex items-center gap-2 text-base" data-testid="trade-ticket-title">
            <Zap className="h-4 w-4 text-primary" />
            Trade Ticket
          </SheetTitle>
          <SheetDescription className="text-xs" data-testid="trade-ticket-description">
            {candidate.strategyVariant} on {candidate.underlying} — ${candidate.strike} {candidate.optionType} exp {candidate.expiration}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="px-4 py-3 space-y-4">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Premium:</span>
                <span className="font-mono font-medium">${candidate.mid.toFixed(2)}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Max Loss:</span>
                <span className="font-mono font-medium text-destructive">${candidate.maxLoss.toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Max Profit:</span>
                <span className="font-mono font-medium text-chart-2">
                  {candidate.maxProfit === -1 ? "Unlimited" : `$${candidate.maxProfit.toLocaleString()}`}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">PoP:</span>
                <span className="font-mono font-medium">{candidate.pop}%</span>
              </div>
            </div>

            {candidate.legs.length > 1 && (
              <div className="space-y-2 p-2 rounded-md bg-muted/50" data-testid="option-legs-list">
                <p className="text-xs font-medium text-muted-foreground">Legs (live broker chain)</p>
                {candidate.legs.map((leg, i) => (
                  <div key={i} className="space-y-1 rounded border bg-background/50 px-2 py-1.5" data-testid={`option-leg-row-${i}`}>
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs capitalize">{leg.side}</Badge>
                        <span className="font-mono">${leg.strike} {leg.optionType}</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground">{leg.expiration}</span>
                    </div>
                    <div className="grid grid-cols-5 gap-1 text-[10px] font-mono text-muted-foreground">
                      <div>
                        <div className="text-[9px] uppercase opacity-70">Bid</div>
                        <div className="text-foreground">${leg.bid.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-[9px] uppercase opacity-70">Ask</div>
                        <div className="text-foreground">${leg.ask.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-[9px] uppercase opacity-70">Δ</div>
                        <div className="text-foreground">{leg.delta.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-[9px] uppercase opacity-70">IV</div>
                        <div className="text-foreground">{leg.impliedVol.toFixed(0)}%</div>
                      </div>
                      <div>
                        <div className="text-[9px] uppercase opacity-70">OI</div>
                        <div className="text-foreground">{leg.openInterest.toLocaleString()}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Live quote + greeks for the (single-leg or primary) contract */}
            <div className="space-y-1.5 p-2 rounded-md bg-muted/30" data-testid="option-quote-grid">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Live broker chain</p>
              <div className="grid grid-cols-4 gap-1.5 text-xs">
                <div className="text-center">
                  <span className="text-muted-foreground block text-[10px] uppercase">Bid</span>
                  <span className="font-mono font-medium">${(preview?.bid ?? candidate.bid).toFixed(2)}</span>
                </div>
                <div className="text-center">
                  <span className="text-muted-foreground block text-[10px] uppercase">Ask</span>
                  <span className="font-mono font-medium">${(preview?.ask ?? candidate.ask).toFixed(2)}</span>
                </div>
                <div className="text-center">
                  <span className="text-muted-foreground block text-[10px] uppercase">Mid</span>
                  <span className="font-mono font-medium">${(preview?.mid ?? candidate.mid).toFixed(2)}</span>
                </div>
                <div className="text-center">
                  <span className="text-muted-foreground block text-[10px] uppercase">Last</span>
                  <span className="font-mono font-medium">${(preview?.last ?? candidate.mid).toFixed(2)}</span>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-1.5 text-xs pt-1 border-t border-border/40">
                <div className="text-center">
                  <span className="text-muted-foreground block text-[10px] uppercase">Δ</span>
                  <span className="font-mono font-medium">{candidate.delta.toFixed(2)}</span>
                </div>
                <div className="text-center">
                  <span className="text-muted-foreground block text-[10px] uppercase">θ</span>
                  <span className="font-mono font-medium">{candidate.theta.toFixed(3)}</span>
                </div>
                <div className="text-center">
                  <span className="text-muted-foreground block text-[10px] uppercase">IV</span>
                  <span className="font-mono font-medium">{candidate.impliedVol.toFixed(0)}%</span>
                </div>
                <div className="text-center">
                  <span className="text-muted-foreground block text-[10px] uppercase">OI / Vol</span>
                  <span className="font-mono font-medium">{candidate.openInterest.toLocaleString()} / {candidate.volume.toLocaleString()}</span>
                </div>
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
                <SelectTrigger data-testid="select-ticket-account">
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
              <Label className="text-xs">Contracts</Label>
              <Input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                data-testid="input-ticket-quantity"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Entry Type</Label>
              <div className="flex gap-2">
                <Button
                  variant={entryType === "limit" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setEntryType("limit")}
                  className="flex-1"
                  data-testid="button-entry-limit"
                >
                  Limit
                </Button>
                <Button
                  variant={entryType === "market" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setEntryType("market")}
                  className="flex-1"
                  data-testid="button-entry-market"
                >
                  Market
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
                  data-testid="input-limit-price"
                />
                {preview && (
                  <div className="flex gap-1 flex-wrap">
                    <Button variant="outline" size="sm" onClick={() => setQuickPrice("mid-0.02")} data-testid="button-price-midminus">
                      Mid-0.02
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setQuickPrice("mid")} data-testid="button-price-mid">
                      Mid
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setQuickPrice("mid+0.02")} data-testid="button-price-midplus">
                      Mid+0.02
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setQuickPrice("nat")} data-testid="button-price-nat">
                      NAT
                    </Button>
                  </div>
                )}
              </div>
            )}

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  <Label className="text-xs font-medium">Exit Plan (Bracket)</Label>
                </div>
                <Switch
                  checked={bracketEnabled}
                  onCheckedChange={(checked) => {
                    setBracketEnabled(checked);
                    if (checked && preview) {
                      if (preview.suggestedTarget && !targetPrice) setTargetPrice(String(preview.suggestedTarget));
                      if (preview.suggestedStop && !stopPrice) setStopPrice(String(preview.suggestedStop));
                    }
                  }}
                  data-testid="switch-bracket"
                />
              </div>

              {bracketEnabled && (
                <div className="space-y-3 p-3 rounded-md border bg-muted/20">
                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    <span>Managed Exit (TradeGuard) — server monitors position and closes at target or stop during market hours.</span>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Target className="h-3 w-3 text-chart-2" />
                      <Label className="text-xs">Target (take profit)</Label>
                    </div>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="e.g. 2.50"
                      value={targetPrice}
                      onChange={(e) => setTargetPrice(e.target.value)}
                      data-testid="input-target-price"
                    />
                    {targetPrice && limitPrice && (
                      <p className="text-xs text-muted-foreground">
                        Close when option value reaches ${targetPrice} (
                        {preview?.isCreditStrategy
                          ? `buy back at ${((1 - parseFloat(targetPrice) / parseFloat(limitPrice)) * 100).toFixed(0)}% profit`
                          : `${((parseFloat(targetPrice) / parseFloat(limitPrice) - 1) * 100).toFixed(0)}% gain`
                        })
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-3 w-3 text-destructive" />
                      <Label className="text-xs">Stop (cut loss)</Label>
                    </div>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="e.g. 0.50"
                      value={stopPrice}
                      onChange={(e) => setStopPrice(e.target.value)}
                      data-testid="input-stop-price"
                    />
                    {stopPrice && limitPrice && (
                      <p className="text-xs text-muted-foreground">
                        Close when option value reaches ${stopPrice} (
                        {preview?.isCreditStrategy
                          ? `loss of $${((parseFloat(stopPrice) - parseFloat(limitPrice)) * quantity * 100).toFixed(0)}`
                          : `${((1 - parseFloat(stopPrice) / parseFloat(limitPrice)) * 100).toFixed(0)}% loss`
                        })
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div
              className="flex items-center gap-1 cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setAdvancedOpen(!advancedOpen)}
              data-testid="toggle-advanced"
            >
              {advancedOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              <span>Advanced</span>
            </div>

            {advancedOpen && (
              <div className="space-y-3 p-3 rounded-md border bg-muted/20">
                <div className="space-y-2">
                  <Label className="text-xs">Time in Force</Label>
                  <Select value={duration} onValueChange={(v) => setDuration(v as "day" | "gtc")}>
                    <SelectTrigger data-testid="select-tif">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="day">DAY</SelectItem>
                      <SelectItem value="gtc">GTC (Good Till Cancel)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {bracketEnabled && (
                  <div className="space-y-2">
                    <Label className="text-xs">Stop Type</Label>
                    <Select value={stopType} onValueChange={(v) => setStopType(v as "stop" | "stop_limit")}>
                      <SelectTrigger data-testid="select-stop-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="stop">Stop (Market)</SelectItem>
                        <SelectItem value="stop_limit">Stop-Limit</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}

            <div className="rounded-md border p-3 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Action:</span>
                <span className="font-medium">{optionSide.replace(/_/g, " ")} {quantity} contract{quantity > 1 ? "s" : ""}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Symbol:</span>
                <span className="font-mono text-xs">{occSymbol}</span>
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
              {bracketEnabled && (targetPrice || stopPrice) && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Exit Plan:</span>
                  <span className="font-medium">
                    {targetPrice ? `T: $${targetPrice}` : ""}{targetPrice && stopPrice ? " / " : ""}{stopPrice ? `S: $${stopPrice}` : ""}
                  </span>
                </div>
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
            data-testid="button-ticket-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={() => placeMutation.mutate()}
            disabled={
              placeMutation.isPending ||
              !selectedAccount ||
              (entryType === "limit" && (!limitPrice || parseFloat(limitPrice) <= 0))
            }
            className="flex-1"
            data-testid="button-ticket-place"
          >
            {placeMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Zap className="h-4 w-4 mr-1" />
            )}
            Place Order
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
