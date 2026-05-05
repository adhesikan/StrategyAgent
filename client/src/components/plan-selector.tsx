import { useState } from "react";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Check, Sparkles } from "lucide-react";
import { usePersona } from "@/context/PersonaContext";
import { PLANS, PERSONA_RECOMMENDED_PLAN, type PlanId } from "@shared/plans";

interface PlanSelectorProps {
  open: boolean;
  onComplete: () => void;
}

const HIGHLIGHTS: Record<PlanId, string[]> = {
  free: ["5 AI analyses / day", "Educational paper trading", "Delayed market data", "No broker connection"],
  pro: ["50 AI analyses / day", "Live market data", "1 broker connection", "Smart alerts + scanner"],
  edge: ["Unlimited analyses", "Up to 5 brokers", "Automation + options flow", "Multi-leg + journal"],
  team: ["Everything in Active Trader", "5 team seats", "Team sharing & partner signals", "Priority support"],
};

export function PlanSelector({ open, onComplete }: PlanSelectorProps) {
  const { persona } = usePersona();
  const [, setLocation] = useLocation();
  const [annual, setAnnual] = useState(false);
  const recommended: PlanId = persona ? PERSONA_RECOMMENDED_PLAN[persona] : "pro";

  const handlePick = (planId: PlanId) => {
    try {
      localStorage.setItem("plan_selector_seen", "1");
    } catch {}
    if (planId === "free") {
      onComplete();
      return;
    }
    onComplete();
    setLocation(`/pricing?plan=${planId}&cycle=${annual ? "annual" : "monthly"}`);
  };

  const handleSkip = () => {
    try {
      localStorage.setItem("plan_selector_seen", "1");
    } catch {}
    onComplete();
  };

  const planEntries: PlanId[] = ["free", "pro", "edge", "team"];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleSkip(); }}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-plan-modal-title">Pick a plan that fits</DialogTitle>
          <DialogDescription>
            Start free and upgrade anytime. Based on your trading style, we recommend the{" "}
            <span className="font-semibold text-foreground">{PLANS[recommended].name}</span> plan.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-center gap-2 my-2">
          <span className={`text-sm ${annual ? "text-muted-foreground" : "font-medium"}`}>Monthly</span>
          <Switch checked={annual} onCheckedChange={setAnnual} data-testid="switch-billing-cycle" />
          <span className={`text-sm ${annual ? "font-medium" : "text-muted-foreground"}`}>
            Annual <Badge variant="secondary" className="ml-1 text-[10px]">Save 20%</Badge>
          </span>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          {planEntries.map((id) => {
            const plan = PLANS[id];
            const price = annual ? plan.priceAnnual : plan.price;
            const isRecommended = id === recommended;
            return (
              <Card
                key={id}
                className={`p-4 flex flex-col gap-2 ${isRecommended ? "border-primary ring-2 ring-primary" : ""}`}
                data-testid={`card-plan-${id}`}
              >
                {isRecommended && (
                  <Badge className="self-start gap-1">
                    <Sparkles className="h-3 w-3" />
                    Recommended
                  </Badge>
                )}
                <div>
                  <h3 className="font-semibold" data-testid={`text-plan-name-${id}`}>{plan.name}</h3>
                  <div className="mt-1">
                    {price === 0 ? (
                      <span className="text-2xl font-bold">Free</span>
                    ) : (
                      <>
                        <span className="text-2xl font-bold">${price}</span>
                        <span className="text-xs text-muted-foreground">/{annual ? "yr" : "mo"}</span>
                      </>
                    )}
                  </div>
                </div>
                <ul className="space-y-1 text-xs text-muted-foreground flex-1">
                  {HIGHLIGHTS[id].map((h) => (
                    <li key={h} className="flex items-start gap-1.5">
                      <Check className="h-3 w-3 mt-0.5 shrink-0 text-primary" />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  variant={isRecommended ? "default" : "outline"}
                  size="sm"
                  onClick={() => handlePick(id)}
                  data-testid={`button-pick-plan-${id}`}
                >
                  {id === "free" ? "Start free" : "Choose plan"}
                </Button>
              </Card>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={handleSkip} data-testid="button-skip-plan-selector">
            Decide later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
