// Sprint 5.4D — Research Record Detail page (/research/:id)
// Shows a structured summary of a saved research record.
// Allows editing only user-owned metadata (title, tags, archived).
// Shows Decision Journal entry point.
// Never reconstructs evidence from GPT prose.

import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft, BookOpen, Edit3, Save, X, Archive, RotateCcw, Trash2, Plus,
  AlertTriangle, BookMarked, ChevronDown, ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, friendlyApiError } from "@/lib/queryClient";
import {
  type ResearchRecord,
  type ResearchRecordMetadataUpdate,
  type DecisionJournalEntry,
  DOMAIN_LABELS,
  CONFIDENCE_COLORS,
  formatDomain,
  formatGeneratedAt,
} from "@/lib/research-records";
import { ResearchDomainSummary, ResearchEvidenceDetail } from "@/components/research-domain-summary";

// ── Metadata editor ───────────────────────────────────────────────────────────

function MetadataEditor({
  record,
  onSaved,
  onCancel,
}: {
  record: ResearchRecord;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState(record.title);
  const [userLabel, setUserLabel] = useState(record.userLabel ?? "");
  const [tags, setTags] = useState<string[]>(record.tags);
  const [tagInput, setTagInput] = useState("");

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: ResearchRecordMetadataUpdate = {
        title: title.trim() || record.title,
        userLabel: userLabel.trim() || undefined,
        tags: tags.filter(Boolean),
      };
      const res = await apiRequest("PATCH", `/api/research-records/${record.id}/metadata`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/research-records/${record.id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/research-records"] });
      toast({ title: "Saved" });
      onSaved();
    },
    onError: (err) => toast({ title: "Save failed", description: friendlyApiError(err), variant: "destructive" }),
  });

  function addTag(raw: string) {
    const n = raw.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 50);
    if (!n || tags.includes(n) || tags.length >= 10) return;
    setTags((p) => [...p, n]);
  }

  function removeTag(t: string) { setTags((p) => p.filter((x) => x !== t)); }

  return (
    <div className="space-y-4" data-testid="metadata-editor">
      <div className="space-y-1.5">
        <Label htmlFor="edit-title">Title</Label>
        <Input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} data-testid="input-edit-title" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="edit-label">Personal note <span className="font-normal text-muted-foreground">(optional)</span></Label>
        <Input id="edit-label" value={userLabel} onChange={(e) => setUserLabel(e.target.value)} maxLength={500} placeholder="Your own context…" data-testid="input-edit-label" />
      </div>
      <div className="space-y-1.5">
        <Label>Tags</Label>
        <div className="flex flex-wrap gap-1.5 rounded-md border border-input bg-background px-3 py-2 min-h-[38px] focus-within:ring-2 focus-within:ring-ring">
          {tags.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-sm bg-secondary text-secondary-foreground text-xs px-1.5 py-0.5" data-testid={`edit-tag-${t}`}>
              {t}
              <button type="button" onClick={() => removeTag(t)} className="hover:text-destructive" aria-label={`Remove tag ${t}`}><X className="h-2.5 w-2.5" /></button>
            </span>
          ))}
          {tags.length < 10 && (
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(tagInput); setTagInput(""); }
                if (e.key === "Backspace" && !tagInput) setTags((p) => p.slice(0, -1));
              }}
              onBlur={() => { if (tagInput) { addTag(tagInput); setTagInput(""); } }}
              className="flex-1 min-w-[80px] bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              placeholder="Add tag…"
              data-testid="input-edit-tag-entry"
              aria-label="Add tag"
            />
          )}
        </div>
      </div>

      {/* Immutable notice — no edit controls for evidence fields */}
      <p className="text-[10px] text-muted-foreground">
        Verdict, confidence, reasons, warnings, source timestamps, and domain snapshot are immutable evidence fields and cannot be edited.
      </p>

      <div className="flex gap-2">
        <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="btn-save-metadata">
          <Save className="h-3.5 w-3.5 mr-1.5" />{saveMutation.isPending ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} data-testid="btn-cancel-metadata">Cancel</Button>
      </div>
    </div>
  );
}

// ── Decision Journal ──────────────────────────────────────────────────────────

