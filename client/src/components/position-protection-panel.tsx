import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Pause, Play, X, Loader2, TrendingDown, Target, DollarSign } from "lucide-react";
import type { PositionProtectionPlan } from "@shared/schema";

const STATUS_STYLE: Record<string, string> = {
  active: "border-emerald-500/40 text-emerald-400 bg-emerald-500/5",
  paused: "border-amber-500/40 text-amber-400 bg-amber-500/5",
  triggered: "border-blue-500/40 text-blue-400 bg-blue-500/5",
  exited: "border-muted-foreground/40 text-muted-foreground bg-muted/20",
  cancelled: "border-muted-foreground/40 text-muted-foreground bg-muted/20",
  error: "border-red-500/40 text-red-400 bg-red-500/5",
};

function ruleSummary(plan: PositionProtectionPlan): string[] {
  const parts: string[] = [];
  if (plan.stopEnabled && plan.stopPrice != null) parts.push(`Stop $${plan.stopPrice.toFixed(2)}`);
  if (plan.targetEnabled && plan.targetPrice != null) parts.push(`Target $${plan.targetPrice.toFixed(2)}`);
  if (plan.trailEnabled) {
    const t = plan.trailMode === "dollar" ? `$${plan.trailValue}` : `${plan.trailValue}%`;
    parts.push(`Trail ${t}${plan.trailStopPrice != null ? ` → $${plan.trailStopPrice.toFixed(2)}` : ""}`);
  }
  return parts;
}

export function PositionProtectionPanel() {
  const { toast } = useToast();

  const { data: plans = [], isLoading } = useQuery<PositionProtectionPlan[]>({
    queryKey: ["/api/position-protection/plans"],
    refetchInterval: 30000,
  });

  const action = useMutation({
    mutationFn: async ({ id, op }: { id: string; op: "pause" | "resume" | "cancel" }) => {
      const res = await apiRequest("POST", `/api/position-protection/plans/${id}/${op}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/position-protection/plans"] });
    },
    onError: (err: any) => {
      toast({ title: "Action failed", description: err?.message || "Please try again.", variant: "destructive" });
    },
  });

  const visible = plans.filter((p) => ["active", "paused", "triggered", "error"].includes(p.status));

  if (!isLoading && visible.length === 0) return null;

  return (
    <Card data-testid="section-position-protection">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          Position Protection
        </CardTitle>
        <CardDescription>
          We monitor these positions during market hours and submit your exit order when a rule triggers.
          Software-generated order routing — fills aren't guaranteed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map((plan) => (
              <div
                key={plan.id}
                className="flex items-start justify-between gap-3 rounded-md border p-3"
                data-testid={`row-protection-${plan.symbol}`}
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold">{plan.symbol}</span>
                    <span className="text-xs text-muted-foreground">
                      {plan.quantity} {plan.positionSide}
                    </span>
                    <Badge variant="outline" className={`text-[10px] capitalize ${STATUS_STYLE[plan.status] || ""}`}>
                      {plan.status}
                    </Badge>
                    {plan.accountMode === "paper" && (
                      <Badge variant="outline" className="text-[10px]">Paper</Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {ruleSummary(plan).map((r, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground rounded bg-muted/40 px-1.5 py-0.5"
                      >
                        {r.startsWith("Stop") ? <DollarSign className="h-3 w-3" /> : r.startsWith("Target") ? <Target className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        {r}
                      </span>
                    ))}
                  </div>
                  {plan.lastPrice != null && (
                    <p className="text-[11px] text-muted-foreground">Last seen ${plan.lastPrice.toFixed(2)}</p>
                  )}
                </div>
                {(plan.status === "active" || plan.status === "paused") && (
                  <div className="flex items-center gap-1 shrink-0">
                    {plan.status === "active" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        disabled={action.isPending}
                        onClick={() => action.mutate({ id: plan.id, op: "pause" })}
                        data-testid={`button-pause-protection-${plan.symbol}`}
                      >
                        <Pause className="h-3 w-3" /> Pause
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        disabled={action.isPending}
                        onClick={() => action.mutate({ id: plan.id, op: "resume" })}
                        data-testid={`button-resume-protection-${plan.symbol}`}
                      >
                        <Play className="h-3 w-3" /> Resume
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs gap-1 text-destructive"
                      disabled={action.isPending}
                      onClick={() => action.mutate({ id: plan.id, op: "cancel" })}
                      data-testid={`button-cancel-protection-${plan.symbol}`}
                    >
                      <X className="h-3 w-3" /> Cancel
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
