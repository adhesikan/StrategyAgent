// Sprint 5.4D — Save Research button and dialog.
// Only the server-issued handleId is submitted — never evidence content.
// Handle ID is never stored in localStorage, URL, or analytics.

import { useState, useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { BookmarkPlus, BookmarkCheck, Clock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { ResearchSaveMeta, ResearchRecord } from "@/lib/research-records";

interface Props {
  researchSave: ResearchSaveMeta;
}

type SaveState = "idle" | "dialog" | "saving" | "saved" | "expired" | "consumed" | "error";

function useCountdown(expiresAt: string): { expired: boolean; remaining: string } {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return { expired: true, remaining: "" };
  const mins = Math.ceil(ms / 60_000);
  return { expired: false, remaining: `${mins}m` };
}

export function SaveResearchButton({ researchSave }: Props) {
  const { toast } = useToast();
  const { expired, remaining } = useCountdown(researchSave.expiresAt);

  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [title, setTitle] = useState(researchSave.titleSuggestion);
  const [userLabel, setUserLabel] = useState("");
  const [tags, setTags] = useState<string[]>(researchSave.tagSuggestions);
  const [tagInput, setTagInput] = useState("");
  const [savedRecordId, setSavedRecordId] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // If expiry ticks past while dialog is open, close and show expired state
  useEffect(() => {
    if (expired && (saveState === "idle" || saveState === "dialog")) {
      setSaveState("expired");
    }
  }, [expired, saveState]);

  const saveMutation = useMutation<ResearchRecord, Error, void>({
    mutationFn: async () => {
      // Only submit the opaque handle + approved user metadata.
      // Never submit evidence, account IDs, context tokens, or raw data.
      const body = {
        handleId: researchSave.handleId,
        title: title.trim() || researchSave.titleSuggestion,
        ...(userLabel.trim() ? { userLabel: userLabel.trim() } : {}),
        tags: tags.filter(Boolean),
      };
      const res = await apiRequest("POST", "/api/research-records", body);
      return res.json() as Promise<ResearchRecord>;
    },
    onSuccess: (record) => {
      setSavedRecordId(record.id);
      setSaveState("saved");
      // Analytics: only event name, no handle IDs or record content
      try { window.dispatchEvent(new CustomEvent("research_save_succeeded")); } catch {}
    },
    onError: (err) => {
      const msg = err.message ?? "";
      if (msg.includes("410") || msg.toLowerCase().includes("expired")) {
        setSaveState("expired");
        toast({ title: "Snapshot expired", description: "This research snapshot has expired. Run the analysis again to create a fresh snapshot.", variant: "destructive" });
      } else if (msg.includes("409") || msg.toLowerCase().includes("consumed")) {
        setSaveState("consumed");
        toast({ title: "Already saved", description: "This research snapshot was already saved.", variant: "destructive" });
      } else if (msg.includes("401") || msg.includes("403")) {
        setSaveState("error");
        toast({ title: "Session error", description: "Please refresh and sign in again.", variant: "destructive" });
      } else {
        setSaveState("error");
        toast({ title: "Save failed", description: "Something went wrong. Please try again.", variant: "destructive" });
      }
      // Analytics: only event name
      try { window.dispatchEvent(new CustomEvent("research_save_failed")); } catch {}
    },
  });

  function handleOpen() {
    if (expired) { setSaveState("expired"); return; }
    if (saveState === "saved" || saveState === "consumed") return;
    setSaveState("dialog");
    // Reset form to suggestions each time dialog opens (if not already saved)
    setTitle(researchSave.titleSuggestion);
    setTags(researchSave.tagSuggestions);
    setUserLabel("");
    setTagInput("");
    // Analytics
    try { window.dispatchEvent(new CustomEvent("research_save_clicked")); } catch {}
    setTimeout(() => titleRef.current?.focus(), 100);
  }

  function handleSave() {
    if (saveMutation.isPending) return;
    setSaveState("saving");
    saveMutation.mutate();
  }

  function addTag(raw: string) {
    const normalized = raw.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 50);
    if (!normalized || tags.includes(normalized) || tags.length >= 10) return;
    setTags((prev) => [...prev, normalized]);
  }

  function removeTag(tag: string) {
    setTags((prev) => prev.filter((t) => t !== tag));
  }

  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(tagInput);
      setTagInput("");
    }
    if (e.key === "Backspace" && !tagInput && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1));
    }
  }

  // Button rendering based on state
  if (saveState === "saved") {
    return (
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="text-emerald-300 border-emerald-500/40 bg-emerald-500/10 cursor-default"
          disabled
          data-testid="btn-research-saved"
          aria-label="Research saved"
        >
          <BookmarkCheck className="h-3.5 w-3.5 mr-1.5" />
          Saved
        </Button>
        {savedRecordId && (
          <a
            href={`/research/${savedRecordId}`}
            className="text-xs text-sky-400 underline underline-offset-2 hover:text-sky-300"
            data-testid="link-open-saved-record"
            aria-label="Open saved research record"
          >
            Open record
          </a>
        )}
      </div>
    );
  }

  if (saveState === "expired") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-amber-400/80" role="status" aria-live="polite" data-testid="msg-research-expired">
        <Clock className="h-3.5 w-3.5 shrink-0" />
        <span>Snapshot expired — run analysis again to save.</span>
      </div>
    );
  }

  if (saveState === "consumed") {
    return (
      <div className="text-xs text-muted-foreground" data-testid="msg-research-consumed">
        Research already saved.
      </div>
    );
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="text-sky-300 border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/20"
        onClick={handleOpen}
        disabled={saveState === "saving"}
        data-testid="btn-save-research"
        aria-label={
          expired
            ? "Research snapshot expired"
            : remaining
            ? `Save Research (expires in ${remaining})`
            : "Save Research"
        }
      >
        <BookmarkPlus className="h-3.5 w-3.5 mr-1.5" />
        {saveState === "saving" ? "Saving…" : `Save Research${remaining ? ` · ${remaining}` : ""}`}
      </Button>

      <Dialog open={saveState === "dialog"} onOpenChange={(open) => { if (!open) setSaveState("idle"); }}>
        <DialogContent
          className="sm:max-w-md"
          aria-labelledby="save-research-dialog-title"
          aria-describedby="save-research-dialog-desc"
          data-testid="dialog-save-research"
        >
          <DialogHeader>
            <DialogTitle id="save-research-dialog-title">Save Research Snapshot</DialogTitle>
            <DialogDescription id="save-research-dialog-desc">
              Save this deterministic analysis snapshot to your Research Library. You can edit the title and tags.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Domain badge */}
            <div>
              <Badge variant="outline" className="text-[10px] text-sky-300 border-sky-500/40 bg-sky-500/10" data-testid="badge-save-domain">
                {researchSave.domain.replace(/_/g, " ")}
              </Badge>
            </div>

            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="research-title">Title</Label>
              <Input
                id="research-title"
                ref={titleRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                placeholder={researchSave.titleSuggestion}
                data-testid="input-research-title"
                aria-label="Research record title"
              />
            </div>

            {/* Optional label */}
            <div className="space-y-1.5">
              <Label htmlFor="research-label">Personal note <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                id="research-label"
                value={userLabel}
                onChange={(e) => setUserLabel(e.target.value)}
                maxLength={500}
                placeholder="e.g. Watching for breakout above resistance"
                data-testid="input-research-label"
                aria-label="Personal note"
              />
            </div>

            {/* Tags */}
            <div className="space-y-1.5">
              <Label htmlFor="research-tags">Tags</Label>
              <div
                className="flex flex-wrap gap-1.5 rounded-md border border-input bg-background px-3 py-2 min-h-[38px] focus-within:ring-2 focus-within:ring-ring"
                role="group"
                aria-label="Research tags"
              >
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-sm bg-secondary text-secondary-foreground text-xs px-1.5 py-0.5"
                    data-testid={`tag-chip-${tag}`}
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      className="hover:text-destructive focus:outline-none focus:text-destructive"
                      aria-label={`Remove tag ${tag}`}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
                {tags.length < 10 && (
                  <input
                    id="research-tags"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={handleTagKeyDown}
                    onBlur={() => { if (tagInput) { addTag(tagInput); setTagInput(""); } }}
                    className="flex-1 min-w-[80px] bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                    placeholder={tags.length === 0 ? "Add tags (Enter to confirm)" : "Add tag…"}
                    data-testid="input-tag-entry"
                    aria-label="Add tag (press Enter or comma to confirm)"
                  />
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">Press Enter or comma to add a tag. Max 10.</p>
            </div>

            {/* Expiry note */}
            {remaining && (
              <p className="text-[10px] text-amber-400/80 flex items-center gap-1" aria-live="polite">
                <Clock className="h-3 w-3 shrink-0" />
                Snapshot expires in {remaining}
              </p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => setSaveState("idle")}
              data-testid="btn-cancel-save"
              aria-label="Cancel saving research"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saveMutation.isPending || !title.trim()}
              data-testid="btn-confirm-save"
              aria-label="Confirm save research snapshot"
            >
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