function DecisionJournalPanel({ record }: { record: ResearchRecord }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const { data: entry, isLoading } = useQuery<DecisionJournalEntry>({
    queryKey: [`/api/research-records/${record.id}/journal`],
    queryFn: async () => {
      const res = await fetch(`/api/research-records/${record.id}/journal`, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${res.status}`);
      const body = await res.json();
      return body.entry ?? null;
    },
    enabled: open,
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/research-records/${record.id}/journal`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/research-records/${record.id}/journal`] });
      toast({ title: "Decision journal created" });
    },
    onError: (err) => toast({ title: "Failed", description: friendlyApiError(err), variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async (fields: Record<string, string | undefined>) => {
      const res = await apiRequest("PATCH", `/api/research-records/${record.id}/journal`, fields);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/research-records/${record.id}/journal`] });
      toast({ title: "Journal updated" });
    },
    onError: (err) => toast({ title: "Failed", description: friendlyApiError(err), variant: "destructive" }),
  });

  const [thesisEdit, setThesisEdit] = useState("");
  const [notesEdit, setNotesEdit] = useState("");
  const [editingJournal, setEditingJournal] = useState(false);

  function handleOpenJournal() {
    setOpen(true);
    if (!entry) createMutation.mutate();
  }

  function handleSaveJournal() {
    updateMutation.mutate({
      ...(thesisEdit ? { thesis: thesisEdit } : {}),
      ...(notesEdit ? { notes: notesEdit } : {}),
    });
    setEditingJournal(false);
  }

  return (
    <Card data-testid="card-decision-journal">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          <span className="flex items-center gap-2">
            <BookMarked className="h-4 w-4 text-sky-400" />
            Decision Journal
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            data-testid="btn-toggle-journal"
          >
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
        </CardTitle>
      </CardHeader>

      {!open && (
        <CardContent className="pt-0 pb-4">
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={handleOpenJournal}
            data-testid="btn-open-journal"
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            {entry ? "Open Decision Journal" : "Add Decision Journal"}
          </Button>
        </CardContent>
      )}

      {open && (
        <CardContent className="pt-0 space-y-4">
          {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}

          {!isLoading && entry && (
            <>
              {!editingJournal ? (
                <div className="space-y-3">
                  {entry.thesis && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Thesis</p>
                      <p className="text-sm" data-testid="journal-thesis">{entry.thesis}</p>
                    </div>
                  )}
                  {entry.notes && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Notes</p>
                      <p className="text-sm" data-testid="journal-notes">{entry.notes}</p>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]" data-testid="journal-decision">{entry.userDecision}</Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => {
                        setThesisEdit(entry.thesis ?? "");
                        setNotesEdit(entry.notes ?? "");
                        setEditingJournal(true);
                      }}
                      data-testid="btn-edit-journal"
                    >
                      <Edit3 className="h-3 w-3 mr-1" /> Edit
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Price and quantity fields require explicit manual entry — this journal does not record automatic trades.
                  </p>
                </div>
              ) : (
                <div className="space-y-3" data-testid="journal-editor">
                  <div className="space-y-1.5">
                    <Label htmlFor="journal-thesis">Thesis</Label>
                    <Textarea id="journal-thesis" value={thesisEdit} onChange={(e) => setThesisEdit(e.target.value)} rows={3} className="text-sm resize-none" data-testid="input-journal-thesis" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="journal-notes">Notes</Label>
                    <Textarea id="journal-notes" value={notesEdit} onChange={(e) => setNotesEdit(e.target.value)} rows={3} className="text-sm resize-none" data-testid="input-journal-notes" />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleSaveJournal} disabled={updateMutation.isPending} data-testid="btn-save-journal">
                      <Save className="h-3.5 w-3.5 mr-1.5" />{updateMutation.isPending ? "Saving…" : "Save"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingJournal(false)} data-testid="btn-cancel-journal">Cancel</Button>
                  </div>
                </div>
              )}
            </>
          )}

          {!isLoading && !entry && !createMutation.isPending && (
            <Button variant="outline" size="sm" className="text-xs" onClick={() => createMutation.mutate()} data-testid="btn-create-journal">
              <Plus className="h-3.5 w-3.5 mr-1.5" />Add Decision Journal
            </Button>
          )}

          {createMutation.isPending && <p className="text-xs text-muted-foreground">Creating journal…</p>}
        </CardContent>
      )}
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ResearchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [editingMeta, setEditingMeta] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data: record, isLoading, isError, error } = useQuery<ResearchRecord>({
    queryKey: [`/api/research-records/${id}`],
    queryFn: async () => {
      const res = await fetch(`/api/research-records/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      const body = await res.json();
      return body.record ?? body;
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/research-records/${id}/archive`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/research-records/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/research-records"] });
      toast({ title: record?.archived ? "Restored" : "Archived" });
    },
    onError: (err) => toast({ title: "Failed", description: friendlyApiError(err), variant: "destructive" }),
  });

  const restoreMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/research-records/${id}/metadata`, { archived: false });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/research-records/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/research-records"] });
      toast({ title: "Restored" });
    },
    onError: (err) => toast({ title: "Failed", description: friendlyApiError(err), variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/research-records/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/research-records"] });
      toast({ title: "Deleted" });
      navigate("/research");
    },
    onError: (err) => toast({ title: "Delete failed", description: friendlyApiError(err), variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="container max-w-3xl mx-auto px-4 py-6">
        <p className="text-sm text-muted-foreground" data-testid="loading-detail">Loading research record…</p>
      </div>
    );
  }

  if (isError || !record) {
    return (
      <div className="container max-w-3xl mx-auto px-4 py-6 space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/research")} className="text-xs" data-testid="btn-back-from-error">
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />Back to Research Library
        </Button>
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-4 flex items-start gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span data-testid="msg-detail-error">{isError ? friendlyApiError(error) : "Research record not found."}</span>
          </CardContent>
        </Card>
      </div>
    );
  }

  const confCls = CONFIDENCE_COLORS[record.confidence] ?? "";

  return (
    <div className="container max-w-3xl mx-auto px-4 py-6 space-y-5">
      {/* Back */}
      <Button variant="ghost" size="sm" onClick={() => navigate("/research")} className="text-xs" data-testid="btn-back">
        <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />Research Library
      </Button>

      {/* Header card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3 justify-between flex-wrap">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base font-semibold mb-2 flex items-center gap-2 flex-wrap">
                <BookOpen className="h-4 w-4 text-sky-400 shrink-0" />
                <span data-testid="heading-record-title">{record.title}</span>
                {record.archived && <Badge variant="outline" className="text-[10px] text-muted-foreground">Archived</Badge>}
              </CardTitle>
              <div className="flex flex-wrap gap-1.5 items-center">
                <Badge variant="outline" className="text-[10px] text-sky-300 border-sky-500/40 bg-sky-500/10" data-testid="badge-domain">
                  {formatDomain(record.domain)}
                </Badge>
                <Badge variant="outline" className={`text-[10px] ${confCls}`} data-testid="badge-confidence">
                  {record.confidence}
                </Badge>
                {record.symbol && (
                  <Badge variant="secondary" className="text-[10px] font-mono" data-testid="badge-symbol">
                    {record.symbol}
                  </Badge>
                )}
                {record.symbols.filter(s => s !== record.symbol).slice(0, 3).map((s) => (
                  <Badge key={s} variant="outline" className="text-[10px] font-mono">{s}</Badge>
                ))}
                {record.strategyDisplayName && (
                  <Badge variant="outline" className="text-[10px]" data-testid="badge-strategy">{record.strategyDisplayName}</Badge>
                )}
              </div>
            </div>
            {/* Action buttons */}
            <div className="flex gap-1.5 flex-wrap shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setEditingMeta(!editingMeta)}
                data-testid="btn-edit-metadata"
                aria-label="Edit research metadata"
              >
                <Edit3 className="h-3.5 w-3.5" />
              </Button>
              {record.archived ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-sky-400"
                  onClick={() => restoreMutation.mutate()}
                  data-testid="btn-restore"
                  aria-label="Restore from archive"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground"
                  onClick={() => archiveMutation.mutate()}
                  data-testid="btn-archive"
                  aria-label="Archive record"
                >
                  <Archive className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => setDeleteOpen(true)}
                data-testid="btn-delete"
                aria-label="Delete record"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Date */}
          <p className="text-[10px] text-muted-foreground mt-2" data-testid="text-generated-at">
            Generated {formatGeneratedAt(record.generatedAt)} · Saved {formatGeneratedAt(record.createdAt)}
          </p>
        </CardHeader>

        {editingMeta && (
          <CardContent className="border-t border-border/50 pt-4">
            <MetadataEditor record={record} onSaved={() => setEditingMeta(false)} onCancel={() => setEditingMeta(false)} />
          </CardContent>
        )}
      </Card>

      {/* Data quality note */}
      {(record.dataQuality?.estimated || record.dataQuality?.simulated || record.dataQuality?.stale) && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs flex items-start gap-2" data-testid="alert-data-quality">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
          <span className="text-amber-100/90">
            {record.dataQuality.estimated && "Values are estimated (not live data). "}
            {record.dataQuality.simulated && "Simulation data only. "}
            {record.dataQuality.stale && "Data may be stale. "}
          </span>
        </div>
      )}

      {/* Domain-specific summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">{DOMAIN_LABELS[record.domain] ?? record.domain} Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <ResearchDomainSummary record={record} />
        </CardContent>
      </Card>

      {/* Evidence detail */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Evidence Detail</CardTitle>
        </CardHeader>
        <CardContent>
          <ResearchEvidenceDetail record={record} />
        </CardContent>
      </Card>

      {/* Tags & user label */}
      {(record.tags.length > 0 || record.userLabel) && (
        <Card>
          <CardContent className="p-4 space-y-2">
            {record.userLabel && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Note</p>
                <p className="text-sm" data-testid="text-user-label">{record.userLabel}</p>
              </div>
            )}
            {record.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5" data-testid="detail-tags">
                {record.tags.map((tag) => (
                  <span key={tag} className="text-[10px] rounded-sm bg-secondary text-secondary-foreground px-1.5 py-0.5">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Decision Journal */}
      {record && <DecisionJournalPanel record={record} />}

      {/* Disclaimer */}
      <p className="text-[10px] text-muted-foreground text-center pb-2">
        This is a deterministic research snapshot, not personalized investment advice.
      </p>

      {/* Delete confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent data-testid="dialog-delete-confirm" aria-labelledby="detail-delete-title">
          <AlertDialogHeader>
            <AlertDialogTitle id="detail-delete-title">Delete Research Record?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{record.title}</strong> and its linked decision journal entry (if any). This action cannot be undone.
              <br /><br />
              Deleting this record does not affect any brokerage positions or trade history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="btn-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="btn-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
