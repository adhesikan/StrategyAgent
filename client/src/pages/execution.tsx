import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { 
  Zap, ExternalLink, CheckCircle2, Circle, ArrowRight, Plus,
  Settings, Activity, Link2, Shield, Copy, RefreshCw, XCircle,
  Wallet, BarChart3, Clock, AlertTriangle, TrendingUp, TrendingDown, History, Bell, Bot
} from "lucide-react";
import { AutoAgentPanel } from "@/components/auto-agent-panel";
import { AgentActivity } from "@/components/agent-activity";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
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

interface Trade {
  id: string;
  userId: string;
  symbol: string;
  strategyId: string;
  endpointId?: string;
  alertEventId?: string;
  side: string;
  status: string;
  entryPrice?: number;
  exitPrice?: number;
  quantity?: number;
  stopLoss?: number;
  target?: number;
  pnl?: number;
  pnlPercent?: number;
  setupPayload?: any;
  entryTimestamp?: string;
  exitTimestamp?: string;
  createdAt: string;
}

const ALGOPILOTX_URL = "https://app.algopilotx.com";

export default function ExecutionCockpit() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formName, setFormName] = useState("");
  const [formWebhookUrl, setFormWebhookUrl] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [activeTab, setActiveTab] = useState("setup");

  const { data: endpoints, isLoading: endpointsLoading } = useQuery<AutomationEndpoint[]>({
    queryKey: ["/api/automation-endpoints"],
  });

  const { data: trades, isLoading: tradesLoading } = useQuery<Trade[]>({
    queryKey: ["/api/trades"],
  });

  const hasEndpoints = endpoints && endpoints.length > 0;
  const hasActiveEndpoint = endpoints?.some(e => e.isActive);

  const createMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/automation-endpoints", {
        name: formName,
        webhookUrl: formWebhookUrl,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Endpoint Created",
        description: "New automation endpoint has been saved",
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

  const testMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("POST", `/api/automation-endpoints/${id}/test`);
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: data.success ? "Test Successful" : "Test Failed",
        description: data.success 
          ? "Endpoint is responding correctly" 
          : data.error || "Could not reach endpoint",
        variant: data.success ? "default" : "destructive",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/automation-endpoints"] });
    },
    onError: (error: any) => {
      toast({
        title: "Test Failed",
        description: error.message || "Could not test endpoint",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setFormName("");
    setFormWebhookUrl("");
    setFormNotes("");
    setDialogOpen(false);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  const wizardSteps = [
    {
      number: 1,
      title: "Open AlgoPilotX",
      description: "Login or create your AlgoPilotX account",
      completed: false,
      action: () => window.open(ALGOPILOTX_URL, "_blank"),
      buttonText: "Open AlgoPilotX Login",
    },
    {
      number: 2,
      title: "Create an Automation",
      description: "Create a new Automation in AlgoPilotX and copy its webhook URL",
      completed: false,
      action: () => window.open(ALGOPILOTX_URL, "_blank"),
      buttonText: "Open Automations",
    },
    {
      number: 3,
      title: "Add Endpoint in VCP Trader",
      description: "Paste the webhook URL to create your automation endpoint",
      completed: hasEndpoints,
      action: () => setDialogOpen(true),
      buttonText: hasEndpoints ? "Add Another Endpoint" : "Add Endpoint",
    },
    {
      number: 4,
      title: "Ready for Execution",
      description: "Use InstaTrade from any opportunity to send to AlgoPilotX",
      completed: hasActiveEndpoint,
      action: undefined,
      buttonText: undefined,
    },
  ];

  const completedSteps = wizardSteps.filter(s => s.completed).length;

  return (
    <main className="flex-1 overflow-auto">
      <div className="container max-w-6xl mx-auto p-4 md:p-6 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold" data-testid="text-page-title">Execution & Monitoring</h1>
            <p className="text-muted-foreground">
              View trade activity, positions, and execution logs
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/automation">
              <Button variant="outline" size="sm" className="gap-2" data-testid="link-automation-center">
                <Shield className="h-4 w-4" />
                Automation Center
              </Button>
            </Link>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList>
            <TabsTrigger value="setup" data-testid="tab-setup">
              <Zap className="h-4 w-4 mr-2" />
              Connections
            </TabsTrigger>
            <TabsTrigger value="agent" data-testid="tab-agent">
              <Bot className="h-4 w-4 mr-2" />
              Agent Activity
            </TabsTrigger>
            <TabsTrigger value="trades" data-testid="tab-trades">
              <History className="h-4 w-4 mr-2" />
              Trades History ({trades?.length || 0})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="setup" className="mt-6 space-y-6">
            <Alert className="border-primary/20 bg-primary/5">
          <Shield className="h-4 w-4" />
          <AlertTitle>Market Intelligence & User-Controlled Automation</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              VCP Trader delivers real-time market intelligence, strategy signals, and alert-driven trade ideas.
              When you choose, these signals can be forwarded to AlgoPilotX, where you control how trades are executed through your own automation rules, risk limits, and brokerage connections.
            </p>
            <p className="font-medium">
              VCP Trader does not place trades, manage accounts, or access brokerage credentials.
              All execution decisions, sizing, and risk management are configured and approved by you inside AlgoPilotX.
            </p>
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-primary" />
                  Setup Wizard
                </CardTitle>
                <CardDescription>
                  Complete these steps to connect VCP Trader with AlgoPilotX
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2 mb-4">
                  <div className="text-sm text-muted-foreground">
                    {completedSteps} of {wizardSteps.length} steps completed
                  </div>
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-primary transition-all duration-300"
                      style={{ width: `${(completedSteps / wizardSteps.length) * 100}%` }}
                    />
                  </div>
                </div>

                {wizardSteps.map((step, index) => (
                  <div 
                    key={step.number}
                    className={cn(
                      "flex items-start gap-4 p-4 rounded-lg border transition-colors",
                      step.completed ? "bg-primary/5 border-primary/20" : "bg-card"
                    )}
                    data-testid={`wizard-step-${step.number}`}
                  >
                    <div className={cn(
                      "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium",
                      step.completed 
                        ? "bg-primary text-primary-foreground" 
                        : "bg-muted text-muted-foreground"
                    )}>
                      {step.completed ? <CheckCircle2 className="h-5 w-5" /> : step.number}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{step.title}</div>
                      <div className="text-sm text-muted-foreground">{step.description}</div>
                    </div>
                    {step.action && (
                      <Button 
                        variant={step.completed ? "outline" : "default"}
                        size="sm"
                        onClick={step.action}
                        data-testid={`button-step-${step.number}`}
                      >
                        {step.buttonText}
                        {step.number < 3 && <ExternalLink className="h-4 w-4 ml-2" />}
                      </Button>
                    )}
                    {step.number === 4 && step.completed && (
                      <Badge variant="default" className="bg-green-600">Ready</Badge>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle>Automation Endpoints</CardTitle>
                  <CardDescription>
                    Your saved AlgoPilotX webhook connections
                  </CardDescription>
                </div>
                <Button onClick={() => setDialogOpen(true)} size="sm" data-testid="button-add-endpoint">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Endpoint
                </Button>
              </CardHeader>
              <CardContent>
                {endpointsLoading ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Loading endpoints...
                  </div>
                ) : !hasEndpoints ? (
                  <div className="text-center py-8 space-y-4">
                    <div className="text-muted-foreground">
                      No automation endpoints configured yet.
                    </div>
                    <Button variant="outline" onClick={() => setDialogOpen(true)} data-testid="button-add-first-endpoint">
                      <Plus className="h-4 w-4 mr-2" />
                      Add Your First Endpoint
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {endpoints?.map((endpoint) => (
                      <div 
                        key={endpoint.id}
                        className="flex items-center gap-4 p-4 rounded-lg border bg-card"
                        data-testid={`endpoint-card-${endpoint.id}`}
                      >
                        <div className={cn(
                          "w-3 h-3 rounded-full flex-shrink-0",
                          endpoint.lastTestSuccess === true ? "bg-green-500" :
                          endpoint.lastTestSuccess === false ? "bg-red-500" :
                          "bg-muted-foreground"
                        )} />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium flex items-center gap-2">
                            {endpoint.name}
                            {endpoint.isActive && (
                              <Badge variant="secondary" className="text-xs">Default</Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground flex items-center gap-2 mt-1">
                            <span className="truncate max-w-xs font-mono">
                              {endpoint.webhookUrl.substring(0, 40)}...
                            </span>
                            <Button 
                              variant="ghost" 
                              size="icon"
                              className="h-5 w-5"
                              onClick={() => copyToClipboard(endpoint.webhookUrl)}
                              data-testid={`button-copy-url-${endpoint.id}`}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                          {endpoint.lastTestedAt && (
                            <div className="text-xs text-muted-foreground mt-1">
                              Last tested: {format(new Date(endpoint.lastTestedAt), "MMM d, h:mm a")}
                            </div>
                          )}
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
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ExternalLink className="h-4 w-4" />
                  Quick Links
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button 
                  variant="outline" 
                  className="w-full justify-start"
                  onClick={() => window.open(ALGOPILOTX_URL, "_blank")}
                  data-testid="button-open-dashboard"
                >
                  <BarChart3 className="h-4 w-4 mr-2" />
                  Open AlgoPilotX Dashboard
                  <ExternalLink className="h-3 w-3 ml-auto" />
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full justify-start"
                  onClick={() => window.open("https://app.algopilotx.com/brokerage-settings", "_blank")}
                  data-testid="button-broker-connections"
                >
                  <Wallet className="h-4 w-4 mr-2" />
                  Broker Connections
                  <ExternalLink className="h-3 w-3 ml-auto" />
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full justify-start"
                  onClick={() => window.open(ALGOPILOTX_URL, "_blank")}
                  data-testid="button-automations"
                >
                  <Zap className="h-4 w-4 mr-2" />
                  Automations
                  <ExternalLink className="h-3 w-3 ml-auto" />
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full justify-start"
                  onClick={() => window.open(ALGOPILOTX_URL, "_blank")}
                  data-testid="button-trade-activity"
                >
                  <Activity className="h-4 w-4 mr-2" />
                  Trade Activity
                  <ExternalLink className="h-3 w-3 ml-auto" />
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  How It Works
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-xs font-medium text-primary">1</div>
                  <div>
                    <div className="font-medium">Scan for Opportunities</div>
                    <div className="text-muted-foreground">VCP Trader identifies breakout setups</div>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-xs font-medium text-primary">2</div>
                  <div>
                    <div className="font-medium">Send to AlgoPilotX</div>
                    <div className="text-muted-foreground">Click InstaTrade to send setup details</div>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-xs font-medium text-primary">3</div>
                  <div>
                    <div className="font-medium">Execute in AlgoPilotX</div>
                    <div className="text-muted-foreground">Review and confirm trade execution</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {hasEndpoints && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Status
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Endpoints</span>
                    <span className="font-medium" data-testid="text-endpoint-count">{endpoints?.length || 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Active</span>
                    <span className="font-medium" data-testid="text-active-count">{endpoints?.filter(e => e.isActive).length || 0}</span>
                  </div>
                  <Separator className="my-2" />
                  <div className="text-xs text-muted-foreground">
                    VCP Trader does not execute trades. AlgoPilotX executes trades based on your configuration.
                  </div>
                </CardContent>
              </Card>
            )}
            </div>
          </div>
          </TabsContent>

          <TabsContent value="agent" className="mt-6">
            <div className="space-y-6">
              <AutoAgentPanel />
              <AgentActivity />
            </div>
          </TabsContent>

          <TabsContent value="trades" className="mt-6">
            {tradesLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
              </div>
            ) : !trades || trades.length === 0 ? (
              <Card>
                <CardContent className="py-12">
                  <div className="flex flex-col items-center justify-center text-center">
                    <History className="h-12 w-12 text-muted-foreground/50 mb-4" />
                    <h3 className="text-lg font-medium">No Trades Yet</h3>
                    <p className="text-sm text-muted-foreground mt-1 max-w-md">
                      When you send trades via InstaTrade or automated alerts, they'll appear here.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {trades.map((trade) => (
                  <Card key={trade.id} data-testid={`trade-card-${trade.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "w-10 h-10 rounded-full flex items-center justify-center",
                            trade.side === "LONG" ? "bg-green-500/10" : "bg-red-500/10"
                          )}>
                            {trade.side === "LONG" ? (
                              <TrendingUp className="h-5 w-5 text-green-500" />
                            ) : (
                              <TrendingDown className="h-5 w-5 text-red-500" />
                            )}
                          </div>
                          <div>
                            <div className="font-semibold font-mono text-lg">{trade.symbol}</div>
                            <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                              <Badge variant="outline" className="text-xs">{trade.strategyId}</Badge>
                              <span>{trade.side}</span>
                              {trade.alertEventId ? (
                                <Badge variant="secondary" className="text-xs gap-1">
                                  <Bell className="h-3 w-3" />
                                  From Alert
                                </Badge>
                              ) : trade.endpointId ? (
                                <Badge variant="secondary" className="text-xs gap-1">
                                  <Zap className="h-3 w-3" />
                                  InstaTrade
                                </Badge>
                              ) : null}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <Badge 
                            variant={trade.status === "OPEN" ? "default" : trade.status === "CLOSED" ? "secondary" : "outline"}
                            className="mb-1"
                          >
                            {trade.status}
                          </Badge>
                          {trade.entryTimestamp && (
                            <div className="text-xs text-muted-foreground">
                              {format(new Date(trade.entryTimestamp), "MMM d, h:mm a")}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <div className="text-muted-foreground text-xs">Entry</div>
                          <div className="font-mono font-medium">
                            {trade.entryPrice ? `$${trade.entryPrice.toFixed(2)}` : "-"}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground text-xs">Target</div>
                          <div className="font-mono font-medium text-green-600">
                            {trade.target ? `$${trade.target.toFixed(2)}` : "-"}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground text-xs">Stop Loss</div>
                          <div className="font-mono font-medium text-red-600">
                            {trade.stopLoss ? `$${trade.stopLoss.toFixed(2)}` : "-"}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground text-xs">P&L</div>
                          <div className={cn(
                            "font-mono font-medium",
                            trade.pnl && trade.pnl > 0 ? "text-green-600" : 
                            trade.pnl && trade.pnl < 0 ? "text-red-600" : ""
                          )}>
                            {trade.pnl != null ? (
                              <>
                                {trade.pnl >= 0 ? "+" : ""}${trade.pnl.toFixed(2)}
                                {trade.pnlPercent != null && (
                                  <span className="text-xs ml-1">
                                    ({trade.pnlPercent >= 0 ? "+" : ""}{trade.pnlPercent.toFixed(1)}%)
                                  </span>
                                )}
                              </>
                            ) : "-"}
                          </div>
                        </div>
                      </div>

                      {trade.exitTimestamp && (
                        <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">
                          Closed: {format(new Date(trade.exitTimestamp), "MMM d, h:mm a")}
                          {trade.exitPrice && ` @ $${trade.exitPrice.toFixed(2)}`}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Automation Endpoint</DialogTitle>
            <DialogDescription>
              Paste the webhook URL from your AlgoPilotX Automation
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Endpoint Name</Label>
              <Input
                id="name"
                placeholder="e.g., Conservative Breakouts"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                data-testid="input-endpoint-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="webhook">Webhook URL</Label>
              <Input
                id="webhook"
                placeholder="https://app.algopilotx.com/webhook/..."
                value={formWebhookUrl}
                onChange={(e) => setFormWebhookUrl(e.target.value)}
                data-testid="input-webhook-url"
              />
              <p className="text-xs text-muted-foreground">
                Copy this from your AlgoPilotX Automation settings
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={resetForm} data-testid="button-cancel-endpoint">
              Cancel
            </Button>
            <Button 
              onClick={() => createMutation.mutate()}
              disabled={!formName || !formWebhookUrl || createMutation.isPending}
              data-testid="button-save-endpoint"
            >
              {createMutation.isPending ? "Saving..." : "Save Endpoint"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
