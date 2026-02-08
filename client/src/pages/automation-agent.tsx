import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { 
  Zap, Settings, CheckCircle2, XCircle, RefreshCw, Trash2, Plus, 
  ExternalLink, Shield, Clock, AlertTriangle, History, ChevronRight, Edit, MoreVertical
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface AutomationEndpoint {
  id: string;
  userId: string;
  name: string;
  webhookUrl: string;
  isActive: boolean;
  lastTestedAt?: string;
  lastTestSuccess?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ExecutionRequest {
  id: string;
  userId: string;
  symbol: string;
  strategyId: string;
  timeframe?: string;
  setupPayload?: any;
  automationProfileId?: string;
  status: string;
  algoPilotxReference?: string;
  redirectUrl?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

interface Trade {
  id: string;
  userId: string;
  symbol: string;
  strategyId: string;
  endpointId?: string;
  side: string;
  status: string;
  entryPrice?: number;
  exitPrice?: number;
  quantity?: number;
  stopLoss?: number;
  target?: number;
  pnl?: number;
  pnlPercent?: number;
  entryTimestamp?: string;
  exitTimestamp?: string;
  createdAt: string;
}

export default function AutomationAgentPage() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [algoPilotXHelperOpen, setAlgoPilotXHelperOpen] = useState(false);
  const [editingEndpoint, setEditingEndpoint] = useState<AutomationEndpoint | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formWebhookUrl, setFormWebhookUrl] = useState("");
  const [formWebhookSecret, setFormWebhookSecret] = useState("");

  const { data: endpoints, isLoading: endpointsLoading } = useQuery<AutomationEndpoint[]>({
    queryKey: ["/api/automation-endpoints"],
  });

  const { data: executionRequests, isLoading: requestsLoading } = useQuery<ExecutionRequest[]>({
    queryKey: ["/api/execution-requests"],
  });

  const { data: trades, isLoading: tradesLoading } = useQuery<Trade[]>({
    queryKey: ["/api/trades"],
  });

  const openTrades = trades?.filter(t => t.status === "OPEN") || [];
  const recentTrades = trades?.filter(t => t.status === "CLOSED").slice(0, 10) || [];

  const createMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/automation-endpoints", {
        name: formName,
        webhookUrl: formWebhookUrl,
        webhookSecret: formWebhookSecret || undefined,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Endpoint Created",
        description: "New automation endpoint has been created",
      });
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["/api/automation-endpoints"] });
    },
    onError: (error: any) => {
      toast({
        title: "Creation Failed",
        description: error.message || "Could not create endpoint",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editingEndpoint) return;
      const response = await apiRequest("PATCH", `/api/automation-endpoints/${editingEndpoint.id}`, {
        name: formName,
        webhookUrl: formWebhookUrl,
        webhookSecret: formWebhookSecret || undefined,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Endpoint Updated",
        description: "Automation endpoint has been updated",
      });
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["/api/automation-endpoints"] });
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message || "Could not update endpoint",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/automation-endpoints/${id}`);
    },
    onSuccess: () => {
      toast({
        title: "Endpoint Deleted",
        description: "Automation endpoint has been removed",
      });
      setDeleteConfirmId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/automation-endpoints"] });
    },
    onError: (error: any) => {
      toast({
        title: "Delete Failed",
        description: error.message || "Could not delete endpoint",
        variant: "destructive",
      });
    },
  });

  const testMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("POST", `/api/automation-endpoints/${id}/test`);
      return response.json();
    },
    onSuccess: (data: any) => {
      if (data.success) {
        toast({
          title: "Test Successful",
          description: "Webhook connection verified",
        });
      } else {
        toast({
          title: "Test Failed",
          description: data.error || "Could not verify connection",
          variant: "destructive",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/automation-endpoints"] });
    },
    onError: (error: any) => {
      toast({
        title: "Test Failed",
        description: error.message || "Could not test connection",
        variant: "destructive",
      });
    },
  });

  const exitTradeMutation = useMutation({
    mutationFn: async ({ tradeId, exitPrice }: { tradeId: string; exitPrice?: number }) => {
      const response = await apiRequest("POST", "/api/instatrade/exit", {
        tradeId,
        exitPrice,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Exit Sent",
        description: "Exit signal sent to AlgoPilotX",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/execution-requests"] });
    },
    onError: (error: any) => {
      toast({
        title: "Exit Failed",
        description: error.message || "Could not send exit signal",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setDialogOpen(false);
    setEditingEndpoint(null);
    setFormName("");
    setFormWebhookUrl("");
    setFormWebhookSecret("");
  };

  const openEditDialog = (endpoint: AutomationEndpoint) => {
    setEditingEndpoint(endpoint);
    setFormName(endpoint.name);
    setFormWebhookUrl(endpoint.webhookUrl);
    setFormWebhookSecret("");
    setDialogOpen(true);
  };

  const openCreateDialog = () => {
    setEditingEndpoint(null);
    setFormName("");
    setFormWebhookUrl("https://app.algopilotx.com/webhook/");
    setFormWebhookSecret("");
    setDialogOpen(true);
  };

  const openAlgoPilotXHelper = () => {
    setAlgoPilotXHelperOpen(true);
  };

  const proceedToCreateEndpoint = () => {
    setAlgoPilotXHelperOpen(false);
    openCreateDialog();
  };

  const handleSave = () => {
    if (editingEndpoint) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { className: string; label: string }> = {
      CREATED: { className: "bg-gray-500/10 text-gray-600 dark:text-gray-400", label: "Created" },
      SENT: { className: "bg-blue-500/10 text-blue-600 dark:text-blue-400", label: "Sent" },
      ACKED: { className: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400", label: "Acknowledged" },
      EXECUTED: { className: "bg-green-500/10 text-green-600 dark:text-green-400", label: "Executed" },
      REJECTED: { className: "bg-red-500/10 text-red-600 dark:text-red-400", label: "Rejected" },
      FAILED: { className: "bg-red-500/10 text-red-600 dark:text-red-400", label: "Failed" },
      OPEN: { className: "bg-blue-500/10 text-blue-600 dark:text-blue-400", label: "Open" },
      CLOSED: { className: "bg-gray-500/10 text-gray-600 dark:text-gray-400", label: "Closed" },
    };
    const variant = variants[status] || variants.CREATED;
    return <Badge className={variant.className}>{variant.label}</Badge>;
  };

  const getPnlClass = (pnl: number | null | undefined) => {
    if (pnl === null || pnl === undefined) return "text-muted-foreground";
    return pnl >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400";
  };

  return (
    <div className="p-6 space-y-6" data-testid="automation-page">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Zap className="h-6 w-6" />
          Automation
        </h1>
        <p className="text-sm text-muted-foreground">
          Connect AlgoPilotX endpoints for InstaTrade™ execution
        </p>
      </div>

      <Tabs defaultValue="endpoints" className="space-y-6">
        <TabsList>
          <TabsTrigger value="endpoints" className="gap-2" data-testid="tab-endpoints">
            <Settings className="h-4 w-4" />
            Endpoints
          </TabsTrigger>
          <TabsTrigger value="trades" className="gap-2" data-testid="tab-trades">
            <Zap className="h-4 w-4" />
            Trades
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2" data-testid="tab-history">
            <History className="h-4 w-4" />
            Execution History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="endpoints" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <ExternalLink className="h-5 w-5" />
                    Automation Endpoints
                  </CardTitle>
                  <CardDescription>
                    Create named endpoints to connect to AlgoPilotX or other webhook destinations
                  </CardDescription>
                </div>
                <Button onClick={openAlgoPilotXHelper} className="gap-2" data-testid="button-add-endpoint">
                  <Plus className="h-4 w-4" />
                  Add Endpoint
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {endpointsLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Loading endpoints...
                </div>
              ) : !endpoints || endpoints.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Settings className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No automation endpoints configured</p>
                  <p className="text-sm mt-1">
                    Create an endpoint to connect to AlgoPilotX
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {endpoints.map((endpoint) => (
                    <div
                      key={endpoint.id}
                      className="flex items-center justify-between p-4 rounded-lg border bg-card"
                      data-testid={`endpoint-${endpoint.id}`}
                    >
                      <div className="flex items-center gap-4">
                        <div className={cn(
                          "h-10 w-10 rounded-full flex items-center justify-center",
                          endpoint.lastTestSuccess ? "bg-green-500/10" : "bg-muted"
                        )}>
                          {endpoint.lastTestSuccess ? (
                            <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                          ) : endpoint.lastTestedAt && !endpoint.lastTestSuccess ? (
                            <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
                          ) : (
                            <Settings className="h-5 w-5 text-muted-foreground" />
                          )}
                        </div>
                        <div>
                          <p className="font-medium">{endpoint.name}</p>
                          <p className="text-sm text-muted-foreground font-mono truncate max-w-[300px]">
                            {endpoint.webhookUrl}
                          </p>
                          {endpoint.lastTestedAt && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Last tested: {format(new Date(endpoint.lastTestedAt), "MMM d, h:mm a")}
                              {endpoint.lastTestSuccess ? " (passed)" : " (failed)"}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => testMutation.mutate(endpoint.id)}
                          disabled={testMutation.isPending}
                          data-testid={`button-test-${endpoint.id}`}
                        >
                          <RefreshCw className={cn("h-4 w-4 mr-2", testMutation.isPending && "animate-spin")} />
                          Test
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" data-testid={`button-menu-${endpoint.id}`}>
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEditDialog(endpoint)}>
                              <Edit className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              className="text-destructive"
                              onClick={() => setDeleteConfirmId(endpoint.id)}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                How It Works
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="flex gap-3">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <span className="text-sm font-medium">1</span>
                  </div>
                  <div>
                    <p className="font-medium">Find Setups</p>
                    <p className="text-sm text-muted-foreground">
                      Use Opportunity Engine to discover trading setups
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <span className="text-sm font-medium">2</span>
                  </div>
                  <div>
                    <p className="font-medium">InstaTrade™</p>
                    <p className="text-sm text-muted-foreground">
                      Click InstaTrade to send setup to your endpoint
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <span className="text-sm font-medium">3</span>
                  </div>
                  <div>
                    <p className="font-medium">Track & Exit</p>
                    <p className="text-sm text-muted-foreground">
                      Monitor open trades and exit when ready
                    </p>
                  </div>
                </div>
              </div>

              <Separator />

              <div className="flex items-start gap-2 text-sm text-muted-foreground">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <p>
                  VCP Trader provides market intelligence only. All trade execution happens in AlgoPilotX 
                  after your explicit confirmation. This is educational and informational only, not investment advice.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trades" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5" />
                Open Trades
              </CardTitle>
              <CardDescription>
                Active positions tracked via InstaTrade™
              </CardDescription>
            </CardHeader>
            <CardContent>
              {tradesLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Loading trades...
                </div>
              ) : openTrades.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Zap className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No open trades</p>
                  <p className="text-sm mt-1">
                    Use InstaTrade from the{" "}
                    <Link href="/" className="text-primary underline">
                      Opportunity Engine
                    </Link>
                    {" "}to enter positions
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {openTrades.map((trade) => (
                    <div
                      key={trade.id}
                      className="flex items-center justify-between p-4 rounded-lg border bg-card"
                      data-testid={`trade-open-${trade.id}`}
                    >
                      <div className="flex items-center gap-4">
                        <div>
                          <p className="font-semibold">{trade.symbol}</p>
                          <p className="text-sm text-muted-foreground">
                            {trade.strategyId} • {trade.side}
                          </p>
                          {trade.entryTimestamp && (
                            <p className="text-xs text-muted-foreground">
                              Opened: {format(new Date(trade.entryTimestamp), "MMM d, h:mm a")}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          {trade.entryPrice && (
                            <p className="text-sm">Entry: ${trade.entryPrice.toFixed(2)}</p>
                          )}
                          {trade.stopLoss && (
                            <p className="text-xs text-muted-foreground">
                              Stop: ${trade.stopLoss.toFixed(2)}
                            </p>
                          )}
                        </div>
                        {getStatusBadge(trade.status)}
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => exitTradeMutation.mutate({ tradeId: trade.id })}
                          disabled={exitTradeMutation.isPending}
                          data-testid={`button-exit-${trade.id}`}
                        >
                          Exit
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Recent Trades
              </CardTitle>
              <CardDescription>
                Closed positions with P&L tracking
              </CardDescription>
            </CardHeader>
            <CardContent>
              {tradesLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Loading trades...
                </div>
              ) : recentTrades.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No closed trades yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {recentTrades.map((trade) => (
                    <div
                      key={trade.id}
                      className="flex items-center justify-between p-4 rounded-lg border bg-card"
                      data-testid={`trade-closed-${trade.id}`}
                    >
                      <div className="flex items-center gap-4">
                        <div>
                          <p className="font-semibold">{trade.symbol}</p>
                          <p className="text-sm text-muted-foreground">
                            {trade.strategyId} • {trade.side}
                          </p>
                          {trade.exitTimestamp && (
                            <p className="text-xs text-muted-foreground">
                              Closed: {format(new Date(trade.exitTimestamp), "MMM d, h:mm a")}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          {trade.entryPrice && trade.exitPrice && (
                            <p className="text-sm">
                              ${trade.entryPrice.toFixed(2)} → ${trade.exitPrice.toFixed(2)}
                            </p>
                          )}
                          {trade.pnl !== null && trade.pnl !== undefined && (
                            <p className={cn("font-medium", getPnlClass(trade.pnl))}>
                              {trade.pnl >= 0 ? "+" : ""}${trade.pnl.toFixed(2)}
                              {trade.pnlPercent !== null && trade.pnlPercent !== undefined && (
                                <span className="text-xs ml-1">
                                  ({trade.pnlPercent >= 0 ? "+" : ""}{trade.pnlPercent.toFixed(2)}%)
                                </span>
                              )}
                            </p>
                          )}
                        </div>
                        {getStatusBadge(trade.status)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Execution History
              </CardTitle>
              <CardDescription>
                Track setups sent to AlgoPilotX and their execution status
              </CardDescription>
            </CardHeader>
            <CardContent>
              {requestsLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Loading history...
                </div>
              ) : !executionRequests || executionRequests.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No execution requests yet</p>
                  <p className="text-sm">
                    Send a setup from the{" "}
                    <Link href="/" className="text-primary underline" data-testid="link-opportunity-engine">
                      Opportunity Engine
                    </Link>
                    {" "}to get started
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {executionRequests.map((request) => (
                    <div
                      key={request.id}
                      className="flex items-center justify-between p-3 rounded-lg border bg-card hover-elevate"
                    >
                      <div className="flex items-center gap-3">
                        <div>
                          <p className="font-semibold">{request.symbol}</p>
                          <p className="text-sm text-muted-foreground">
                            {request.strategyId} • {format(new Date(request.createdAt), "MMM d, h:mm a")}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {getStatusBadge(request.status)}
                        {request.redirectUrl && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => window.open(request.redirectUrl, "_blank")}
                            data-testid={`button-open-request-${request.id}`}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={(open) => !open && resetForm()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingEndpoint ? "Edit Endpoint" : "Create Endpoint"}</DialogTitle>
            <DialogDescription>
              {editingEndpoint 
                ? "Update your automation endpoint settings." 
                : "Add a new webhook endpoint for InstaTrade™ integration."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Endpoint Name</Label>
              <Input
                id="name"
                placeholder="e.g., AlgoPilotX Main"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                data-testid="input-endpoint-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="webhookUrl">Webhook URL</Label>
              <Input
                id="webhookUrl"
                placeholder="https://app.algopilotx.com/webhook/..."
                value={formWebhookUrl}
                onChange={(e) => setFormWebhookUrl(e.target.value)}
                data-testid="input-webhook-url"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="webhookSecret">Webhook Secret (optional)</Label>
              <Input
                id="webhookSecret"
                type="password"
                placeholder={editingEndpoint ? "Leave blank to keep existing" : "Your webhook secret"}
                value={formWebhookSecret}
                onChange={(e) => setFormWebhookSecret(e.target.value)}
                data-testid="input-webhook-secret"
              />
              <p className="text-xs text-muted-foreground">
                Stored encrypted. Used to sign webhook payloads.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetForm}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!formName || !formWebhookUrl || createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-endpoint"
            >
              {(createMutation.isPending || updateMutation.isPending) ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Endpoint?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this automation endpoint. Any trades using this endpoint will no longer be able to send exit signals.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirmId && deleteMutation.mutate(deleteConfirmId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={algoPilotXHelperOpen} onOpenChange={setAlgoPilotXHelperOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              Connect to AlgoPilotX
            </DialogTitle>
            <DialogDescription>
              Follow these steps to get your webhook URL from AlgoPilotX
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-3">
              <div className="flex gap-3 items-start">
                <div className="flex-shrink-0 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-medium">
                  1
                </div>
                <div className="flex-1">
                  <p className="font-medium">Login to AlgoPilotX</p>
                  <p className="text-sm text-muted-foreground">
                    Open AlgoPilotX and sign in to your account
                  </p>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <div className="flex-shrink-0 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-medium">
                  2
                </div>
                <div className="flex-1">
                  <p className="font-medium">Create an Automation</p>
                  <p className="text-sm text-muted-foreground">
                    Set up a new automation for your trading strategy
                  </p>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <div className="flex-shrink-0 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-medium">
                  3
                </div>
                <div className="flex-1">
                  <p className="font-medium">Copy the Webhook URL</p>
                  <p className="text-sm text-muted-foreground">
                    Find and copy the webhook URL from your automation settings
                  </p>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <div className="flex-shrink-0 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-medium">
                  4
                </div>
                <div className="flex-1">
                  <p className="font-medium">Paste it Here</p>
                  <p className="text-sm text-muted-foreground">
                    Return here and paste the webhook URL when creating your endpoint
                  </p>
                </div>
              </div>
            </div>
            <Separator />
            <div className="bg-muted/50 rounded-lg p-4 text-center">
              <Button
                variant="default"
                className="gap-2"
                onClick={() => window.open("https://app.algopilotx.com", "_blank")}
                data-testid="button-open-algopilotx"
              >
                <ExternalLink className="h-4 w-4" />
                Open AlgoPilotX
              </Button>
              <p className="text-xs text-muted-foreground mt-2">
                Opens in a new tab
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setAlgoPilotXHelperOpen(false)}>
              Cancel
            </Button>
            <Button onClick={proceedToCreateEndpoint} className="gap-2" data-testid="button-proceed-create-endpoint">
              <Plus className="h-4 w-4" />
              Create Endpoint
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
