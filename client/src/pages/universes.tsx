import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Globe,
} from "lucide-react";
import type { PlatformUniverse } from "@shared/platform-types";

interface UniverseDetail {
  id: string;
  name: string;
  count: number;
  description: string | null;
  symbols: string[];
}

export default function UniversesPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUniverse, setEditingUniverse] = useState<UniverseDetail | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PlatformUniverse | null>(null);

  const [formName, setFormName] = useState("");
  const [formTickers, setFormTickers] = useState("");
  const [formDescription, setFormDescription] = useState("");

  const { data: universes, isLoading } = useQuery<PlatformUniverse[]>({
    queryKey: ["/api/platform/universes"],
  });

  const createMutation = useMutation({
    mutationFn: async (body: { name: string; symbols: string[]; description?: string }) => {
      const res = await apiRequest("POST", "/api/platform/universes", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/universes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/platform/context"] });
      toast({ title: "Universe created" });
      closeDialog();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: { name?: string; symbols: string[]; description?: string } }) => {
      const res = await apiRequest("PUT", `/api/platform/universes/${id}`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/universes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/platform/context"] });
      toast({ title: "Universe updated" });
      closeDialog();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/platform/universes/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/universes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/platform/context"] });
      toast({ title: "Universe deleted" });
      setDeleteTarget(null);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete", description: err.message, variant: "destructive" });
    },
  });

  function openCreate() {
    setEditingUniverse(null);
    setFormName("");
    setFormTickers("");
    setFormDescription("");
    setDialogOpen(true);
  }

  function openEdit(u: PlatformUniverse) {
    fetchUniverseDetail(u.id);
  }

  async function fetchUniverseDetail(id: string) {
    try {
      const res = await fetch(`/api/platform/universes/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Not found");
      const detail: UniverseDetail = await res.json();
      setEditingUniverse(detail);
      setFormName(detail.name);
      setFormDescription(detail.description ?? "");
      setFormTickers(detail.symbols.join(", "));
      setDialogOpen(true);
    } catch {
      toast({ title: "Failed to load universe details", variant: "destructive" });
    }
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingUniverse(null);
    setFormName("");
    setFormTickers("");
    setFormDescription("");
  }

  function parseSymbols(raw: string): string[] {
    return raw
      .split(/[,\s]+/)
      .map(s => s.trim().toUpperCase())
      .filter(s => s.length > 0 && s.length <= 10);
  }

  function handleSubmit() {
    const symbols = parseSymbols(formTickers);
    if (!formName.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    if (symbols.length === 0) {
      toast({ title: "At least one ticker is required", variant: "destructive" });
      return;
    }

    if (editingUniverse) {
      updateMutation.mutate({
        id: editingUniverse.id,
        body: {
          name: formName.trim(),
          symbols,
          description: formDescription.trim() || undefined,
        },
      });
    } else {
      createMutation.mutate({
        name: formName.trim(),
        symbols,
        description: formDescription.trim() || undefined,
      });
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/settings")}
          data-testid="button-back-settings"
        >
          <ArrowLeft />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold" data-testid="text-page-title">Ticker Universes</h1>
          <p className="text-sm text-muted-foreground">Manage custom symbol lists for scanning and analysis</p>
        </div>
        <Button onClick={openCreate} data-testid="button-create-universe">
          <Plus className="mr-1 h-4 w-4" />
          New Universe
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : !universes || universes.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Globe className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground mb-4">No universes yet. Create one to get started.</p>
            <Button onClick={openCreate} data-testid="button-create-empty">
              <Plus className="mr-1 h-4 w-4" />
              Create Universe
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Symbols</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {universes.map((u) => (
                <TableRow key={u.id} data-testid={`row-universe-${u.id}`}>
                  <TableCell>
                    <div>
                      <span className="font-medium" data-testid={`text-name-${u.id}`}>{u.name}</span>
                      {u.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{u.description}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" data-testid={`text-count-${u.id}`}>{u.count} tickers</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(u)}
                        data-testid={`button-edit-${u.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteTarget(u)}
                        data-testid={`button-delete-${u.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle data-testid="text-dialog-title">
              {editingUniverse ? "Edit Universe" : "Create Universe"}
            </DialogTitle>
            <DialogDescription>
              {editingUniverse
                ? "Update the name and tickers for this universe."
                : "Give your universe a name and add tickers separated by commas."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="universe-name">Name</Label>
              <Input
                id="universe-name"
                placeholder="e.g. My Watchlist"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                data-testid="input-universe-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="universe-tickers">Tickers</Label>
              <Input
                id="universe-tickers"
                placeholder="AAPL, MSFT, NVDA, TSLA"
                value={formTickers}
                onChange={(e) => setFormTickers(e.target.value)}
                data-testid="input-universe-tickers"
              />
              <p className="text-xs text-muted-foreground">
                Comma or space separated. {parseSymbols(formTickers).length} symbol{parseSymbols(formTickers).length !== 1 ? "s" : ""} detected.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="universe-desc">Description (optional)</Label>
              <Input
                id="universe-desc"
                placeholder="Optional description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                data-testid="input-universe-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} data-testid="button-dialog-cancel">
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isSaving} data-testid="button-dialog-save">
              {isSaving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {editingUniverse ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Universe</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteTarget?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              data-testid="button-delete-confirm"
            >
              {deleteMutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
