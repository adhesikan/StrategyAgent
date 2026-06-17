import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ShieldCheck,
  Pause,
  Play,
  X,
  Loader2,
  TrendingDown,
  Target,
  DollarSign,
  Pencil,
  History,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { HelpLink } from "@/components/help-link";
import type { PositionProtectionPlan, PositionProtectionEvent } from "@shared/schema";

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

function EventLog({ planId }: { planId: string }) {
  const { data: events = [], isLoading } = useQuery<PositionProtectionEvent[]>({
    queryKey: ["/api/position-protection/plans", planId, "events"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/position-protection/plans/${planId}/events`);
      return res.json();
    },
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-2 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading activity…
      </div>
    );
  }
  if (events.length === 0) {
    return <p className="py-2 text-[11px] text-muted-foreground">No activity yet.</p>;
  }
  return (
    <ul className="space-y-1 py-1" data-testid={`event-log-${planId}`}>
      {events.map((ev) => (
        <li key={ev.id} className="flex items-start gap-2 text-[11px]">
          <Badge variant="outline" className="text-[9px] capitalize shrink-0">
            {ev.eventType.replace(/_/g, " ")}
          </Badge>
          <span className="text-muted-foreground">{ev.message}</span>
          {ev.createdAt && (
            <span className="ml-auto shrink-0 text-muted-foreground/70 tabular-nums">
              {new Date(ev.createdAt).toLocaleString()}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

interface EditState {
  stopValue: string;
  targetValue: string;
  trailValue: string;
}

export function PositionProtectionPanel() {
  const { toast } = useToast();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({ stopValue: "", targetValue: "", trailValue: "" });

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

  const editMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Record<string, any> }) => {
      const res = await apiRequest("PATCH", `/api/position-protection/plans/${id}`, body);
      return res.json();
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/position-protection/plans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/position-protection/plans", vars.id, "events"] });
      setEditId(null);
      toast({ title: "Protection updated", description: "Your exit rules were saved." });
    },
    onError: (err: any) => {
      toast({ title: "Update failed", description: err?.message || "Please try again.", variant: "destructive" });
    },
  });

  const startEdit = (plan: PositionProtectionPlan) => {
    setEditId(plan.id);
    setEditState({
      stopValue: plan.stopValue != null ? String(plan.stopValue) : "",
      targetValue: plan.targetValue != null ? String(plan.targetValue) : "",
      trailValue: plan.trailValue != null ? String(plan.trailValue) : "",
    });
  };

  const saveEdit = (plan: PositionProtectionPlan) => {
    const body: Record<string, any> = {};
    if (plan.stopEnabled) {
      const v = parseFloat(editState.stopValue);
      if (!isNaN(v) && v > 0) body.stopValue = v;
    }
    if (plan.targetEnabled) {
      const v = parseFloat(editState.targetValue);
      if (!isNaN(v) && v > 0) body.targetValue = v;
    }
    if (plan.trailEnabled) {
      const v = parseFloat(editState.trailValue);
      if (!isNaN(v) && v > 0) body.trailValue = v;
    }
    if (Object.keys(body).length === 0) {
      setEditId(null);
      return;
    }
    editMutation.mutate({ id: plan.id, body });
  };

  const visible = plans.filter((p) => ["active", "paused", "triggered", "error"].includes(p.status));
  const recentlyExited = plans
    .filter((p) => p.status === "exited" && p.exitedAt)
    .sort((a, b) => new Date(b.exitedAt!).getTime() - new Date(a.exitedAt!).getTime())
    .slice(0, 5);

  if (!isLoading && visible.length === 0 && recentlyExited.length === 0) return null;

  return (
    <Card data-testid="section-position-protection">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          Position Protection
          <HelpLink section="position-protection" />
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
            {visible.map((plan) => {
              const isEditing = editId === plan.id;
              const isExpanded = expandedId === plan.id;
              const editable = plan.status === "active" || plan.status === "paused";
              return (
                <div
                  key={plan.id}
                  className="rounded-md border p-3"
                  data-testid={`row-protection-${plan.symbol}`}
                >
                  <div className="flex items-start justify-between gap-3">
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
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                        {plan.lastPrice != null && <span>Last ${plan.lastPrice.toFixed(2)}</span>}
                        {plan.trailEnabled && plan.trailStopPrice != null && (
                          <span data-testid={`text-trailstop-${plan.symbol}`}>
                            Trail stop ${plan.trailStopPrice.toFixed(2)}
                          </span>
                        )}
                        {plan.highWaterMark != null && <span>High ${plan.highWaterMark.toFixed(2)}</span>}
                        {plan.lastCheckedAt && (
                          <span data-testid={`text-lastchecked-${plan.symbol}`}>
                            Checked {new Date(plan.lastCheckedAt).toLocaleTimeString()}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground/80">
                        Exit as {plan.exitOrderType === "stop_limit" ? "stop-limit" : plan.exitOrderType} order
                      </p>
                    </div>
                    {editable && (
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1"
                          disabled={editMutation.isPending}
                          onClick={() => (isEditing ? setEditId(null) : startEdit(plan))}
                          data-testid={`button-edit-protection-${plan.symbol}`}
                        >
                          <Pencil className="h-3 w-3" /> {isEditing ? "Close" : "Edit"}
                        </Button>
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

                  {isEditing && editable && (
                    <div className="mt-3 grid gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-3" data-testid={`edit-protection-${plan.symbol}`}>
                      {plan.stopEnabled && (
                        <div className="space-y-1">
                          <Label className="text-[11px]">Stop ({plan.stopMode})</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={editState.stopValue}
                            onChange={(e) => setEditState((s) => ({ ...s, stopValue: e.target.value }))}
                            className="h-8"
                            data-testid={`input-edit-stop-${plan.symbol}`}
                          />
                        </div>
                      )}
                      {plan.targetEnabled && (
                        <div className="space-y-1">
                          <Label className="text-[11px]">Target ({plan.targetMode})</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={editState.targetValue}
                            onChange={(e) => setEditState((s) => ({ ...s, targetValue: e.target.value }))}
                            className="h-8"
                            data-testid={`input-edit-target-${plan.symbol}`}
                          />
                        </div>
                      )}
                      {plan.trailEnabled && (
                        <div className="space-y-1">
                          <Label className="text-[11px]">Trail ({plan.trailMode})</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={editState.trailValue}
                            onChange={(e) => setEditState((s) => ({ ...s, trailValue: e.target.value }))}
                            className="h-8"
                            data-testid={`input-edit-trail-${plan.symbol}`}
                          />
                        </div>
                      )}
                      <div className="sm:col-span-3 flex justify-end">
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          disabled={editMutation.isPending}
                          onClick={() => saveEdit(plan)}
                          data-testid={`button-save-protection-${plan.symbol}`}
                        >
                          {editMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save changes"}
                        </Button>
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setExpandedId(isExpanded ? null : plan.id)}
                    data-testid={`button-toggle-events-${plan.symbol}`}
                  >
                    <History className="h-3 w-3" />
                    Activity log
                    {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                  {isExpanded && (
                    <div className="mt-1 border-t pt-1">
                      <EventLog planId={plan.id} />
                    </div>
                  )}
                </div>
              );
            })}

            {recentlyExited.length > 0 && (
              <div className="pt-2 mt-2 border-t space-y-1.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Recently exited
                </p>
                {recentlyExited.map((plan) => (
                  <div
                    key={plan.id}
                    className="flex items-center justify-between gap-3 rounded-md bg-muted/20 px-3 py-2 text-xs"
                    data-testid={`row-exited-protection-${plan.symbol}`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <span className="font-mono font-semibold">{plan.symbol}</span>
                      {plan.triggerReason && (
                        <Badge variant="outline" className="text-[10px] capitalize">
                          {plan.triggerReason === "trail" ? "trailing stop" : plan.triggerReason} hit
                        </Badge>
                      )}
                      {plan.accountMode === "paper" && (
                        <Badge variant="outline" className="text-[10px]">Paper</Badge>
                      )}
                    </div>
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                      {plan.exitPrice != null ? `$${plan.exitPrice.toFixed(2)}` : "—"}
                      {plan.exitedAt ? ` · ${new Date(plan.exitedAt).toLocaleDateString()}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
