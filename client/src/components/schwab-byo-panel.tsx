import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AlertTriangle, Info, Copy, Loader2 } from "lucide-react";

interface SchwabByoStatusResp {
  mode: "platform_credentials" | "user_credentials";
  hasClientId: boolean;
  hasClientSecret: boolean;
  clientIdMasked: string;
  redirectUri: string | null;
  updatedAt: string | null;
  lastRefreshSuccessAt: string | null;
  reconnectRequired: boolean;
  lastError: string | null;
  platformConfigured: boolean;
  platformCallbackUrl: string;
}

const STEPS: { title: string; body: string }[] = [
  { title: "Step 1", body: "Go to the Schwab Developer Portal and sign in." },
  { title: "Step 2", body: "Create a new app for your own use." },
  { title: "Step 3", body: "Select the appropriate Trader API / market data permissions available to your Schwab developer account." },
  { title: "Step 4", body: "Set the callback / redirect URI exactly to the value shown in Strategy Agent." },
  { title: "Step 5", body: "After Schwab approves or activates the app, copy the Client ID and Client Secret." },
  { title: "Step 6", body: "Paste Client ID, Client Secret, and Redirect URI into Strategy Agent." },
  { title: "Step 7", body: "Click 'Save Credentials.'" },
  { title: "Step 8", body: "Click 'Connect Schwab Using My Credentials.'" },
  { title: "Step 9", body: "Approve access on Schwab's OAuth screen." },
  { title: "Step 10", body: "Return to Strategy Agent and confirm Schwab shows Connected." },
];

