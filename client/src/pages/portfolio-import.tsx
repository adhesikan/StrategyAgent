import { useState, useRef, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Upload, FileSpreadsheet, AlertTriangle, CheckCircle2,
  ChevronLeft, ChevronRight, Trash2, RefreshCw, Info,
  Shield, Lock, HelpCircle, CheckCheck,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NormalizedPosition {
  symbol:      string;
  quantity:    number;
  averageCost: number | null;
  costBasis:   number | null;
  currency:    string;
  warnings:    string[];
}

interface InvalidRow {
  rowIndex: number;
  raw:      Record<string, unknown>;
  reason:   string;
}

interface SheetInfo {
  availableSheets: string[];
  selectedSheet:   string;
}

interface PreviewResponse {
  previewId:           string;
  parsedRows:          number;
  validRows:           number;
  invalidRows:         InvalidRow[];
  warnings:            string[];
  normalizedPositions: NormalizedPosition[];
  sheetInfo?:          SheetInfo;
  expiresInSeconds:    number;
}

interface Portfolio {
  id:   string;
  name: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtCurrency(v: number | null): string {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
}

const SAFETY_BULLETS = [
  { icon: Shield,      text: "Maximum 500 holdings"              },
  { icon: Lock,        text: "Nothing uploaded until confirmation" },
  { icon: Shield,      text: "Formula cells ignored"             },
  { icon: CheckCheck,  text: "Unknown columns safely ignored"    },
  { icon: Lock,        text: "Broker credentials never required" },
  { icon: Shield,      text: "Files processed securely"          },
];

// ---------------------------------------------------------------------------
// Step 1: File picker — enhanced per §6
// ---------------------------------------------------------------------------

function StepUpload({
  onPreview,
}: {
  onPreview: (preview: PreviewResponse, fileType: "csv" | "xlsx") => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging]   = useState(false);
  const [file, setFile]           = useState<File | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [fileType, setFileType]   = useState<"csv" | "xlsx">("csv");

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("No file selected");
      const fd = new FormData();
      fd.append("file", file);
      if (fileType === "xlsx") fd.append("sheetIndex", String(sheetIndex));
      const endpoint = fileType === "csv" ? "/api/portfolio/import/csv" : "/api/portfolio/import/xlsx";
      const r = await fetch(endpoint, { method: "POST", body: fd });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: r.statusText }));
        throw new Error(err.error ?? "Upload failed");
      }
      return r.json() as Promise<PreviewResponse>;
    },
    onSuccess: (data) => onPreview(data, fileType),
    onError: (err: Error) => toast({ title: "Upload failed", description: err.message, variant: "destructive" }),
  });

  function handleFile(f: File) {
    const ext = f.name.split(".").pop()?.toLowerCase();
    if (ext === "xlsx" || ext === "xls") setFileType("xlsx");
    else setFileType("csv");
    setFile(f);
  }

  // Keyboard support for drop zone
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileRef.current?.click();
    }
  }, []);

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      <div>
        <h2 className="text-xl font-semibold">Import Holdings</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Upload a CSV or Excel spreadsheet. We support common column names like Ticker, Symbol,
          Shares, Quantity, Average Cost, etc.
        </p>
      </div>

      {/* Drop zone with keyboard support */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Drop zone: click or press Enter to select a file"
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          dragging ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary/50"
        }`}
        onClick={() => fileRef.current?.click()}
        onKeyDown={handleKeyDown}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files[0];
          if (f) handleFile(f);
        }}
      >
        <FileSpreadsheet className="h-10 w-10 mx-auto mb-3 text-muted-foreground" aria-hidden="true" />
        {file ? (
          <div>
            <p className="font-medium">{file.name}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {(file.size / 1024).toFixed(1)} KB · {fileType.toUpperCase()}
            </p>
          </div>
        ) : (
          <div>
            <p className="font-medium">Drop your spreadsheet here</p>
            <p className="text-sm text-muted-foreground mt-1">or press Enter to browse</p>
            <p className="text-xs text-muted-foreground mt-0.5">CSV or XLSX · max 5 MB</p>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          aria-hidden="true"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
      </div>

      {/* Supported files safety info — §6 */}
      <div
        className="rounded-xl border bg-muted/20 p-4 space-y-3"
        role="region"
        aria-label="Supported file information"
        data-testid="file-safety-info"
      >
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
          <p className="text-sm font-medium">Supported Files</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs">CSV</Badge>
          <Badge variant="outline" className="text-xs">Excel (.xlsx)</Badge>
        </div>
        <Separator />
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5" role="list" aria-label="File constraints">
          {SAFETY_BULLETS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-2 text-xs text-muted-foreground" role="listitem">
              <Icon className="h-3 w-3 text-green-500 shrink-0" aria-hidden="true" />
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Recognized headers */}
      <div className="rounded-lg border border-muted bg-muted/20 p-4 text-xs space-y-1 text-muted-foreground">
        <p className="font-medium text-foreground mb-2">Recognized column headers</p>
        <p><strong>Ticker:</strong> Ticker, Symbol, Sym, Stock, Security</p>
        <p><strong>Quantity:</strong> Shares, Quantity, Qty, Units</p>
        <p><strong>Avg Cost:</strong> Average Cost, Avg Cost, Cost Basis Per Share, Price</p>
        <p><strong>Cost Basis:</strong> Cost Basis, Total Cost, Book Value</p>
        <p className="text-muted-foreground/60 mt-2 italic">Unknown columns are ignored.</p>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <Button
          className="flex-1"
          onClick={() => upload.mutate()}
          disabled={!file || upload.isPending}
          aria-label={file ? `Preview import of ${file.name}` : "Select a file first"}
        >
          {upload.isPending ? (
            <><RefreshCw className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" /> Parsing…</>
          ) : (
            <><Upload className="h-4 w-4 mr-2" aria-hidden="true" /> Preview Import</>
          )}
        </Button>
        {file && (
          <Button
            variant="ghost"
            onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ""; }}
            aria-label="Clear selected file"
          >
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preview summary — §7
// ---------------------------------------------------------------------------

function PreviewSummary({ preview, positions }: { preview: PreviewResponse; positions: NormalizedPosition[] }) {
  const uniqueSymbols    = new Set(positions.map(p => p.symbol)).size;
  const duplicateSymbols = preview.parsedRows > 0 ? Math.max(0, preview.validRows - uniqueSymbols) : 0;
  const missingAvgCost   = positions.filter(p => p.averageCost == null).length;
  const missingCostBasis = positions.filter(p => p.costBasis   == null).length;
  const estimatedCB      = positions.reduce((s, p) => s + (p.costBasis ?? 0), 0);
  const estimatedMV      = positions.reduce((s, p) => {
    // market value not available at import time — requires stored bars
    return s;
  }, 0);

  const rows: Array<{ label: string; value: string | number; tooltip?: string }> = [
    { label: "Detected Holdings",   value: positions.length },
    { label: "Unique Symbols",      value: uniqueSymbols },
    { label: "Duplicate Symbols",   value: duplicateSymbols > 0 ? duplicateSymbols : "—", tooltip: "Duplicates are consolidated with weighted-average cost." },
    { label: "Missing Average Cost", value: missingAvgCost  > 0 ? missingAvgCost   : "—", tooltip: "Average cost is optional. G/L will not be calculated for these positions." },
    { label: "Missing Cost Basis",  value: missingCostBasis > 0 ? missingCostBasis : "—" },
    { label: "Estimated Cost Basis", value: estimatedCB > 0 ? fmtCurrency(estimatedCB) : "—", tooltip: "Sum of all imported cost basis values." },
    { label: "Est. Market Value",   value: "—", tooltip: "Market value is computed after import using stored daily bar prices." },
  ];

  return (
    <TooltipProvider>
      <Card data-testid="preview-summary">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Portfolio Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {rows.map(({ label, value, tooltip }) => (
              <div key={label} className="space-y-0.5">
                <dt className="text-xs text-muted-foreground flex items-center gap-1">
                  {label}
                  {tooltip && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-3 w-3 cursor-help shrink-0" aria-label={`${label} explanation`} />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs max-w-xs">
                        {tooltip}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </dt>
                <dd className="font-semibold text-sm">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Preview + edit — enhanced per §7
// ---------------------------------------------------------------------------

function StepPreview({
  preview,
  fileType,
  onConfirm,
  onBack,
}: {
  preview:   PreviewResponse;
  fileType:  "csv" | "xlsx";
  onConfirm: (portfolioId: string, portfolioName: string) => void;
  onBack:    () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [positions, setPositions]           = useState<NormalizedPosition[]>(preview.normalizedPositions);
  const [portfolioName, setPortfolioName]   = useState(`Imported Portfolio ${new Date().toLocaleDateString()}`);
  const [targetPortfolioId, setTargetPortfolioId] = useState<string>("");

  const { data: existingPortfolios } = useQuery<Portfolio[]>({ queryKey: ["/api/portfolio"] });

  const confirm = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        previewId: preview.previewId,
        editedPositions: positions.map(p => ({
          symbol:      p.symbol,
          quantity:    p.quantity,
          averageCost: p.averageCost,
        })),
      };
      if (targetPortfolioId) {
        body.portfolioId = targetPortfolioId;
      } else {
        body.portfolioName = portfolioName;
      }
      const r = await fetch("/api/portfolio/import/confirm", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: r.statusText }));
        throw new Error(err.error ?? "Confirm failed");
      }
      return r.json() as Promise<{ portfolioId: string; portfolioName: string; importedCount: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
      onConfirm(data.portfolioId, data.portfolioName);
    },
    onError: (err: Error) => toast({ title: "Import failed", description: err.message, variant: "destructive" }),
  });

  function removePosition(idx: number) {
    setPositions(ps => ps.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-5">
      {/* Back + header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1" aria-label="Go back to upload">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Back
        </Button>
        <div>
          <h2 className="text-xl font-semibold">Review Import</h2>
          <p className="text-sm text-muted-foreground">
            {preview.parsedRows} rows parsed · {positions.length} valid · {preview.invalidRows.length} skipped
          </p>
        </div>
      </div>

      {/* Portfolio summary — §7 */}
      <PreviewSummary preview={preview} positions={positions} />

      {/* Sheet info */}
      {preview.sheetInfo && preview.sheetInfo.availableSheets.length > 1 && (
        <div
          className="flex items-start gap-2 text-sm bg-blue-500/10 rounded-lg px-3 py-2 border border-blue-500/20"
          role="note"
          aria-label="Multiple sheets detected"
        >
          <Info className="h-4 w-4 mt-0.5 text-blue-500 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium text-blue-700 dark:text-blue-400">Multiple sheets detected</p>
            <p className="text-muted-foreground">
              Showing: <strong>{preview.sheetInfo.selectedSheet}</strong>.
              Available: {preview.sheetInfo.availableSheets.join(", ")}.
            </p>
          </div>
        </div>
      )}

      {/* Warnings */}
      {preview.warnings.length > 0 && (
        <div
          className="flex items-start gap-2 text-sm bg-yellow-500/10 rounded-lg px-3 py-2 border border-yellow-500/20"
          role="alert"
          aria-live="polite"
        >
          <AlertTriangle className="h-4 w-4 mt-0.5 text-yellow-500 shrink-0" aria-hidden="true" />
          <div className="space-y-0.5">
            {preview.warnings.map((w, i) => <p key={i}>{w}</p>)}
          </div>
        </div>
      )}

      {/* Invalid rows */}
      {preview.invalidRows.length > 0 && (
        <div
          className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 space-y-1"
          role="alert"
          aria-live="polite"
          data-testid="invalid-rows"
        >
          <p className="text-sm font-medium text-red-600 dark:text-red-400">
            {preview.invalidRows.length} row{preview.invalidRows.length > 1 ? "s" : ""} could not be imported:
          </p>
          {preview.invalidRows.slice(0, 5).map((r, i) => (
            <p key={i} className="text-xs text-muted-foreground">Row {r.rowIndex + 2}: {r.reason}</p>
          ))}
          {preview.invalidRows.length > 5 && (
            <p className="text-xs text-muted-foreground">…and {preview.invalidRows.length - 5} more</p>
          )}
        </div>
      )}

      {/* Editable positions table — scrollable on mobile */}
      <div
        className="rounded border overflow-x-auto"
        role="region"
        aria-label="Import preview table"
      >
        <table className="w-full text-sm min-w-[420px]">
          <thead>
            <tr className="bg-muted/30 text-muted-foreground border-b">
              <th className="text-left px-3 py-2 font-medium" scope="col">Symbol</th>
              <th className="text-right px-3 py-2 font-medium" scope="col">Quantity</th>
              <th className="text-right px-3 py-2 font-medium" scope="col">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger className="inline-flex items-center gap-1 cursor-help">
                      Avg Cost <HelpCircle className="h-3 w-3" aria-hidden="true" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs max-w-xs">
                      Average price paid per share. Used to calculate unrealized gain/loss.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </th>
              <th className="text-right px-3 py-2 font-medium" scope="col">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger className="inline-flex items-center gap-1 cursor-help">
                      Cost Basis <HelpCircle className="h-3 w-3" aria-hidden="true" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs max-w-xs">
                      Total amount invested in this position (quantity × average cost).
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </th>
              <th className="px-3 py-2 w-8" scope="col"><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p, i) => (
              <tr key={i} className="border-b last:border-0 hover:bg-muted/10 focus-within:bg-muted/10">
                <td className="px-3 py-2 font-medium">
                  {p.symbol}
                  {p.warnings.length > 0 && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="ml-1 inline-block cursor-help">
                            <AlertTriangle className="inline h-3 w-3 text-yellow-500" aria-label={`Warning: ${p.warnings.join("; ")}`} />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="text-xs max-w-xs">
                          {p.warnings.join("; ")}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </td>
                <td className="px-3 py-2 text-right">{p.quantity.toLocaleString()}</td>
                <td className="px-3 py-2 text-right">{fmtCurrency(p.averageCost)}</td>
                <td className="px-3 py-2 text-right">{fmtCurrency(p.costBasis)}</td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => removePosition(i)}
                    className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Remove ${p.symbol} from import`}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {positions.length === 0 && (
        <div className="text-center py-8 text-muted-foreground" role="status">
          All positions removed. Go back to re-upload.
        </div>
      )}

      {/* Portfolio target */}
      <div className="space-y-3 border rounded-lg p-4">
        <p className="text-sm font-medium">Save to portfolio</p>
        {existingPortfolios && existingPortfolios.length > 0 && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground" htmlFor="target-portfolio">
              Replace existing portfolio (optional)
            </Label>
            <Select value={targetPortfolioId} onValueChange={setTargetPortfolioId}>
              <SelectTrigger id="target-portfolio" className="h-8 text-sm">
                <SelectValue placeholder="— Create new portfolio —" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">— Create new portfolio —</SelectItem>
                {existingPortfolios.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {!targetPortfolioId && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground" htmlFor="portfolio-name">
              New portfolio name
            </Label>
            <Input
              id="portfolio-name"
              value={portfolioName}
              onChange={e => setPortfolioName(e.target.value)}
              className="h-8 text-sm"
              placeholder="My Portfolio"
              aria-label="Portfolio name"
            />
          </div>
        )}
        {targetPortfolioId && (
          <p className="text-xs text-yellow-600 dark:text-yellow-400" role="alert">
            <AlertTriangle className="inline h-3 w-3 mr-1" aria-hidden="true" />
            All existing positions in this portfolio will be replaced.
          </p>
        )}
      </div>

      <Button
        className="w-full"
        onClick={() => confirm.mutate()}
        disabled={positions.length === 0 || confirm.isPending}
        aria-label={`Confirm import of ${positions.length} position${positions.length !== 1 ? "s" : ""}`}
      >
        {confirm.isPending ? (
          <><RefreshCw className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" /> Importing…</>
        ) : (
          <>
            <CheckCircle2 className="h-4 w-4 mr-2" aria-hidden="true" />
            Confirm Import ({positions.length} position{positions.length !== 1 ? "s" : ""})
          </>
        )}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3: Success
// ---------------------------------------------------------------------------

function StepSuccess({ portfolioId, portfolioName }: { portfolioId: string; portfolioName: string }) {
  const [, setLocation] = useLocation();
  return (
    <div
      className="max-w-md mx-auto text-center space-y-5 py-12"
      role="status"
      aria-live="polite"
      data-testid="success-screen"
    >
      <CheckCircle2 className="h-14 w-14 text-green-500 mx-auto" aria-hidden="true" />
      <div>
        <h2 className="text-2xl font-bold">Import complete</h2>
        <p className="text-muted-foreground mt-1">{portfolioName} is ready.</p>
        <p className="text-sm text-muted-foreground mt-2">
          Market prices will be enriched from stored daily bar data.
        </p>
      </div>
      <Button
        onClick={() => setLocation("/portfolio")}
        className="w-full"
        aria-label="View your portfolio"
      >
        View Portfolio <ChevronRight className="h-4 w-4 ml-1" aria-hidden="true" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

type Step = "upload" | "preview" | "success";

export default function PortfolioImportPage() {
  const [step,               setStep]               = useState<Step>("upload");
  const [preview,            setPreview]            = useState<PreviewResponse | null>(null);
  const [fileType,           setFileType]           = useState<"csv" | "xlsx">("csv");
  const [confirmedPortfolio, setConfirmedPortfolio] = useState<{ id: string; name: string } | null>(null);
  const [, setLocation] = useLocation();

  const stepLabels: Record<Step, string> = {
    upload:  "Upload",
    preview: "Review",
    success: "Complete",
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-3xl mx-auto px-4 py-8">

        {/* Breadcrumb — §10 */}
        <nav aria-label="Breadcrumb" className="mb-6">
          <ol className="flex items-center gap-1 text-sm text-muted-foreground flex-wrap" role="list">
            <li role="listitem">
              <button
                onClick={() => setLocation("/")}
                className="hover:text-foreground focus-visible:outline-none focus-visible:underline"
              >
                Home
              </button>
            </li>
            <li role="listitem" aria-hidden="true"><ChevronRight className="h-3.5 w-3.5" /></li>
            <li role="listitem">
              <button
                onClick={() => setLocation("/portfolio")}
                className="hover:text-foreground focus-visible:outline-none focus-visible:underline"
              >
                Portfolio
              </button>
            </li>
            <li role="listitem" aria-hidden="true"><ChevronRight className="h-3.5 w-3.5" /></li>
            <li role="listitem" className="text-foreground font-medium">Portfolio Import</li>
          </ol>
        </nav>

        {/* Step indicator */}
        <div
          className="flex items-center gap-2 mb-8"
          role="progressbar"
          aria-label="Import progress"
          aria-valuenow={step === "upload" ? 1 : step === "preview" ? 2 : 3}
          aria-valuemin={1}
          aria-valuemax={3}
        >
          {(["upload", "preview", "success"] as Step[]).map((s, i, arr) => {
            const stepIndex  = arr.indexOf(step);
            const thisIndex  = i;
            const isActive   = s === step;
            const isComplete = thisIndex < stepIndex;
            return (
              <div key={s} className="flex items-center gap-2">
                <div
                  className={`flex items-center gap-2 text-xs font-medium transition-colors ${
                    isActive   ? "text-foreground" :
                    isComplete ? "text-green-600 dark:text-green-400" :
                    "text-muted-foreground"
                  }`}
                  aria-current={isActive ? "step" : undefined}
                >
                  <div className={`h-5 w-5 rounded-full flex items-center justify-center text-[11px] font-bold ${
                    isComplete ? "bg-green-500 text-white" :
                    isActive   ? "bg-primary text-primary-foreground" :
                    "bg-muted text-muted-foreground"
                  }`}>
                    {isComplete ? <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> : i + 1}
                  </div>
                  <span>{stepLabels[s]}</span>
                </div>
                {i < arr.length - 1 && (
                  <div className={`h-px flex-1 w-8 ${isComplete ? "bg-green-500" : "bg-border"}`} aria-hidden="true" />
                )}
              </div>
            );
          })}
        </div>

        {step === "upload" && (
          <StepUpload
            onPreview={(p, ft) => {
              setPreview(p);
              setFileType(ft);
              setStep("preview");
            }}
          />
        )}

        {step === "preview" && preview && (
          <StepPreview
            preview={preview}
            fileType={fileType}
            onBack={() => setStep("upload")}
            onConfirm={(id, name) => {
              setConfirmedPortfolio({ id, name });
              setStep("success");
            }}
          />
        )}

        {step === "success" && confirmedPortfolio && (
          <StepSuccess portfolioId={confirmedPortfolio.id} portfolioName={confirmedPortfolio.name} />
        )}
      </div>
    </div>
  );
}
