import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Zap } from "lucide-react";
import { StockTradeTicket } from "@/components/stock-trade-ticket";

interface BrokerAccount {
  id: string;
  name: string;
  type: string;
  buyingPower: number;
  equity: number;
  currency: string;
}

export default function InstaTradePage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const sp = new URLSearchParams(search);
  const ticker = (sp.get("ticker") || "SPY").toUpperCase();

  const [open, setOpen] = useState(true);
  const [selectedAccount, setSelectedAccount] = useState<BrokerAccount | null>(null);
  const { data: brokerAccounts } = useQuery<BrokerAccount[]>({
    queryKey: ["/api/broker/accounts"],
  });

  useEffect(() => {
    setOpen(true);
  }, [ticker]);

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-2xl mx-auto px-4 md:px-8 py-12">
        <Card className="p-8 text-center">
          <div className="h-12 w-12 rounded-lg bg-primary text-primary-foreground flex items-center justify-center mx-auto mb-4">
            <Zap className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-medium">InstaTrade™</h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
            The trade ticket panel is open on the right. Close it to return here, or
            open it again any time.
          </p>
          <div className="flex items-center justify-center gap-2 mt-6">
            <Button onClick={() => setOpen(true)} data-testid="button-reopen-ticket">
              Open ticket
            </Button>
            <Button variant="outline" onClick={() => navigate("/home")} data-testid="button-back-home">
              Back to Home
            </Button>
          </div>
        </Card>
      </div>

      <StockTradeTicket
        open={open}
        onOpenChange={setOpen}
        scanResult={{
          ticker,
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
    </div>
  );
}
