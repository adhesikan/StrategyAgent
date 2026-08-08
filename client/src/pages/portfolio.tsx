import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Plus, Upload, Link2, Trash2, Pencil, Check, X,
  TrendingUp, TrendingDown, Package, RefreshCw, ChevronRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Portfolio {
  id:              string;
  userId:          string;
  name:            string;
  sourceType:      "manual" | "csv" | "xlsx" | "broker";
  sourceAccountId: string | null;
  createdAt:       string;
  updatedAt:       string;
}

interface EnrichedPosition {
  id:            string;
  portfolioId:   string;
  symbol:        string;
  quantity:      string;
  averageCost:   string | null;
  costBasis:     string | null;
  currency:      string;
  sourceType:    string;
  importedAt:    string;
  updatedAt:     string;
  currentPrice:  number | null;
  marketValue:   number | null;
  gainLoss:      number | null;
}

interface PositionsResponse {
  portfolio: Portfolio;
  positions: EnrichedPosition[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtCurrency(v: number | null | undefined): string {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
}

function fmtNumber(v: string | number | null | undefined): string {
  if (v == null) return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (!isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function sourceLabel(t: string): string {
  const map: Record<string, string> = {
    manual: "Manual",
    csv:    "Spreadsheet",
    xlsx:   "Spreadsheet",
    broker: "Broker",
  };
  return map[t] ?? t;
}

function sourceBadgeVariant(t: string): "default" | "secondary" | "outline" {
  if (t === "broker") return "default";
  if (t === "manual") return "secondary";
  return "outline";
}

// ---------------------------------------------------------------------------
// Onboarding state
// ---------------------------------------------------------------------------

function PortfolioOnboarding() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("My Portfolio");

  const createManual = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/portfolio", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name: name.trim() || "My Portfolio", sourceType: "manual" }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Failed to create portfolio");
      return r.json() as Promise<Portfolio>;
    },
    onSuccess: (portfolio) => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
      toast({ title: "Portfolio created" });
      setCreating(false);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="max-w-lg mx-auto mt-16 space-y-6 text-center px-4">
      <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
        <Package className="h-6 w-6 text-primary" />
      </div>
      <div>
        <h1 className="text-2xl font-bold">Add your portfolio</h1>
        <p className="text-muted-foreground mt-2">
          Track holdings from any source — no broker connection required.
        </p>
      </div>
      <div className="grid gap-3">
        <Button
          variant="default"
          className="w-full h-14 text-base"
          onClick={() => setCreating(true)}
        >
          <Plus className="h-4 w-4 mr-2" />
          Enter Manually
        </Button>
        <Button
          variant="outline"
          className="w-full h-14 text-base"
          onClick={() => setLocation("/portfolio/import")}
        >
          <Upload className="h-4 w-4 mr-2" />
          Upload Spreadsheet (CSV or XLSX)
        </Button>
        <Button
          variant="ghost"
          className="w-full h-14 text-base text-muted-foreground"
          onClick={() => setLocation("/settings?tab=broker")}
        >
          <Link2 className="h-4 w-4 mr-2" />
          Connect Broker
        </Button>
      </div>

      {creating && (
        <Dialog open onOpenChange={() => setCreating(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Portfolio</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <Label htmlFor="pname">Portfolio name</Label>
              <Input
                id="pname"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="My Portfolio"
                onKeyDown={e => e.key === "Enter" && createManual.mutate()}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
              <Button onClick={() => createManual.mutate()} disabled={createManual.isPending}>
                {createManual.isPending ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add / edit position dialog
// ---------------------------------------------------------------------------

function AddPositionDialog({
  portfolioId,
  editingPosition,
  onClose,
}: {
  portfolioId:      string;
  editingPosition?: EnrichedPosition;
  onClose:          () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isEditing = !!editingPosition;

  const [symbol,      setSymbol]      = useState(editingPosition?.symbol ?? "");
  const [quantity,    setQuantity]    = useState(editingPosition ? fmtNumber(editingPosition.quantity) : "");
  const [averageCost, setAverageCost] = useState(editingPosition?.averageCost ?? "");

  const save = useMutation({
    mutationFn: async () => {
      const url = isEditing
        ? `/api/portfolio/${portfolioId}/positions/${editingPosition!.id}`
        : `/api/portfolio/${portfolioId}/positions`;
      const body = isEditing
        ? { quantity: parseFloat(quantity), averageCost: averageCost ? parseFloat(averageCost) : null }
        : { symbol: symbol.trim().toUpperCase(), quantity: parseFloat(quantity), averageCost: averageCost ? parseFloat(averageCost) : undefined };
      const r = await fetch(url, {
        method:  isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Failed");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/portfolio/${portfolioId}/positions`] });
      toast({ title: isEditing ? "Position updated" : "Position added" });
      onClose();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Position" : "Add Position"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {!isEditing && (
            <div className="space-y-1">
              <Label htmlFor="sym">Ticker</Label>
              <Input
                id="sym"
                value={symbol}
                onChange={e => setSymbol(e.target.value.toUpperCase())}
                placeholder="AAPL"
                className="uppercase"
                maxLength={10}
              />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="qty">Quantity</Label>
            <Input
              id="qty"
              type="number"
              min="0"
              step="any"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              placeholder="100"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="avgcost">
              Average Cost <span className="text-muted-foreground text-xs">(optional)</span>
            </Label>
            <Input
              id="avgcost"
              type="number"
              min="0"
              step="any"
              value={averageCost}
              onChange={e => setAverageCost(e.target.value)}
              placeholder="150.00"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : isEditing ? "Save Changes" : "Add Position"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Holdings table
// ---------------------------------------------------------------------------

function HoldingsTable({
  portfolioId,
  positions,
  onEdit,
  onDelete,
}: {
  portfolioId: string;
  positions:   EnrichedPosition[];
  onEdit:      (p: EnrichedPosition) => void;
  onDelete:    (p: EnrichedPosition) => void;
}) {
  if (positions.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Package className="h-8 w-8 mx-auto mb-2 opacity-40" />
        <p>No positions yet. Add one above.</p>
      </div>
    );
  }

  const totalMV = positions.reduce((s, p) => s + (p.marketValue ?? 0), 0);
  const totalGL = positions.reduce((s, p) => s + (p.gainLoss ?? 0), 0);
  const totalCB = positions.reduce((s, p) => s + (p.costBasis != null ? Number(p.costBasis) : 0), 0);

  return (
    <div>
      {/* Summary bar */}
      <div className="flex flex-wrap gap-4 mb-4 px-1">
        <div>
          <p className="text-xs text-muted-foreground">Positions</p>
          <p className="font-semibold">{positions.length}</p>
        </div>
        {totalMV > 0 && (
          <div>
            <p className="text-xs text-muted-foreground">Market Value</p>
            <p className="font-semibold">{fmtCurrency(totalMV)}</p>
          </div>
        )}
        {totalCB > 0 && (
          <div>
            <p className="text-xs text-muted-foreground">Cost Basis</p>
            <p className="font-semibold">{fmtCurrency(totalCB)}</p>
          </div>
        )}
        {totalCB > 0 && (
          <div>
            <p className="text-xs text-muted-foreground">Unrealized G/L</p>
            <p className={`font-semibold ${totalGL >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
              {totalGL >= 0 ? "+" : ""}{fmtCurrency(totalGL)}
            </p>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30 text-muted-foreground">
              <th className="text-left px-3 py-2 font-medium">Symbol</th>
              <th className="text-right px-3 py-2 font-medium">Quantity</th>
              <th className="text-right px-3 py-2 font-medium">Avg Cost</th>
              <th className="text-right px-3 py-2 font-medium">Price</th>
              <th className="text-right px-3 py-2 font-medium">Market Value</th>
              <th className="text-right px-3 py-2 font-medium">G/L</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {positions.map(p => {
              const gl = p.gainLoss;
              return (
                <tr key={p.id} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium">{p.symbol}</td>
                  <td className="px-3 py-2 text-right">{fmtNumber(p.quantity)}</td>
                  <td className="px-3 py-2 text-right">{fmtCurrency(p.averageCost != null ? parseFloat(p.averageCost) : null)}</td>
                  <td className="px-3 py-2 text-right">{fmtCurrency(p.currentPrice)}</td>
                  <td className="px-3 py-2 text-right">{fmtCurrency(p.marketValue)}</td>
                  <td className={`px-3 py-2 text-right ${gl != null && gl >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                    {gl != null ? `${gl >= 0 ? "+" : ""}${fmtCurrency(gl)}` : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1 justify-end">
                      <button
                        onClick={() => onEdit(p)}
                        className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                        aria-label="Edit position"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => onDelete(p)}
                        className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500"
                        aria-label="Delete position"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Portfolio detail view
// ---------------------------------------------------------------------------

function PortfolioDetail({ portfolio }: { portfolio: Portfolio }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [addingPos, setAddingPos] = useState(false);
  const [editingPos, setEditingPos] = useState<EnrichedPosition | undefined>();
  const [deletingPos, setDeletingPos] = useState<EnrichedPosition | undefined>();
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(portfolio.name);

  const { data, isLoading } = useQuery<PositionsResponse>({
    queryKey: [`/api/portfolio/${portfolio.id}/positions`],
    refetchInterval: 5 * 60 * 1000,
  });

  const deletePosition = useMutation({
    mutationFn: async (pos: EnrichedPosition) => {
      const r = await fetch(`/api/portfolio/${portfolio.id}/positions/${pos.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json()).error ?? "Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/portfolio/${portfolio.id}/positions`] });
      toast({ title: "Position removed" });
      setDeletingPos(undefined);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const saveName = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/portfolio/${portfolio.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name: nameValue.trim() }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
      setEditingName(false);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deletePortfolio = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/portfolio/${portfolio.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json()).error ?? "Failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
      toast({ title: "Portfolio deleted" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex-1 min-w-0">
          {editingName ? (
            <div className="flex items-center gap-2">
              <Input
                value={nameValue}
                onChange={e => setNameValue(e.target.value)}
                className="h-8 text-base font-semibold"
                onKeyDown={e => e.key === "Enter" && saveName.mutate()}
                autoFocus
              />
              <button onClick={() => saveName.mutate()} disabled={saveName.isPending} className="p-1 hover:text-primary">
                <Check className="h-4 w-4" />
              </button>
              <button onClick={() => { setEditingName(false); setNameValue(portfolio.name); }} className="p-1 hover:text-destructive">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold truncate">{portfolio.name}</h2>
              <button onClick={() => setEditingName(true)} className="p-1 text-muted-foreground hover:text-foreground">
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={sourceBadgeVariant(portfolio.sourceType)} className="text-xs">
              {sourceLabel(portfolio.sourceType)} Portfolio
            </Badge>
            <span className="text-xs text-muted-foreground">
              Last imported {new Date(portfolio.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </span>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button size="sm" variant="outline" onClick={() => setAddingPos(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Position
          </Button>
          <Button size="sm" variant="outline" onClick={() => setLocation("/portfolio/import")}>
            <Upload className="h-3.5 w-3.5 mr-1" /> Import
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:bg-destructive/10"
            onClick={() => { if (confirm("Delete this portfolio?")) deletePortfolio.mutate(); }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <HoldingsTable
          portfolioId={portfolio.id}
          positions={data?.positions ?? []}
          onEdit={setEditingPos}
          onDelete={setDeletingPos}
        />
      )}

      {(addingPos || editingPos) && (
        <AddPositionDialog
          portfolioId={portfolio.id}
          editingPosition={editingPos}
          onClose={() => { setAddingPos(false); setEditingPos(undefined); }}
        />
      )}

      {deletingPos && (
        <Dialog open onOpenChange={() => setDeletingPos(undefined)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove {deletingPos.symbol}?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              This will permanently remove {deletingPos.symbol} from your portfolio.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeletingPos(undefined)}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={() => deletePosition.mutate(deletingPos)}
                disabled={deletePosition.isPending}
              >
                {deletePosition.isPending ? "Removing…" : "Remove"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main portfolio page
// ---------------------------------------------------------------------------

export default function PortfolioPage() {
  const { data: portfolios, isLoading } = useQuery<Portfolio[]>({
    queryKey: ["/api/portfolio"],
  });

  const [activeId, setActiveId] = useState<string | null>(null);
  const [, setLocation] = useLocation();

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!portfolios || portfolios.length === 0) {
    return (
      <div className="min-h-screen bg-background">
        <PortfolioOnboarding />
      </div>
    );
  }

  const active = activeId ? portfolios.find(p => p.id === activeId) : portfolios[0];

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-6xl mx-auto px-4 py-6 space-y-4">
        {/* Page header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Portfolio</h1>
            <p className="text-sm text-muted-foreground">Track your holdings</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setLocation("/portfolio/import")}>
              <Upload className="h-3.5 w-3.5 mr-1.5" /> Import Spreadsheet
            </Button>
          </div>
        </div>

        <div className="flex gap-4">
          {/* Sidebar — portfolio list */}
          {portfolios.length > 1 && (
            <aside className="w-56 shrink-0 space-y-1">
              {portfolios.map(p => (
                <button
                  key={p.id}
                  onClick={() => setActiveId(p.id)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center justify-between group ${
                    (active?.id === p.id) ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                  }`}
                >
                  <span className="truncate">{p.name}</span>
                  <ChevronRight className="h-3.5 w-3.5 opacity-50" />
                </button>
              ))}
            </aside>
          )}

          {/* Main content */}
          <main className="flex-1 min-w-0">
            {active ? (
              <Card>
                <CardContent className="pt-5">
                  <PortfolioDetail key={active.id} portfolio={active} />
                </CardContent>
              </Card>
            ) : null}
          </main>
        </div>
      </div>
    </div>
  );
}
