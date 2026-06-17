import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShieldCheck } from "lucide-react";
import type { PositionProtectionPlan } from "@shared/schema";

const STATUS_STYLE: Record<string, string> = {
  active: "border-emerald-500/40 text-emerald-400 bg-emerald-500/5",
  paused: "border-amber-500/40 text-amber-400 bg-amber-500/5",
  triggered: "border-blue-500/40 text-blue-400 bg-blue-500/5",
  exited: "border-muted-foreground/40 text-muted-foreground bg-muted/20",
  cancelled: "border-muted-foreground/40 text-muted-foreground bg-muted/20",
  error: "border-red-500/40 text-red-400 bg-red-500/5",
};

const STATUS_FILTERS = ["all", "active", "paused", "triggered", "exited", "cancelled", "error"];

export default function AdminPositionProtectionPage() {
  const [status, setStatus] = useState("all");

  const { data: plans = [], isLoading } = useQuery<PositionProtectionPlan[]>({
    queryKey: ["/api/admin/position-protection/plans", status],
    queryFn: async () => {
      const url =
        status === "all"
          ? "/api/admin/position-protection/plans"
          : `/api/admin/position-protection/plans?status=${status}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load plans");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const counts = plans.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="container mx-auto py-6 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-admin-protection-title">
          <ShieldCheck className="h-6 w-6 text-primary" />
          Position Protection Monitor
        </h1>
        <p className="text-sm text-muted-foreground">
          All user-defined exit plans across accounts. App-managed monitoring; exits are submitted as standard orders.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {Object.entries(counts).map(([s, n]) => (
          <Badge key={s} variant="outline" className={`text-xs capitalize ${STATUS_STYLE[s] || ""}`}>
            {s}: {n}
          </Badge>
        ))}
        <div className="ml-auto">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40" data-testid="select-admin-protection-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((s) => (
                <SelectItem key={s} value={s} className="capitalize">
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Plans</CardTitle>
          <CardDescription>{plans.length} plan(s)</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : plans.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center" data-testid="text-no-admin-plans">
              No plans for this filter.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Side / Qty</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Rules</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Last Price</TableHead>
                    <TableHead>Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plans.map((p) => (
                    <TableRow key={p.id} data-testid={`row-admin-protection-${p.id}`}>
                      <TableCell className="font-mono font-bold">{p.symbol}</TableCell>
                      <TableCell className="text-xs">
                        {p.positionSide} · {p.quantity}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] capitalize">
                          {p.accountMode}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {[
                          p.stopEnabled && p.stopPrice != null ? `Stop $${p.stopPrice.toFixed(2)}` : null,
                          p.targetEnabled && p.targetPrice != null ? `Tgt $${p.targetPrice.toFixed(2)}` : null,
                          p.trailEnabled ? `Trail ${p.trailValue}${p.trailMode === "dollar" ? "$" : "%"}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] capitalize ${STATUS_STYLE[p.status] || ""}`}>
                          {p.status}
                        </Badge>
                        {p.triggerReason && (
                          <span className="ml-1 text-[10px] text-muted-foreground">({p.triggerReason})</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {p.lastPrice != null ? `$${p.lastPrice.toFixed(2)}` : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {p.updatedAt ? new Date(p.updatedAt).toLocaleString() : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
