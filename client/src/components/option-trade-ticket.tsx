import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Loader2, Zap, AlertCircle } from "lucide-react";

interface BrokerAccount {
  id: string;
  name: string;
  type: string;
  buyingPower: number;
  equity: number;
  currency: string;
}

interface OptionContract {
  symbol: string;
  strike: number;
  optionType: "call" | "put";
  expiration: string;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  openInterest: number;
  greeks?: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    mid_iv: number;
  };
}

interface OptionTradeTicketProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  symbol: string;
  onSymbolChange: (newSymbol: string) => void;
  brokerAccounts: BrokerAccount[];
  selectedAccount: BrokerAccount | null;
  onAccountChange: (account: BrokerAccount | null) => void;
}

function fmtMoney(n: number) {
  if (!isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

function daysUntil(dateStr: string): number {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 0;
  return Math.max(0, Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
}

export function OptionTradeTicket({
  open,
  onOpenChange,
  symbol,
  onSymbolChange,
  brokerAccounts,
  selectedAccount,
  onAccountChange,
}: OptionTradeTicketProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [symbolDraft, setSymbolDraft] = useState(symbol);
  const [side, setSide] = useState<"call" | "put">("call");
  const [expiration, setExpiration] = useState<string>("");
  const [selectedContract, setSelectedContract] = useState<OptionContract | null>(null);
  const [quantity, setQuantity] = useState<number>(1);
  const [orderType, setOrderType] = useState<"market" | "limit">("limit");
  const [limitPrice, setLimitPrice] = useState<string>("");
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    setSymbolDraft(symbol);
  }, [symbol]);

  // Reset selection when symbol or expiration changes
  useEffect(() => {
    setSelectedContract(null);
    setLimitPrice("");
    setAcknowledged(false);
  }, [symbol, expiration, side]);

  const commitSymbol = () => {
    const sym = symbolDraft.trim().toUpperCase();
    if (sym && sym !== symbol) {
      onSymbolChange(sym);
      setExpiration("");
    }
  };

  const expirationsQuery = useQuery<{ symbol: string; expirations: string[] }>({
    queryKey: ["/api/broker/options/expirations", symbol],
    enabled: open && !!symbol,
  });

  // Default expiration to first available once loaded
  useEffect(() => {
    const exps = expirationsQuery.data?.expirations || [];
    if (exps.length > 0 && (!expiration || !exps.includes(expiration))) {
      setExpiration(exps[0]);
    }
  }, [expirationsQuery.data, expiration]);

  const chainQuery = useQuery<{ symbol: string; expiration: string; contracts: OptionContract[] }>({
    queryKey: ["/api/broker/options/chain", symbol, expiration],
    enabled: open && !!symbol && !!expiration,
  });

  const filteredContracts = useMemo(() => {
    const all = chainQuery.data?.contracts || [];
    return all
      .filter((c) => c.optionType === side)
      .sort((a, b) => a.strike - b.strike);
  }, [chainQuery.data, side]);

  const accountSelected = !!selectedAccount;
  const isSandbox = selectedAccount?.id?.startsWith("sandbox:") || false;

  useEffect(() => {
    if (selectedContract && !limitPrice) {
      const mid = (selectedContract.bid + selectedContract.ask) / 2;
      if (mid > 0) setLimitPrice(mid.toFixed(2));
    }
  }, [selectedContract]);

  const placeMutation = useMutation({
    mutationFn: async () => {
      if (!selectedContract) throw new Error("Pick a contract first");
      if (!selectedAccount) throw new Error("Select an account");
      if (!acknowledged) throw new Error("Confirm the acknowledgment to continue");

      let estPremium = 0;
      if (orderType === "limit") {
        estPremium = parseFloat(limitPrice);
        if (!estPremium || estPremium <= 0) throw new Error("Enter a valid limit price");
      } else {
        estPremium = selectedContract.ask || selectedContract.last || 0;
      }

      const payload = {
        symbol,
        instrumentType: side === "call" ? "long_call" : "long_put",
        quantity,
        legs: [
          {
            side: "buy",
            optionSymbol: selectedContract.symbol,
            strike: selectedContract.strike,
            expiration: selectedContract.expiration,
            optionType: selectedContract.optionType,
            estimatedPremium: estPremium * 100, // per contract = premium * 100 shares
          },
        ],
        complianceAcknowledged: true,
      };

      const res = await apiRequest("POST", "/api/trade/place-option", payload);
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Option Order Submitted",
        description: data.notice || `Buy ${quantity} ${symbol} ${selectedContract?.optionType?.toUpperCase() ?? ""} ${selectedContract?.strike} @ ${selectedContract?.expiration}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/broker/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trade-outcomes"] });
      onOpenChange(false);
    },
    onError: (error: any) => {
      let description = "Could not place option order";
      try {
        const jsonMatch = error.message?.match(/\{.*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          description = parsed.error || description;
          if (parsed.blockers?.length) {
            description += ` — ${parsed.blockers.join(", ")}`;
          }
        } else {
          description = error.message || description;
        }
      } catch {
        description = error.message || description;
      }
      toast({ title: "Order Failed", description, variant: "destructive" });
    },
  });

  const submitLabel = !accountSelected
    ? "Connect Broker to Use InstaTrade™"
    : isSandbox
      ? "Paper Trade"
      : "Send to Broker with InstaTrade™";

  const dte = expiration ? daysUntil(expiration) : 0;
  const estCost = (selectedContract && orderType === "limit" && limitPrice)
    ? parseFloat(limitPrice) * 100 * quantity
    : selectedContract
      ? selectedContract.ask * 100 * quantity
      : 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col" data-testid="option-trade-ticket-sheet">
        <SheetHeader className="px-4 pt-4 pb-3 border-b">
          <SheetTitle className="flex items-center gap-2 text-base" data-testid="option-trade-ticket-title">
            <Zap className="h-4 w-4 text-primary" />
            InstaTrade™ Options · {symbol}
          </SheetTitle>
          <SheetDescription className="text-xs">
            Pick a contract from your broker's option chain and place the trade.
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="px-4 py-3 space-y-4">
            {/* Symbol + Account */}
            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Symbol</Label>
                <Input
                  value={symbolDraft}
                  onChange={(e) => setSymbolDraft(e.target.value.toUpperCase())}
                  onBlur={commitSymbol}
                  onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                  className="font-mono uppercase h-8"
                  data-testid="input-option-ticket-symbol"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Account</Label>
                <Select
                  value={selectedAccount?.id || ""}
                  onValueChange={(v) => {
                    const acc = brokerAccounts.find((a) => a.id === v) || null;
                    onAccountChange(acc);
                  }}
                >
                  <SelectTrigger data-testid="select-option-ticket-account">
                    <SelectValue placeholder={brokerAccounts.length ? "Select account" : "No broker connected"} />
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
            </div>

            <Separator />

            {/* Expiration + Call/Put */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Expiration</Label>
                <Select value={expiration} onValueChange={setExpiration}>
                  <SelectTrigger data-testid="select-option-expiration">
                    <SelectValue placeholder={expirationsQuery.isLoading ? "Loading..." : "Pick a date"} />
                  </SelectTrigger>
                  <SelectContent>
                    {(expirationsQuery.data?.expirations || []).map((e) => (
                      <SelectItem key={e} value={e}>
                        {e} ({daysUntil(e)}d)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Type</Label>
                <Tabs value={side} onValueChange={(v) => setSide(v as "call" | "put")}>
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="call" data-testid="tab-option-call">Calls</TabsTrigger>
                    <TabsTrigger value="put" data-testid="tab-option-put">Puts</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </div>

            {expiration && dte > 0 && (
              <div className="text-[11px] text-muted-foreground">
                {dte} day{dte !== 1 ? "s" : ""} to expiration
              </div>
            )}

            {/* Chain table */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Strikes</Label>
                {chainQuery.isFetching ? (
                  <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading chain
                  </span>
                ) : null}
              </div>

              {expirationsQuery.isError || chainQuery.isError ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs flex gap-2">
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                  <div>
                    Couldn't load the option chain from your broker. Make sure your broker is connected and supports
                    option-chain data, then try again.
                  </div>
                </div>
              ) : null}

              {!expirationsQuery.isError && !chainQuery.isError && (
                <div className="rounded-md border max-h-72 overflow-auto" data-testid="option-chain-table">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/80 backdrop-blur z-10">
                      <tr className="text-left text-muted-foreground">
                        <th className="px-2 py-1.5 font-medium">Strike</th>
                        <th className="px-2 py-1.5 font-medium text-right">Bid</th>
                        <th className="px-2 py-1.5 font-medium text-right">Ask</th>
                        <th className="px-2 py-1.5 font-medium text-right">Δ</th>
                        <th className="px-2 py-1.5 font-medium text-right">OI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredContracts.length === 0 && !chainQuery.isFetching ? (
                        <tr><td colSpan={5} className="px-2 py-3 text-center text-muted-foreground">
                          No {side}s for this expiration.
                        </td></tr>
                      ) : null}
                      {filteredContracts.map((c) => {
                        const isSelected = selectedContract?.symbol === c.symbol;
                        return (
                          <tr
                            key={c.symbol}
                            onClick={() => setSelectedContract(c)}
                            className={`cursor-pointer hover-elevate active-elevate-2 ${isSelected ? "bg-primary/15 ring-1 ring-primary/40" : ""}`}
                            data-testid={`row-option-${c.optionType}-${c.strike}`}
                          >
                            <td className="px-2 py-1.5 font-mono">{c.strike.toFixed(2)}</td>
                            <td className="px-2 py-1.5 text-right font-mono">{fmtMoney(c.bid)}</td>
                            <td className="px-2 py-1.5 text-right font-mono">{fmtMoney(c.ask)}</td>
                            <td className="px-2 py-1.5 text-right font-mono">{c.greeks ? c.greeks.delta.toFixed(2) : "—"}</td>
                            <td className="px-2 py-1.5 text-right font-mono">{c.openInterest.toLocaleString()}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Order form (shown once a contract is picked) */}
            {selectedContract && (
              <>
                <Separator />
                <div className="space-y-3">
                  <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-1" data-testid="text-selected-contract">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Selected:</span>
                      <span className="font-mono font-medium">
                        {symbol} {selectedContract.optionType?.toUpperCase() ?? ""} {selectedContract.strike} {selectedContract.expiration}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Bid / Ask:</span>
                      <span className="font-mono">{fmtMoney(selectedContract.bid)} / {fmtMoney(selectedContract.ask)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">OI / Vol:</span>
                      <span className="font-mono">{selectedContract.openInterest.toLocaleString()} / {selectedContract.volume.toLocaleString()}</span>
                    </div>
                    {selectedContract.greeks ? (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Δ / IV:</span>
                        <span className="font-mono">
                          {selectedContract.greeks.delta.toFixed(2)} / {(selectedContract.greeks.mid_iv * 100).toFixed(1)}%
                        </span>
                      </div>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Contracts</Label>
                      <Input
                        type="number"
                        min={1}
                        max={100}
                        value={quantity}
                        onChange={(e) => setQuantity(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                        data-testid="input-option-quantity"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Order Type</Label>
                      <div className="flex gap-2">
                        <Button
                          variant={orderType === "market" ? "default" : "outline"}
                          size="sm"
                          className="flex-1"
                          onClick={() => setOrderType("market")}
                          data-testid="button-option-market"
                        >
                          Market
                        </Button>
                        <Button
                          variant={orderType === "limit" ? "default" : "outline"}
                          size="sm"
                          className="flex-1"
                          onClick={() => setOrderType("limit")}
                          data-testid="button-option-limit"
                        >
                          Limit
                        </Button>
                      </div>
                    </div>
                  </div>

                  {orderType === "limit" && (
                    <div className="space-y-1">
                      <Label className="text-xs">Limit Price (per share)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={limitPrice}
                        onChange={(e) => setLimitPrice(e.target.value)}
                        data-testid="input-option-limit-price"
                      />
                      <div className="flex gap-1 flex-wrap">
                        <Button variant="outline" size="sm" onClick={() => setLimitPrice(selectedContract.bid.toFixed(2))} data-testid="button-option-bid">Bid</Button>
                        <Button variant="outline" size="sm" onClick={() => setLimitPrice(((selectedContract.bid + selectedContract.ask) / 2).toFixed(2))} data-testid="button-option-mid">Mid</Button>
                        <Button variant="outline" size="sm" onClick={() => setLimitPrice(selectedContract.ask.toFixed(2))} data-testid="button-option-ask">Ask</Button>
                      </div>
                    </div>
                  )}

                  <div className="rounded-md border p-3 space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Order Summary</p>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Action:</span>
                      <span className="font-medium">
                        Buy to open {quantity} {selectedContract.optionType?.toUpperCase() ?? ""} {selectedContract.strike}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Order Type:</span>
                      <span className="font-medium capitalize">
                        {orderType}{orderType === "limit" && limitPrice ? ` @ $${limitPrice}` : ""}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Est. Cost:</span>
                      <span className="font-mono font-medium">${estCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    {isSandbox && (
                      <Badge variant="outline" className="text-[10px] mt-1">Paper account — simulated fill</Badge>
                    )}
                  </div>

                  <label className="flex items-start gap-2 text-xs cursor-pointer" data-testid="label-option-ack">
                    <Checkbox
                      checked={acknowledged}
                      onCheckedChange={(v) => setAcknowledged(!!v)}
                      data-testid="checkbox-option-ack"
                    />
                    <span className="text-muted-foreground leading-snug">
                      I've reviewed this contract and understand options carry the risk of total loss of premium.
                      VCP Trader AI provides software-generated analysis — never investment advice.
                    </span>
                  </label>
                </div>
              </>
            )}
          </div>
        </ScrollArea>

        <SheetFooter className="px-4 py-3 border-t gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1" data-testid="button-option-cancel">
            Cancel
          </Button>
          <Button
            onClick={() => placeMutation.mutate()}
            disabled={!accountSelected || !selectedContract || !acknowledged || placeMutation.isPending}
            className="flex-1"
            data-testid="button-option-submit"
          >
            {placeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
            {submitLabel}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
