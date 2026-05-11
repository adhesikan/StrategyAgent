import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Check, Sparkles, Loader2, ArrowLeft } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { usePlan } from "@/context/PlanContext";
import { usePersona } from "@/context/PersonaContext";
import { PLANS, PERSONA_RECOMMENDED_PLAN, type PlanId } from "@shared/plans";

const DISPLAY_NAME: Partial<Record<PlanId, string>> = {
  pro: "Pro",
  edge: "Elite",
};

const DISPLAY_PRICE_MONTHLY: Partial<Record<PlanId, number>> = {
  pro: 79,
  edge: 149,
};

const DISPLAY_PRICE_ANNUAL: Partial<Record<PlanId, number>> = {
  pro: 758,
  edge: 1430,
};

const DISPLAY_TAGLINE: Partial<Record<PlanId, string>> = {
  pro: "Daily AI stock and options ideas, plus broker-connected order preparation.",
  edge: "For active stock and options traders who want every edge.",
};

const HIGHLIGHTS: Partial<Record<PlanId, string[]>> = {
  pro: [
    "Daily AI stock ideas",
    "Daily AI options ideas",
    "Grow, Income, Trade, and Markets modes",
    "News sentiment and market context",
    "Watchlist intelligence",
    "Paper/simulated trading",
    "Basic Opportunity Radar",
    "Broker connection support",
    "InstaTrade™ order preparation",
    "Live market data through connected brokerage account",
  ],
  edge: [
    "Everything in Pro",
    "Advanced Opportunity Radar",
    "Advanced options analytics",
    "Advanced filters",
    "Scenario scoring breakdowns",
    "Portfolio and position context from connected broker",
    "Journal analytics",
    "AI trade review insights",
    "Multi-broker support, where available",
    "Priority scans",
  ],
};

const ORDER: PlanId[] = ["pro", "edge"];

export default function PricingPage() {
  const [, navigate] = useLocation();
  const { plan: currentPlan } = usePlan();
  const { persona } = usePersona();
  const { toast } = useToast();

  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const initialPlan = params.get("plan") as PlanId | null;
  const initialCycle = params.get("cycle");

  const [annual, setAnnual] = useState(initialCycle === "annual");
  const recommendedRaw: PlanId = persona ? PERSONA_RECOMMENDED_PLAN[persona] : "pro";
  const recommended: PlanId = ORDER.includes(recommendedRaw) ? recommendedRaw : "pro";

  useEffect(() => {
    document.title = "Pricing — VCP Trader AI";
  }, []);

  const checkout = useMutation({
    mutationFn: async (vars: { planId: PlanId; cycle: "monthly" | "annual" }) => {
      const res = await apiRequest("POST", "/api/billing/checkout", vars);
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

  // Auto-trigger checkout if URL has ?plan=...&cycle=... and user lands here from PlanSelector
  useEffect(() => {
    if (initialPlan && initialPlan !== "free" && ORDER.includes(initialPlan) && !checkout.isPending && !checkout.isSuccess) {
      // Don't auto-fire — let user click the highlighted CTA so they can review.
    }
  }, [initialPlan, checkout.isPending, checkout.isSuccess]);

  return (
    <div className="flex-1 p-4 md:p-8 max-w-7xl mx-auto w-full space-y-8">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => navigate("/home")} data-testid="button-back-home">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to Home
        </Button>
        {currentPlan !== "free" && (
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
          Start in paper/simulated mode. Connect your brokerage for live market data and self-directed InstaTrade™ order submission. 14-day free trial. Cancel anytime.
        </p>

        <div className="flex items-center justify-center gap-3 pt-2">
          <span className={annual ? "text-muted-foreground" : "font-medium"}>Monthly</span>
          <Switch checked={annual} onCheckedChange={setAnnual} data-testid="switch-billing-cycle" />
          <span className={annual ? "font-medium" : "text-muted-foreground"}>
            Annual <Badge variant="secondary" className="ml-1 text-[10px]">Save ~20%</Badge>
          </span>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 max-w-4xl mx-auto">
        {ORDER.map((id) => {
          const isCurrent = id === currentPlan;
          const isRecommended = id === recommended && id !== currentPlan;
          const isHighlighted = id === initialPlan || isRecommended;
          const monthly = DISPLAY_PRICE_MONTHLY[id] ?? 0;
          const annualPrice = DISPLAY_PRICE_ANNUAL[id] ?? 0;
          const price = annual ? annualPrice : monthly;
          const cycleLabel = annual ? "/yr" : "/mo";
          const displayName = DISPLAY_NAME[id] ?? PLANS[id].name;
          const tagline = DISPLAY_TAGLINE[id];
          const highlights = HIGHLIGHTS[id] ?? [];

          return (
            <div
              key={id}
              className={`relative rounded-xl border p-6 flex flex-col gap-4 bg-card/40 backdrop-blur ${
                isHighlighted ? "border-primary ring-2 ring-primary/40 shadow-lg" : "border-border"
              }`}
              data-testid={`card-plan-${id}`}
            >
              {isRecommended && (
                <Badge className="absolute -top-2.5 left-4">
                  <Sparkles className="h-3 w-3 mr-1" /> Recommended
                </Badge>
              )}
              {isCurrent && (
                <Badge variant="secondary" className="absolute -top-2.5 right-4">
                  Current plan
                </Badge>
              )}

              <div>
                <h3 className="font-bold text-2xl" data-testid={`text-plan-name-${id}`}>{displayName}</h3>
                {tagline && (
                  <p className="text-sm text-muted-foreground mt-1">{tagline}</p>
                )}
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-4xl font-bold">${price}</span>
                  <span className="text-sm text-muted-foreground">{cycleLabel}</span>
                </div>
                {annual && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    ${(annualPrice / 12).toFixed(0)}/mo billed annually
                  </p>
                )}
              </div>

              <ul className="space-y-2 text-sm flex-1">
                {highlights.map((h) => (
                  <li key={h} className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>

              {isCurrent ? (
                <Button variant="outline" disabled data-testid={`button-current-${id}`}>
                  Your current plan
                </Button>
              ) : (
                <Button
                  variant={isHighlighted ? "default" : "outline"}
                  onClick={() => checkout.mutate({ planId: id, cycle: annual ? "annual" : "monthly" })}
                  disabled={checkout.isPending}
                  data-testid={`button-choose-${id}`}
                >
                  {checkout.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-1" />
                  )}
                  Start 14-day trial
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <div className="max-w-3xl mx-auto space-y-3 text-xs text-muted-foreground text-center">
        <p>
          VCP Trader AI does not include a separate live market data feed. Live quotes, option chains, account balances, positions, and order submission are available through supported brokerage connections and the user's brokerage entitlements.
        </p>
        <p>
          All plans are software tools for analysis and education. VCP Trader AI is not a broker-dealer or investment adviser and does not provide personalized investment advice. You always confirm orders before they're sent.
        </p>
      </div>
    </div>
  );
}
