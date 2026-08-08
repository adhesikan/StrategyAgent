/**
 * Portfolio Document Import — Sprint 2.4.1
 *
 * Handles image (screenshot) and PDF brokerage statement imports.
 * Uses the same preview → confirm flow as the spreadsheet import page.
 * AI extraction happens server-side; client only shows progress and preview.
 */

import { useState, useRef, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import {
  Camera, FileText, Upload, CheckCircle2, AlertTriangle,
  ChevronLeft, ChevronRight, Trash2, RefreshCw, Info,
  HelpCircle, Cpu, Shield, Eye, AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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

type DocumentType = "image" | "pdf";
type ExtractionConfidence = "high" | "medium" | "low";

interface ExtractedPosition {
  symbol:      string;
  quantity:    number;
  averageCost: number | null;
  costBasis:   number | null;
  currency:    string;
  warnings:    string[];
  confidence?: ExtractionConfidence;
  marketValue?: number | null;
}

interface InvalidRow {
  rowIndex: number;
  raw:      Record<string, unknown>;
  reason:   string;
}

interface ExtractionMetadata {
  detectedInstitution?: string | null;
  detectedPeriod?:      string | null;
  extractionWarnings:   string[];
  lowConfidenceCount:   number;
}

interface ExtractionTelemetry {
  sourceType:           "image" | "pdf";
  processingDurationMs: number;
  rowsDetected:         number;
  rowsValid:            number;
  rowsInvalid:          number;
  lowConfidenceCount:   number;
  resultStatus:         string;
}

interface PreviewResponse {
  previewId:           string;
  parsedRows:          number;
  validRows:           number;
  invalidRows:         InvalidRow[];
  warnings:            string[];
  normalizedPositions: ExtractedPosition[];
  metadata?:           ExtractionMetadata;
  telemetry?:          ExtractionTelemetry;
  expiresInSeconds:    number;
}

interface Portfolio {
  id:   string;
  name: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtCurrency(v: number | null | undefined): string {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
}

const CONFIDENCE_CONFIG: Record<ExtractionConfidence, { label: string; className: string }> = {
  high:   { label: "High confidence",  className: "text-green-600 dark:text-green-400 bg-green-500/10 border-green-500/20" },
  medium: { label: "Needs review",     className: "text-yellow-600 dark:text-yellow-400 bg-yellow-500/10 border-yellow-500/20" },
  low:    { label: "Could not verify", className: "text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/20" },
};

// ---------------------------------------------------------------------------
// Document type config
// ---------------------------------------------------------------------------

const DOC_CONFIG: Record<DocumentType, {
  icon:         React.ComponentType<{ className?: string }>;
  title:        string;
  subtitle:     string;
  dropLabel:    string;
  formats:      string;
  accept:       string;
  analyzeMsg:   string;
  endpoint:     string;
  maxSizeMb:    number;
  tipBullets:   string[];
}> = {
  image: {
    icon:      Camera,
    title:     "Import Portfolio Screenshot",
    subtitle:  "Upload a screenshot of your brokerage holdings. AI will extract your positions for review.",
    dropLabel: "Drop your screenshot here",
    formats:   "PNG · JPG · WEBP",
    accept:    ".png,.jpg,.jpeg,.webp,image/png,image/jpg,image/jpeg,image/webp",
    analyzeMsg:"Analyzing screenshot with AI…",
    endpoint:  "/api/portfolio/import/image",
    maxSizeMb: 10,
    tipBullets: [
      "Capture the full holdings / positions table",
      "Include column headers in the screenshot",
      "Higher resolution = better extraction accuracy",
      "Always review extracted holdings before confirming",
    ],
  },
  pdf: {
    icon:      FileText,
    title:     "Import Brokerage Statement",
    subtitle:  "Upload a PDF brokerage statement. AI will locate and extract your holdings for review.",
    dropLabel: "Drop your PDF statement here",
    formats:   "PDF only · max 15 MB · max 50 pages",
    accept:    ".pdf,application/pdf",
    analyzeMsg:"Extracting holdings from PDF…",
    endpoint:  "/api/portfolio/import/pdf",
    maxSizeMb: 15,
    tipBullets: [
      "Text-based PDFs work best",
      "Scanned-image PDFs may not extract correctly",
      "Holdings / portfolio summary section is key",
      "Always review extracted holdings before confirming",
    ],
  },
};

// ---------------------------------------------------------------------------
// Step 1: Document upload
// ---------------------------------------------------------------------------

function StepUpload({
  docType,
  onPreview,
}: {
  docType:   DocumentType;
  onPreview: (p: PreviewResponse) => void;
}) {
  const { toast } = useToast();
  const fileRef    = useRef<HTMLInputElement>(null);
  const [file, setFile]       = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const cfg = DOC_CONFIG[docType];
  const Icon = cfg.icon;

  const extract = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("No file selected");
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(cfg.endpoint, { method: "POST", body: fd });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: r.statusText }));
        throw new Error(err.error ?? "Extraction failed");
      }
      return r.json() as Promise<PreviewResponse>;
    },
    onSuccess: onPreview,
    onError: (err: Error) => toast({
      title:       "Extraction failed",
      description: err.message,
      variant:     "destructive",
    }),
  });

  const handleFile = useCallback((f: File) => {
    if (f.size > cfg.maxSizeMb * 1024 * 1024) {
      toast({
        title:       "File too large",
        description: `Maximum size is ${cfg.maxSizeMb} MB.`,
        variant:     "destructive",
      });
      return;
    }
    setFile(f);
  }, [cfg.maxSizeMb, toast]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileRef.current?.click(); }
  }, []);

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      <div>
        <h2 className="text-xl font-semibold">{cfg.title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{cfg.subtitle}</p>
      </div>

      {/* AI processing notice */}
      <div
        className="flex items-start gap-2.5 rounded-lg border border-blue-500/20 bg-blue-500/8 px-4 py-3 text-sm"
        role="note"
      >
        <Cpu className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          <p className="font-medium text-blue-700 dark:text-blue-400">AI-powered extraction</p>
          <p className="text-muted-foreground text-xs mt-0.5">
            Extraction accuracy varies. Always review detected holdings before confirming.
            Your file is not stored after extraction.
          </p>
        </div>
      </div>

      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label={`Drop zone: click or press Enter to select a ${docType === "image" ? "screenshot" : "PDF"}`}
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
        <Icon className="h-10 w-10 mx-auto mb-3 text-muted-foreground" aria-hidden="true" />
        {file ? (
          <div>
            <p className="font-medium">{file.name}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {(file.size / 1024).toFixed(1)} KB
            </p>
          </div>
        ) : (
          <div>
            <p className="font-medium">{cfg.dropLabel}</p>
            <p className="text-sm text-muted-foreground mt-1">or press Enter to browse</p>
            <p className="text-xs text-muted-foreground mt-0.5">{cfg.formats}</p>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept={cfg.accept}
          className="hidden"
          aria-hidden="true"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
      </div>

      {/* Tips */}
      <div className="rounded-lg border bg-muted/20 p-4 space-y-2">
        <p className="text-xs font-medium text-foreground">Tips for best results</p>
        <ul className="space-y-1" role="list">
          {cfg.tipBullets.map(tip => (
            <li key={tip} className="flex items-center gap-2 text-xs text-muted-foreground" role="listitem">
              <Shield className="h-3 w-3 text-green-500 shrink-0" aria-hidden="true" />
              {tip}
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1 border-t">
          <Shield className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span>Your file is processed in memory only and is not stored.</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <Button
          className="flex-1"
          onClick={() => extract.mutate()}
          disabled={!file || extract.isPending}
          aria-label={file ? `Extract holdings from ${file.name}` : "Select a file first"}
        >
          {extract.isPending ? (
            <><RefreshCw className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" /> {cfg.analyzeMsg}</>
          ) : (
            <><Upload className="h-4 w-4 mr-2" aria-hidden="true" /> Extract Holdings</>
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
// Preview summary with extraction metadata
// ---------------------------------------------------------------------------

function ExtractionSummary({
  preview,
  positions,
}: {
  preview:   PreviewResponse;
  positions: ExtractedPosition[];
}) {
  const metadata = preview.metadata;
  const uniqueSymbols      = new Set(positions.map(p => p.symbol)).size;
  const missingAvgCost     = positions.filter(p => p.averageCost == null).length;
  const lowConfidenceCount = positions.filter(p => p.confidence === "low" || p.confidence === "medium").length;

  return (
    <Card data-testid="extraction-summary">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Eye className="h-4 w-4 text-primary" aria-hidden="true" />
          Extraction Summary
        </CardTitle>
        {(metadata?.detectedInstitution || metadata?.detectedPeriod) && (
          <CardDescription className="text-xs">
            {metadata.detectedInstitution && <span className="font-medium">{metadata.detectedInstitution}</span>}
            {metadata.detectedInstitution && metadata.detectedPeriod && " · "}
            {metadata.detectedPeriod}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-3">
          {[
            { label: "Positions Detected",  value: positions.length },
            { label: "Unique Symbols",      value: uniqueSymbols },
            { label: "Missing Avg Cost",    value: missingAvgCost  > 0 ? missingAvgCost  : "—" },
            { label: "Needs Review",        value: lowConfidenceCount > 0 ? lowConfidenceCount : "—",
              tooltip: "Fields with medium or low confidence should be manually verified before confirming." },
          ].map(({ label, value, tooltip }) => (
            <div key={label}>
              <TooltipProvider>
                <dt className="text-xs text-muted-foreground flex items-center gap-1">
                  {label}
                  {tooltip && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-3 w-3 cursor-help" aria-label={`${label} explanation`} />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs max-w-xs">{tooltip}</TooltipContent>
                    </Tooltip>
                  )}
                </dt>
              </TooltipProvider>
              <dd className="font-semibold text-sm">{value}</dd>
            </div>
          ))}
        </dl>

        {lowConfidenceCount > 0 && (
          <div
            className="flex items-start gap-2 text-xs rounded-md border border-yellow-500/20 bg-yellow-500/8 px-3 py-2"
            role="alert"
          >
            <AlertCircle className="h-3.5 w-3.5 text-yellow-500 shrink-0 mt-0.5" aria-hidden="true" />
            <span className="text-yellow-700 dark:text-yellow-400">
              {lowConfidenceCount} field{lowConfidenceCount > 1 ? "s need" : " needs"} review before confirming.
              Edit or remove uncertain rows.
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Review extracted positions
// ---------------------------------------------------------------------------

function StepPreview({
  preview,
  docType,
  onConfirm,
  onBack,
}: {
  preview:   PreviewResponse;
  docType:   DocumentType;
  onConfirm: (portfolioId: string, portfolioName: string) => void;
  onBack:    () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [positions, setPositions]           = useState<ExtractedPosition[]>(preview.normalizedPositions);
  const [portfolioName, setPortfolioName]   = useState(`${docType === "pdf" ? "Statement" : "Screenshot"} Import ${new Date().toLocaleDateString()}`);
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
    onSuccess: data => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
      onConfirm(data.portfolioId, data.portfolioName);
    },
    onError: (err: Error) => toast({ title: "Import failed", description: err.message, variant: "destructive" }),
  });

  function removePosition(idx: number) {
    setPositions(ps => ps.filter((_, i) => i !== idx));
  }

  const hasLowConfidence = positions.some(p => p.confidence === "low");

  return (
    <div className="space-y-5">
      {/* Back + header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1" aria-label="Go back to upload">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Back
        </Button>
        <div>
          <h2 className="text-xl font-semibold">Review Extracted Holdings</h2>
          <p className="text-sm text-muted-foreground">
            {positions.length} position{positions.length !== 1 ? "s" : ""} extracted
            {preview.invalidRows.length > 0 && ` · ${preview.invalidRows.length} skipped`}
          </p>
        </div>
      </div>

      {/* Extraction summary */}
      <ExtractionSummary preview={preview} positions={positions} />

      {/* Extraction warnings from AI */}
      {(preview.metadata?.extractionWarnings ?? []).length > 0 && (
        <div
          className="flex items-start gap-2 text-sm bg-yellow-500/10 rounded-lg px-3 py-2 border border-yellow-500/20"
          role="alert"
        >
          <AlertTriangle className="h-4 w-4 mt-0.5 text-yellow-500 shrink-0" aria-hidden="true" />
          <div className="space-y-0.5">
            {(preview.metadata!.extractionWarnings).map((w, i) => <p key={i} className="text-xs">{w}</p>)}
          </div>
        </div>
      )}

      {/* General warnings */}
      {preview.warnings.length > 0 && (
        <div
          className="flex items-start gap-2 text-sm bg-yellow-500/10 rounded-lg px-3 py-2 border border-yellow-500/20"
          role="alert"
        >
          <AlertTriangle className="h-4 w-4 mt-0.5 text-yellow-500 shrink-0" aria-hidden="true" />
          <div className="space-y-0.5">
            {preview.warnings.map((w, i) => <p key={i} className="text-xs">{w}</p>)}
          </div>
        </div>
      )}

      {/* Invalid rows */}
      {preview.invalidRows.length > 0 && (
        <div
          className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 space-y-1"
          role="alert"
          data-testid="invalid-rows"
        >
          <p className="text-sm font-medium text-red-600 dark:text-red-400">
            {preview.invalidRows.length} row{preview.invalidRows.length !== 1 ? "s" : ""} could not be imported:
          </p>
          {preview.invalidRows.slice(0, 5).map((r, i) => (
            <p key={i} className="text-xs text-muted-foreground">Row {r.rowIndex + 1}: {r.reason}</p>
          ))}
          {preview.invalidRows.length > 5 && (
            <p className="text-xs text-muted-foreground">…and {preview.invalidRows.length - 5} more</p>
          )}
        </div>
      )}

      {/* High-confidence warning */}
      {hasLowConfidence && (
        <div
          className="flex items-start gap-2 text-xs bg-orange-500/8 border border-orange-500/20 rounded-lg px-3 py-2"
          role="alert"
        >
          <AlertTriangle className="h-3.5 w-3.5 text-orange-500 shrink-0 mt-0.5" aria-hidden="true" />
          <span className="text-orange-700 dark:text-orange-400">
            Some positions have low confidence. Edit values or remove uncertain rows before confirming.
          </span>
        </div>
      )}

      {/* Editable positions table */}
      <div
        className="rounded border overflow-x-auto"
        role="region"
        aria-label="Extracted positions preview table"
        data-testid="extraction-preview-table"
      >
        <table className="w-full text-sm min-w-[520px]">
          <thead>
            <tr className="bg-muted/30 text-muted-foreground border-b">
              <th className="text-left px-3 py-2 font-medium" scope="col">Symbol</th>
              <th className="text-right px-3 py-2 font-medium" scope="col">Quantity</th>
              <th className="text-right px-3 py-2 font-medium" scope="col">Avg Cost</th>
              <th className="text-right px-3 py-2 font-medium" scope="col">Cost Basis</th>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <th className="text-center px-3 py-2 font-medium cursor-help" scope="col">
                      <span className="inline-flex items-center gap-1">
                        Confidence <HelpCircle className="h-3 w-3" aria-hidden="true" />
                      </span>
                    </th>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs max-w-xs">
                    AI confidence in the extracted values.
                    "Needs review" = manually verify before confirming.
                    "Could not verify" = consider removing this row.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <th className="px-3 py-2 w-8" scope="col"><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p, i) => {
              const conf = p.confidence ?? "high";
              const confCfg = CONFIDENCE_CONFIG[conf];
              return (
                <tr
                  key={i}
                  className={`border-b last:border-0 hover:bg-muted/10 ${conf === "low" ? "bg-red-500/5" : ""}`}
                >
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
                  <td className="px-3 py-2 text-center">
                    <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full border ${confCfg.className}`}>
                      {confCfg.label}
                    </span>
                  </td>
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
              );
            })}
          </tbody>
        </table>
      </div>

      {positions.length === 0 && (
        <div className="text-center py-8 text-muted-foreground" role="status">
          All positions removed. Go back to upload a different file.
        </div>
      )}

      {/* Portfolio target */}
      <div className="space-y-3 border rounded-lg p-4">
        <p className="text-sm font-medium">Save to portfolio</p>
        {existingPortfolios && existingPortfolios.length > 0 && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground" htmlFor="target-portfolio">
              Add to existing portfolio (optional)
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
            <Label className="text-xs text-muted-foreground" htmlFor="portfolio-name">New portfolio name</Label>
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

function StepSuccess({ portfolioId, portfolioName, docType }: {
  portfolioId: string;
  portfolioName: string;
  docType: DocumentType;
}) {
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
          Your {docType === "image" ? "screenshot" : "PDF"} was processed in memory and is no longer retained.
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

const STEP_LABELS: Record<Step, string> = {
  upload:  "Upload",
  preview: "Review",
  success: "Complete",
};

export default function PortfolioImportDocumentPage() {
  const search   = useSearch();
  const params   = new URLSearchParams(search);
  const rawType  = params.get("type");
  const docType: DocumentType = rawType === "pdf" ? "pdf" : "image";

  const [step, setStep]                           = useState<Step>("upload");
  const [preview, setPreview]                     = useState<PreviewResponse | null>(null);
  const [confirmedPortfolio, setConfirmedPortfolio] = useState<{ id: string; name: string } | null>(null);
  const [, setLocation] = useLocation();

  const cfg  = DOC_CONFIG[docType];
  const Icon = cfg.icon;

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-3xl mx-auto px-4 py-8">

        {/* Breadcrumb */}
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
            <li aria-hidden="true"><ChevronRight className="h-3.5 w-3.5" /></li>
            <li role="listitem">
              <button
                onClick={() => setLocation("/portfolio")}
                className="hover:text-foreground focus-visible:outline-none focus-visible:underline"
              >
                Portfolio
              </button>
            </li>
            <li aria-hidden="true"><ChevronRight className="h-3.5 w-3.5" /></li>
            <li role="listitem" className="text-foreground font-medium flex items-center gap-1.5">
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {docType === "image" ? "Screenshot Import" : "PDF Statement Import"}
            </li>
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
            const isActive   = s === step;
            const isComplete = i < stepIndex;
            return (
              <div key={s} className="flex items-center gap-2">
                <div
                  className={`flex items-center gap-2 text-xs font-medium ${
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
                  <span>{STEP_LABELS[s]}</span>
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
            docType={docType}
            onPreview={p => { setPreview(p); setStep("preview"); }}
          />
        )}

        {step === "preview" && preview && (
          <StepPreview
            preview={preview}
            docType={docType}
            onBack={() => setStep("upload")}
            onConfirm={(id, name) => { setConfirmedPortfolio({ id, name }); setStep("success"); }}
          />
        )}

        {step === "success" && confirmedPortfolio && (
          <StepSuccess
            portfolioId={confirmedPortfolio.id}
            portfolioName={confirmedPortfolio.name}
            docType={docType}
          />
        )}
      </div>
    </div>
  );
}
