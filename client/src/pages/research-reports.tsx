/**
 * Sprint 2.5.5 — Research Reports & Publishing
 * /research-reports
 *
 * Report Library: list, search, filter, pin, duplicate, delete
 * Report Viewer:  inline expanded view with all sections
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  FileText, Plus, Search, Pin, PinOff, Trash2, Download,
  ChevronDown, ChevronUp, ExternalLink, RefreshCw,
  BookOpen, BarChart2, Activity, Shield,
  ArrowLeft, Filter, X, Copy,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { REPORT_TYPES, REPORT_TYPE_LABELS, EXPORT_FORMATS } from "@shared/research-report-types";
import type {
  ResearchReport, ReportType, ExportFormat, ReportSection,
} from "@shared/research-report-types";

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Type helpers / constants
// ---------------------------------------------------------------------------

const SECTION_ICONS: Record<string, typeof FileText> = {
  executive_summary:           FileText,
  market_overview:             BarChart2,
  sector_summary:              BarChart2,
  theme_summary:               Activity,
  institutional_summary:       Activity,
  research_candidate_summary:  FileText,
  research_monitoring_summary: Activity,
  collection_summary:          BookOpen,
  risk_summary:                Shield,
  methodology:                 BookOpen,
  appendix:                    FileText,
};

function typeBadgeColor(reportType: ReportType): string {
  if (reportType.startsWith("weekly_"))   return "bg-purple-500/10 text-purple-400 border-purple-500/20";
  if (reportType === "morning_brief")     return "bg-blue-500/10 text-blue-400 border-blue-500/20";
  if (reportType === "evening_summary")   return "bg-indigo-500/10 text-indigo-400 border-indigo-500/20";
  if (reportType === "market_changes")    return "bg-amber-500/10 text-amber-400 border-amber-500/20";
  if (reportType === "collection_summary") return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
  return "bg-slate-500/10 text-slate-400 border-slate-500/20";
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 2)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Generate Report Modal
// ---------------------------------------------------------------------------

interface GenerateModalProps {
  open: boolean;
  onClose: () => void;
  onGenerated: (report: ResearchReport) => void;
}

function GenerateReportModal({ open, onClose, onGenerated }: GenerateModalProps) {
  const [reportType, setReportType] = useState<ReportType>("morning_brief");
  const [title, setTitle]           = useState("");
  const [subtitle, setSubtitle]     = useState("");
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<{ report: ResearchReport }>("/api/research-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportType,
          title:    title.trim() || undefined,
          subtitle: subtitle.trim() || undefined,
        }),
      }),
    onSuccess: ({ report }) => {
      toast({ title: "Report generated", description: report.title });
      onGenerated(report);
      onClose();
      setTitle("");
      setSubtitle("");
      setReportType("morning_brief");
    },
    onError: (err: Error) => {
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-100">
            <Plus className="h-4 w-4 text-blue-400" />
            Generate Research Report
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Report type */}
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Report Type</label>
            <Select value={reportType} onValueChange={v => setReportType(v as ReportType)}>
              <SelectTrigger className="bg-slate-800 border-slate-600 text-slate-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                {REPORT_TYPES.map(t => (
                  <SelectItem key={t} value={t} className="text-slate-200 focus:bg-slate-700">
                    {REPORT_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-slate-500 mt-1">
              Generated from existing intelligence — no new scans performed.
            </p>
          </div>

          {/* Optional custom title */}
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Custom Title (optional)</label>
            <Input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={REPORT_TYPE_LABELS[reportType]}
              maxLength={120}
              className="bg-slate-800 border-slate-600 text-slate-200 placeholder:text-slate-500"
            />
          </div>

          {/* Optional subtitle */}
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Subtitle (optional)</label>
            <Input
              value={subtitle}
              onChange={e => setSubtitle(e.target.value)}
              placeholder="e.g. For internal review"
              maxLength={200}
              className="bg-slate-800 border-slate-600 text-slate-200 placeholder:text-slate-500"
            />
          </div>

          {/* Compliance note */}
          <p className="text-[10px] text-slate-500 bg-slate-800/50 rounded p-2 leading-relaxed">
            Research reports summarise deterministic intelligence and do not constitute investment advice.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-slate-400 hover:text-slate-200">
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="bg-blue-600 hover:bg-blue-500 text-white"
          >
            {mutation.isPending ? (
              <><RefreshCw className="h-3 w-3 animate-spin mr-1" />Generating…</>
            ) : "Generate Report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Export menu
// ---------------------------------------------------------------------------

interface ExportMenuProps {
  report: ResearchReport;
}

function ExportMenu({ report }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  async function doExport(fmt: ExportFormat) {
    setOpen(false);
    try {
      const url = `/api/research-reports/${report.id}/export?format=${fmt}`;
      if (fmt === "html" || fmt === "markdown") {
        window.open(url, "_blank");
      } else {
        const data = await apiFetch<{ format: string; content: unknown }>(url);
        const blob = new Blob([JSON.stringify(data.content, null, 2)], { type: "application/json" });
        const a    = document.createElement("a");
        a.href     = URL.createObjectURL(blob);
        a.download = `${report.id}.${fmt === "pdf_ready" ? "pdf-ready.json" : fmt === "ppt_ready" ? "ppt-ready.json" : "json"}`;
        a.click();
        URL.revokeObjectURL(a.href);
      }
      toast({ title: `Exported as ${fmt}` });
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    }
  }

  return (
    <div className="relative">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen(v => !v)}
        className="text-slate-400 hover:text-slate-200 h-7 px-2"
      >
        <Download className="h-3.5 w-3.5 mr-1" />
        Export
        <ChevronDown className="h-3 w-3 ml-1" />
      </Button>
      {open && (
        <div className="absolute right-0 top-8 z-50 bg-slate-800 border border-slate-700 rounded-md shadow-xl min-w-[140px]">
          {EXPORT_FORMATS.map(fmt => (
            <button
              key={fmt}
              onClick={() => doExport(fmt)}
              className="block w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 hover:text-slate-100 first:rounded-t-md last:rounded-b-md"
            >
              {fmt === "html"      ? "HTML" :
               fmt === "markdown" ? "Markdown" :
               fmt === "json"     ? "JSON (raw)" :
               fmt === "pdf_ready" ? "PDF-ready JSON" : "PPT-ready JSON"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report Viewer (full inline)
// ---------------------------------------------------------------------------

interface ReportViewerProps {
  report: ResearchReport;
  onBack: () => void;
  onPin: (pinned: boolean) => void;
  onDelete: () => void;
}

function ReportSection({ section, defaultOpen = false }: { section: ReportSection; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const Icon = SECTION_ICONS[section.sectionType] ?? FileText;

  return (
    <div className="border border-slate-700/50 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-800/40 hover:bg-slate-800/60 text-left"
      >
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          <span className="text-sm font-medium text-slate-200">{section.title}</span>
        </div>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-slate-500" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-500" />}
      </button>
      {open && (
        <div className="px-4 py-3 bg-slate-900/30 space-y-2">
          <p className="text-xs text-slate-300 leading-relaxed">{section.content}</p>
          {section.bullets.length > 0 && (
            <ul className="space-y-1 mt-2">
              {section.bullets.map((b, i) => (
                <li key={i} className="text-xs text-slate-400 flex items-start gap-1.5">
                  <span className="text-blue-400 mt-0.5 shrink-0">·</span>
                  {b}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ReportViewer({ report, onBack, onPin, onDelete }: ReportViewerProps) {
  const [, setLocation] = useLocation();

  return (
    <div className="space-y-4">
      {/* Viewer header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 mb-2"
          >
            <ArrowLeft className="h-3 w-3" /> Back to reports
          </button>
          <h1 className="text-lg font-semibold text-slate-100">{report.title}</h1>
          {report.subtitle && <p className="text-xs text-slate-400 mt-0.5">{report.subtitle}</p>}
        </div>
        <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
          <ExportMenu report={report} />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onPin(!report.isPinned)}
            className="text-slate-400 hover:text-yellow-400 h-7 px-2"
            title={report.isPinned ? "Unpin" : "Pin"}
          >
            {report.isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onDelete}
            className="text-slate-400 hover:text-red-400 h-7 px-2"
            title="Archive report"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Meta strip */}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 bg-slate-800/30 rounded-lg px-3 py-2">
        <Badge variant="outline" className={`text-[10px] ${typeBadgeColor(report.reportType)}`}>
          {REPORT_TYPE_LABELS[report.reportType]}
        </Badge>
        <span>Generated: {relativeTime(report.generatedAt)}</span>
        {report.dataFreshness && <span>Data: {report.dataFreshness}</span>}
        {report.marketRegime && <span>Regime: {report.marketRegime}</span>}
        <span>Author: {report.author}</span>
        {report.isPinned && <Badge variant="outline" className="text-[10px] text-yellow-400 border-yellow-500/30">Pinned</Badge>}
      </div>

      {/* Key Findings */}
      <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg px-4 py-3">
        <h3 className="text-xs font-semibold text-blue-400 mb-2 uppercase tracking-wide">Key Findings</h3>
        <ul className="space-y-1">
          {report.content.keyFindings.map((f, i) => (
            <li key={i} className="text-xs text-slate-300 flex items-start gap-1.5">
              <span className="text-blue-400 mt-0.5 shrink-0">·</span>
              {f}
            </li>
          ))}
        </ul>
      </div>

      {/* Sections */}
      <div className="space-y-2">
        {report.content.sections.map((s, i) => (
          <ReportSection key={s.id} section={s} defaultOpen={i < 2} />
        ))}
      </div>

      {/* Supporting Evidence */}
      {report.content.supportingEvidence.length > 0 && (
        <div className="border border-slate-700/50 rounded-lg p-4">
          <h3 className="text-xs font-semibold text-slate-400 mb-3 uppercase tracking-wide">Supporting Evidence</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {report.content.supportingEvidence.map((e, i) => (
              <div key={i} className="bg-slate-800/40 rounded p-2.5">
                <p className="text-xs font-medium text-slate-300">{e.label}</p>
                <p className="text-xs text-blue-400">{String(e.value ?? "N/A")}</p>
                {e.context && <p className="text-[10px] text-slate-500 mt-0.5">{e.context}</p>}
                <p className="text-[10px] text-slate-600 mt-0.5">Source: {e.source}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Related research links */}
      <div className="flex flex-wrap gap-2">
        {[
          { label: "Command Center",    href: "/command-center" },
          { label: "Research Workspace", href: "/research-workspace" },
          { label: "Collections",       href: "/research/collections" },
          { label: "Research Monitor",  href: "/research-monitor" },
          { label: "Opportunity Intel", href: "/opportunities" },
        ].map(l => (
          <button
            key={l.href}
            onClick={() => setLocation(l.href)}
            className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 bg-slate-800/40 hover:bg-slate-800/70 px-2.5 py-1.5 rounded-md border border-slate-700/40 transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            {l.label}
          </button>
        ))}
      </div>

      {/* Glossary link */}
      <button
        onClick={() => setLocation("/research/glossary")}
        className="text-[11px] text-slate-500 hover:text-slate-300 flex items-center gap-1"
      >
        <BookOpen className="h-3 w-3" /> How are scores calculated? View Research Glossary
      </button>

      {/* Compliance disclaimer */}
      <div className="bg-slate-800/20 border border-slate-700/30 rounded-lg p-3">
        <p className="text-[10px] text-slate-500 leading-relaxed">{report.content.disclaimer}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report Card
// ---------------------------------------------------------------------------

interface ReportCardProps {
  report: ResearchReport;
  onOpen:   () => void;
  onPin:    (pinned: boolean) => void;
  onDelete: () => void;
}

function ReportCard({ report, onOpen, onPin, onDelete }: ReportCardProps) {
  return (
    <div
      className={`relative bg-slate-800/40 border rounded-lg p-4 hover:bg-slate-800/60 transition-colors cursor-pointer
        ${report.isPinned ? "border-yellow-500/30" : "border-slate-700/40"}`}
      onClick={onOpen}
    >
      {report.isPinned && (
        <Pin className="absolute top-2 right-2 h-3 w-3 text-yellow-400" />
      )}

      {/* Type badge */}
      <Badge variant="outline" className={`text-[10px] mb-2 ${typeBadgeColor(report.reportType)}`}>
        {REPORT_TYPE_LABELS[report.reportType]}
      </Badge>

      {/* Title */}
      <h3 className="text-sm font-medium text-slate-200 leading-snug mb-1 pr-4">{report.title}</h3>

      {/* Summary */}
      {report.summary && (
        <p className="text-[11px] text-slate-400 line-clamp-2 mb-2">{report.summary}</p>
      )}

      {/* Meta */}
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-2 text-[10px] text-slate-500">
          <span>{relativeTime(report.generatedAt)}</span>
          {report.marketRegime && <span>· {report.marketRegime}</span>}
          {report.dataFreshness && <span>· {report.dataFreshness}</span>}
        </div>

        <div className="flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
          <ExportMenu report={report} />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onPin(!report.isPinned)}
            className="text-slate-500 hover:text-yellow-400 h-6 w-6 p-0"
            title={report.isPinned ? "Unpin" : "Pin"}
          >
            {report.isPinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onDelete}
            className="text-slate-500 hover:text-red-400 h-6 w-6 p-0"
            title="Archive"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ResearchReportsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [showGenerate, setShowGenerate]  = useState(false);
  const [viewingReport, setViewingReport] = useState<ResearchReport | null>(null);
  const [search, setSearch]             = useState("");
  const [typeFilter, setTypeFilter]     = useState<ReportType | "all">("all");
  const [showPinnedOnly, setShowPinnedOnly] = useState(false);

  // ── Fetch reports ──
  const { data: reportsData, isLoading } = useQuery({
    queryKey: ["/api/research-reports"],
    queryFn: () => apiFetch<{ reports: ResearchReport[] }>("/api/research-reports"),
    staleTime: 30_000,
  });

  const allReports = reportsData?.reports ?? [];

  // ── Filter / search ──
  const filtered = useMemo(() => {
    let list = allReports;
    if (typeFilter !== "all") list = list.filter(r => r.reportType === typeFilter);
    if (showPinnedOnly)       list = list.filter(r => r.isPinned);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(r =>
        r.title.toLowerCase().includes(q) ||
        r.summary?.toLowerCase().includes(q) ||
        r.marketRegime?.toLowerCase().includes(q)
      );
    }
    // Pinned first
    return [...list].sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      return new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime();
    });
  }, [allReports, typeFilter, showPinnedOnly, search]);

  // ── Mutations ──
  const pinMutation = useMutation({
    mutationFn: ({ id, isPinned }: { id: string; isPinned: boolean }) =>
      apiFetch(`/api/research-reports/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPinned }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/research-reports"] }),
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/research-reports/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/research-reports"] });
      if (viewingReport) setViewingReport(null);
      toast({ title: "Report archived" });
    },
    onError: (err: Error) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  function handlePin(report: ResearchReport, pinned: boolean) {
    pinMutation.mutate({ id: report.id, isPinned: pinned });
    if (viewingReport?.id === report.id) setViewingReport({ ...viewingReport, isPinned: pinned });
  }

  function handleDelete(report: ResearchReport) {
    if (!confirm(`Archive "${report.title}"? It will no longer appear in your report library.`)) return;
    deleteMutation.mutate(report.id);
  }

  function handleGenerated(report: ResearchReport) {
    queryClient.invalidateQueries({ queryKey: ["/api/research-reports"] });
    setViewingReport(report);
  }

  // ── Render viewer mode ──
  if (viewingReport) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <ReportViewer
          report={viewingReport}
          onBack={() => setViewingReport(null)}
          onPin={pinned => handlePin(viewingReport, pinned)}
          onDelete={() => handleDelete(viewingReport)}
        />
      </div>
    );
  }

  // ── Report library ──
  return (
    <div className="container mx-auto max-w-5xl px-4 py-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100 flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-400" />
            Research Reports
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            {allReports.length} report{allReports.length !== 1 ? "s" : ""} in library
          </p>
        </div>
        <Button
          onClick={() => setShowGenerate(true)}
          className="bg-blue-600 hover:bg-blue-500 text-white text-sm gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Generate Report
        </Button>
      </div>

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search reports…"
            className="pl-8 bg-slate-800/60 border-slate-700/50 text-slate-200 placeholder:text-slate-500 h-8 text-xs"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X className="h-3.5 w-3.5 text-slate-500 hover:text-slate-300" />
            </button>
          )}
        </div>

        <Select value={typeFilter} onValueChange={v => setTypeFilter(v as typeof typeFilter)}>
          <SelectTrigger className="w-48 bg-slate-800/60 border-slate-700/50 text-slate-200 h-8 text-xs">
            <Filter className="h-3.5 w-3.5 text-slate-500 mr-1" />
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent className="bg-slate-800 border-slate-700">
            <SelectItem value="all" className="text-slate-200 text-xs focus:bg-slate-700">All types</SelectItem>
            {REPORT_TYPES.map(t => (
              <SelectItem key={t} value={t} className="text-slate-200 text-xs focus:bg-slate-700">
                {REPORT_TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowPinnedOnly(v => !v)}
          className={`h-8 text-xs gap-1 ${showPinnedOnly ? "text-yellow-400 bg-yellow-400/10" : "text-slate-400"}`}
        >
          <Pin className="h-3.5 w-3.5" />
          Pinned
        </Button>
      </div>

      {/* Empty state */}
      {isLoading && (
        <div className="text-center py-16 text-slate-400">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-3 text-slate-600" />
          <p className="text-sm">Loading reports…</p>
        </div>
      )}

      {!isLoading && allReports.length === 0 && (
        <div className="text-center py-16 space-y-3">
          <FileText className="h-10 w-10 text-slate-600 mx-auto" />
          <h3 className="text-sm font-medium text-slate-400">No research reports yet</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Generate your first research report from existing market intelligence — no new data scans required.
          </p>
          <Button
            onClick={() => setShowGenerate(true)}
            className="bg-blue-600 hover:bg-blue-500 text-white text-sm gap-1.5 mt-2"
          >
            <Plus className="h-4 w-4" />
            Generate Your First Report
          </Button>
        </div>
      )}

      {!isLoading && allReports.length > 0 && filtered.length === 0 && (
        <div className="text-center py-12 text-slate-400">
          <Search className="h-8 w-8 mx-auto mb-3 text-slate-600" />
          <p className="text-sm">No reports match your filters.</p>
          <button
            onClick={() => { setSearch(""); setTypeFilter("all"); setShowPinnedOnly(false); }}
            className="text-xs text-blue-400 hover:text-blue-300 mt-1"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Report grid */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map(report => (
            <ReportCard
              key={report.id}
              report={report}
              onOpen={() => setViewingReport(report)}
              onPin={pinned => handlePin(report, pinned)}
              onDelete={() => handleDelete(report)}
            />
          ))}
        </div>
      )}

      {/* Quick links */}
      {allReports.length > 0 && (
        <div className="border-t border-slate-700/30 pt-4">
          <p className="text-[11px] text-slate-500 mb-2">Related research</p>
          <div className="flex flex-wrap gap-2">
            {[
              { label: "Command Center",    href: "/command-center" },
              { label: "Research Hub",      href: "/research" },
              { label: "Collections",       href: "/research/collections" },
              { label: "Research Monitor",  href: "/research-monitor" },
              { label: "AI Workspace",      href: "/research-workspace" },
            ].map(l => (
              <a
                key={l.href}
                href={l.href}
                className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 bg-slate-800/40 hover:bg-slate-800/70 px-2.5 py-1.5 rounded-md border border-slate-700/40 transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                {l.label}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Compliance footer */}
      <p className="text-[10px] text-slate-600 text-center">
        Research reports summarise deterministic intelligence. Not investment advice. Not a recommendation to buy or sell.
      </p>

      {/* Generate modal */}
      <GenerateReportModal
        open={showGenerate}
        onClose={() => setShowGenerate(false)}
        onGenerated={handleGenerated}
      />
    </div>
  );
}
