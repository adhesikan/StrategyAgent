import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TradeSetupCard } from "@/components/trade-setup-card";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import {
  Sparkles,
  Send,
  Loader2,
  Bot,
  Target,
  Clock,
  BarChart3,
  Lightbulb,
} from "lucide-react";

interface BuiltInStrategy {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  timeframes: string[];
}

export default function AgentPage() {
  const urlParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const [prompt, setPrompt] = useState("");
  const [symbol, setSymbol] = useState("");
  const [strategy, setStrategy] = useState(urlParams.get("strategy") || "");
  const [assetType, setAssetType] = useState("stock");
  const [timeframe, setTimeframe] = useState("");
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: strategies } = useQuery<BuiltInStrategy[]>({
    queryKey: ["/api/agent/strategies"],
  });

  const generateMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/agent/generate", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/setups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agent/activity"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Generation Failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleGenerate = () => {
    const data: any = {};
    if (prompt.trim()) data.prompt = prompt.trim();
    if (symbol.trim()) data.symbol = symbol.trim().toUpperCase();
    if (strategy) data.strategy = strategy;
    if (assetType) data.assetType = assetType;
    if (timeframe) data.timeframe = timeframe;

    if (!data.prompt && !data.symbol) {
      toast({
        title: "Missing Input",
        description: "Please enter a prompt or select a symbol to generate a setup.",
        variant: "destructive",
      });
      return;
    }

    generateMutation.mutate(data);
  };

  const examplePrompts = [
    "Give me a 15-minute ORB setup on TSLA",
    "Find a bullish pullback setup on NVDA",
    "Show a VWAP reclaim setup on AAPL",
    "Generate a setup with at least 2:1 reward to risk on MSFT",
    "Use volatility breakout strategy on AMD",
  ];

  return (
    <div className="flex-1 p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
          <Bot className="h-6 w-6 text-primary" />
          Strategy Agent
        </h1>
        <p className="text-sm text-muted-foreground" data-testid="text-page-subtitle">
          AI-powered strategy analysis and setup generation
        </p>
      </div>

      <Card className="border-primary/20 bg-card/80 backdrop-blur" data-testid="card-agent-input">
        <CardContent className="pt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="prompt" className="text-sm font-medium flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Describe your setup
            </Label>
            <Textarea
              id="prompt"
              placeholder="e.g., Give me a 15-minute ORB setup on TSLA..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="min-h-[80px] resize-none"
              data-testid="input-prompt"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleGenerate();
                }
              }}
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Target className="h-3 w-3" />
                Symbol
              </Label>
              <Input
                placeholder="TSLA"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                className="h-9"
                data-testid="input-symbol"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Asset Type</Label>
              <Select value={assetType} onValueChange={setAssetType}>
                <SelectTrigger className="h-9" data-testid="select-asset-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stock">Stock</SelectItem>
                  <SelectItem value="option">Option</SelectItem>
                  <SelectItem value="future">Future</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <BarChart3 className="h-3 w-3" />
                Strategy
              </Label>
              <Select value={strategy} onValueChange={setStrategy}>
                <SelectTrigger className="h-9" data-testid="select-strategy">
                  <SelectValue placeholder="Auto-detect" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto-detect</SelectItem>
                  {strategies?.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Timeframe
              </Label>
              <Select value={timeframe} onValueChange={setTimeframe}>
                <SelectTrigger className="h-9" data-testid="select-timeframe">
                  <SelectValue placeholder="Auto" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="1m">1 Minute</SelectItem>
                  <SelectItem value="5m">5 Minutes</SelectItem>
                  <SelectItem value="15m">15 Minutes</SelectItem>
                  <SelectItem value="30m">30 Minutes</SelectItem>
                  <SelectItem value="1h">1 Hour</SelectItem>
                  <SelectItem value="1D">Daily</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            onClick={handleGenerate}
            disabled={generateMutation.isPending}
            className="w-full h-11"
            data-testid="button-generate-setup"
          >
            {generateMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating Setup...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Generate Setup
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {!generateMutation.data && !generateMutation.isPending && (
        <Card className="border-dashed border-border/40" data-testid="card-examples">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              <Lightbulb className="h-4 w-4 text-amber-400" />
              Example Prompts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {examplePrompts.map((example, i) => (
              <button
                key={i}
                onClick={() => {
                  setPrompt(example);
                }}
                className="block w-full text-left text-sm text-muted-foreground hover:text-foreground transition-colors p-2 rounded-md hover:bg-accent/50"
                data-testid={`button-example-${i}`}
              >
                "{example}"
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {generateMutation.data?.setup && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold" data-testid="text-results-title">Generated Setup</h2>
          <TradeSetupCard
            setup={generateMutation.data.setup}
            onOpenChart={(sym) => navigate(`/charts/${sym}`)}
            onSendToInstatrade={(setup) => {
              toast({
                title: "InstaTrade™",
                description: `Opening InstaTrade™ for ${setup.symbol}...`,
              });
            }}
            onReviewSetup={(setup) => {
              toast({
                title: "Setup Reviewed",
                description: `${setup.strategyName} setup for ${setup.symbol} marked as reviewed.`,
              });
            }}
          />
        </div>
      )}

      {generateMutation.data && !generateMutation.data.setup && (
        <Card className="border-amber-500/30 bg-amber-500/5" data-testid="card-no-setup">
          <CardContent className="py-6 text-center">
            <p className="text-sm text-muted-foreground">
              No valid setup currently matches the selected strategy conditions.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
