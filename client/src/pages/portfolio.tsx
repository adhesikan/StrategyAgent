import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Plus, Upload, Link2, Trash2, Pencil, Check, X,
  TrendingUp, TrendingDown, Package, RefreshCw, ChevronRight,
  CheckCircle2, Shield, Clock, Lock, BarChart2, Layers,
  Building2, FlaskConical, Activity, Target, Search,
  Cpu, PieChart, AlertCircle, BookOpen, HelpCircle,
  FileSpreadsheet, Camera, FileText,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
// Onboarding — redesigned per Sprint 2.4.0A
// ---------------------------------------------------------------------------

const TRUST_BULLETS = [
  { icon: Shield,       text: "No broker connection required" },
  { icon: Clock,        text: "Import in minutes"             },
  { icon: Lock,         text: "Your portfolio stays private"  },
  { icon: CheckCircle2, text: "Secure local processing"       },
];

const SUPPORTED_SOURCES = [
  { label: "CSV",                    tag: "csv"  },
  { label: "Excel (.xlsx)",          tag: "xlsx" },
  { label: "Fidelity Export",        tag: "csv"  },
  { label: "Schwab Export",          tag: "csv"  },
  { label: "Robinhood Export",       tag: "csv"  },
  { label: "Interactive Brokers",    tag: "csv"  },
  { label: "TradeStation Export",    tag: "csv"  },
  { label: "Tradier Export",         tag: "csv"  },
];

const WHAT_HAPPENS = [
  { icon: BarChart2,    label: "Track your holdings"             },
  { icon: TrendingUp,   label: "Monitor portfolio performance"   },
  { icon: PieChart,     label: "View sector exposure"            },
  { icon: Building2,    label: "Research institutional ownership" },
  { icon: Activity,     label: "Monitor technical strength"      },
  { icon: Layers,       label: "Identify portfolio concentration" },
  { icon: FlaskConical, label: "Generate AI research"            },
  { icon: Target,       label: "Discover covered call candidates" },
];

