import { useEffect } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Sparkles, Loader2, ArrowLeft, ArrowRight, Info } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { usePlan } from "@/context/PlanContext";
import { useBranding } from "@/hooks/use-branding";

function planFeatures(instaTradeName: string): string[] {
  return [
    "Daily AI-ranked stock candidates",
    "Historical daily market analysis during trial",
    "Grow, Income, Trade, and Markets modes",
    "Opportunity Radar and Analysis Conditions",
    "News sentiment and market context",
    "Watchlist intelligence",
    "Congress Activity",
    "AI-assisted options strategy insights",
    "Tradier and TradeStation connections",
    "Current market data through connected brokerages",
    "Options chains through supported brokerages",
    `${instaTradeName} order review and submission`,
    "Position and results tracking",
    "Built-in risk controls",
    "Analysis-to-live workflow",
  ];
}

export default function PricingPage() {
  const [, navigate] = useLocation();
  const { plan: currentPlan } = usePlan();
  const { toast } = useToast();
  const { instaTradeName, instaTradeFooterNotice } = useBranding();
  const isCurrent = currentPlan !== "free";

  useEffect(() => {
    document.title = "Pricing — VCP Trader AI";
  }, []);

  const checkout = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/billing/checkout", { planId: "pro", cycle: "monthly" });
      return res.json() as Promise<{ url: string }>;
    },
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (error: Error) => {
      toast({
        title: "Checkout unavailable",
        description: error.message || "Stripe is not configured yet. Please try again shortly.",
        variant: "destructive",
      });
    },
  });

  const portal = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/billing/portal", {});
      return res.json() as Promise<{ url: string }>;
    },
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (error: Error) => {
      toast({
        title: "Couldn't open billing portal",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="flex-1 p-4 md:p-8 max-w-7xl mx-auto w-full space-y-8">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => navigate("/home")} data-testid="button-back-home">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to Home
        </Button>
        {isCurrent && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => portal.mutate()}
            disabled={portal.isPending}
            data-testid="button-manage-billing"
          >
            {portal.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            Manage billing
          </Button>
        )}
      </div>

      <div className="text-center space-y-3">
        <h1 className="text-3xl md:text-5xl font-bold tracking-tight" data-testid="text-pricing-title">
          Simple Pricing. Bring Your Broker.
        </h1>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          Start with a 14-day trial featuring historical daily market analysis, AI-ranked stock candidates, market intelligence, and research tools. Connect a supported brokerage account to unlock current broker-authorized market data, account context, options chains where available, and self-directed {instaTradeName} order review and submission.
        </p>
      </div>

      <div className="max-w-xl mx-auto">
        <div
          className="relative rounded-2xl border-2 border-primary bg-card/40 backdrop-blur p-6 md:p-8 flex flex-col gap-5 shadow-xl"
          data-testid="card-plan-pro"
        >
          <Badge className="absolute -top-3 left-1/2 -translate-x-1/2" data-testid="badge-founding-member">
            <Sparkles className="h-3 w-3 mr-1" /> Founding Member Access
          </Badge>

          <div className="text-center pt-2">
            <div className="flex justify-center">
              <Badge variant="secondary" data-testid="badge-free-trial">14-Day Free Trial</Badge>
            </div>
            <h3 className="font-bold text-2xl mt-3" data-testid="text-plan-name">VCP Trader AI Pro</h3>
            <div className="mt-3 flex items-baseline justify-center gap-1">
              <span className="text-5xl font-bold" data-testid="text-pro-price">$99</span>
              <span className="text-sm text-muted-foreground">/month</span>
            </div>
            <p className="text-sm font-medium text-primary mt-2" data-testid="text-founding-price-label">
              Founding Member Price
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Lock in this price while your subscription remains continuously active.
            </p>
            <p className="text-xs text-muted-foreground mt-1" data-testid="text-planned-standard-price">
              Planned standard price: $149/month
            </p>
            <p className="text-sm text-muted-foreground mt-3">
              One complete plan for market research, AI-ranked opportunities, broker-connected analysis, and self-directed stock and options order review.
            </p>
          </div>

          <ul className="space-y-2 text-sm">
            {planFeatures(instaTradeName).map((h) => (
              <li key={h} className="flex items-start gap-2">
                <Check className="h-4 w-4 mt-0.5 shrink-0 text-primary" aria-hidden="true" />
                <span>{h}</span>
              </li>
            ))}
          </ul>

          <div
            className="rounded-lg border border-border bg-muted/40 p-3 flex items-start gap-2 text-xs text-muted-foreground"
            role="note"
            data-testid="box-trial-disclosure"
          >
            <Info className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
            <p>
              Trial data: Market analysis uses historical daily data through the previous completed trading session. Current quotes, positions, buying power, options-chain data, and order submission require a supported brokerage connection.
            </p>
          </div>

          {isCurrent ? (
            <Button variant="outline" disabled data-testid="button-current">
              Your current plan
            </Button>
          ) : (
            <div className="flex flex-col gap-2">
              <Button
                size="lg"
                onClick={() => checkout.mutate()}
                disabled={checkout.isPending}
                data-testid="button-start-trial"
              >
                {checkout.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-1" />
                )}
                Start Free Trial
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                No broker connection required to explore analysis.
              </p>
              <Button
                size="lg"
                variant="outline"
                onClick={() => navigate("/home")}
                data-testid="button-explore-analysis"
              >
                Explore Market Analysis
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-3xl mx-auto space-y-3 text-xs text-muted-foreground text-center">
        <p>
          VCP Trader AI does not provide a separate live market data feed. Live data availability depends on your connected brokerage account, broker entitlements, and market data permissions.
        </p>
        <p>
          VCP Trader AI is a software tool for analysis and education. It is not a broker-dealer or investment adviser and does not provide personalized investment advice. You always confirm orders before they're sent.
        </p>
        <p data-testid="text-trademark-notice">{instaTradeFooterNotice}</p>
      </div>
    </div>
  );
}
