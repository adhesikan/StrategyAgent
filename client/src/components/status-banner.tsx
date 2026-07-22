import { useState } from "react";
import { Wifi, WifiOff, AlertTriangle, X, MailWarning } from "lucide-react";
import { useBrokerStatus } from "@/hooks/use-broker-status";
import { useAuth } from "@/hooks/use-auth";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

const VERIFY_BANNER_DISMISS_KEY = "verify-email-banner-dismissed";

export function VerifyEmailBanner() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem(VERIFY_BANNER_DISMISS_KEY) === "1",
  );

  const resendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/resend-verification");
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Verification email sent",
        description: `Check ${user?.email} for the verification link. It expires in 24 hours.`,
      });
    },
    onError: () => {
      toast({
        title: "Could not send verification email",
        description: "Please try again in a few minutes.",
        variant: "destructive",
      });
    },
  });

  if (!user || user.emailVerified || dismissed) return null;

  return (
    <div
      className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 flex flex-wrap items-center justify-center gap-2"
      data-testid="banner-verify-email"
    >
      <MailWarning className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
      <span className="text-xs md:text-sm text-amber-700 dark:text-amber-300">
        Please verify your email address ({user.email}) so you don't lose access to password resets and account emails.
      </span>
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2 text-xs shrink-0"
        disabled={resendMutation.isPending}
        onClick={() => resendMutation.mutate()}
        data-testid="button-resend-verification"
      >
        {resendMutation.isPending ? "Sending..." : "Resend email"}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={() => {
          sessionStorage.setItem(VERIFY_BANNER_DISMISS_KEY, "1");
          setDismissed(true);
        }}
        aria-label="Dismiss verification reminder"
        data-testid="button-dismiss-verify-banner"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function StatusBanner() {
  const { isLoading, dataStatus, dataSourceStatus, connectionLost, connectionLostProvider, dismissConnectionLost } = useBrokerStatus();

  if (connectionLost) {
    return (
      <div
        className="bg-destructive/10 border-b border-destructive/30 px-4 py-2.5 flex items-center justify-center gap-3"
        data-testid="banner-connection-lost"
      >
        <WifiOff className="h-4 w-4 text-destructive shrink-0" />
        <span className="text-sm text-destructive">
          {connectionLostProvider
            ? `Your ${connectionLostProvider} brokerage access has expired. Please reconnect to continue trading.`
            : "Your brokerage access has expired. Please reconnect to continue trading."}
        </span>
        <Button variant="outline" size="sm" asChild className="shrink-0">
          <Link href="/settings" data-testid="link-reconnect-broker-heartbeat">Reconnect</Link>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={dismissConnectionLost}
          data-testid="button-dismiss-connection-lost"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return null;
  }

  if (dataStatus?.isLive) {
    const providerName = dataSourceStatus?.activeProvider || 
      (dataSourceStatus?.activeSource === "brokerage" ? dataSourceStatus?.brokerProvider || "Brokerage" : 
       "Live Data");
    
    return (
      <div 
        className="bg-green-500/10 border-b border-green-500/20 px-4 py-1.5 flex items-center justify-center gap-2"
        data-testid="banner-live-data"
      >
        <Wifi className="h-3.5 w-3.5 text-green-500" />
        <span className="text-xs text-green-600 dark:text-green-400">
          Live: {providerName}
        </span>
      </div>
    );
  }

  if (dataStatus?.error) {
    return (
      <div 
        className="bg-orange-500/10 border-b border-orange-500/20 px-4 py-1.5 flex items-center justify-center gap-2"
        data-testid="banner-broker-error"
      >
        <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />
        <span className="text-xs text-orange-600 dark:text-orange-400">
          Data fetch failed - showing cached data
        </span>
      </div>
    );
  }

  return (
    <div
      className="bg-muted/40 border-b border-border/60 px-4 py-1.5 flex items-center justify-center gap-2"
      data-testid="banner-mock-data"
    >
      <WifiOff className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-xs text-muted-foreground">
        Sample data — connect a broker for live prices.
      </span>
      <Button variant="ghost" size="sm" asChild className="h-6 px-2 text-xs">
        <Link href="/settings" data-testid="link-connect-broker-banner">
          Connect
        </Link>
      </Button>
    </div>
  );
}
