import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  BookOpen,
  Plus,
  Edit,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Loader2,
  Sparkles,
} from "lucide-react";

interface CustomStrategy {
  id: string;
  name: string;
  description: string | null;
  assetType: string;
  timeframe: string | null;
  rulesJson: any;
  sourceText: string | null;
  validationStatus: string;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function MyStrategiesPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [createTab, setCreateTab] = useState("plain");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [assetType, setAssetType] = useState("stock");
  const [timeframe, setTimeframe] = useState("");
  const [entryLogic, setEntryLogic] = useState("");
  const [stopLogic, setStopLogic] = useState("");
  const [targetLogic, setTargetLogic] = useState("");
  const [parsedRules, setParsedRules] = useState<any>(null);
  const { toast } = useToast();

  const { data: strategies, isLoading } = useQuery<CustomStrategy[]>({
    queryKey: ["/api/agent/custom-strategies"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/agent/custom-strategies", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/custom-strategies"] });
      setShowCreate(false);
      resetForm();
      toast({ title: "Strategy Created", description: "Your strategy has been saved as a draft." });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/agent/custom-strategies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/custom-strategies"] });
      toast({ title: "Strategy Deleted" });
    },
  });

  const parseMutation = useMutation({
    mutationFn: async (text: string) => {
      const res = await apiRequest("POST", "/api/agent/parse-strategy", { text });
      return res.json();
    },
    onSuccess: (data) => {
      setParsedRules(data);
    },
  });

  const resetForm = () => {
    setName("");
    setDescription("");
    setSourceText("");
    setAssetType("stock");
    setTimeframe("");
    setEntryLogic("");
    setStopLogic("");
    setTargetLogic("");
    setParsedRules(null);
  };

  const handleCreate = () => {
    if (!name.trim()) {
      toast({ title: "Name Required", variant: "destructive" });
      return;
    }

    const data: any = {
      name: name.trim(),
      description: description.trim() || null,
      assetType,
      timeframe: timeframe || null,
    };

    if (createTab === "plain") {
      data.sourceText = sourceText;
      data.rulesJson = parsedRules?.rules || null;
      data.validationStatus = parsedRules?.validationStatus || "draft";
    } else {
      data.rulesJson = {
        entryLogic,
        stopLogic,
        targetLogic,
      };
      data.validationStatus = entryLogic && stopLogic ? "validated" : "needs_review";
    }

    createMutation.mutate(data);
  };

  const validationBadge = (status: string) => {
    switch (status) {
      case "validated":
        return <Badge variant="outline" className="text-[10px] bg-green-500/15 text-green-400 border-green-500/30"><CheckCircle2 className="h-3 w-3 mr-0.5" />Validated</Badge>;
      case "needs_review":
        return <Badge variant="outline" className="text-[10px] bg-amber-500/15 text-amber-400 border-amber-500/30"><AlertTriangle className="h-3 w-3 mr-0.5" />Needs Review</Badge>;
      default:
        return <Badge variant="outline" className="text-[10px]"><FileText className="h-3 w-3 mr-0.5" />Draft</Badge>;
    }
  };

  return (
    <div className="flex-1 p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <BookOpen className="h-6 w-6 text-primary" />
            My Strategies
          </h1>
          <p className="text-sm text-muted-foreground" data-testid="text-page-subtitle">
            Create and manage your custom trading strategies
          </p>
        </div>
        <Dialog open={showCreate} onOpenChange={(v) => { setShowCreate(v); if (!v) resetForm(); }}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-strategy">
              <Plus className="h-4 w-4 mr-2" />
              New Strategy
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Custom Strategy</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Strategy Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Breakout Strategy" data-testid="input-strategy-name" />
              </div>
              <div className="space-y-1.5">
                <Label>Description (optional)</Label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description" data-testid="input-strategy-desc" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Asset Type</Label>
                  <Select value={assetType} onValueChange={setAssetType}>
                    <SelectTrigger data-testid="select-asset-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="stock">Stock</SelectItem>
                      <SelectItem value="option">Option</SelectItem>
                      <SelectItem value="future">Future</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Timeframe</Label>
                  <Select value={timeframe} onValueChange={setTimeframe}>
                    <SelectTrigger data-testid="select-timeframe"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1m">1 Minute</SelectItem>
                      <SelectItem value="5m">5 Minutes</SelectItem>
                      <SelectItem value="15m">15 Minutes</SelectItem>
                      <SelectItem value="1h">1 Hour</SelectItem>
                      <SelectItem value="1D">Daily</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Tabs value={createTab} onValueChange={setCreateTab}>
                <TabsList className="w-full">
                  <TabsTrigger value="plain" className="flex-1">Plain English</TabsTrigger>
                  <TabsTrigger value="structured" className="flex-1">Structured Form</TabsTrigger>
                </TabsList>
                <TabsContent value="plain" className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Describe your strategy in plain English</Label>
                    <Textarea
                      value={sourceText}
                      onChange={(e) => setSourceText(e.target.value)}
                      placeholder="Buy when price breaks above the high of the first 15 minutes and volume is above average. Stop below the opening range low. Exit at 2x risk."
                      className="min-h-[100px]"
                      data-testid="input-source-text"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => parseMutation.mutate(sourceText)}
                    disabled={!sourceText.trim() || parseMutation.isPending}
                    data-testid="button-parse-strategy"
                  >
                    {parseMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
                    Parse Strategy
                  </Button>
                  {parsedRules && (
                    <Card className="bg-accent/30">
                      <CardContent className="py-3 space-y-2 text-xs">
                        <p><strong>Entry:</strong> {parsedRules.rules?.entryLogic || "Not detected"}</p>
                        <p><strong>Stop:</strong> {parsedRules.rules?.stopLogic || "Not detected"}</p>
                        <p><strong>Target:</strong> {parsedRules.rules?.targetLogic || "Not detected"}</p>
                        <p><strong>Status:</strong> {parsedRules.validationStatus}</p>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>
                <TabsContent value="structured" className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Entry Logic</Label>
                    <Textarea value={entryLogic} onChange={(e) => setEntryLogic(e.target.value)} placeholder="e.g., Price breaks above 15-min opening range high with above-average volume" className="min-h-[60px]" data-testid="input-entry-logic" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Stop Logic</Label>
                    <Textarea value={stopLogic} onChange={(e) => setStopLogic(e.target.value)} placeholder="e.g., Below the opening range low" className="min-h-[60px]" data-testid="input-stop-logic" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Target Logic</Label>
                    <Textarea value={targetLogic} onChange={(e) => setTargetLogic(e.target.value)} placeholder="e.g., 2x the risk from entry" className="min-h-[60px]" data-testid="input-target-logic" />
                  </div>
                </TabsContent>
              </Tabs>

              <Button onClick={handleCreate} disabled={createMutation.isPending} className="w-full" data-testid="button-save-strategy">
                {createMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                Save Strategy
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !strategies || strategies.length === 0 ? (
        <Card className="border-dashed" data-testid="card-empty">
          <CardContent className="py-12 text-center space-y-3">
            <BookOpen className="h-10 w-10 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground">
              No custom strategies yet. Create your first strategy to use with the Agent.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {strategies.map((s) => (
            <Card key={s.id} className="bg-card/80" data-testid={`card-strategy-${s.id}`}>
              <CardContent className="py-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
                      <BookOpen className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{s.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">{s.assetType?.toUpperCase()}</span>
                        {s.timeframe && (
                          <>
                            <span className="text-xs text-muted-foreground">•</span>
                            <span className="text-xs text-muted-foreground">{s.timeframe}</span>
                          </>
                        )}
                        {s.description && (
                          <>
                            <span className="text-xs text-muted-foreground">•</span>
                            <span className="text-xs text-muted-foreground">{s.description}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {validationBadge(s.validationStatus)}
                    <Badge variant={s.isEnabled ? "default" : "secondary"} className="text-[10px]">
                      {s.isEnabled ? "Enabled" : "Disabled"}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => deleteMutation.mutate(s.id)}
                      data-testid={`button-delete-${s.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
