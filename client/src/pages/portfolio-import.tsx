import { useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Upload, FileSpreadsheet, AlertTriangle, CheckCircle2,
  ChevronLeft, ChevronRight, Trash2, RefreshCw, Info,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

// ---------------------------------------------------------------------------
// Step 1: File picker
// ---------------------------------------------------------------------------

function StepUpload({
  onPreview,
}: {
  onPreview: (preview: PreviewResponse, fileType: "csv" | "xlsx") => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [fileType, setFileType] = useState<"csv" | "xlsx">("csv");

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

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      <div>
        <h2 className="text-xl font-semibold">Import Holdings</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Upload a CSV or Excel spreadsheet. We support common column names like Ticker, Symbol, Shares, Quantity, Average Cost, etc.
        </p>
      </div>

      {/* Drop zone */}
      <div
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
          dragging ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary/50"
        }`}
        onClick={() => fileRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files[0];
          if (f) handleFile(f);
        }}
      >
        <FileSpreadsheet className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
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
            <p className="text-sm text-muted-foreground mt-1">CSV or XLSX · max 5 MB · up to 500 positions</p>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <Button
          className="flex-1"
          onClick={() => upload.mutate()}
          disabled={!file || upload.isPending}
        >
          {upload.isPending ? (
            <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Parsing…</>
          ) : (
            <><Upload className="h-4 w-4 mr-2" /> Preview Import</>
          )}
        </Button>
        {file && (
          <Button variant="ghost" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ""; }}>
            Clear
          </Button>
        )}
      </div>

      {/* Supported headers info */}
      <div className="rounded-lg border border-muted bg-muted/20 p-4 text-xs space-y-1 text-muted-foreground">
        <p className="font-medium text-foreground mb-2">Recognized column headers</p>
        <p><strong>Ticker:</strong> Ticker, Symbol, Sym, Stock, Security</p>
        <p><strong>Quantity:</strong> Shares, Quantity, Qty, Units</p>
        <p><strong>Avg Cost:</strong> Average Cost, Avg Cost, Cost Basis Per Share, Price</p>
        <p><strong>Cost Basis:</strong> Cost Basis, Total Cost, Book Value</p>
        <p className="text-muted-foreground/60 mt-2 italic">Unknown columns are ignored.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Preview + edit
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
  const [positions, setPositions] = useState<NormalizedPosition[]>(preview.normalizedPositions);
  const [portfolioName, setPortfolioName] = useState(`Imported Portfolio ${new Date().toLocaleDateString()}`);
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
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
          <ChevronLeft className="h-4 w-4" /> Back
        </Button>
        <div>
          <h2 className="text-xl font-semibold">Review Import</h2>
          <p className="text-sm text-muted-foreground">
            {preview.parsedRows} rows parsed · {positions.length} valid · {preview.invalidRows.length} skipped
          </p>
        </div>
      </div>

      {/* Sheet info */}
      {preview.sheetInfo && preview.sheetInfo.availableSheets.length > 1 && (
        <div className="flex items-start gap-2 text-sm bg-blue-500/10 rounded-lg px-3 py-2 border border-blue-500/20">
          <Info className="h-4 w-4 mt-0.5 text-blue-500 shrink-0" />
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
      {(preview.warnings.length > 0) && (
        <div className="flex items-start gap-2 text-sm bg-yellow-500/10 rounded-lg px-3 py-2 border border-yellow-500/20">
          <AlertTriangle className="h-4 w-4 mt-0.5 text-yellow-500 shrink-0" />
          <div className="space-y-0.5">
            {preview.warnings.map((w, i) => <p key={i}>{w}</p>)}
          </div>
        </div>
      )}

      {/* Invalid rows */}
      {preview.invalidRows.length > 0 && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 space-y-1">
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

      {/* Editable positions table */}
      <div className="rounded border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/30 text-muted-foreground border-b">
              <th className="text-left px-3 py-2 font-medium">Symbol</th>
              <th className="text-right px-3 py-2 font-medium">Quantity</th>
              <th className="text-right px-3 py-2 font-medium">Avg Cost</th>
              <th className="text-right px-3 py-2 font-medium">Cost Basis</th>
              <th className="px-3 py-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p, i) => (
              <tr key={i} className="border-b last:border-0 hover:bg-muted/10">
                <td className="px-3 py-2 font-medium">
                  {p.symbol}
                  {p.warnings.length > 0 && (
                    <span title={p.warnings.join("; ")} className="ml-1 inline-block">
                      <AlertTriangle className="inline h-3 w-3 text-yellow-500" />
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">{p.quantity.toLocaleString()}</td>
                <td className="px-3 py-2 text-right">{fmtCurrency(p.averageCost)}</td>
                <td className="px-3 py-2 text-right">{fmtCurrency(p.costBasis)}</td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => removePosition(i)}
                    className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500"
                    title="Remove this position"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {positions.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          All positions removed. Go back to re-upload.
        </div>
      )}

      {/* Portfolio target */}
      <div className="space-y-3 border rounded-lg p-4">
        <p className="text-sm font-medium">Save to portfolio</p>
        {existingPortfolios && existingPortfolios.length > 0 && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Replace existing portfolio (optional)</Label>
            <Select value={targetPortfolioId} onValueChange={setTargetPortfolioId}>
              <SelectTrigger className="h-8 text-sm">
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
            <Label className="text-xs text-muted-foreground">New portfolio name</Label>
            <Input
              value={portfolioName}
              onChange={e => setPortfolioName(e.target.value)}
              className="h-8 text-sm"
              placeholder="My Portfolio"
            />
          </div>
        )}
        {targetPortfolioId && (
          <p className="text-xs text-yellow-600 dark:text-yellow-400">
            <AlertTriangle className="inline h-3 w-3 mr-1" />
            All existing positions in this portfolio will be replaced.
          </p>
        )}
      </div>

      <Button
        className="w-full"
        onClick={() => confirm.mutate()}
        disabled={positions.length === 0 || confirm.isPending}
      >
        {confirm.isPending ? (
          <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Importing…</>
        ) : (
          <>
            <CheckCircle2 className="h-4 w-4 mr-2" />
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
    <div className="max-w-md mx-auto text-center space-y-5 py-12">
      <CheckCircle2 className="h-14 w-14 text-green-500 mx-auto" />
      <div>
        <h2 className="text-2xl font-bold">Import complete</h2>
        <p className="text-muted-foreground mt-1">{portfolioName} is ready.</p>
      </div>
      <Button onClick={() => setLocation("/portfolio")} className="w-full">
        View Portfolio <ChevronRight className="h-4 w-4 ml-1" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

type Step = "upload" | "preview" | "success";

export default function PortfolioImportPage() {
  const [step, setStep] = useState<Step>("upload");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [fileType, setFileType] = useState<"csv" | "xlsx">("csv");
  const [confirmedPortfolio, setConfirmedPortfolio] = useState<{ id: string; name: string } | null>(null);
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-3xl mx-auto px-4 py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-sm text-muted-foreground mb-6">
          <button onClick={() => setLocation("/portfolio")} className="hover:text-foreground">Portfolio</button>
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="text-foreground">Import Spreadsheet</span>
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