const AVAILABLE_BROKERS   = ["Tradier", "TradeStation"];
const COMING_SOON_BROKERS = ["Schwab", "Interactive Brokers", "Fidelity", "Robinhood"];

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
      toast({ title: "Portfolio created" });
      setCreating(false);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-2xl mx-auto px-4 py-12 space-y-8">

        {/* Hero */}
        <div className="text-center space-y-3">
          <div
            className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto"
            aria-hidden="true"
          >
            <Package className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="onboarding-title">
            Import Your Investment Portfolio
          </h1>
          <p className="text-muted-foreground text-base max-w-lg mx-auto leading-relaxed">
            Import holdings from your broker, spreadsheet, or enter them manually.
            Once imported, VCP Trader AI continuously analyzes your portfolio using market intelligence,
            technical research, institutional activity, sector leadership and portfolio analytics.
          </p>
        </div>

        {/* Trust banner */}
        <div
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
          role="list"
          aria-label="Security and privacy assurances"
        >
          {TRUST_BULLETS.map(({ icon: Icon, text }) => (
            <div
              key={text}
              role="listitem"
              className="flex items-center gap-2 bg-green-500/8 border border-green-500/20 rounded-lg px-3 py-2 text-xs text-green-700 dark:text-green-400"
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{text}</span>
            </div>
          ))}
        </div>

        {/* Primary actions */}
        <div className="space-y-3" role="group" aria-label="Import options">
          {/* PRIMARY */}
          <Button
            variant="default"
            className="w-full h-14 text-base font-semibold"
            onClick={() => setLocation("/portfolio/import")}
            data-testid="btn-upload"
          >
            <Upload className="h-5 w-5 mr-2" aria-hidden="true" />
            Upload Portfolio
          </Button>

          {/* SECONDARY */}
          <Button
            variant="outline"
            className="w-full h-12 text-base"
            onClick={() => setLocation("/settings?tab=broker")}
            data-testid="btn-connect-broker"
          >
            <Link2 className="h-4 w-4 mr-2" aria-hidden="true" />
            Connect Broker
          </Button>

          {/* TERTIARY */}
          <Button
            variant="ghost"
            className="w-full h-12 text-base text-muted-foreground hover:text-foreground"
            onClick={() => setCreating(true)}
            data-testid="btn-manual"
          >
            <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
            Enter Holdings Manually
          </Button>

          {/* Coming soon — informational only */}
          <div className="grid grid-cols-2 gap-3 pt-1" data-testid="coming-soon-cards">
            {[
              { icon: Camera,   label: "Import from Screenshot"   },
              { icon: FileText, label: "Import from PDF Statement" },
            ].map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="relative flex flex-col items-center justify-center gap-1.5 border-2 border-dashed border-muted-foreground/20 rounded-xl p-4 text-center opacity-50 cursor-not-allowed select-none"
                aria-disabled="true"
                aria-label={`${label} — coming soon`}
              >
                <Icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                <span className="text-xs text-muted-foreground font-medium">{label}</span>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Coming Soon</Badge>
              </div>
            ))}
          </div>
        </div>

        {/* Supported imports */}
        <Card data-testid="supported-imports-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-primary" aria-hidden="true" />
              Supported Imports
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {SUPPORTED_SOURCES.map(({ label }) => (
                <Badge key={label} variant="outline" className="text-xs">
                  {label}
                </Badge>
              ))}
            </div>
            <Separator />
            <div className="flex flex-wrap gap-2">
              {["Screenshot Import", "PDF Statement Import"].map(label => (
                <Badge key={label} variant="secondary" className="text-xs opacity-60">
                  {label} — Coming Soon
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Broker card */}
        <Card data-testid="broker-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Link2 className="h-4 w-4 text-primary" aria-hidden="true" />
              Connected Brokers
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">Available Today</p>
              <div className="flex flex-wrap gap-2">
                {AVAILABLE_BROKERS.map(b => (
                  <Badge key={b} variant="default" className="text-xs">
                    {b}
                  </Badge>
                ))}
              </div>
            </div>
            <Separator />
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">Coming Soon</p>
              <div className="flex flex-wrap gap-2">
                {COMING_SOON_BROKERS.map(b => (
                  <Badge key={b} variant="secondary" className="text-xs opacity-60">
                    {b}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* What happens after import */}
        <Card data-testid="what-happens-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">What happens after import?</CardTitle>
            <CardDescription className="text-xs">
              VCP Trader AI delivers professional-grade analysis, research, and intelligence across all your holdings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {WHAT_HAPPENS.map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-start gap-2.5 text-sm">
                  <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Icon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                  </div>
                  <span className="text-muted-foreground leading-tight">{label}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Manual create dialog */}
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
                autoFocus
                aria-describedby="pname-hint"
              />
              <p id="pname-hint" className="text-xs text-muted-foreground">
                You can add positions manually after creating the portfolio.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
              <Button onClick={() => createManual.mutate()} disabled={createManual.isPending}>
                {createManual.isPending ? "Creating…" : "Create Portfolio"}
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

const FIELD_TOOLTIPS: Record<string, string> = {
  averageCost: "The average price you paid per share across all purchases.",
  costBasis:   "Total amount you invested in this position (quantity × average cost).",
  marketValue: "Current market price × shares held. Uses stored daily bar prices.",
};

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
    <TooltipProvider>
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
                  aria-label="Stock ticker symbol"
                />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="qty">Quantity (Shares)</Label>
              <Input
                id="qty"
                type="number"
                min="0"
                step="any"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                placeholder="100"
                aria-label="Number of shares"
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="avgcost">
                  Average Cost <span className="text-muted-foreground text-xs">(optional)</span>
                </Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" aria-label="What is average cost?" />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-xs">
                    {FIELD_TOOLTIPS.averageCost}
                  </TooltipContent>
                </Tooltip>
              </div>
              <Input
                id="avgcost"
                type="number"
                min="0"
                step="any"
                value={averageCost}
                onChange={e => setAverageCost(e.target.value)}
                placeholder="150.00"
                aria-describedby="avgcost-hint"
              />
              <p id="avgcost-hint" className="text-xs text-muted-foreground">
                Per-share price paid. Used to calculate your cost basis and unrealized gain/loss.
              </p>
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
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Holdings table
// ---------------------------------------------------------------------------

const COL_TOOLTIPS: Record<string, string> = {
  "Avg Cost":     "Average price paid per share across all purchases.",
  "Price":        "Latest daily close price from stored market bars. Updates nightly.",
  "Market Value": "Current price × shares held.",
  "G/L":          "Unrealized gain or loss: market value minus total cost basis.",
  "Source":       "How this position was added: Manual entry, Spreadsheet import, or Broker.",
};

function ColHeader({ label, tooltip }: { label: string; tooltip?: string }) {
  if (!tooltip) return <th className="text-right px-3 py-2 font-medium">{label}</th>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <th className="text-right px-3 py-2 font-medium cursor-help">
          <span className="inline-flex items-center gap-1 justify-end">
            {label}
            <HelpCircle className="h-3 w-3 text-muted-foreground/60" aria-hidden="true" />
          </span>
        </th>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

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
  const [, setLocation] = useLocation();

  if (positions.length === 0) {
    return (
      <div
        className="text-center py-16 space-y-4"
        data-testid="empty-state"
        role="region"
        aria-label="No holdings"
      >
        <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mx-auto">
          <Package className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        </div>
        <div>
          <p className="font-medium text-lg">No Holdings Yet</p>
          <p className="text-sm text-muted-foreground mt-1">Add positions to start tracking your portfolio.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 justify-center max-w-sm mx-auto">
          <Button
            variant="default"
            size="sm"
            className="flex-1"
            onClick={() => setLocation("/portfolio/import")}
          >
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            Import a Spreadsheet
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => setLocation("/settings?tab=broker")}
          >
            <Link2 className="h-3.5 w-3.5 mr-1.5" />
            Connect a Broker
          </Button>
        </div>
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => {}}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Enter Holdings Manually
        </Button>
      </div>
    );
  }

  const totalMV = positions.reduce((s, p) => s + (p.marketValue ?? 0), 0);
  const totalGL = positions.reduce((s, p) => s + (p.gainLoss ?? 0), 0);
  const totalCB = positions.reduce((s, p) => s + (p.costBasis != null ? Number(p.costBasis) : 0), 0);

  return (
    <TooltipProvider>
      <div>
        {/* Summary bar */}
        <div
          className="flex flex-wrap gap-4 mb-4 px-1"
          role="region"
          aria-label="Portfolio summary"
        >
          <div>
            <p className="text-xs text-muted-foreground">Positions</p>
            <p className="font-semibold">{positions.length}</p>
          </div>
          {totalMV > 0 && (
            <div>
              <p className="text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  Market Value
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-3 w-3 cursor-help" aria-label="Market value explanation" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs max-w-xs">
                      {COL_TOOLTIPS["Market Value"]}
                    </TooltipContent>
                  </Tooltip>
                </span>
              </p>
              <p className="font-semibold">{fmtCurrency(totalMV)}</p>
            </div>
          )}
          {totalCB > 0 && (
            <div>
              <p className="text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  Cost Basis
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-3 w-3 cursor-help" aria-label="Cost basis explanation" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs max-w-xs">
                      {FIELD_TOOLTIPS.costBasis}
                    </TooltipContent>
                  </Tooltip>
                </span>
              </p>
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

        {/* Scrollable table — mobile-friendly */}
        <div className="overflow-x-auto rounded border" role="region" aria-label="Holdings table">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="border-b bg-muted/30 text-muted-foreground">
                <th className="text-left px-3 py-2 font-medium" scope="col">Symbol</th>
                <th className="text-right px-3 py-2 font-medium" scope="col">Quantity</th>
                <ColHeader label="Avg Cost"     tooltip={COL_TOOLTIPS["Avg Cost"]}     />
                <ColHeader label="Price"        tooltip={COL_TOOLTIPS["Price"]}        />
                <ColHeader label="Market Value" tooltip={COL_TOOLTIPS["Market Value"]} />
                <ColHeader label="G/L"          tooltip={COL_TOOLTIPS["G/L"]}          />
                <th className="px-3 py-2 w-16" scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {positions.map(p => {
                const gl = p.gainLoss;
                return (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-muted/20 focus-within:bg-muted/10">
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
                          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`Edit ${p.symbol} position`}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          onClick={() => onDelete(p)}
                          className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`Remove ${p.symbol} from portfolio`}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
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
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Intelligence placeholder cards — Sprint 2.4.0A §9
// ---------------------------------------------------------------------------

const INTELLIGENCE_CARDS = [
  { icon: BarChart2,    title: "Portfolio Health",         description: "Overall strength assessment across all holdings." },
  { icon: FlaskConical, title: "AI Research",              description: "AI-powered fundamental and technical Analysis." },
  { icon: PieChart,     title: "Sector Exposure",          description: "Concentration analysis by sector and industry." },
  { icon: Building2,    title: "Institutional Activity",   description: "13F filings and institutional ownership signals." },
  { icon: Activity,     title: "Technical Strength",       description: "VCP pattern and momentum analysis per holding." },
  { icon: Shield,       title: "Portfolio Risk",           description: "Concentration, volatility, and drawdown metrics." },
  { icon: Target,       title: "Opportunities",            description: "Cross-reference holdings against ranked setups." },
];

function IntelligencePlaceholders() {
  return (
    <div className="space-y-3 mt-6" role="region" aria-label="Portfolio intelligence — upcoming features">
      <div className="flex items-center gap-2">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground font-medium px-2">Portfolio Intelligence</span>
        <Separator className="flex-1" />
      </div>
      <div
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
        data-testid="intelligence-placeholders"
      >
        {INTELLIGENCE_CARDS.map(({ icon: Icon, title, description }) => (
          <div
            key={title}
            className="border rounded-xl p-4 space-y-2 opacity-60 cursor-default select-none"
            aria-label={`${title} — available in an upcoming release`}
          >
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Icon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-medium leading-tight">{title}</p>
              </div>
              <Badge variant="secondary" className="text-[10px] ml-auto shrink-0 px-1.5 py-0">
                Upcoming
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
            <p className="text-[11px] text-muted-foreground/60 italic">Available in an upcoming release</p>
          </div>
        ))}
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
  const [addingPos,   setAddingPos]   = useState(false);
  const [editingPos,  setEditingPos]  = useState<EnrichedPosition | undefined>();
  const [deletingPos, setDeletingPos] = useState<EnrichedPosition | undefined>();
  const [editingName, setEditingName] = useState(false);
  const [nameValue,   setNameValue]   = useState(portfolio.name);

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

  const positions = data?.positions ?? [];

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
                aria-label="Portfolio name"
              />
              <button
                onClick={() => saveName.mutate()}
                disabled={saveName.isPending}
                className="p-1 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                aria-label="Save name"
              >
                <Check className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                onClick={() => { setEditingName(false); setNameValue(portfolio.name); }}
                className="p-1 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                aria-label="Cancel rename"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold truncate">{portfolio.name}</h2>
              <button
                onClick={() => setEditingName(true)}
                className="p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                aria-label={`Rename ${portfolio.name}`}
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          )}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Badge variant={sourceBadgeVariant(portfolio.sourceType)} className="text-xs cursor-help">
                      {sourceLabel(portfolio.sourceType)} Portfolio
                    </Badge>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs max-w-xs">
                  {portfolio.sourceType === "broker"
                    ? "Positions synced from a connected broker account."
                    : portfolio.sourceType === "manual"
                    ? "Positions entered manually one at a time."
                    : "Positions imported from a spreadsheet file (CSV or XLSX)."}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <span className="text-xs text-muted-foreground">
              Updated {new Date(portfolio.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </span>
          </div>
        </div>
        <div className="flex gap-2 shrink-0 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => setAddingPos(true)} aria-label="Add position">
            <Plus className="h-3.5 w-3.5 mr-1" aria-hidden="true" /> Add Position
          </Button>
          <Button size="sm" variant="outline" onClick={() => setLocation("/portfolio/import")} aria-label="Import from spreadsheet">
            <Upload className="h-3.5 w-3.5 mr-1" aria-hidden="true" /> Import
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:bg-destructive/10"
            onClick={() => { if (confirm("Delete this portfolio and all its positions?")) deletePortfolio.mutate(); }}
            aria-label={`Delete portfolio ${portfolio.name}`}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading positions…" />
        </div>
      ) : (
        <>
          <HoldingsTable
            portfolioId={portfolio.id}
            positions={positions}
            onEdit={setEditingPos}
            onDelete={setDeletingPos}
          />
          {/* Intelligence placeholders — shown whenever positions exist */}
          {positions.length > 0 && <IntelligencePlaceholders />}
        </>
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
      <div className="flex justify-center items-center min-h-[60vh]" aria-label="Loading portfolio…">
        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!portfolios || portfolios.length === 0) {
    return <PortfolioOnboarding />;
  }

  const active = activeId ? portfolios.find(p => p.id === activeId) : portfolios[0];

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-6xl mx-auto px-4 py-6 space-y-4">

        {/* Breadcrumb + page header */}
        <div className="space-y-1">
          <nav aria-label="Breadcrumb">
            <ol className="flex items-center gap-1 text-sm text-muted-foreground" role="list">
              <li role="listitem">
                <button
                  onClick={() => setLocation("/")}
                  className="hover:text-foreground focus-visible:outline-none focus-visible:underline"
                >
                  Home
                </button>
              </li>
              <li role="listitem" aria-hidden="true"><ChevronRight className="h-3.5 w-3.5" /></li>
              <li role="listitem" className="text-foreground font-medium">Portfolio Overview</li>
              {active && (
                <>
                  <li role="listitem" aria-hidden="true"><ChevronRight className="h-3.5 w-3.5" /></li>
                  <li role="listitem" className="text-foreground">{active.name}</li>
                </>
              )}
            </ol>
          </nav>
          <div className="flex items-center justify-between pt-1 flex-wrap gap-2">
            <h1 className="text-2xl font-bold">Portfolio</h1>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setLocation("/portfolio/import")}
              aria-label="Import new spreadsheet"
            >
              <Upload className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" /> Import Spreadsheet
            </Button>
          </div>
        </div>

        <div className="flex gap-4 flex-col sm:flex-row">
          {/* Sidebar — portfolio list (shown when >1 portfolio) */}
          {portfolios.length > 1 && (
            <nav aria-label="Portfolio list" className="sm:w-56 w-full shrink-0">
              <ol className="space-y-1" role="list">
                {portfolios.map(p => (
                  <li key={p.id} role="listitem">
                    <button
                      onClick={() => setActiveId(p.id)}
                      className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center justify-between group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        (active?.id === p.id) ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                      }`}
                      aria-current={active?.id === p.id ? "page" : undefined}
                    >
                      <span className="truncate">{p.name}</span>
                      <ChevronRight className="h-3.5 w-3.5 opacity-50" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
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
