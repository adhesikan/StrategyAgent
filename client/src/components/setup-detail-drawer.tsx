import { useState, useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { X, Target, TrendingUp, AlertTriangle, ExternalLink, Bell, Zap, ArrowUpRight, ArrowDownRight, Info, ChevronDown, Check, Calculator, DollarSign, Crosshair } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ScanResult } from "@shared/schema";
import { cn } from "@/lib/utils";

interface SetupDetailDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  result: ScanResult | null;
  strategyName?: string;
  onCreateAlert?: () => void;
}

interface AutomationEndpoint {
  id: string;
  name: string;
  webhookUrl: string;
  isActive: boolean;
  lastTestSuccess?: boolean;
}

export function SetupDetailDrawer({ 
  isOpen, 
  onClose, 
  result, 
  strategyName = "VCP",
  onCreateAlert 
}: SetupDetailDrawerProps) {
  const { toast } = useToast();
  const [showConnectPrompt, setShowConnectPrompt] = useState(false);
  const [showEndpointDialog, setShowEndpointDialog] = useState(false);
  const [selectedEndpoint, setSelectedEndpoint] = useState<AutomationEndpoint | null>(null);
  
  const [accountSize, setAccountSize] = useState<string>("50000");
  const [riskPercent, setRiskPercent] = useState<string>("1");

  const { data: endpoints } = useQuery<AutomationEndpoint[]>({
    queryKey: ["/api/automation-endpoints"],
    enabled: isOpen,
  });

  const hasEndpoints = endpoints && endpoints.length > 0;

  const instatradeMutation = useMutation({
    mutationFn: async (endpointId: string) => {
      if (!result) throw new Error("No result selected");
      const response = await apiRequest("POST", "/api/instatrade/entry", {
        endpointId,
        symbol: result.ticker,
        strategyId: strategyName,
        setupPayload: {
          price: result.price,
          resistance: result.resistance,
          stopLoss: result.stopLoss,
          entryTrigger: result.resistance,
          stage: result.stage,
          patternScore: result.patternScore,
          timeframe: "1D",
        },
      });
      return response.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "InstaTrade™ Sent",
        description: `Entry signal sent for ${result?.ticker}`,
      });
      setShowEndpointDialog(false);
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/execution-requests"] });
    },
    onError: (error: any) => {
      toast({
        title: "InstaTrade™ Failed",
        description: error.message || "Could not send entry signal",
        variant: "destructive",
      });
    },
  });

  const handleInstaTrade = () => {
    // Always show the dialog so users can see trade details and calculators
    if (hasEndpoints) {
      setSelectedEndpoint(endpoints![0]);
    }
    setShowEndpointDialog(true);
  };

  const handleConfirmInstaTrade = () => {
    if (selectedEndpoint) {
      instatradeMutation.mutate(selectedEndpoint.id);
    }
  };

  const positionCalc = useMemo(() => {
    if (!result?.resistance || !result?.stopLoss) return null;
    
    const account = parseFloat(accountSize) || 0;
    const riskPct = parseFloat(riskPercent) || 0;
    const entryPrice = result.resistance;
    const stopPrice = result.stopLoss;
    
    if (account <= 0 || riskPct <= 0 || entryPrice <= stopPrice) return null;
    
    const riskAmount = account * (riskPct / 100);
    const riskPerShare = entryPrice - stopPrice;
    const shares = Math.floor(riskAmount / riskPerShare);
    const positionValue = shares * entryPrice;
    const actualRisk = shares * riskPerShare;
    
    return {
      shares,
      positionValue,
      riskAmount: actualRisk,
      riskPerShare,
      percentOfAccount: (positionValue / account) * 100,
    };
  }, [result?.resistance, result?.stopLoss, accountSize, riskPercent]);

  const priceTargets = useMemo(() => {
    if (!result?.resistance || !result?.stopLoss) return null;
    
    const entry = result.resistance;
    const stop = result.stopLoss;
    const riskAmount = entry - stop;
    
    return {
      target1R: entry + riskAmount,
      target2R: entry + (riskAmount * 2),
      target3R: entry + (riskAmount * 3),
      riskRewardAt1R: 1,
      riskRewardAt2R: 2,
      riskRewardAt3R: 3,
    };
  }, [result?.resistance, result?.stopLoss]);

  if (!result) return null;

  const priceChange = result.changePercent || 0;
  const isPositive = priceChange >= 0;
  const riskReward = result.resistance && result.stopLoss && result.price
    ? ((result.resistance - result.price) / (result.price - result.stopLoss)).toFixed(2)
    : null;

  const stageColor = {
    "FORMING": "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
    "READY": "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    "BREAKOUT": "bg-green-500/10 text-green-600 dark:text-green-400",
  }[result.stage?.toUpperCase() || "FORMING"] || "bg-muted text-muted-foreground";

  return (
    <>
      <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader className="pb-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <SheetTitle className="text-2xl font-bold">{result.ticker}</SheetTitle>
                <Badge className={cn("text-xs", stageColor)}>
                  {result.stage}
                </Badge>
              </div>
              {result.patternScore && (
                <Badge variant="secondary" className="text-sm">
                  {result.patternScore}% Score
                </Badge>
              )}
            </div>
            <SheetDescription className="text-base">{result.name || result.ticker}</SheetDescription>
          </SheetHeader>

          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-3xl font-bold">${result.price?.toFixed(2)}</p>
                <p className={cn(
                  "text-sm flex items-center gap-1",
                  isPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                )}>
                  {isPositive ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                  {isPositive ? "+" : ""}{priceChange.toFixed(2)}%
                </p>
              </div>
              <Badge variant="outline" className="text-sm">
                {strategyName}
              </Badge>
            </div>

            <Separator />

            <div className="space-y-4">
              <h3 className="font-semibold flex items-center gap-2">
                <Target className="h-4 w-4" />
                Key Levels
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {result.resistance && (
                  <Card>
                    <CardContent className="p-3">
                      <p className="text-xs text-muted-foreground mb-1">Resistance (Entry)</p>
                      <p className="text-lg font-semibold text-green-600 dark:text-green-400">
                        ${result.resistance.toFixed(2)}
                      </p>
                    </CardContent>
                  </Card>
                )}
                {result.stopLoss && (
                  <Card>
                    <CardContent className="p-3">
                      <p className="text-xs text-muted-foreground mb-1">Stop Loss</p>
                      <p className="text-lg font-semibold text-red-600 dark:text-red-400">
                        ${result.stopLoss.toFixed(2)}
                      </p>
                    </CardContent>
                  </Card>
                )}
                {result.rvol && (
                  <Card>
                    <CardContent className="p-3">
                      <p className="text-xs text-muted-foreground mb-1">RVOL</p>
                      <p className={cn(
                        "text-lg font-semibold",
                        result.rvol >= 1.5 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
                      )}>
                        {result.rvol.toFixed(2)}x
                      </p>
                    </CardContent>
                  </Card>
                )}
                {riskReward && (
                  <Card>
                    <CardContent className="p-3">
                      <p className="text-xs text-muted-foreground mb-1">Risk/Reward</p>
                      <p className={cn(
                        "text-lg font-semibold",
                        parseFloat(riskReward) >= 2 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
                      )}>
                        {riskReward}R
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>

            {priceTargets && (
              <>
                <Separator />
                <div className="space-y-3">
                  <h3 className="font-semibold flex items-center gap-2">
                    <Crosshair className="h-4 w-4" />
                    Price Targets
                  </h3>
                  <div className="grid grid-cols-3 gap-2">
                    <Card>
                      <CardContent className="p-3 text-center">
                        <p className="text-xs text-muted-foreground mb-1">Target 1R</p>
                        <p className="text-lg font-semibold text-green-600 dark:text-green-400">
                          ${priceTargets.target1R.toFixed(2)}
                        </p>
                        <p className="text-xs text-muted-foreground">+{((priceTargets.target1R - result.resistance!) / result.resistance! * 100).toFixed(1)}%</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-3 text-center">
                        <p className="text-xs text-muted-foreground mb-1">Target 2R</p>
                        <p className="text-lg font-semibold text-green-600 dark:text-green-400">
                          ${priceTargets.target2R.toFixed(2)}
                        </p>
                        <p className="text-xs text-muted-foreground">+{((priceTargets.target2R - result.resistance!) / result.resistance! * 100).toFixed(1)}%</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-3 text-center">
                        <p className="text-xs text-muted-foreground mb-1">Target 3R</p>
                        <p className="text-lg font-semibold text-green-600 dark:text-green-400">
                          ${priceTargets.target3R.toFixed(2)}
                        </p>
                        <p className="text-xs text-muted-foreground">+{((priceTargets.target3R - result.resistance!) / result.resistance! * 100).toFixed(1)}%</p>
                      </CardContent>
                    </Card>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Based on risk/reward multiples from entry at ${result.resistance?.toFixed(2)}
                  </p>
                </div>
              </>
            )}

            {result.resistance && result.stopLoss && (
              <>
                <Separator />
                <div className="space-y-3">
                  <h3 className="font-semibold flex items-center gap-2">
                    <Calculator className="h-4 w-4" />
                    Position Size Calculator
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="account-size" className="text-xs">Account Size</Label>
                      <div className="relative">
                        <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="account-size"
                          type="number"
                          value={accountSize}
                          onChange={(e) => setAccountSize(e.target.value)}
                          className="pl-8"
                          placeholder="50000"
                          data-testid="input-account-size"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="risk-percent" className="text-xs">Risk Per Trade (%)</Label>
                      <Input
                        id="risk-percent"
                        type="number"
                        step="0.5"
                        min="0.1"
                        max="10"
                        value={riskPercent}
                        onChange={(e) => setRiskPercent(e.target.value)}
                        placeholder="1"
                        data-testid="input-risk-percent"
                      />
                    </div>
                  </div>
                  {positionCalc && (
                    <Card className="bg-primary/5 border-primary/20">
                      <CardContent className="p-4">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-xs text-muted-foreground">Shares to Buy</p>
                            <p className="text-2xl font-bold text-primary" data-testid="text-shares-to-buy">
                              {positionCalc.shares.toLocaleString()}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Position Value</p>
                            <p className="text-lg font-semibold" data-testid="text-position-value">
                              ${positionCalc.positionValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Risk Amount</p>
                            <p className="text-sm font-medium text-red-600 dark:text-red-400" data-testid="text-risk-amount">
                              ${positionCalc.riskAmount.toFixed(2)}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">% of Account</p>
                            <p className={cn(
                              "text-sm font-medium",
                              positionCalc.percentOfAccount > 25 ? "text-yellow-600 dark:text-yellow-400" : ""
                            )} data-testid="text-percent-of-account">
                              {positionCalc.percentOfAccount.toFixed(1)}%
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                  {!positionCalc && (
                    <p className="text-sm text-muted-foreground text-center py-2">
                      Enter account size and risk percentage to calculate position
                    </p>
                  )}
                </div>
              </>
            )}

            {(result.volume || result.avgVolume || result.ema9 || result.ema21 || result.atr) && (
              <>
                <Separator />
                <div className="space-y-3">
                  <h3 className="font-semibold flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    Technical Details
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {result.volume && (
                      <div className="text-sm">
                        <span className="text-muted-foreground">Volume:</span>{" "}
                        <span className="font-medium">{(result.volume / 1000000).toFixed(2)}M</span>
                      </div>
                    )}
                    {result.avgVolume && (
                      <div className="text-sm">
                        <span className="text-muted-foreground">Avg Vol:</span>{" "}
                        <span className="font-medium">{(result.avgVolume / 1000000).toFixed(2)}M</span>
                      </div>
                    )}
                    {result.ema9 && (
                      <div className="text-sm">
                        <span className="text-muted-foreground">9 EMA:</span>{" "}
                        <span className="font-medium">${result.ema9.toFixed(2)}</span>
                      </div>
                    )}
                    {result.ema21 && (
                      <div className="text-sm">
                        <span className="text-muted-foreground">21 EMA:</span>{" "}
                        <span className="font-medium">${result.ema21.toFixed(2)}</span>
                      </div>
                    )}
                    {result.atr && (
                      <div className="text-sm">
                        <span className="text-muted-foreground">ATR:</span>{" "}
                        <span className="font-medium">${result.atr.toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            <Separator />

            <div className="space-y-3">
              <h3 className="font-semibold flex items-center gap-2">
                <Info className="h-4 w-4" />
                Setup Explanation
              </h3>
              <p className="text-sm text-muted-foreground">
                {result.stage === "BREAKOUT"
                  ? `${result.ticker} has broken above resistance${result.resistance ? ` at $${result.resistance.toFixed(2)}` : ""} with ${result.rvol && result.rvol >= 1.5 ? "strong" : "moderate"} volume confirmation.${result.stopLoss ? ` Consider entries with stop at $${result.stopLoss.toFixed(2)}.` : ""}`
                  : result.stage === "READY"
                  ? `${result.ticker} is approaching resistance${result.resistance ? ` at $${result.resistance.toFixed(2)}` : ""}. Watch for a breakout with volume above 1.5x average.`
                  : `${result.ticker} is forming a ${strategyName} pattern. Volatility is contracting as the stock consolidates${result.price ? ` near $${result.price.toFixed(2)}` : ""}.`
                }
              </p>
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  className="flex-1 gap-2"
                  onClick={onCreateAlert}
                  data-testid="button-create-alert"
                >
                  <Bell className="h-4 w-4" />
                  Create Alert
                </Button>
                <Button 
                  className="flex-1 gap-2"
                  onClick={handleInstaTrade}
                  disabled={instatradeMutation.isPending}
                  data-testid="button-instatrade"
                >
                  <Zap className="h-4 w-4" />
                  {instatradeMutation.isPending ? "Sending..." : "InstaTrade™"}
                </Button>
              </div>

              {showConnectPrompt && !hasEndpoints && (
                <Card className="border-primary/20 bg-primary/5">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <Zap className="h-5 w-5 text-primary mt-0.5" />
                      <div>
                        <p className="font-medium">Connect AlgoPilotX</p>
                        <p className="text-sm text-muted-foreground">
                          Create an automation endpoint to execute setups with InstaTrade™.
                        </p>
                      </div>
                    </div>
                    <Button 
                      variant="default" 
                      className="w-full gap-2"
                      onClick={() => window.location.href = "/automation"}
                      data-testid="button-connect-algopilotx"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Create Endpoint
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="pt-4 border-t">
              <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Educational & informational only. Not investment advice.
              </p>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={showEndpointDialog} onOpenChange={setShowEndpointDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              InstaTrade™ {result.ticker}
            </DialogTitle>
            <DialogDescription>
              {hasEndpoints 
                ? "Review trade details and select an endpoint to execute."
                : "Review trade details below. Connect an endpoint to execute trades."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-muted/50">
              <p className="text-sm font-medium mb-1">Setup Summary</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Symbol:</span>{" "}
                  <span className="font-medium">{result.ticker}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Strategy:</span>{" "}
                  <span className="font-medium">{strategyName}</span>
                </div>
                {result.price && (
                  <div>
                    <span className="text-muted-foreground">Current:</span>{" "}
                    <span className="font-medium">${result.price.toFixed(2)}</span>
                  </div>
                )}
                {result.resistance && (
                  <div>
                    <span className="text-muted-foreground">Entry (Breakout):</span>{" "}
                    <span className="font-medium text-green-600">${result.resistance.toFixed(2)}</span>
                  </div>
                )}
                {result.stopLoss && (
                  <div>
                    <span className="text-muted-foreground">Stop:</span>{" "}
                    <span className="font-medium text-red-600">${result.stopLoss.toFixed(2)}</span>
                  </div>
                )}
                {positionCalc && (
                  <>
                    <div>
                      <span className="text-muted-foreground">Shares:</span>{" "}
                      <span className="font-medium">{positionCalc.shares.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Position:</span>{" "}
                      <span className="font-medium">${positionCalc.positionValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    </div>
                  </>
                )}
                {priceTargets && (
                  <>
                    <div>
                      <span className="text-muted-foreground">Target 1R:</span>{" "}
                      <span className="font-medium text-green-600">${priceTargets.target1R.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Target 2R:</span>{" "}
                      <span className="font-medium text-green-600">${priceTargets.target2R.toFixed(2)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {hasEndpoints ? (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Select Endpoint</Label>
                <Select
                  value={selectedEndpoint?.id || ""}
                  onValueChange={(value) => {
                    const endpoint = endpoints?.find(e => e.id === value);
                    if (endpoint) setSelectedEndpoint(endpoint);
                  }}
                >
                  <SelectTrigger data-testid="select-drawer-endpoint">
                    <Zap className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="Choose an endpoint" />
                  </SelectTrigger>
                  <SelectContent>
                    {endpoints?.map((endpoint) => (
                      <SelectItem key={endpoint.id} value={endpoint.id}>
                        {endpoint.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <Zap className="h-5 w-5 text-primary mt-0.5" />
                    <div>
                      <p className="font-medium">Connect AlgoPilotX</p>
                      <p className="text-sm text-muted-foreground">
                        Create an automation endpoint to execute trades with InstaTrade™.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEndpointDialog(false)} data-testid="button-close-instatrade-dialog">
              Close
            </Button>
            {hasEndpoints ? (
              <Button
                onClick={handleConfirmInstaTrade}
                disabled={!selectedEndpoint || instatradeMutation.isPending}
                data-testid="button-confirm-instatrade"
              >
                {instatradeMutation.isPending ? "Sending..." : "Send InstaTrade™"}
              </Button>
            ) : (
              <Button
                onClick={() => window.location.href = "/automation"}
                data-testid="button-goto-automation"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Create Endpoint
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
