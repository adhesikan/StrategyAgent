import { useEffect } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Sparkles, Loader2, ArrowLeft, ArrowRight } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { usePlan } from "@/context/PlanContext";

const PLAN_FEATURES: string[] = [
  "Daily AI stock ideas",
  "Daily AI options ideas",
  "Grow, Income, Trade, and Markets modes",
  "Opportunity Radar / Top Opportunities",
  "News sentiment and market context",
  "Watchlist intelligence",
  "Paper/simulated trading during trial",
  "Broker connection support",
  "Tradier and TradeStation support",
  "Live market data through connected brokerage account",
  "Options chains through connected brokerage account where supported",
  "InstaTrade™ order review and submission",
  "Journal and results tracking",
  "Built-in risk controls",
  "Paper-to-live workflow",
];

export default function PricingPage() {
  const [, navigate] = useLocation();
  const { plan: currentPlan } = usePlan();
  const { toast } = useToast();
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
          Start in paper mode during your trial. Connect Tradier, TradeStation, or another supported brokerage for live market data, account context, and self-directed InstaTrade™ order submission.
        </p>
      </div>

      <div className="max-w-xl mx-auto">
        <div
          className="relative rounded-2xl border-2 border-primary bg-card/40 backdrop-blur p-6 md:p-8 flex flex-col gap-5 shadow-xl"
          data-testid="card-plan-pro"
        >
          <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">
            <Sparkles className="h-3 w-3 mr-1" /> 14-Day Free Trial
          </Badge>

          <div className="text-center pt-2">
            <h3 className="font-bold text-2xl" data-testid="text-plan-name">VCP Trader AI Pro</h3>
            <div className="mt-3 flex items-baseline justify-center gap-1">
              <span className="text-5xl font-bold">$99</span>
              <span className="text-sm text-muted-foreground">/month</span>
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              One simple plan. Everything you need to research, review, and submit self-directed stock and options orders.
            </p>
          </div>

          <ul className="space-y-2 text-sm">
            {PLAN_FEATURES.map((h) => (
              <li key={h} className="flex items-start gap-2">
                <Check className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                <span>{h}</span>
              </li>
            ))}
          </ul>

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
                Start 14-Day Trial
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => navigate("/home")}
                data-testid="button-explore-paper"
              >
                Explore in Paper Mode
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
      </div>
    </div>
  );
}