export function SchwabByoPanel() {
  const { toast } = useToast();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState("");

  const { data: status, isLoading } = useQuery<SchwabByoStatusResp>({
    queryKey: ["/api/schwab/byo-credentials"],
  });

  useEffect(() => {
    if (redirectUri) return;
    if (status?.redirectUri) {
      setRedirectUri(status.redirectUri);
    } else if (status?.platformCallbackUrl) {
      // Default to this app's callback URL so users can paste it straight into
      // their Schwab Developer Portal app config.
      setRedirectUri(status.platformCallbackUrl);
    }
  }, [status?.redirectUri, status?.platformCallbackUrl]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/schwab/byo-credentials", {
        clientId, clientSecret, redirectUri,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Credentials saved", description: "Your Schwab developer credentials are encrypted and stored." });
      setClientSecret("");
      queryClient.invalidateQueries({ queryKey: ["/api/schwab/byo-credentials"] });
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err.message || "Could not save credentials", variant: "destructive" });
    },
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/schwab/byo-credentials");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Credentials cleared", description: "Your saved Schwab developer credentials have been removed." });
      setClientId(""); setClientSecret(""); setRedirectUri("");
      queryClient.invalidateQueries({ queryKey: ["/api/schwab/byo-credentials"] });
    },
    onError: (err: any) => {
      toast({ title: "Clear failed", description: err.message || "Could not clear credentials", variant: "destructive" });
    },
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/schwab/oauth?mode=user_credentials");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to start Schwab OAuth");
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data.authUrl) window.location.href = data.authUrl;
    },
    onError: (err: any) => {
      toast({ title: "Connect failed", description: err.message, variant: "destructive" });
    },
  });

  const canConnectByo = !!status?.hasClientId && !!status?.hasClientSecret && !!status?.redirectUri;

  return (
    <Card data-testid="card-schwab-byo">
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base font-medium">Advanced Schwab Connection</CardTitle>
            <CardDescription>
              Use this only if you already have your own approved Schwab Developer app credentials.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={status?.mode === "user_credentials" ? "default" : "outline"} className="text-xs" data-testid="badge-schwab-mode">
              {status?.mode === "user_credentials" ? "Using Your Credentials" : "Using Platform Credentials"}
            </Badge>
            {status?.reconnectRequired && (
              <Badge variant="destructive" className="text-xs" data-testid="badge-schwab-reconnect">Reconnect Required</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Advanced option</AlertTitle>
          <AlertDescription>
            Most users should use the standard "Connect Schwab" button above. Bring your own credentials only if
            you have access to the Schwab Developer Portal and an approved app. Schwab may require app approval
            before credentials work. Your redirect URI must match exactly.
          </AlertDescription>
        </Alert>

        {status?.lastError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Last error</AlertTitle>
            <AlertDescription className="text-xs break-words" data-testid="text-schwab-last-error">{status.lastError}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="schwab-client-id">Client ID</Label>
            <Input
              id="schwab-client-id"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder={status?.clientIdMasked || "Paste your Schwab Client ID"}
              autoComplete="off"
              data-testid="input-schwab-client-id"
            />
            {status?.hasClientId && !clientId && (
              <p className="text-[11px] text-muted-foreground">Saved: {status.clientIdMasked}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="schwab-client-secret">Client Secret</Label>
            <Input
              id="schwab-client-secret"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={status?.hasClientSecret ? "•••••••• (saved)" : "Paste your Schwab Client Secret"}
              autoComplete="off"
              data-testid="input-schwab-client-secret"
            />
            <p className="text-[11px] text-muted-foreground">Your secret is encrypted at rest and never displayed back.</p>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="schwab-redirect-uri">Redirect URI</Label>
            <Input
              id="schwab-redirect-uri"
              value={redirectUri}
              onChange={(e) => setRedirectUri(e.target.value)}
              placeholder="https://your-domain.example.com/api/schwab/callback"
              data-testid="input-schwab-redirect-uri"
            />
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>This must match exactly what you registered with Schwab.</span>
              {status?.platformCallbackUrl && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                  onClick={() => {
                    navigator.clipboard?.writeText(status.platformCallbackUrl);
                    toast({ title: "Copied", description: "Platform callback URL copied" });
                  }}
                  data-testid="button-copy-platform-callback"
                >
                  <Copy className="h-3 w-3" />
                  Copy platform default
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!clientId || !clientSecret || !redirectUri || saveMutation.isPending}
            data-testid="button-schwab-save-creds"
          >
            {saveMutation.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            Save Credentials
          </Button>
          <Button
            variant="default"
            onClick={() => connectMutation.mutate()}
            disabled={!canConnectByo || connectMutation.isPending}
            data-testid="button-schwab-connect-byo"
          >
            {connectMutation.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            Connect Schwab Using My Credentials
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              if (confirm("Clear your saved Schwab developer credentials? If a Schwab connection is currently active using these credentials, token refresh will stop working and you'll need to reconnect.")) {
                clearMutation.mutate();
              }
            }}
            disabled={!status?.hasClientId || clearMutation.isPending}
            data-testid="button-schwab-clear-creds"
          >
            {clearMutation.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            Clear My Credentials
          </Button>
        </div>

        {status && (
          <>
            <Separator />
            <div className="grid gap-2 text-xs sm:grid-cols-2" data-testid="schwab-byo-status">
              <div><span className="text-muted-foreground">Mode:</span> <span className="font-mono">{status.mode}</span></div>
              <div><span className="text-muted-foreground">Reconnect required:</span> <span className="font-mono">{status.reconnectRequired ? "yes" : "no"}</span></div>
              <div><span className="text-muted-foreground">Last refresh success:</span> <span className="font-mono">{status.lastRefreshSuccessAt ? new Date(status.lastRefreshSuccessAt).toLocaleString() : "—"}</span></div>
              <div><span className="text-muted-foreground">Credentials saved at:</span> <span className="font-mono">{status.updatedAt ? new Date(status.updatedAt).toLocaleString() : "—"}</span></div>
            </div>
          </>
        )}

        <Accordion type="single" collapsible>
          <AccordionItem value="byo-help">
            <AccordionTrigger className="text-sm" data-testid="accordion-schwab-byo-help">
              How to connect Schwab using your own credentials
            </AccordionTrigger>
            <AccordionContent>
              <ol className="space-y-2 text-sm">
                {STEPS.map((s) => (
                  <li key={s.title}>
                    <span className="font-medium">{s.title}: </span>
                    <span className="text-muted-foreground">{s.body}</span>
                  </li>
                ))}
              </ol>
              <div className="mt-4 space-y-1 text-xs text-muted-foreground">
                <p>Notes:</p>
                <ul className="list-disc pl-5 space-y-0.5">
                  <li>This is an advanced option. Normal users should use the standard Schwab connection when available.</li>
                  <li>You must already have access to Schwab's Developer Portal.</li>
                  <li>Schwab may require app approval before credentials work.</li>
                  <li>Your redirect URI must match exactly.</li>
                  <li>If Schwab credentials expire, are revoked, or are changed, reconnect may be required.</li>
                </ul>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {isLoading && (
          <p className="text-xs text-muted-foreground">Loading saved credentials…</p>
        )}
      </CardContent>
    </Card>
  );
}
