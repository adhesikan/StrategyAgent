// Sprint 5.4D — Research Library page (/research)
// Lists saved research records with filters and pagination.
// No userId is sent from the frontend.
// No raw evidence or handle IDs in URLs or analytics.

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  BookOpen, Search, Filter, Archive, Trash2, RotateCcw, AlertTriangle, Sparkles, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, friendlyApiError } from "@/lib/queryClient";
import {
  type ResearchRecord,
  type ResearchRecordList,
  type ResearchDomain,
  DOMAIN_LABELS,
  CONFIDENCE_COLORS,
  formatGeneratedAt,
} from "@/lib/research-records";

const PAGE_SIZE = 20;
const ALL_DOMAINS = Object.keys(DOMAIN_LABELS) as ResearchDomain[];

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const cls = CONFIDENCE_COLORS[confidence as keyof typeof CONFIDENCE_COLORS] ?? "border-muted text-muted-foreground bg-muted/20";
  return <Badge variant="outline" className={`text-[10px] ${cls}`}>{confidence}</Badge>;
}

function DomainBadge({ domain }: { domain: ResearchDomain }) {
  return <Badge variant="outline" className="text-[10px] capitalize">{DOMAIN_LABELS[domain] ?? domain}</Badge>;
}

function ResearchRecordCard({
  record,
  onArchive,
  onRestore,
  onDelete,
}: {
  record: ResearchRecord;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  onDelete: (record: ResearchRecord) => void;
}) {
  return (
    <Card
      className={`transition-colors ${record.archived ? "opacity-60" : ""}`}
      data-testid={`card-research-${record.id}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            {/* Title row */}
            <div className="flex items-start gap-2 flex-wrap mb-1.5">
              <Link
                href={`/research/${record.id}`}
                className="text-sm font-medium hover:underline underline-offset-2 truncate"
                data-testid={`link-record-${record.id}`}
                aria-label={`Open research record: ${record.title}`}
                onClick={() => {
                  try { window.dispatchEvent(new CustomEvent("research_record_opened")); } catch {}
                }}
              >
                {record.title}
              </Link>
              {record.archived && (
                <Badge variant="outline" className="text-[10px] text-muted-foreground shrink-0" data-testid="badge-archived">Archived</Badge>
              )}
            </div>

            {/* Meta row */}
            <div className="flex flex-wrap gap-1.5 items-center mb-2">
              <DomainBadge domain={record.domain} />
              <ConfidenceBadge confidence={record.confidence} />
              {record.symbol && (
                <Badge variant="secondary" className="text-[10px] font-mono" data-testid="badge-symbol">
                  {record.symbol}
                </Badge>
              )}
              {record.strategyDisplayName && (
                <Badge variant="outline" className="text-[10px]">{record.strategyDisplayName}</Badge>
              )}
            </div>

            {/* Verdict */}
            {record.verdict && (
              <p className="text-xs text-muted-foreground truncate mb-2" data-testid="text-verdict">
                {record.verdict}
              </p>
            )}

            {/* Tags */}
            {record.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2" data-testid="tag-list">
                {record.tags.slice(0, 6).map((tag) => (
                  <span key={tag} className="text-[10px] rounded-sm bg-secondary text-secondary-foreground px-1.5 py-0.5">
                    {tag}
                  </span>
                ))}
                {record.tags.length > 6 && (
                  <span className="text-[10px] text-muted-foreground">+{record.tags.length - 6}</span>
                )}
              </div>
            )}

            {/* Date */}
            <p className="text-[10px] text-muted-foreground" data-testid="text-generated-at">
              Generated {formatGeneratedAt(record.generatedAt)}
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-1 shrink-0">
            <Link href={`/research/${record.id}`}>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" aria-label="Open record">
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
            {record.archived ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-sky-400 hover:text-sky-300"
                onClick={() => onRestore(record.id)}
                aria-label="Restore from archive"
                data-testid={`btn-restore-${record.id}`}
              >
                <RotateCcw className="h-3 w-3" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => onArchive(record.id)}
                aria-label="Archive record"
                data-testid={`btn-archive-${record.id}`}
              >
                <Archive className="h-3 w-3" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(record)}
              aria-label="Delete record"
              data-testid={`btn-delete-${record.id}`}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ResearchLibraryPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  // Filters
  const [symbolSearch, setSymbolSearch] = useState("");
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [showArchived, setShowArchived] = useState(false);
  const [page, setPage] = useState(0);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<ResearchRecord | null>(null);

  const queryKey = [
    "/api/research-records",
    { domain: domainFilter, symbol: symbolSearch, archived: showArchived, page },
  ];

  const params = new URLSearchParams();
  if (domainFilter && domainFilter !== "all") params.set("domain", domainFilter);
  if (symbolSearch) params.set("symbol", symbolSearch);
  if (showArchived) params.set("archived", "true");
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(page * PAGE_SIZE));

  const { data, isLoading, isError, error } = useQuery<ResearchRecordList>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/research-records?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/research-records/${id}/archive`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/research-records"] });
      toast({ title: "Archived" });
      try { window.dispatchEvent(new CustomEvent("research_record_archived")); } catch {}
    },
    onError: (err) => toast({ title: "Archive failed", description: friendlyApiError(err), variant: "destructive" }),
  });

  const restoreMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PATCH", `/api/research-records/${id}/metadata`, { archived: false });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/research-records"] });
      toast({ title: "Restored" });
    },
    onError: (err) => toast({ title: "Restore failed", description: friendlyApiError(err), variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/research-records/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/research-records"] });
      setDeleteTarget(null);
      toast({ title: "Research record deleted" });
      try { window.dispatchEvent(new CustomEvent("research_record_deleted")); } catch {}
    },
    onError: (err) => toast({ title: "Delete failed", description: friendlyApiError(err), variant: "destructive" }),
  });

  const records = data?.records ?? [];
  const total = data?.count ?? 0;
  const pageCount = Math.ceil(total / PAGE_SIZE);
  const hasNext = page < pageCount - 1;
  const hasPrev = page > 0;

  return (
    <div className="container max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-sky-400" />
          <h1 className="text-lg font-semibold" data-testid="heading-research-library">Research Library</h1>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => navigate("/ask")}
            data-testid="btn-analyze-stock"
          >
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            Analyze a Stock
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Immutable evidence snapshots from your research sessions. Records here are not personalized investment advice.
      </p>

      {/* Filters */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-[140px]">
              <div className="relative">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  value={symbolSearch}
                  onChange={(e) => { setSymbolSearch(e.target.value); setPage(0); }}
                  placeholder="Symbol, title, or tag…"
                  className="h-8 pl-8 text-xs"
                  data-testid="input-symbol-search"
                  aria-label="Search research records by symbol, title or tag"
                />
              </div>
            </div>
            <Select value={domainFilter} onValueChange={(v) => { setDomainFilter(v); setPage(0); }}>
              <SelectTrigger className="h-8 w-[180px] text-xs" data-testid="select-domain-filter" aria-label="Filter by domain">
                <SelectValue placeholder="All domains" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All domains</SelectItem>
                {ALL_DOMAINS.map((d) => (
                  <SelectItem key={d} value={d}>{DOMAIN_LABELS[d]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant={showArchived ? "secondary" : "outline"}
              size="sm"
              className="h-8 text-xs"
              onClick={() => { setShowArchived(!showArchived); setPage(0); }}
              data-testid="btn-toggle-archived"
              aria-pressed={showArchived}
              aria-label={showArchived ? "Hide archived records" : "Show archived records"}
            >
              <Archive className="h-3 w-3 mr-1.5" />
              {showArchived ? "Hide archived" : "Show archived"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Content */}
      {isLoading && (
        <div className="text-center py-12 text-muted-foreground text-sm" data-testid="loading-library">
          Loading research records…
        </div>
      )}

      {isError && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-4 flex items-start gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span data-testid="msg-library-error">{friendlyApiError(error)}</span>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && records.length === 0 && (
        <Card data-testid="card-empty-library">
          <CardContent className="py-12 text-center space-y-4">
            <BookOpen className="h-10 w-10 text-muted-foreground mx-auto" />
            <div>
              <h2 className="text-base font-medium mb-1">No saved research yet.</h2>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                Run an analysis or research workflow, then choose <strong>Save Research</strong> to keep an immutable evidence snapshot.
              </p>
            </div>
            <div className="flex gap-2 justify-center flex-wrap">
              <Button size="sm" variant="outline" onClick={() => navigate("/ask?q=Analyze+NVDA")}>
                Analyze a Stock
              </Button>
              <Button size="sm" variant="outline" onClick={() => navigate("/ask?q=Find+bullish+opportunities")}>
                Explore Market Opportunities
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && records.length > 0 && (
        <div className="space-y-3" data-testid="list-research-records">
          {records.map((record) => (
            <ResearchRecordCard
              key={record.id}
              record={record}
              onArchive={(id) => archiveMutation.mutate(id)}
              onRestore={(id) => restoreMutation.mutate(id)}
              onDelete={setDeleteTarget}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-2" data-testid="pagination">
          <span>{total} total record{total !== 1 ? "s" : ""}</span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!hasPrev}
              onClick={() => setPage(page - 1)}
              data-testid="btn-prev-page"
              aria-label="Previous page"
            >
              Previous
            </Button>
            <span className="flex items-center px-2">
              {page + 1} / {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasNext}
              onClick={() => setPage(page + 1)}
              data-testid="btn-next-page"
              aria-label="Next page"
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent data-testid="dialog-delete-confirm" aria-labelledby="delete-dialog-title">
          <AlertDialogHeader>
            <AlertDialogTitle id="delete-dialog-title">Delete Research Record?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.title}</strong> and its linked decision journal entry (if any). This action cannot be undone.
              <br /><br />
              Deleting this record does not affect any brokerage positions or trade history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="btn-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="btn-confirm-delete"
              aria-label="Permanently delete research record"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
