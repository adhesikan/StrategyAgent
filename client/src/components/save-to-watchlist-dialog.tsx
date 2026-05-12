import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Bookmark } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Watchlist } from "@shared/schema";

interface SaveToWatchlistDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ticker: string;
}

export function SaveToWatchlistDialog({ open, onOpenChange, ticker }: SaveToWatchlistDialogProps) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [selectedId, setSelectedId] = useState<string>("");
  const [newName, setNewName] = useState("");

  const { data: watchlists, isLoading } = useQuery<Watchlist[]>({
    queryKey: ["/api/watchlists"],
    enabled: open,
  });

  const hasExisting = (watchlists?.length ?? 0) > 0;

  // Default the radio selection based on what's available the first time
  // the dialog opens with watchlists loaded.
  useEffect(() => {
    if (!open) return;
    if (!hasExisting) {
      setMode("new");
    } else if (!selectedId && watchlists?.[0]) {
      setSelectedId(watchlists[0].id);
    }
  }, [open, hasExisting, watchlists, selectedId]);

  // Reset transient state whenever the dialog closes for predictable next open.
  useEffect(() => {
    if (open) return;
    setNewName("");
    setSelectedId("");
    setMode("existing");
  }, [open]);

  const addMutation = useMutation({
    mutationFn: async ({ watchlistId, symbol }: { watchlistId: string; symbol: string }) => {
      await apiRequest("POST", `/api/watchlists/${watchlistId}/symbols`, { symbol });
    },
  });

  const createMutation = useMutation({
    mutationFn: async ({ name, symbol }: { name: string; symbol: string }) => {
      const res = await apiRequest("POST", "/api/watchlists", { name, symbols: [symbol] });
      return res.json() as Promise<Watchlist>;
    },
  });

  const isSaving = addMutation.isPending || createMutation.isPending;

  async function handleSave() {
    const sym = ticker.toUpperCase();
    try {
      if (mode === "existing") {
        if (!selectedId) {
          toast({ title: "Pick a watchlist", variant: "destructive" });
          return;
        }
        await addMutation.mutateAsync({ watchlistId: selectedId, symbol: sym });
        toast({ title: `${sym} added`, description: "Saved to your watchlist." });
      } else {
        const name = newName.trim();
        if (!name) {
          toast({ title: "Enter a watchlist name", variant: "destructive" });
          return;
        }
        await createMutation.mutateAsync({ name, symbol: sym });
        toast({ title: `${sym} added`, description: `New watchlist "${name}" created.` });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/watchlists"] });
      onOpenChange(false);
      setNewName("");
    } catch (err) {
      toast({
        title: "Failed to save",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-save-watchlist">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bookmark className="h-4 w-4" />
            Save {ticker.toUpperCase()} to watchlist
          </DialogTitle>
          <DialogDescription>
            Add this symbol to an existing watchlist or create a new one.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <RadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as "existing" | "new")}
            className="space-y-3"
          >
            <div className="flex items-start gap-3">
              <RadioGroupItem
                value="existing"
                id="watchlist-existing"
                disabled={!hasExisting && !isLoading}
                data-testid="radio-existing"
                className="mt-2"
              />
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="watchlist-existing" className="text-sm font-medium">
                  Add to existing watchlist
                </Label>
                <Select
                  value={selectedId}
                  onValueChange={setSelectedId}
                  disabled={mode !== "existing" || !hasExisting}
                >
                  <SelectTrigger data-testid="select-watchlist">
                    <SelectValue placeholder={isLoading ? "Loading…" : hasExisting ? "Choose a watchlist" : "No watchlists yet"} />
                  </SelectTrigger>
                  <SelectContent>
                    {watchlists?.map((w) => (
                      <SelectItem key={w.id} value={w.id} data-testid={`option-watchlist-${w.id}`}>
                        {w.name} ({w.symbols?.length ?? 0})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <RadioGroupItem
                value="new"
                id="watchlist-new"
                data-testid="radio-new"
                className="mt-2"
              />
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="watchlist-new" className="text-sm font-medium">
                  Create new watchlist
                </Label>
                <Input
                  placeholder="e.g. Earnings plays"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  disabled={mode !== "new"}
                  maxLength={60}
                  data-testid="input-new-watchlist-name"
                />
              </div>
            </div>
          </RadioGroup>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-save">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving} data-testid="button-confirm-save">
            {isSaving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
