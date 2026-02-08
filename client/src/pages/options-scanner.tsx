import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Lock, ScanLine } from "lucide-react";

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

interface TokenResponse {
  token: string;
  expiresIn: string;
  user: { id: string; email: string; role: string };
}

export default function OptionsScanner() {
  const tokenRef = useRef<string | null>(null);
  const [tokenReady, setTokenReady] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const { data: me, isLoading: meLoading } = useQuery<MeResponse>({
    queryKey: ["/api/auth/me"],
  });

  useEffect(() => {
    if (!me?.entitlements?.optionsScanner) return;

    let cancelled = false;

    async function fetchToken() {
      try {
        const res = await apiRequest("POST", "/api/auth/token");
        const data: TokenResponse = await res.json();
        if (!cancelled) {
          tokenRef.current = data.token;
          setTokenReady(true);
        }
      } catch (err) {
        if (!cancelled) {
          setTokenError("Failed to initialize session. Please refresh.");
        }
      }
    }

    fetchToken();

    return () => {
      cancelled = true;
    };
  }, [me?.entitlements?.optionsScanner]);

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

  if (tokenError) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-8 space-y-3">
            <p className="text-destructive" data-testid="text-token-error">{tokenError}</p>
            <Button onClick={() => window.location.reload()} data-testid="button-retry">
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!tokenReady) {
    return (
      <div className="flex items-center justify-center h-full" data-testid="loading-options-token">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">Options Scanner loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4" data-testid="options-scanner-container">
      <div className="flex items-center gap-3">
        <ScanLine className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold" data-testid="text-options-title">Options Scanner</h1>
      </div>
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground" data-testid="text-options-ready">
            Options Scanner ready. Module will load here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
