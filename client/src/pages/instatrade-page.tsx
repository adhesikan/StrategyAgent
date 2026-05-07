import { useState } from "react";
import { useSearch } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Zap, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function InstaTradePage() {
  const search = useSearch();
  const sp = new URLSearchParams(search);
  const ticker = (sp.get("ticker") || "XLE").toUpperCase();
  const strategy = sp.get("strategy") || "iron-condor";

  const [mode, setMode] = useState<"simple" | "advanced">("simple");
  const [action, setAction] = useState("buy_to_open");
  const [qty, setQty] = useState("1");
  const [orderType, setOrderType] = useState("limit");
  const [expiration, setExpiration] = useState("Jun 6");
  const [limit, setLimit] = useState("1.40");
  const [tif, setTif] = useState("day");
  const [profitTarget, setProfitTarget] = useState("0.70");
  const [stopLoss, setStopLoss] = useState("2.80");
  const { toast } = useToast();

  const send = () => {
    toast({
      title: "Order ready for review",
      description: `${ticker} · ${strategy} · Qty ${qty} · ${orderType} @ $${limit}`,
    });
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-4xl mx-auto px-4 md:px-8 py-8 space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="inline-flex items-center gap-2 mb-2">
              <div className="h-8 w-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center">
                <Zap className="h-4 w-4" />
              </div>
              <h1 className="text-[22px] font-medium" data-testid="text-instatrade-title">
                InstaTrade<sup className="text-xs ml-0.5">™</sup>
              </h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Pre-loaded from {ticker} · {strategy}. Review and send to your broker.
            </p>
          </div>
          <div className="bg-muted/40 rounded-lg p-1 flex">
            <button
              onClick={() => setMode("simple")}
              className={
                "px-4 py-1.5 text-sm rounded-md transition-colors " +
                (mode === "simple" ? "bg-background shadow-sm" : "text-muted-foreground")
              }
              data-testid="tab-simple"
            >
              Simple
            </button>
            <button
              onClick={() => setMode("advanced")}
              className={
                "px-4 py-1.5 text-sm rounded-md transition-colors " +
                (mode === "advanced" ? "bg-background shadow-sm" : "text-muted-foreground")
              }
              data-testid="tab-advanced"
            >
              Advanced · OCO
            </button>
          </div>
        </div>

        <Card className="p-6 space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Symbol">
              <Input value={ticker} readOnly data-testid="input-symbol" />
            </Field>
            <Field label="Action">
              <Select value={action} onValueChange={setAction}>
                <SelectTrigger data-testid="select-action"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="buy_to_open">Buy to open</SelectItem>
                  <SelectItem value="sell_to_open">Sell to open</SelectItem>
                  <SelectItem value="buy_to_close">Buy to close</SelectItem>
                  <SelectItem value="sell_to_close">Sell to close</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Quantity">
              <Input value={qty} onChange={(e) => setQty(e.target.value)} type="number" data-testid="input-qty" />
            </Field>
            <Field label="Order type">
              <Select value={orderType} onValueChange={setOrderType}>
                <SelectTrigger data-testid="select-order-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="market">Market</SelectItem>
                  <SelectItem value="limit">Limit</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Strategy">
              <Input value={strategy} readOnly data-testid="input-strategy" />
            </Field>
            <Field label="Expiration">
              <Input value={expiration} onChange={(e) => setExpiration(e.target.value)} data-testid="input-expiration" />
            </Field>
            <Field label="Limit price">
              <Input value={limit} onChange={(e) => setLimit(e.target.value)} data-testid="input-limit" />
            </Field>
            <Field label="Time in force">
              <Select value={tif} onValueChange={setTif}>
                <SelectTrigger data-testid="select-tif"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">Day</SelectItem>
                  <SelectItem value="gtc">GTC</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          {mode === "advanced" && (
            <div className="border-t pt-5 space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200">OCO</Badge>
                <span className="text-sm font-medium">One-cancels-other exits</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="p-4 border-emerald-200 bg-emerald-50/40">
                  <div className="text-xs uppercase tracking-wide text-emerald-700 mb-3">Profit target</div>
                  <Field label="Close at credit">
                    <Input value={profitTarget} onChange={(e) => setProfitTarget(e.target.value)} data-testid="input-profit-target" />
                  </Field>
                  <p className="text-xs text-muted-foreground mt-2">~50% of max profit · Limit order</p>
                </Card>
                <Card className="p-4 border-rose-200 bg-rose-50/40">
                  <div className="text-xs uppercase tracking-wide text-rose-700 mb-3">Stop loss</div>
                  <Field label="Close at debit">
                    <Input value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} data-testid="input-stop-loss" />
                  </Field>
                  <p className="text-xs text-muted-foreground mt-2">2× credit rule · Market order</p>
                </Card>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t">
            <p className="text-xs text-muted-foreground">
              {mode === "advanced"
                ? `Entry + OCO exits pre-loaded · Profit at $${profitTarget} · Stop at $${stopLoss}`
                : `${action.replace(/_/g, " ")} ${qty} ${ticker} @ ${orderType === "limit" ? `$${limit}` : "market"}`}
            </p>
            <Button onClick={send} className="gap-2" data-testid="button-send-order">
              <Send className="h-4 w-4" />
              {mode === "advanced" ? "Send all orders" : "Send order"}
            </Button>
          </div>
        </Card>

        <p className="text-xs text-muted-foreground">
          Orders are routed to your connected broker. Review carefully before submitting.
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
