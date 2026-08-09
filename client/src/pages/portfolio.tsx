import { useState } from "react";
import { useQuery, useMutation, useQueryClient, useQueries } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Plus, Upload, Link2, Trash2, Pencil, Check, X,
  TrendingUp, TrendingDown, Package, RefreshCw, ChevronRight,
  CheckCircle2, Shield, Clock, Lock, BarChart2, Layers,
  Building2, FlaskConical, Activity, Target, Search,
  Cpu, PieChart, AlertCircle, BookOpen, HelpCircle,
  FileSpreadsheet, Camera, FileText, History, Camera as CameraIcon,
  ArrowUp, ArrowDown, Minus, CircleDot, LogOut,
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
    image:  "Screenshot",
    pdf:    "PDF Statement",
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
            onClick={() => setLocation("/portfolio/connect")}
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

          {/* Document import options */}
          <div className="grid grid-cols-2 gap-3 pt-1" data-testid="document-import-cards">
            {[
              {
                icon:    Camera,
                label:   "Upload Screenshot",
                route:   "/portfolio/import/document?type=image",
                testId:  "btn-screenshot",
                ariaLbl: "Import portfolio from a screenshot",
              },
              {
                icon:    FileText,
                label:   "Upload PDF Statement",
                route:   "/portfolio/import/document?type=pdf",
                testId:  "btn-pdf",
                ariaLbl: "Import portfolio from a PDF brokerage statement",
              },
            ].map(({ icon: Icon, label, route, testId, ariaLbl }) => (
              <Button
                key={label}
                variant="outline"
                className="h-auto flex-col gap-1.5 py-4 border-dashed"
                onClick={() => setLocation(route)}
                data-testid={testId}
                aria-label={ariaLbl}
              >
                <Icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                <span className="text-xs font-medium">{label}</span>
              </Button>
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
              {["Screenshots (PNG/JPG/WEBP)", "PDF Brokerage Statements"].map(label => (
                <Badge key={label} variant="outline" className="text-xs">
                  {label}
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

// ---------------------------------------------------------------------------
// Portfolio History types (Sprint 2.6.0)
// ---------------------------------------------------------------------------

interface SnapshotCard {
  id:               string;
  snapshotDate:     string;
  capturedAt:       string;
  sourceType:       string;
  totalMarketValue: number | null;
  positionCount:    number;
  coverage:         { positionsTotal: number; positionsWithMarketData: number; coveragePercent: number };
}

interface PortfolioHistoryResponse {
  portfolioId: string;
  period:      string;
  snapshots:   SnapshotCard[];
  count:       number;
  disclaimer:  string;
}

interface PositionChangeItem {
  symbol:           string;
  changeType:       string;
  previousQuantity: number | null;
  currentQuantity:  number | null;
  quantityDelta:    number | null;
  marketValueDelta: number | null;
  sector:           string | null;
}

interface ExposureChangeItem {
  name:           string;
  changeType:     string;
  percentDelta:   number | null;
  previousPercent: number | null;
  currentPercent:  number | null;
}

interface ResearchChangeItem {
  symbol:        string;
  changeType:    string;
  previousScore: number | null;
  currentScore:  number | null;
  scoreDelta:    number | null;
  sector:        string | null;
}

interface PortfolioChanges {
  summary: {
    fromDate:              string;
    toDate:                string;
    valueChange:           number | null;
    valueChangePercent:    number | null;
    previousValue:         number | null;
    currentValue:          number | null;
    positionCountChange:   number;
    previousPositionCount: number;
    currentPositionCount:  number;
  };
  addedPositions:       PositionChangeItem[];
  exitedPositions:      PositionChangeItem[];
  increasedPositions:   PositionChangeItem[];
  reducedPositions:     PositionChangeItem[];
  researchStrengthened: ResearchChangeItem[];
  researchWeakened:     ResearchChangeItem[];
  newlyQualified:       ResearchChangeItem[];
  noLongerQualified:    ResearchChangeItem[];
  sectorChanges:        ExposureChangeItem[];
  themeChanges:         ExposureChangeItem[];
  limitations:          string[];
  dataFreshness:        { fromSnapshotAt: string; toSnapshotAt: string; institutionalDataNote: string };
}

interface PortfolioChangesResponse {
  changes:    PortfolioChanges;
  disclaimer: string;
}

// Source type labels
function sourceTypeLabel(t: string): string {
  const map: Record<string, string> = {
    manual_import:   "CSV Import",
    xlsx_import:     "Excel Import",
    image_import:    "Screenshot Import",
    pdf_import:      "PDF Import",
    broker_sync:     "Broker Sync",
    manual_snapshot: "Manual Capture",
    position_change: "Position Change",
  };
  return map[t] ?? t;
}

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

function fmtQtyDelta(v: number | null): string {
  if (v == null) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${Number(v).toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
}

// Change type icon + colour
function PositionChangeIcon({ type }: { type: string }) {
  if (type === "NEW")       return <ArrowUp   className="h-3.5 w-3.5 text-green-500"  aria-hidden="true" />;
  if (type === "INCREASED") return <ArrowUp   className="h-3.5 w-3.5 text-blue-500"   aria-hidden="true" />;
  if (type === "EXITED")    return <LogOut    className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />;
  if (type === "REDUCED")   return <ArrowDown className="h-3.5 w-3.5 text-amber-500"  aria-hidden="true" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />;
}

// ---------------------------------------------------------------------------
// Portfolio Intelligence types (Sprint 2.6.1)
// ---------------------------------------------------------------------------

interface PortfolioIntelligenceResult {
  portfolioId: string; portfolioName: string; generatedAt: string; snapshotId: string | null;
  marketValue: number | null; costBasis: number | null; positionCount: number; marketRegime: string | null;
  coverage: { positionsTotal: number; positionsWithOpportunityIntelligence: number; positionsWithMarketData: number; positionsWithFundamentalEvidence: number; positionsWithInstitutionalEvidence: number; positionsWithSector: number; positionsWithTheme: number; overallCoveragePercent: number };
  concentration: { largestPositionPercent: number | null; largestPositionSymbol: string | null; top3PositionPercent: number | null; top5PositionPercent: number | null; largestSectorPercent: number | null; largestSectorName: string | null; largestThemePercent: number | null; largestThemeName: string | null; concentrationLabel: "Low" | "Moderate" | "High"; top3Label: "Low" | "Moderate" | "High"; sectorLabel: "Low" | "Moderate" | "High" };
  sectorExposure: Array<{ sector: string; marketValue: number | null; portfolioPercent: number | null; positionCount: number; symbols: string[]; changeSincePreviousSnapshot: number | null }>;
  themeExposure: Array<{ themeId: string; themeName: string; marketValue: number | null; portfolioPercent: number | null; positionCount: number; symbols: string[] }>;
  opportunityOverlap: Array<{ symbol: string; companyName: string | null; overlapCategory: string; researchScore: number | null; technicalScore: number | null; opportunityType: string | null; opportunityTypeLabel: string | null; confidence: string | null; riskLevel: string | null; portfolioWeight: number | null; primaryEvidence: Array<{ type: string; description: string; weight: number }> }>;
  strengthenedHoldings: Array<{ symbol: string; changeType: string; previousScore: number | null; currentScore: number | null; scoreDelta: number | null; companyName: string | null; sector: string | null }>;
  weakenedHoldings: Array<{ symbol: string; changeType: string; previousScore: number | null; currentScore: number | null; scoreDelta: number | null; companyName: string | null; sector: string | null }>;
  newlyQualifiedHoldings: Array<{ symbol: string; changeType: string; previousScore: number | null; currentScore: number | null; scoreDelta: number | null; companyName: string | null; sector: string | null }>;
  noLongerQualifiedHoldings: Array<{ symbol: string; changeType: string; previousScore: number | null; currentScore: number | null; scoreDelta: number | null; companyName: string | null; sector: string | null }>;
  qualifiedHoldings: Array<{ symbol: string; companyName: string | null; sector: string | null; themes: string[]; portfolioWeight: number | null; marketValue: number | null; researchScore: number | null; overlapCategory: string; hasInstitutionalEvidence: boolean }>;
  uncoveredHoldings: Array<{ symbol: string; companyName: string | null; sector: string | null; themes: string[]; portfolioWeight: number | null }>;
  institutionalSummary: { symbolsCovered: number; symbolsTotal: number; coveragePercent: number; holdingsWithActivity: number; disclosure: string };
  riskObservations: Array<{ type: string; label: string; description: string; affectedSymbols: string[] }>;
  researchObservations: Array<{ type: string; text: string }>;
  furtherResearchAreas: Array<{ area: string; description: string; linkPath?: string }>;
  disclaimer: string; limitations: string[];
  freshness: { generatedAt: string; opportunityIntelligenceAt: string | null; latestSnapshotAt: string | null; institutionalDataNote: string };
}

interface PortfolioIntelligenceResponse {
  available: boolean; portfolioId: string; generatedAt: string;
  intelligence: PortfolioIntelligenceResult | null; message?: string;
}

function concentrationColor(label: "Low" | "Moderate" | "High"): string {
  if (label === "High")     return "text-destructive";
  if (label === "Moderate") return "text-amber-600";
  return "text-green-600";
}

function overlapBadge(cat: string): { label: string; className: string } {
  if (cat === "CURRENTLY_QUALIFIED")      return { label: "Qualified",   className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" };
  if (cat === "APPROACHING_QUALIFICATION") return { label: "Approaching", className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" };
  if (cat === "NO_LONGER_QUALIFIED")      return { label: "Was Qualified", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" };
  return { label: "Not Ranked",  className: "bg-muted text-muted-foreground" };
}

function ScoreBar({ score, label }: { score: number | null; label: string }) {
  if (score === null) return <span className="text-[10px] text-muted-foreground">—</span>;
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-primary/70 rounded-full" style={{ width: `${Math.min(score, 100)}%` }} />
      </div>
      <span className="text-[10px] text-muted-foreground w-6 shrink-0">{score}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Portfolio Intelligence Tab (Sprint 2.6.1)
// ---------------------------------------------------------------------------

function PortfolioIntelligenceTab({ portfolioId }: { portfolioId: string }) {
  const [, setLocation] = useLocation();

  const { data, isLoading, error } = useQuery<PortfolioIntelligenceResponse>({
    queryKey:  [`/api/portfolio/${portfolioId}/intelligence`],
    queryFn:   () => fetch(`/api/portfolio/${portfolioId}/intelligence`).then(r => r.json()),
    staleTime: 10 * 60 * 1000, // 10 min
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading intelligence…" />
      </div>
    );
  }

  if (error || !data) {
    return <p className="text-sm text-destructive py-4">Portfolio Intelligence is temporarily unavailable.</p>;
  }

  if (!data.available || !data.intelligence) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center space-y-2">
        <Activity className="h-8 w-8 text-muted-foreground mx-auto" aria-hidden="true" />
        <p className="text-sm font-medium">Portfolio Intelligence unavailable</p>
        <p className="text-xs text-muted-foreground">{data.message ?? "Add positions to generate intelligence."}</p>
      </div>
    );
  }

  const intel = data.intelligence;
  const cov   = intel.coverage;
  const conc  = intel.concentration;

  return (
    <div className="space-y-6">

      {/* Limitations */}
      {intel.limitations.length > 0 && (
        <div className="rounded-lg bg-muted/40 border px-3 py-2 space-y-1">
          {intel.limitations.map(l => (
            <p key={l} className="text-[11px] text-muted-foreground flex items-start gap-1.5">
              <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" aria-hidden="true" /> {l}
            </p>
          ))}
        </div>
      )}

      {/* ── Research Coverage ────────────────────────────────────────────── */}
      <section aria-labelledby="intel-coverage">
        <h3 id="intel-coverage" className="text-sm font-semibold mb-2">Research Coverage</h3>
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Overall Coverage</span>
            <span className="text-sm font-semibold">{cov.overallCoveragePercent}%</span>
          </div>
          <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${cov.overallCoveragePercent}%` }} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
            {[
              { label: "Research Data",    value: cov.positionsWithOpportunityIntelligence },
              { label: "Market Prices",    value: cov.positionsWithMarketData },
              { label: "Sector Tagged",    value: cov.positionsWithSector },
              { label: "Theme Tagged",     value: cov.positionsWithTheme },
              { label: "Fundamental",      value: cov.positionsWithFundamentalEvidence },
              { label: "Institutional",    value: cov.positionsWithInstitutionalEvidence },
            ].map(({ label, value }) => (
              <div key={label} className="space-y-0.5">
                <p className="text-[10px] text-muted-foreground">{label}</p>
                <p className="text-xs font-medium">{value} / {cov.positionsTotal}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Opportunity Overlap ──────────────────────────────────────────── */}
      <section aria-labelledby="intel-overlap">
        <h3 id="intel-overlap" className="text-sm font-semibold mb-2">Opportunity Overlap</h3>
        <div className="space-y-1">
          {intel.opportunityOverlap.length === 0 ? (
            <p className="text-xs text-muted-foreground">No opportunity overlap data available.</p>
          ) : intel.opportunityOverlap.map(item => {
            const badge = overlapBadge(item.overlapCategory);
            return (
              <div key={item.symbol} className="flex items-center justify-between gap-2 px-2 py-2 rounded bg-muted/30 hover:bg-muted/50 cursor-pointer" onClick={() => setLocation(`/opportunities/${item.symbol}`)} role="button" aria-label={`Open ${item.symbol} in Opportunity Workspace`}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-xs font-semibold shrink-0">{item.symbol}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${badge.className}`}>{badge.label}</span>
                  {item.companyName && <span className="text-[10px] text-muted-foreground truncate hidden sm:block">{item.companyName}</span>}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {item.researchScore !== null && (
                    <div className="w-16 hidden sm:block">
                      <ScoreBar score={item.researchScore} label="Research" />
                    </div>
                  )}
                  <span className="text-[10px] text-muted-foreground">{item.portfolioWeight !== null ? `${item.portfolioWeight}%` : "—"}</span>
                  <ChevronRight className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Research Changes ─────────────────────────────────────────────── */}
      {(intel.strengthenedHoldings.length + intel.weakenedHoldings.length +
        intel.newlyQualifiedHoldings.length + intel.noLongerQualifiedHoldings.length) > 0 && (
        <section aria-labelledby="intel-changes">
          <h3 id="intel-changes" className="text-sm font-semibold mb-2">Research Evidence Changes</h3>
          <div className="space-y-1">
            {[
              ...intel.strengthenedHoldings.map(h => ({ ...h, _label: "Strengthened", _color: "text-green-600" })),
              ...intel.newlyQualifiedHoldings.map(h => ({ ...h, _label: "Newly Qualified", _color: "text-blue-600" })),
              ...intel.weakenedHoldings.map(h => ({ ...h, _label: "Weakened", _color: "text-amber-600" })),
              ...intel.noLongerQualifiedHoldings.map(h => ({ ...h, _label: "No Longer Qualified", _color: "text-destructive" })),
            ].map(h => (
              <div key={`${h.symbol}-${h.changeType}`} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-muted/30 text-xs">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-medium ${h._color}`}>{h._label}</span>
                  <span className="font-mono font-semibold">{h.symbol}</span>
                  {h.sector && <span className="text-muted-foreground hidden sm:block">{h.sector}</span>}
                </div>
                {h.scoreDelta !== null && (
                  <span className="text-muted-foreground shrink-0">
                    {h.scoreDelta > 0 ? `+${h.scoreDelta}` : h.scoreDelta} pts
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Sector Exposure ──────────────────────────────────────────────── */}
      {intel.sectorExposure.length > 0 && (
        <section aria-labelledby="intel-sectors">
          <h3 id="intel-sectors" className="text-sm font-semibold mb-2">Sector Exposure</h3>
          <div className="space-y-2">
            {intel.sectorExposure.map(s => (
              <div key={s.sector} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <button className="hover:text-primary focus-visible:outline-none focus-visible:underline text-left" onClick={() => setLocation("/research/sectors")}>{s.sector}</button>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-muted-foreground">{s.positionCount} holding{s.positionCount !== 1 ? "s" : ""}</span>
                    <span className="font-semibold">{s.portfolioPercent !== null ? `${s.portfolioPercent}%` : "—"}</span>
                    {s.changeSincePreviousSnapshot !== null && (
                      <span className={`text-[10px] ${s.changeSincePreviousSnapshot > 0 ? "text-blue-600" : "text-amber-600"}`}>
                        {s.changeSincePreviousSnapshot > 0 ? "+" : ""}{s.changeSincePreviousSnapshot.toFixed(1)}pp
                      </span>
                    )}
                  </div>
                </div>
                {s.portfolioPercent !== null && (
                  <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary/60 rounded-full" style={{ width: `${Math.min(s.portfolioPercent, 100)}%` }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Theme Exposure ───────────────────────────────────────────────── */}
      {intel.themeExposure.length > 0 && (
        <section aria-labelledby="intel-themes">
          <div className="flex items-center justify-between mb-2">
            <h3 id="intel-themes" className="text-sm font-semibold">Theme Exposure</h3>
            <span className="text-[10px] text-muted-foreground">May exceed 100% due to overlap</span>
          </div>
          <div className="space-y-2">
            {intel.themeExposure.map(t => (
              <div key={t.themeId} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <button className="hover:text-primary focus-visible:outline-none focus-visible:underline text-left" onClick={() => setLocation(`/research/themes`)}>{t.themeName}</button>
                  <span className="font-semibold shrink-0">{t.portfolioPercent !== null ? `${t.portfolioPercent}%` : "—"}</span>
                </div>
                {t.portfolioPercent !== null && (
                  <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500/60 rounded-full" style={{ width: `${Math.min(t.portfolioPercent, 100)}%` }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Concentration ────────────────────────────────────────────────── */}
      <section aria-labelledby="intel-concentration">
        <h3 id="intel-concentration" className="text-sm font-semibold mb-2">Concentration</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {[
            { label: "Largest Position",    value: conc.largestPositionPercent !== null ? `${conc.largestPositionPercent}%` : "—", sub: conc.largestPositionSymbol ?? "", labelTag: conc.concentrationLabel },
            { label: "Top 3 Positions",     value: conc.top3PositionPercent    !== null ? `${conc.top3PositionPercent}%`    : "—", sub: "", labelTag: conc.top3Label },
            { label: "Top 5 Positions",     value: conc.top5PositionPercent    !== null ? `${conc.top5PositionPercent}%`    : "—", sub: "", labelTag: undefined },
            { label: "Largest Sector",      value: conc.largestSectorPercent   !== null ? `${conc.largestSectorPercent}%`   : "—", sub: conc.largestSectorName ?? "", labelTag: conc.sectorLabel },
            { label: "Largest Theme",       value: conc.largestThemePercent    !== null ? `${conc.largestThemePercent}%`    : "—", sub: conc.largestThemeName  ?? "", labelTag: undefined },
          ].map(({ label, value, sub, labelTag }) => (
            <div key={label} className="rounded-lg border bg-muted/30 p-2.5 space-y-0.5">
              <p className="text-[10px] text-muted-foreground">{label}</p>
              <div className="flex items-baseline gap-1.5">
                <p className="text-sm font-semibold">{value}</p>
                {labelTag && <span className={`text-[10px] font-medium ${concentrationColor(labelTag as any)}`}>{labelTag}</span>}
              </div>
              {sub && <p className="text-[10px] text-muted-foreground truncate">{sub}</p>}
            </div>
          ))}
        </div>
      </section>

      {/* ── Institutional Context ────────────────────────────────────────── */}
      <section aria-labelledby="intel-institutional">
        <h3 id="intel-institutional" className="text-sm font-semibold mb-2">Institutional Context</h3>
        <div className="rounded-lg border bg-card p-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">13F Signal Coverage</span>
            <span className="font-semibold">{intel.institutionalSummary.symbolsCovered} / {intel.institutionalSummary.symbolsTotal} holdings</span>
          </div>
          {intel.institutionalSummary.symbolsCovered === 0 ? (
            <p className="text-[11px] text-muted-foreground">Institutional evidence unavailable for this portfolio's holdings.</p>
          ) : (
            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary/60 rounded-full" style={{ width: `${intel.institutionalSummary.coveragePercent}%` }} />
            </div>
          )}
          <p className="text-[10px] text-muted-foreground/70 italic border-t pt-2 leading-relaxed">
            {intel.institutionalSummary.disclosure}
          </p>
        </div>
      </section>

      {/* ── Risk Observations ────────────────────────────────────────────── */}
      {intel.riskObservations.length > 0 && (
        <section aria-labelledby="intel-risk">
          <h3 id="intel-risk" className="text-sm font-semibold mb-2">Risk Observations</h3>
          <div className="space-y-2">
            {intel.riskObservations.map(obs => (
              <div key={obs.type} className="rounded-lg border bg-muted/20 p-3 space-y-1">
                <p className="text-xs font-semibold">{obs.label}</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{obs.description}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Research Observations ────────────────────────────────────────── */}
      {intel.researchObservations.length > 0 && (
        <section aria-labelledby="intel-research-obs">
          <h3 id="intel-research-obs" className="text-sm font-semibold mb-2">Research Observations</h3>
          <div className="rounded-lg border bg-card p-3 space-y-2">
            {intel.researchObservations.map(obs => (
              <p key={obs.type} className="text-[11px] text-muted-foreground leading-relaxed">• {obs.text}</p>
            ))}
          </div>
        </section>
      )}

      {/* ── Further Research ─────────────────────────────────────────────── */}
      {intel.furtherResearchAreas.length > 0 && (
        <section aria-labelledby="intel-further">
          <h3 id="intel-further" className="text-sm font-semibold mb-2">Further Research Areas</h3>
          <div className="space-y-1.5">
            {intel.furtherResearchAreas.map(area => (
              <button key={area.area} className="w-full text-left rounded-lg border bg-muted/20 hover:bg-muted/40 p-2.5 space-y-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => area.linkPath && setLocation(area.linkPath)}>
                <p className="text-xs font-medium flex items-center gap-1">
                  <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />{area.area}
                </p>
                <p className="text-[10px] text-muted-foreground">{area.description}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Compliance disclaimer */}
      <p className="text-[11px] text-muted-foreground/60 italic border-t pt-3 leading-relaxed">
        {intel.disclaimer}
      </p>

      {/* Data freshness */}
      {intel.freshness.opportunityIntelligenceAt && (
        <p className="text-[11px] text-muted-foreground/50">
          Research data as of: {new Date(intel.freshness.opportunityIntelligenceAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Portfolio History tab (Sprint 2.6.0)
// ---------------------------------------------------------------------------

function PortfolioHistoryTab({ portfolioId }: { portfolioId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<string>("30D");
  const [showChanges, setShowChanges] = useState(false);

  const { data: historyData, isLoading: historyLoading } = useQuery<PortfolioHistoryResponse>({
    queryKey: [`/api/portfolio/${portfolioId}/history`, period],
    queryFn: () =>
      fetch(`/api/portfolio/${portfolioId}/history?period=${period}`)
        .then(r => r.json()),
  });

  const { data: changesData, isLoading: changesLoading } = useQuery<PortfolioChangesResponse>({
    queryKey: [`/api/portfolio/${portfolioId}/changes`],
    queryFn:  () =>
      fetch(`/api/portfolio/${portfolioId}/changes`).then(r => {
        if (!r.ok) return null;
        return r.json();
      }),
    enabled: showChanges,
  });

  const captureSnapshot = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/portfolio/${portfolioId}/snapshot`, { method: "POST" });
      if (!r.ok) throw new Error((await r.json()).error ?? "Failed");
      return r.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`/api/portfolio/${portfolioId}/history`] });
      toast({
        title: data.skipped ? "Snapshot already current" : "Snapshot captured",
        description: data.skipped
          ? "An identical snapshot was captured in the last 30 minutes."
          : `Portfolio state saved successfully.`,
      });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const snapshots = historyData?.snapshots ?? [];
  const changes   = changesData?.changes;

  const PERIODS = ["7D", "30D", "90D", "YTD", "1Y", "ALL"];

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1 flex-wrap" role="group" aria-label="History period">
          {PERIODS.map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                period === p
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
              aria-pressed={period === p}
            >
              {p}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => captureSnapshot.mutate()}
          disabled={captureSnapshot.isPending}
          aria-label="Capture portfolio snapshot"
        >
          <CircleDot className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
          {captureSnapshot.isPending ? "Capturing…" : "Capture Snapshot"}
        </Button>
      </div>

      {/* Snapshot timeline */}
      {historyLoading ? (
        <div className="flex justify-center py-8">
          <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading history…" />
        </div>
      ) : snapshots.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center space-y-2">
          <History className="h-8 w-8 text-muted-foreground mx-auto" aria-hidden="true" />
          <p className="text-sm font-medium">No portfolio snapshots yet</p>
          <p className="text-xs text-muted-foreground max-w-xs mx-auto">
            Snapshots are captured automatically after imports, broker syncs, and position changes.
            Click "Capture Snapshot" to create one now.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">{snapshots.length} snapshot{snapshots.length !== 1 ? "s" : ""} in {period}</p>
            {snapshots.length >= 2 && (
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={() => setShowChanges(v => !v)}
              >
                {showChanges ? "Hide Changes" : "View Changes"}
              </Button>
            )}
          </div>

          {/* Snapshot cards */}
          <ol className="space-y-2" role="list">
            {snapshots.map(snap => (
              <li key={snap.id} role="listitem">
                <div className="rounded-lg border bg-card p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">
                        {new Date(snap.capturedAt).toLocaleString("en-US", {
                          month: "short", day: "numeric",
                          hour: "2-digit", minute: "2-digit",
                        })}
                      </span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {sourceTypeLabel(snap.sourceType)}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{snap.positionCount} position{snap.positionCount !== 1 ? "s" : ""}</span>
                      <span>{fmtCurrency(snap.totalMarketValue)}</span>
                      <span className="text-[10px]">{snap.coverage.coveragePercent}% priced</span>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* "What Changed?" section */}
      {showChanges && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" aria-hidden="true" />
            <h3 className="text-sm font-semibold">What Changed?</h3>
          </div>

          {changesLoading ? (
            <div className="flex justify-center py-4">
              <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : !changes ? (
            <p className="text-xs text-muted-foreground">
              At least two snapshots are needed to compare changes.
            </p>
          ) : (
            <div className="space-y-4">
              {/* Summary strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { label: "Portfolio Value", value: fmtCurrency(changes.summary.currentValue), sub: changes.summary.valueChange !== null ? `${fmtPct(changes.summary.valueChangePercent)} change` : "—" },
                  { label: "Positions", value: String(changes.summary.currentPositionCount), sub: `${fmtQtyDelta(changes.summary.positionCountChange)} from previous` },
                  { label: "New Positions", value: String(changes.addedPositions.length), sub: changes.addedPositions.map(p => p.symbol).join(", ") || "None" },
                  { label: "Research Changes", value: String(changes.researchStrengthened.length + changes.researchWeakened.length), sub: `${changes.researchStrengthened.length} improved · ${changes.researchWeakened.length} weakened` },
                ].map(({ label, value, sub }) => (
                  <div key={label} className="rounded-lg border bg-muted/30 p-2.5 space-y-0.5">
                    <p className="text-[10px] text-muted-foreground">{label}</p>
                    <p className="text-sm font-semibold">{value}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{sub}</p>
                  </div>
                ))}
              </div>

              {/* Position changes */}
              {(changes.addedPositions.length + changes.exitedPositions.length +
                changes.increasedPositions.length + changes.reducedPositions.length) > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Position Changes</p>
                  <div className="space-y-1">
                    {[...changes.addedPositions, ...changes.exitedPositions,
                       ...changes.increasedPositions, ...changes.reducedPositions].map(p => (
                      <div key={`${p.symbol}-${p.changeType}`} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-muted/30 text-xs">
                        <div className="flex items-center gap-1.5">
                          <PositionChangeIcon type={p.changeType} />
                          <span className="font-mono font-medium">{p.symbol}</span>
                          {p.sector && <span className="text-muted-foreground text-[10px]">{p.sector}</span>}
                        </div>
                        <span className="text-muted-foreground shrink-0">
                          {p.changeType === "NEW" ? `+${fmtNumber(p.currentQuantity)} shares`
                            : p.changeType === "EXITED" ? `−${fmtNumber(p.previousQuantity)} shares`
                            : fmtQtyDelta(p.quantityDelta) + " shares"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Research evidence changes */}
              {(changes.researchStrengthened.length + changes.researchWeakened.length +
                changes.newlyQualified.length + changes.noLongerQualified.length) > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Research Evidence</p>
                  <div className="space-y-1">
                    {[
                      ...changes.researchStrengthened.map(r => ({ ...r, _label: "Strengthened", _color: "text-green-600" })),
                      ...changes.researchWeakened.map(r => ({ ...r, _label: "Weakened", _color: "text-amber-600" })),
                      ...changes.newlyQualified.map(r => ({ ...r, _label: "Newly Qualified", _color: "text-blue-600" })),
                      ...changes.noLongerQualified.map(r => ({ ...r, _label: "No Longer Qualified", _color: "text-destructive" })),
                    ].map(r => (
                      <div key={`${r.symbol}-${r.changeType}`} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-muted/30 text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className={`font-medium text-[10px] ${r._color}`}>{r._label}</span>
                          <span className="font-mono font-medium">{r.symbol}</span>
                        </div>
                        {r.scoreDelta !== null && (
                          <span className="text-muted-foreground shrink-0">
                            Score {fmtQtyDelta(r.scoreDelta)} pts
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Exposure changes */}
              {changes.sectorChanges.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Sector Exposure Changes</p>
                  <div className="space-y-1">
                    {changes.sectorChanges.map(e => (
                      <div key={e.name} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-muted/30 text-xs">
                        <span className="font-medium">{e.name}</span>
                        <span className={`shrink-0 ${(e.percentDelta ?? 0) > 0 ? "text-blue-600" : "text-amber-600"}`}>
                          {fmtPct(e.percentDelta)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Limitations */}
              {changes.limitations.length > 0 && (
                <div className="rounded-lg bg-muted/40 border px-3 py-2 space-y-0.5">
                  {changes.limitations.map(l => (
                    <p key={l} className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                      <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" aria-hidden="true" /> {l}
                    </p>
                  ))}
                </div>
              )}

              {/* Data freshness */}
              <div className="text-[11px] text-muted-foreground space-y-0.5 pt-1 border-t">
                <p>Comparing: {new Date(changes.dataFreshness.fromSnapshotAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} → {new Date(changes.dataFreshness.toSnapshotAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                <p>{changes.dataFreshness.institutionalDataNote}</p>
              </div>
            </div>
          )}

          {/* Compliance disclaimer */}
          {changesData?.disclaimer && (
            <p className="text-[11px] text-muted-foreground/60 italic border-t pt-2">
              {changesData.disclaimer}
            </p>
          )}
        </div>
      )}

      {/* Compliance disclaimer */}
      {historyData?.disclaimer && snapshots.length > 0 && (
        <p className="text-[11px] text-muted-foreground/60 italic border-t pt-2">
          {historyData.disclaimer}
        </p>
      )}
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
  const [activeTab,   setActiveTab]   = useState<"holdings" | "history" | "intelligence">("holdings");

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

      {/* Tab switcher */}
      <div className="flex gap-1 border-b" role="tablist" aria-label="Portfolio sections">
        {([
          { id: "holdings",      label: "Holdings" },
          { id: "history",       label: "History",      icon: History },
          { id: "intelligence",  label: "Intelligence", icon: Activity },
        ] as const).map(tab => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring -mb-px ${
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {"icon" in tab && tab.icon ? <tab.icon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "history" ? (
        <PortfolioHistoryTab portfolioId={portfolio.id} />
      ) : activeTab === "intelligence" ? (
        <PortfolioIntelligenceTab portfolioId={portfolio.id} />
      ) : isLoading ? (
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
