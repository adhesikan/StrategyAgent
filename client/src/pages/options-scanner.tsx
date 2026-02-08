import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { PlatformUniverse, PlatformRiskProfile } from "@shared/platform-types";
import {
  Loader2,
  Lock,
  ScanLine,
  Play,
  History,
  TrendingUp,
  TrendingDown,
  Info,
  Clock,
  Shield,
  ExternalLink,
  AlertTriangle,
  Unplug,
  Pencil,
  Globe,
} from "lucide-react";

interface MeResponse {
  user: { id: string; email: string; role: string };
  entitlements: {
    stockScanner: boolean;
    optionsScanner: boolean;
    automation: boolean;
    plan: string;
  };
  broker: { connected: boolean; provider: string | null };
}

interface BrokerStatus {
  connected: boolean;
  provider?: string;
  status?: string;
  lastChecked?: string;
}

interface OptionCandidate {
  rank: number;
  symbol: string;
  underlying: string;
  expiration: string;
  strike: number;
  optionType: "call" | "put";
  strategy: string;
  bid: number;
  ask: number;
  mid: number;
  impliedVol: number;
  delta: number;
  theta: number;
  openInterest: number;
  volume: number;
  score: number;
  rationale: string;
}

interface ScanResult {
  strategyKey: string;
  universeId: string;
  scannedAt: string;
  candidateCount: number;
  candidates: OptionCandidate[];
}

interface StrategyDef {
  key: string;
  label: string;
  description: string;
}

interface ScanHistoryItem {
  id: string;
  createdAt: string;
  universeId: string;
  strategyKey: string;
  resultJson: ScanResult;
}

const MODE_LABELS: Record<string, string> = {
  conservative: "Conservative",
  balanced: "Balanced",
  aggressive: "Aggressive",
};

