import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import { useState } from "react";
import {
  History,
  Search,
  Filter,
  Clock,
  BarChart3,
  Zap,
  Eye,
  Loader2,
  Info,
} from "lucide-react";
import { HelpLink } from "@/components/help-link";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface SetupHistoryItem {
  id: string;
  symbol: string;
  strategyName: string;
  assetType: string;
  timeframe: string;
  modelScore: number | null;
  status: string;
  sentToInstatrade: boolean;
  createdAt: string;
  setupJson: any;
}

export default function TradeSetupsPage() {
  const [symbolFilter, setSymbolFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [gradeFilter, setGradeFilter] = useState("all");
  const [instrumentFilter, setInstrumentFilter] = useState("all");
  const [executedFilter, setExecutedFilter] = useState("all");
  const [minScore, setMinScore] = useState<string>("");
  const [, navigate] = useLocation();

  const buildQueryString = () => {
    const params = new URLSearchParams();
    if (symbolFilter) params.set("symbol", symbolFilter);
    if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  };

  const { data: setupsRaw, isLoading } = useQuery<SetupHistoryItem[]>({
    queryKey: [`/api/agent/setups${buildQueryString()}`],
  });

  const setups = (setupsRaw || []).filter((s) => {
    const sj = s.setupJson || {};
    const grade = sj.probability?.grade;
    const score = sj.probability?.finalScore ?? s.modelScore ?? 0;
    const instrument = sj.instrument?.recommended || (s.assetType === "option" ? "option" : "stock");
    if (gradeFilter !== "all" && grade !== gradeFilter) return false;
    if (instrumentFilter === "stock" && instrument !== "stock") return false;
    if (instrumentFilter === "option" && instrument === "stock") return false;
    if (executedFilter === "yes" && !s.sentToInstatrade) return false;
    if (executedFilter === "no" && s.sentToInstatrade) return false;
    if (minScore && Number(score) < Number(minScore)) return false;
    return true;
  });

  const statusColor = (status: string) => {
    switch (status) {
      case "generated": return "bg-blue-500/15 text-blue-400 border-blue-500/30";
      case "reviewed": return "bg-amber-500/15 text-amber-400 border-amber-500/30";
      case "sent_to_instatrade": return "bg-green-500/15 text-green-400 border-green-500/30";
      case "archived": return "bg-muted text-muted-foreground border-border";
      default: return "bg-muted text-muted-foreground border-border";
    }
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case "generated": return "Generated";
      case "reviewed": return "Reviewed";
      case "sent_to_instatrade": return "Sent to InstaTrade™";
      case "archived": return "Archived";
      default: return status;
    }
  };

  return (
    <div className="flex-1 p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <History className="h-6 w-6 text-primary" />
            Trade Setups
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="text-muted-foreground/70 hover:text-foreground" aria-label="About trade setups">
                    <Info className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[300px] text-xs leading-snug">
                  Every AI-generated setup is logged here — including its score, instrument recommendation, status, and whether you sent it to InstaTrade™. Use the filters to narrow by symbol, grade, or execution status.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </h1>
          <p className="text-sm text-muted-foreground" data-testid="text-page-subtitle">
            Previously generated setup history
          </p>
        </div>
        <HelpLink section="journal" label="History help" />
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter by symbol..."
            value={symbolFilter}
            onChange={(e) => setSymbolFilter(e.target.value.toUpperCase())}
            className="pl-9 h-9"
            data-testid="input-filter-symbol"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px] h-9" data-testid="select-filter-status">
            <Filter className="h-3.5 w-3.5 mr-1.5" />
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="generated">Generated</SelectItem>
            <SelectItem value="reviewed">Reviewed</SelectItem>
            <SelectItem value="sent_to_instatrade">Sent to InstaTrade™</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        <Select value={gradeFilter} onValueChange={setGradeFilter}>
          <SelectTrigger className="w-[130px] h-9" data-testid="select-filter-grade">
            <SelectValue placeholder="All Grades" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Grades</SelectItem>
            <SelectItem value="A+">A+ only</SelectItem>
            <SelectItem value="A">A only</SelectItem>
            <SelectItem value="B">B only</SelectItem>
            <SelectItem value="C">C only</SelectItem>
          </SelectContent>
        </Select>
        <Select value={instrumentFilter} onValueChange={setInstrumentFilter}>
          <SelectTrigger className="w-[140px] h-9" data-testid="select-filter-instrument">
            <SelectValue placeholder="Instrument" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Instruments</SelectItem>
            <SelectItem value="stock">Stock</SelectItem>
            <SelectItem value="option">Options</SelectItem>
          </SelectContent>
        </Select>
        <Select value={executedFilter} onValueChange={setExecutedFilter}>
          <SelectTrigger className="w-[140px] h-9" data-testid="select-filter-executed">
            <SelectValue placeholder="Executed" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Executed</SelectItem>
            <SelectItem value="yes">Sent only</SelectItem>
            <SelectItem value="no">Not sent</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type="number"
          min={0}
          max={100}
          placeholder="Min score"
          value={minScore}
          onChange={(e) => setMinScore(e.target.value)}
          className="w-[110px] h-9"
          data-testid="input-filter-minscore"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !setups || setups.length === 0 ? (
        <Card className="border-dashed" data-testid="card-empty">
          <CardContent className="py-12 text-center space-y-3">
            <History className="h-10 w-10 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground">
              No setups generated yet. Go to the Agent page to generate your first setup.
            </p>
            <Button variant="outline" onClick={() => navigate("/agent")} data-testid="button-go-to-agent">
              Go to Agent
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {setups.map((setup) => (
            <Card key={setup.id} className="bg-card/80" data-testid={`card-setup-history-${setup.id}`}>
              <CardContent className="py-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
                      <span className="text-sm font-bold text-primary">{setup.symbol}</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium">{setup.strategyName}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">{setup.assetType?.toUpperCase()}</span>
                        <span className="text-xs text-muted-foreground">•</span>
                        <span className="text-xs text-muted-foreground">{setup.timeframe}</span>
                        <span className="text-xs text-muted-foreground">•</span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(setup.createdAt).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {setup.modelScore !== null && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <BarChart3 className="h-3 w-3" />
                        Score: {setup.modelScore}
                      </span>
                    )}
                    <Badge variant="outline" className={`text-[10px] ${statusColor(setup.status)}`} data-testid={`badge-status-${setup.id}`}>
                      {statusLabel(setup.status)}
                    </Badge>
                    {setup.sentToInstatrade && (
                      <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30" data-testid={`badge-instatrade-${setup.id}`}>
                        <Zap className="h-3 w-3 mr-0.5" />
                        InstaTrade™
                      </Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/60 text-center" data-testid="text-disclaimer">
        Software-generated setup for informational purposes only. Not investment advice or a recommendation.
      </p>
    </div>
  );
}
