import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Zap, Search, Info } from "lucide-react";
import { Link } from "wouter";
import { StockTradeTicket } from "@/components/stock-trade-ticket";
import { HelpLink } from "@/components/help-link";

interface BrokerAccount {
  id: string;
  name: string;
  type: string;
  buyingPower: number;
  equity: number;
  currency: string;
}

const POPULAR = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "TSLA", "AMD", "META"];

export default function InstaTradePage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const sp = useMemo(() => new URLSearchParams(search), [search]);
  const urlTicker = (sp.get("ticker") || "SPY").toUpperCase();
  const assetType = (sp.get("asset") || "stock").toLowerCase() as "stock" | "option";

  const [tickerInput, setTickerInput] = useState(urlTicker);
  const [activeTicker, setActiveTicker] = useState(urlTicker);
  const [open, setOpen] = useState(true);
  const [selectedAccount, setSelectedAccount] = useState<BrokerAccount | null>(null);
  const { data: brokerAccounts } = useQuery<BrokerAccount[]>({
    queryKey: ["/api/broker/accounts"],
  });

  useEffect(() => {
    setTickerInput(urlTicker);
    setActiveTicker(urlTicker);
  }, [urlTicker]);

  useEffect(() => {
    if (assetType === "stock") setOpen(true);
  }, [activeTicker, assetType]);

  const updateUrl = (next: { ticker?: string; asset?: "stock" | "option" }) => {
    const p = new URLSearchParams(search);
    if (next.ticker) p.set("ticker", next.ticker.toUpperCase());
    if (next.asset) p.set("asset", next.asset);
    navigate(`/instatrade?${p.toString()}`, { replace: true });
  };

  const applyTicker = () => {
    const sym = tickerInput.trim().toUpperCase();
    if (!sym || sym === activeTicker) {
      setOpen(true);
      return;
    }
    setActiveTicker(sym);
    updateUrl({ ticker: sym, asset: assetType });
  };

  const handleAssetChange = (value: string) => {
    updateUrl({ ticker: activeTicker, asset: value as "stock" | "option" });
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-2xl mx-auto px-4 md:px-8 py-12">
        <Card className="p-8">
          <div className="text-center">
            <div className="h-12 w-12 rounded-lg bg-primary text-primary-foreground flex items-center justify-center mx-auto mb-4">
              <Zap className="h-5 w-5" />
            </div>
            <div className="flex items-center justify-center gap-2">
              <h1 className="text-xl font-medium">InstaTrade™</h1>
              <HelpLink section="instatrade" />
            </div>
            <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
              Pick a symbol and asset type — the trade ticket opens on the right.
            </p>
          </div>

          <div className="mt-6 space-y-4">
            <Tabs value={assetType} onValueChange={handleAssetChange}>
              <TabsList className="grid w-full grid-cols-2" data-testid="tabs-asset-type">
                <TabsTrigger value="stock" data-testid="tab-asset-stock">Stock</TabsTrigger>
                <TabsTrigger value="option" data-testid="tab-asset-option">Option</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="space-y-2">
              <Label htmlFor="instatrade-symbol">Symbol</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="instatrade-symbol"
                    value={tickerInput}
                    onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") applyTicker();
                    }}
                    placeholder="e.g. AAPL"
                    className="pl-9 uppercase font-mono"
                    data-testid="input-instatrade-symbol"
                  />
                </div>
                <Button onClick={applyTicker} data-testid="button-apply-symbol">
                  {assetType === "stock" ? "Open Ticket" : "Find Options"}
                </Button>
              </div>
              <div className="flex flex-wrap gap-1 pt-1">
                <span className="text-xs text-muted-foreground mr-1 self-center">Popular:</span>
                {POPULAR.map((sym) => (
                  <Button
                    key={sym}
                    variant={sym === activeTicker ? "default" : "outline"}
                    size="sm"
                    className="h-7 px-2 text-xs font-mono"
                    onClick={() => {
                      setTickerInput(sym);
                      setActiveTicker(sym);
                      updateUrl({ ticker: sym, asset: assetType });
                    }}
                    data-testid={`button-popular-${sym}`}
                  >
                    {sym}
                  </Button>
                ))}
              </div>
            </div>

            {assetType === "option" && (
              <div className="rounded-md border border-border/60 bg-muted/40 p-3 text-sm flex gap-2">
                <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div>
                  Option tickets (calls, puts, spreads) are built from a strategy idea — open{" "}
                  <Link href={`/trade-finder?ticker=${activeTicker}`} className="underline">
                    Trade Finder
                  </Link>{" "}
                  for a custom plan, or{" "}
                  <Link href="/income-mode" className="underline">
                    Generate Income
                  </Link>{" "}
                  for covered calls and CSPs. The reviewed setup will open back here for you to send
                  to your broker.
                </div>
              </div>
            )}

            {assetType === "stock" && (
              <div className="flex items-center justify-between pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate("/home")}
                  data-testid="button-back-home"
                >
                  Back to Home
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setOpen(true)}
                  data-testid="button-reopen-ticket"
                >
                  Reopen Ticket
                </Button>
              </div>
            )}
          </div>
        </Card>
      </div>

      {assetType === "stock" && (
        <StockTradeTicket
          open={open}
          onOpenChange={setOpen}
          scanResult={{
            ticker: activeTicker,
            price: 0,
            resistance: null,
            stopLoss: null,
            stage: "WATCH",
            patternScore: 0,
          }}
          brokerAccounts={brokerAccounts || []}
          selectedAccount={selectedAccount}
          onAccountChange={setSelectedAccount}
        />
      )}
    </div>
  );
}