export default function OptionsScanner() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [universeId, setUniverseId] = useState("");
  const [activeStrategy, setActiveStrategy] = useState("wheel");
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const { data: me, isLoading: meLoading } = useQuery<MeResponse>({
    queryKey: ["/api/auth/me"],
  });

  const { data: universes, isLoading: universesLoading } = useQuery<PlatformUniverse[]>({
    queryKey: ["/api/platform/universes"],
    enabled: !!me?.entitlements?.optionsScanner,
  });

  const { data: riskProfile, isLoading: riskLoading } = useQuery<PlatformRiskProfile>({
    queryKey: ["/api/platform/risk-profile"],
    enabled: !!me?.entitlements?.optionsScanner,
  });

  const { data: brokerStatus } = useQuery<BrokerStatus>({
    queryKey: ["/api/broker/status"],
    enabled: !!me?.entitlements?.optionsScanner,
  });

  const { data: strategies } = useQuery<StrategyDef[]>({
    queryKey: ["/api/options/strategies"],
    enabled: !!me?.entitlements?.optionsScanner,
  });

  const { data: scanHistory } = useQuery<ScanHistoryItem[]>({
    queryKey: ["/api/options/scans"],
    enabled: !!me?.entitlements?.optionsScanner && showHistory,
  });

  const selectedUniverseId = universeId || (universes && universes.length > 0 ? universes[0].id : "");

  const scanMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/options/scan", {
        universeId: selectedUniverseId,
        strategyKey: activeStrategy,
        riskProfileId: riskProfile?.id,
      });
      return res.json();
    },
    onSuccess: (data: ScanResult) => {
      setScanResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/options/scans"] });
      toast({
        title: "Scan complete",
        description: `Found ${data.candidateCount} candidates for ${data.strategyKey}`,
      });
    },
    onError: () => {
      toast({
        title: "Scan failed",
        description: "Could not complete the options scan. Please try again.",
        variant: "destructive",
      });
    },
  });

  if (meLoading) {
    return (
      <div className="flex items-center justify-center h-full" data-testid="loading-options">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!me?.entitlements?.optionsScanner) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Lock className="h-6 w-6 text-muted-foreground" />
            </div>
            <CardTitle data-testid="text-options-locked">Options Scanner</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-muted-foreground" data-testid="text-upgrade-message">
              Upgrade to Pro to access Options Scanner
            </p>
            <Link href="/pricing">
              <Button data-testid="button-upgrade-pricing">View Pricing</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isDataLoading = universesLoading || riskLoading;
  const brokerConnected = brokerStatus?.connected === true;
  const hasUniverses = universes && universes.length > 0;
  const canScan = brokerConnected && !!selectedUniverseId && !scanMutation.isPending;

  const activeStrategyDef = strategies?.find((s) => s.key === activeStrategy);

  return (
    <div className="flex-1 overflow-auto p-4 md:p-6 space-y-5" data-testid="options-scanner-container">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <ScanLine className="h-6 w-6 text-primary" />
            Options Scanner
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Find high-probability options trades across strategies
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowHistory(!showHistory)}
            data-testid="button-toggle-history"
          >
            <History className="h-4 w-4 mr-1" />
            {showHistory ? "Hide History" : "Scan History"}
          </Button>
        </div>
      </div>

      {isDataLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card data-testid="card-universe-selector">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Globe className="h-4 w-4 text-muted-foreground" />
                    Ticker Universe
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate("/settings/universes")}
                    className="text-xs"
                    data-testid="link-manage-universes"
                  >
                    Manage
                    <ExternalLink className="h-3 w-3 ml-1" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {!hasUniverses ? (
                  <div className="text-center py-4 space-y-3">
                    <p className="text-sm text-muted-foreground" data-testid="text-no-universes">
                      No ticker universes configured yet.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate("/settings/universes")}
                      data-testid="button-create-first-universe"
                    >
                      Create Universe
                    </Button>
                  </div>
                ) : (
                  <Select
                    value={selectedUniverseId}
                    onValueChange={setUniverseId}
                  >
                    <SelectTrigger data-testid="select-universe">
                      <SelectValue placeholder="Select universe" />
                    </SelectTrigger>
                    <SelectContent>
                      {universes.map((u) => (
                        <SelectItem key={u.id} value={u.id} data-testid={`option-universe-${u.id}`}>
                          {u.name} ({u.count})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </CardContent>
            </Card>

            <Card data-testid="card-risk-profile">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Shield className="h-4 w-4 text-muted-foreground" />
                    Risk Profile
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate("/settings/risk-profile")}
                    className="text-xs"
                    data-testid="link-edit-risk-profile"
                  >
                    <Pencil className="h-3 w-3 mr-1" />
                    Edit
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {riskProfile ? (
                  <div className="flex flex-wrap items-center gap-2" data-testid="risk-profile-summary">
                    <Badge variant="secondary" data-testid="text-risk-mode">
                      {MODE_LABELS[riskProfile.risk_mode] ?? riskProfile.risk_mode}
                    </Badge>
                    <span className="text-sm text-muted-foreground" data-testid="text-risk-deploy">
                      Deploy {riskProfile.max_deploy}%
                    </span>
                    <span className="text-sm text-muted-foreground" data-testid="text-risk-per-trade">
                      Risk {riskProfile.risk_per_trade}%/trade
                    </span>
                    <Badge
                      variant={riskProfile.protections_enabled ? "default" : "outline"}
                      className="text-xs"
                      data-testid="text-protections-status"
                    >
                      {riskProfile.protections_enabled ? "Protections ON" : "Protections OFF"}
                    </Badge>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No risk profile found.</p>
                )}
              </CardContent>
            </Card>
          </div>

          {!brokerConnected && (
            <Card className="border-yellow-500/30" data-testid="card-broker-warning">
              <CardContent className="py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Unplug className="h-5 w-5 text-yellow-500" />
                    <div>
                      <p className="text-sm font-medium" data-testid="text-broker-warning">
                        Broker not connected
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Connect a brokerage to run live options scans
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => navigate("/settings")}
                    data-testid="button-connect-broker"
                  >
                    Connect Tradier
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card data-testid="card-scan-panel">
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3 flex-wrap">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button
                          onClick={() => scanMutation.mutate()}
                          disabled={!canScan}
                          data-testid="button-run-scan"
                        >
                          {scanMutation.isPending ? (
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                          ) : (
                            <Play className="h-4 w-4 mr-1" />
                          )}
                          Run Scan
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {!canScan && !scanMutation.isPending && (
                      <TooltipContent data-testid="tooltip-scan-disabled">
                        {!brokerConnected
                          ? "Connect a broker first"
                          : !selectedUniverseId
                          ? "Select a ticker universe"
                          : ""}
                      </TooltipContent>
                    )}
                  </Tooltip>

                  {!brokerConnected && (
                    <span className="flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-400" data-testid="text-scan-validation">
                      <AlertTriangle className="h-3 w-3" />
                      Connect broker to scan
                    </span>
                  )}
                  {brokerConnected && !selectedUniverseId && (
                    <span className="flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-400" data-testid="text-scan-validation">
                      <AlertTriangle className="h-3 w-3" />
                      Select a universe
                    </span>
                  )}
                </div>

                {scanResult && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    <span data-testid="text-scan-time">
                      {new Date(scanResult.scannedAt).toLocaleTimeString()}
                    </span>
                    <Badge variant="secondary" data-testid="text-candidate-count">
                      {scanResult.candidateCount} candidates
                    </Badge>
                  </div>
                )}
              </div>
            </CardHeader>

            <CardContent>
              <Tabs value={activeStrategy} onValueChange={setActiveStrategy}>
                <TabsList className="flex flex-wrap h-auto gap-1" data-testid="tabs-strategy">
                  {(strategies || []).map((s) => (
                    <TabsTrigger key={s.key} value={s.key} data-testid={`tab-strategy-${s.key}`}>
                      {s.label}
                    </TabsTrigger>
                  ))}
                </TabsList>

                {activeStrategyDef && (
                  <p className="text-sm text-muted-foreground mt-3 mb-4" data-testid="text-strategy-description">
                    {activeStrategyDef.description}
                  </p>
                )}

                {(strategies || []).map((s) => (
                  <TabsContent key={s.key} value={s.key}>
                    {scanResult && scanResult.strategyKey === s.key ? (
                      <CandidatesTable candidates={scanResult.candidates} />
                    ) : scanResult && scanResult.strategyKey !== s.key ? (
                      <EmptyState message={`Run a scan with "${s.label}" selected to see results`} />
                    ) : (
                      <EmptyState message="Select a universe and click Run Scan to find candidates" />
                    )}
                  </TabsContent>
                ))}
              </Tabs>
            </CardContent>
          </Card>

          {showHistory && (
            <Card data-testid="card-scan-history">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <History className="h-5 w-5 text-primary" />
                  <CardTitle>Recent Scans</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                {!scanHistory || scanHistory.length === 0 ? (
                  <EmptyState message="No scan history yet. Run your first scan above." />
                ) : (
                  <ScrollArea className="max-h-[300px]">
                    <div className="space-y-2">
                      {scanHistory.map((scan) => (
                        <div
                          key={scan.id}
                          className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg border hover-elevate cursor-pointer"
                          onClick={() => {
                            setScanResult(scan.resultJson);
                            setActiveStrategy(scan.strategyKey);
                            setShowHistory(false);
                          }}
                          data-testid={`history-item-${scan.id}`}
                        >
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{scan.strategyKey}</Badge>
                            <span className="text-sm text-muted-foreground">{scan.universeId}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">
                              {scan.resultJson?.candidateCount ?? 0} results
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {new Date(scan.createdAt).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-12" data-testid="empty-state">
      <div className="text-center space-y-2">
        <ScanLine className="h-10 w-10 mx-auto text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

function CandidatesTable({ candidates }: { candidates: OptionCandidate[] }) {
  if (candidates.length === 0) {
    return <EmptyState message="No candidates found for this scan" />;
  }

  return (
    <ScrollArea className="max-h-[500px]" data-testid="candidates-table-container">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            <TableHead>Symbol</TableHead>
            <TableHead>Underlying</TableHead>
            <TableHead className="text-right">Strike</TableHead>
            <TableHead>Exp</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Bid</TableHead>
            <TableHead className="text-right">Ask</TableHead>
            <TableHead className="text-right">Mid</TableHead>
            <TableHead className="text-right">IV</TableHead>
            <TableHead className="text-right">Delta</TableHead>
            <TableHead className="text-right">Theta</TableHead>
            <TableHead className="text-right">OI</TableHead>
            <TableHead className="text-right">Vol</TableHead>
            <TableHead className="text-right">Score</TableHead>
            <TableHead className="w-12"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {candidates.map((c) => (
            <TableRow key={c.symbol} data-testid={`candidate-row-${c.rank}`}>
              <TableCell className="font-mono text-muted-foreground">{c.rank}</TableCell>
              <TableCell className="font-medium">{c.symbol}</TableCell>
              <TableCell>{c.underlying}</TableCell>
              <TableCell className="text-right font-mono">${c.strike}</TableCell>
              <TableCell className="text-sm">{c.expiration}</TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={cn(
                    c.optionType === "put"
                      ? "text-red-600 dark:text-red-400 border-red-500/30"
                      : "text-green-600 dark:text-green-400 border-green-500/30"
                  )}
                >
                  {c.optionType === "put" ? (
                    <TrendingDown className="h-3 w-3 mr-1" />
                  ) : (
                    <TrendingUp className="h-3 w-3 mr-1" />
                  )}
                  {c.optionType.toUpperCase()}
                </Badge>
              </TableCell>
              <TableCell className="text-right font-mono">${c.bid.toFixed(2)}</TableCell>
              <TableCell className="text-right font-mono">${c.ask.toFixed(2)}</TableCell>
              <TableCell className="text-right font-mono font-medium">${c.mid.toFixed(2)}</TableCell>
              <TableCell className="text-right font-mono">{c.impliedVol}%</TableCell>
              <TableCell className="text-right font-mono">{c.delta}</TableCell>
              <TableCell className="text-right font-mono">{c.theta}</TableCell>
              <TableCell className="text-right font-mono">{c.openInterest.toLocaleString()}</TableCell>
              <TableCell className="text-right font-mono">{c.volume.toLocaleString()}</TableCell>
              <TableCell className="text-right">
                <ScoreBadge score={c.score} />
              </TableCell>
              <TableCell>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="icon" variant="ghost" data-testid={`button-info-${c.rank}`}>
                      <Info className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-[300px]">
                    <p className="text-sm">{c.rationale}</p>
                  </TooltipContent>
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}

function ScoreBadge({ score }: { score: number }) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        "font-mono",
        score >= 90
          ? "text-green-600 dark:text-green-400"
          : score >= 80
          ? "text-blue-600 dark:text-blue-400"
          : "text-muted-foreground"
      )}
      data-testid="badge-score"
    >
      {score}
    </Badge>
  );
}
