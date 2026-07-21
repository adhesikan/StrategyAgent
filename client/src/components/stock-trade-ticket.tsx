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
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2,
  Zap,
  Target,
  Shield,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Moon,
  TrendingDown,
} from "lucide-react";
import { getMarketSessionInfo } from "@shared/market-session";
import { HelpLink } from "@/components/help-link";
import { LiveTradingSetupDialog, useLiveSetupStatus } from "@/components/live-trading-setup";

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
  /** When provided, the symbol becomes editable inside the ticket. */
  onSymbolChange?: (newSymbol: string) => void;
}

const PP_ACK_TEXT =
  "I understand Position Protection submits exit orders on my behalf when my rules trigger. Fills aren't guaranteed and this isn't investment advice.";

export function StockTradeTicket({
  open,
  onOpenChange,
  scanResult,
  brokerAccounts,
  selectedAccount,
  onAccountChange,
  onSymbolChange,
}: StockTradeTicketProps) {
  const { toast } = useToast();
  const [symbolDraft, setSymbolDraft] = useState<string>("");

  useEffect(() => {
    if (scanResult) setSymbolDraft(scanResult.ticker);
  }, [scanResult?.ticker]);

  const commitSymbol = () => {
    const sym = symbolDraft.trim().toUpperCase();
    if (sym && onSymbolChange && scanResult && sym !== scanResult.ticker) {
      onSymbolChange(sym);
    }
  };
  const [entryType, setEntryType] = useState<"market" | "limit">("limit");
  const [limitPrice, setLimitPrice] = useState<string>("");
  const [quantity, setQuantity] = useState<number>(1);
  const [duration, setDuration] = useState<"day" | "gtc">("day");
  const [bracketEnabled, setBracketEnabled] = useState(false);
  const [targetPrice, setTargetPrice] = useState<string>("");
  const [stopPrice, setStopPrice] = useState<string>("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [livePrice, setLivePrice] = useState<number>(0);
  const [extendedHours, setExtendedHours] = useState(false);

  // ── Position Protection (app-managed exit rules) ──
  const [protectionEnabled, setProtectionEnabled] = useState(false);
  const [ppStopEnabled, setPpStopEnabled] = useState(true);
  const [ppStopMode, setPpStopMode] = useState<"percent" | "dollar" | "price">("percent");
  const [ppStopValue, setPpStopValue] = useState<string>("5");
  const [ppTargetEnabled, setPpTargetEnabled] = useState(false);
  const [ppTargetMode, setPpTargetMode] = useState<"percent" | "dollar" | "price">("percent");
  const [ppTargetValue, setPpTargetValue] = useState<string>("20");
  const [ppTrailEnabled, setPpTrailEnabled] = useState(false);
  const [ppTrailMode, setPpTrailMode] = useState<"percent" | "dollar">("percent");
  const [ppTrailValue, setPpTrailValue] = useState<string>("10");
  const [ppExitOrderType, setPpExitOrderType] = useState<"market" | "stop" | "stop_limit">("market");
  const [ppAdvancedOpen, setPpAdvancedOpen] = useState(false);
  const [ppPreset, setPpPreset] = useState<"conservative" | "standard" | "wider" | "custom">("standard");
  const [ppAck, setPpAck] = useState(false);

  // Beginner presets: one tap sets a stop-only plan at a sensible percentage.
  function applyPpPreset(preset: "conservative" | "standard" | "wider" | "custom") {
    setPpPreset(preset);
    if (preset === "custom") {
      setPpAdvancedOpen(true);
      return;
    }
    const stopPct = preset === "conservative" ? "3" : preset === "standard" ? "5" : "8";
    setPpStopEnabled(true);
    setPpStopMode("percent");
    setPpStopValue(stopPct);
    setPpTargetEnabled(false);
    setPpTrailEnabled(false);
    setPpExitOrderType("market");
    setPpAdvancedOpen(false);
  }

  const { data: ppConfig } = useQuery<{
    enabled: boolean;
    liveEnabled: boolean;
    sandboxEnabled?: boolean;
    optionsEnabled: boolean;
    spreadsEnabled: boolean;
  }>({
    queryKey: ["/api/position-protection/config"],
  });

  const accountIsPaper = selectedAccount?.id?.startsWith("sandbox:") ?? false;
  const accountMode: "paper" | "live" = accountIsPaper ? "paper" : "live";
  const { liveSetupCompleted } = useLiveSetupStatus();
  const [showLiveSetup, setShowLiveSetup] = useState(false);
  const needsLiveSetup = !accountIsPaper && !!selectedAccount && !liveSetupCompleted;
  const protectionLiveBlocked = !accountIsPaper && ppConfig ? !ppConfig.liveEnabled : false;
  const protectionSandboxBlocked = accountIsPaper && ppConfig ? !ppConfig.sandboxEnabled : false;
  const protectionBlocked = protectionLiveBlocked || protectionSandboxBlocked;

  const sessionInfo = getMarketSessionInfo();
  const inExtendedSession = sessionInfo.session === "pre" || sessionInfo.session === "after";

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
      setExtendedHours(false);
      setProtectionEnabled(false);
      setPpAck(false);

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

      if (extendedHours && entryType !== "limit") {
        throw new Error("Pre-market / after-hours orders must be limit orders");
      }

      const payload: Record<string, any> = {
        accountId: selectedAccount.id,
        symbol: scanResult.ticker,
        side: "buy",
        quantity,
        orderType: entryType,
        duration,
        extendedHours,
      };

      if (entryType === "limit") {
        const parsedPrice = parseFloat(limitPrice);
        if (!parsedPrice || parsedPrice <= 0) throw new Error("Enter a valid limit price");
        payload.price = parsedPrice;
      }

      if (bracketEnabled && targetPrice && stopPrice && !extendedHours) {
        payload.bracketTarget = parseFloat(targetPrice);
        payload.bracketStop = parseFloat(stopPrice);
      }

      const res = await apiRequest("POST", "/api/trade/place-equity", payload);
      return res.json();
    },
    onSuccess: async (data) => {
      toast({
        title: "Order Placed",
        description: `Buy order for ${quantity} shares of ${scanResult?.ticker} submitted${data.hasBracket ? " with bracket exit" : ""}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/broker/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });

      if (protectionEnabled && ppAck && selectedAccount && scanResult) {
        try {
          const planPayload: Record<string, any> = {
            brokerProvider: data.provider || "tradier",
            brokerAccountId: selectedAccount.id,
            accountMode,
            symbol: scanResult.ticker,
            instrumentType: "stock",
            positionSide: "long",
            quantity,
            entryPrice,
            exitOrderType: ppExitOrderType,
            acknowledged: true,
            acknowledgedText: PP_ACK_TEXT,
            stopEnabled: ppStopEnabled,
            stopMode: ppStopMode,
            stopValue: ppStopEnabled ? parseFloat(ppStopValue) : undefined,
            targetEnabled: ppTargetEnabled,
            targetMode: ppTargetMode,
            targetValue: ppTargetEnabled ? parseFloat(ppTargetValue) : undefined,
            trailEnabled: ppTrailEnabled,
            trailMode: ppTrailMode,
            trailValue: ppTrailEnabled ? parseFloat(ppTrailValue) : undefined,
          };
          await apiRequest("POST", "/api/position-protection/plans", planPayload);
          queryClient.invalidateQueries({ queryKey: ["/api/position-protection/plans"] });
          toast({
            title: "Position Protection On",
            description: `We'll watch ${scanResult.ticker} and submit your exit when a rule triggers.`,
          });
        } catch (err: any) {
          toast({
            title: "Order placed, but protection didn't save",
            description: err?.message || "You can add Position Protection from your positions panel.",
            variant: "destructive",
          });
        }
      }

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
              {onSymbolChange ? (
                <div className="space-y-1">
                  <Label className="text-xs">Symbol</Label>
                  <Input
                    value={symbolDraft}
                    onChange={(e) => setSymbolDraft(e.target.value.toUpperCase())}
                    onBlur={commitSymbol}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); } }}
                    className="font-mono uppercase h-8"
                    data-testid="input-stock-ticket-symbol"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Press Enter or click away to switch symbols.
                  </p>
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-2 text-xs">
                {!onSymbolChange && (
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground">Symbol:</span>
                    <span className="font-mono font-medium">{scanResult.ticker}</span>
                  </div>
                )}
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

            {ppConfig?.enabled && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    <Label className="text-xs font-medium">Position Protection</Label>
                    <HelpLink section="position-protection" />
                  </div>
                  <Switch
                    checked={protectionEnabled}
                    disabled={protectionBlocked}
                    onCheckedChange={setProtectionEnabled}
                    data-testid="switch-position-protection"
                  />
                </div>

                <p className="text-[11px] text-muted-foreground leading-snug">
                  After your order fills, we monitor this position during market hours and
                  submit your exit order when one of your rules triggers — including trailing
                  stops your broker can't place natively. This is software-generated order
                  routing, not investment advice, and fills aren't guaranteed.
                </p>

                {protectionLiveBlocked && (
                  <p className="text-[11px] text-amber-500 leading-snug" data-testid="text-protection-live-blocked">
                    Position Protection is temporarily unavailable for live accounts.
                  </p>
                )}
                {protectionSandboxBlocked && (
                  <p className="text-[11px] text-muted-foreground leading-snug" data-testid="text-protection-live-only">
                    Position Protection is only available for verified live brokerage positions.
                  </p>
                )}

                {protectionEnabled && (
                  <div className="space-y-3 p-3 rounded-md border bg-muted/20">
                    {/* Beginner presets */}
                    <div className="space-y-1.5">
                      <Label className="text-[11px] text-muted-foreground">Quick preset</Label>
                      <div className="grid grid-cols-4 gap-1.5">
                        {([
                          { key: "conservative", label: "Conservative", sub: "3%" },
                          { key: "standard", label: "Standard", sub: "5%" },
                          { key: "wider", label: "Wider", sub: "8%" },
                          { key: "custom", label: "Custom", sub: "set it" },
                        ] as const).map((p) => (
                          <button
                            key={p.key}
                            type="button"
                            onClick={() => applyPpPreset(p.key)}
                            data-testid={`button-pp-preset-${p.key}`}
                            className={`flex flex-col items-center rounded-md border px-1 py-1.5 text-[11px] transition-colors ${
                              ppPreset === p.key
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border hover:bg-muted/40"
                            }`}
                          >
                            <span className="font-medium leading-tight">{p.label}</span>
                            <span className="text-[10px] text-muted-foreground">{p.sub}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setPpAdvancedOpen((v) => !v)}
                      data-testid="toggle-pp-advanced"
                      className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      {ppAdvancedOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      <span>Advanced rules</span>
                    </button>

                    {ppAdvancedOpen && (
                    <div className="space-y-3">
                    {/* Stop loss */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <DollarSign className="h-3 w-3 text-destructive" />
                          <Label className="text-xs">Stop Loss</Label>
                        </div>
                        <Switch
                          checked={ppStopEnabled}
                          onCheckedChange={setPpStopEnabled}
                          data-testid="switch-pp-stop"
                        />
                      </div>
                      {ppStopEnabled && (
                        <div className="flex gap-2">
                          <Input
                            type="number"
                            step="0.01"
                            value={ppStopValue}
                            onChange={(e) => setPpStopValue(e.target.value)}
                            className="h-8"
                            data-testid="input-pp-stop-value"
                          />
                          <Select value={ppStopMode} onValueChange={(v) => setPpStopMode(v as any)}>
                            <SelectTrigger className="h-8 w-28" data-testid="select-pp-stop-mode">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="percent">% below</SelectItem>
                              <SelectItem value="dollar">$ below</SelectItem>
                              <SelectItem value="price">at price</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>

                    {/* Take profit */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Target className="h-3 w-3 text-chart-2" />
                          <Label className="text-xs">Take Profit</Label>
                        </div>
                        <Switch
                          checked={ppTargetEnabled}
                          onCheckedChange={setPpTargetEnabled}
                          data-testid="switch-pp-target"
                        />
                      </div>
                      {ppTargetEnabled && (
                        <div className="flex gap-2">
                          <Input
                            type="number"
                            step="0.01"
                            value={ppTargetValue}
                            onChange={(e) => setPpTargetValue(e.target.value)}
                            className="h-8"
                            data-testid="input-pp-target-value"
                          />
                          <Select value={ppTargetMode} onValueChange={(v) => setPpTargetMode(v as any)}>
                            <SelectTrigger className="h-8 w-28" data-testid="select-pp-target-mode">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="percent">% above</SelectItem>
                              <SelectItem value="dollar">$ above</SelectItem>
                              <SelectItem value="price">at price</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>

                    {/* Trailing stop */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <TrendingDown className="h-3 w-3 text-yellow-500" />
                          <Label className="text-xs">Trailing Stop</Label>
                        </div>
                        <Switch
                          checked={ppTrailEnabled}
                          onCheckedChange={setPpTrailEnabled}
                          data-testid="switch-pp-trail"
                        />
                      </div>
                      {ppTrailEnabled && (
                        <>
                          <div className="flex gap-2">
                            <Input
                              type="number"
                              step="0.01"
                              value={ppTrailValue}
                              onChange={(e) => setPpTrailValue(e.target.value)}
                              className="h-8"
                              data-testid="input-pp-trail-value"
                            />
                            <Select value={ppTrailMode} onValueChange={(v) => setPpTrailMode(v as any)}>
                              <SelectTrigger className="h-8 w-28" data-testid="select-pp-trail-mode">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="percent">% trail</SelectItem>
                                <SelectItem value="dollar">$ trail</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            Follows the high. We move the stop up as price rises, never down.
                          </p>
                        </>
                      )}
                    </div>

                    {/* Exit order type */}
                    <div className="space-y-1.5">
                      <Label className="text-xs">When triggered, submit</Label>
                      <Select value={ppExitOrderType} onValueChange={(v) => setPpExitOrderType(v as any)}>
                        <SelectTrigger className="h-8" data-testid="select-pp-exit-order-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="market">Market order (fastest)</SelectItem>
                          <SelectItem value="stop">Stop order (rests at level)</SelectItem>
                          <SelectItem value="stop_limit">Stop-limit (price protected)</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">
                        Market fills fastest but at the next available price. Stop-limit caps the price
                        but may not fill in a fast move.
                      </p>
                    </div>
                    </div>
                    )}

                    <div className="flex items-start gap-2 pt-1">
                      <Checkbox
                        id="pp-ack"
                        checked={ppAck}
                        onCheckedChange={(c) => setPpAck(c === true)}
                        className="mt-0.5"
                        data-testid="checkbox-pp-ack"
                      />
                      <Label htmlFor="pp-ack" className="text-[11px] leading-snug text-muted-foreground font-normal">
                        {PP_ACK_TEXT}
                      </Label>
                    </div>
                  </div>
                )}
              </div>
            )}

            {inExtendedSession && (
              <div className="space-y-2 p-3 rounded-md border border-blue-500/30 bg-blue-500/5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Moon className="h-4 w-4 text-blue-400" />
                    <Label className="text-xs font-medium">
                      {sessionInfo.session === "pre" ? "Pre-Market Session" : "After-Hours Session"}
                    </Label>
                  </div>
                  <Switch
                    checked={extendedHours}
                    onCheckedChange={(checked) => {
                      setExtendedHours(checked);
                      if (checked) {
                        setEntryType("limit");
                        setBracketEnabled(false);
                        setDuration("day");
                      }
                    }}
                    data-testid="switch-extended-hours"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Route this order to the {sessionInfo.session === "pre" ? "pre-market (4:00–9:30 AM ET)" : "after-hours (4:00–8:00 PM ET)"} session.
                  Limit orders only — bracket exits aren't allowed and will be skipped.
                  Spreads are wider and fills aren't guaranteed.
                </p>
                <HelpLink section="extended-hours" label="Learn about pre-market & after-hours" variant="inline" />
              </div>
            )}

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
            onClick={() => (needsLiveSetup ? setShowLiveSetup(true) : placeMutation.mutate())}
            disabled={
              placeMutation.isPending ||
              !selectedAccount ||
              (entryType === "limit" && (!limitPrice || parseFloat(limitPrice) <= 0)) ||
              (bracketEnabled && (!targetPrice || !stopPrice || parseFloat(targetPrice) <= 0 || parseFloat(stopPrice) <= 0)) ||
              (protectionEnabled && !ppAck)
            }
            className="flex-1"
            data-testid="button-stock-ticket-place"
            title={!selectedAccount ? "Connect Broker to Use InstaTrade™" : undefined}
          >
            {placeMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Zap className="h-4 w-4 mr-1" />
            )}
            {!selectedAccount
              ? "Connect Broker to Use InstaTrade™"
              : needsLiveSetup
              ? "Complete Live Trading Setup"
              : extendedHours
              ? `Send ${sessionInfo.session === "pre" ? "Pre-Market" : "After-Hours"} Order`
              : "Send to Broker with InstaTrade™"}
          </Button>
        </SheetFooter>
        <LiveTradingSetupDialog
          open={showLiveSetup}
          onClose={() => setShowLiveSetup(false)}
          onCompleted={() => setShowLiveSetup(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
