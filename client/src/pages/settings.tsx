import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Settings as SettingsIcon, Bell, Wifi, Shield, Database, FileText, Printer, ExternalLink, Code, Bot, Send, History, AlertCircle, CheckCircle, Plus, Trash2, Edit2, Zap, Clock, Target, List, Info, Eye, Save, TriangleAlert, BookOpen, RotateCcw, ChevronLeft, ChevronRight, Radio, HelpCircle, User, KeyRound, UserX, Loader2, SlidersHorizontal } from "lucide-react";
import { TradePreferencesSection } from "@/components/trade-preferences-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Link, useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { InteractiveTutorial } from "@/components/interactive-tutorial";
import type { BrokerConnection, BrokerProviderType, OpportunityDefaults, SnaptradeConnection } from "@shared/schema";
import { STRATEGY_CONFIGS, getStrategyDisplayName } from "@shared/strategies";
import { useTooltipVisibility } from "@/hooks/use-tooltips";
import { useBrokerStatus } from "@/hooks/use-broker-status";
import { TradingStyleSection } from "@/components/settings/trading-style-section";
import { BillingSection } from "@/components/settings/billing-section";

interface UserSettingsResponse {
  showTooltips: boolean;
  pushNotificationsEnabled: boolean;
  breakoutAlertsEnabled: boolean;
  stopAlertsEnabled: boolean;
  emaAlertsEnabled: boolean;
  approachingAlertsEnabled: boolean;
  hasSeenWelcomeTutorial: boolean;
  hasSeenScannerTutorial: boolean;
  hasSeenVcpTutorial: boolean;
  hasSeenAlertsTutorial: boolean;
  preferredDataSource: "brokerage";
}

const brokerProviders = [
  { 
    id: "tradier", 
    name: "Tradier", 
    description: "Commission-free trading platform",
    tokenUrl: "https://web.tradier.com/user/api",
    tokenInstructions: "Log in to Tradier, go to Settings > API Access, and copy your Access Token.",
    requiresSecretKey: false,
    supportsOAuth: true,
    signupUrl: "https://join.tradier.com/partner?platform=261",
  },
  { 
    id: "tradestation", 
    name: "TradeStation", 
    description: "Professional trading platform",
    tokenUrl: "https://api.tradestation.com/docs/",
    tokenInstructions: "Log in to TradeStation, go to API settings, and copy your Access Token.",
    requiresSecretKey: false,
    supportsOAuth: true,
    signupUrl: "https://getstarted2.tradestation.com/intro?offer=ALGOAGRB",
  },
  { 
    id: "alpaca", 
    name: "Alpaca", 
    description: "API-first stock trading",
    tokenUrl: "https://app.alpaca.markets/paper/dashboard/overview",
    tokenInstructions: "Log in to Alpaca, go to your dashboard, click on API Keys, and copy both your API Key ID and Secret Key.",
    requiresSecretKey: true,
    supportsOAuth: false,
  },
  { 
    id: "tastytrade", 
    name: "TastyTrade", 
    description: "Options and futures trading platform",
    tokenUrl: "https://developer.tastytrade.com/",
    tokenInstructions: "Log in to TastyTrade Developer Portal, create an application, and copy your API credentials. Use your session token as the Access Token.",
    requiresSecretKey: true,
    supportsOAuth: false,
  },
];

function TradeStationSimModeCard() {
  const { toast } = useToast();
  const { data: simStatus } = useQuery<{ simMode: boolean; provider: string | null; available: boolean }>({
    queryKey: ["/api/broker/sim-mode"],
  });

  const toggleSimMode = useMutation({
    mutationFn: async (enabled: boolean) => {
      await apiRequest("POST", "/api/broker/sim-mode", { enabled });
    },
    onSuccess: (_, enabled) => {
      queryClient.invalidateQueries({ queryKey: ["/api/broker/sim-mode"] });
      queryClient.invalidateQueries({ queryKey: ["/api/broker/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/broker/accounts"] });
      toast({
        title: enabled ? "Sim Mode Enabled" : "Sim Mode Disabled",
        description: enabled
          ? "Trading will use the TradeStation simulation environment"
          : "Trading will use the TradeStation live environment",
      });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update sim mode", variant: "destructive" });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">Simulated Trading</CardTitle>
        <CardDescription>
          Switch between live and simulated trading environments on TradeStation
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className={`h-2.5 w-2.5 rounded-full ${simStatus?.simMode ? "bg-amber-500" : "bg-green-500"}`} />
              <span className="text-sm font-medium" data-testid="text-sim-mode-status">
                {simStatus?.simMode ? "Simulation Mode" : "Live Mode"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {simStatus?.simMode
                ? "Orders go to sim-api.tradestation.com (no real money)"
                : "Orders go to the live TradeStation API"}
            </p>
          </div>
          <Switch
            checked={simStatus?.simMode ?? false}
            onCheckedChange={(checked) => toggleSimMode.mutate(checked)}
            disabled={toggleSimMode.isPending}
            data-testid="switch-sim-mode"
          />
        </div>
      </CardContent>
    </Card>
  );
}

const VALID_SETTINGS_TABS = new Set([
  "trading-style",
  "billing",
  "broker",
  "notifications",
  "display",
  "trade-prefs",
  "scanner",
  "legal",
  "account",
]);

export default function Settings() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const initialTab = (() => {
    if (typeof window === "undefined") return "broker";
    const t = new URLSearchParams(window.location.search).get("tab");
    return t && VALID_SETTINGS_TABS.has(t) ? t : "broker";
  })();
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [showTokenFallback, setShowTokenFallback] = useState(false);
  const { tooltipsEnabled, setTooltipsEnabled } = useTooltipVisibility();
  
  const [showAccountPickerDialog, setShowAccountPickerDialog] = useState(false);
  const [hasCheckedAccountPicker, setHasCheckedAccountPicker] = useState(false);

  const [localSettings, setLocalSettings] = useState<UserSettingsResponse>({
    showTooltips: true,
    pushNotificationsEnabled: false,
    breakoutAlertsEnabled: true,
    stopAlertsEnabled: true,
    emaAlertsEnabled: true,
    approachingAlertsEnabled: true,
    hasSeenWelcomeTutorial: false,
    hasSeenScannerTutorial: false,
    hasSeenVcpTutorial: false,
    hasSeenAlertsTutorial: false,
    preferredDataSource: "brokerage",
  });
  const [originalSettings, setOriginalSettings] = useState<UserSettingsResponse | null>(null);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
  
  const { data: userSettings, isLoading: isLoadingSettings } = useQuery<UserSettingsResponse>({
    queryKey: ["/api/user/settings"],
  });
  
  useEffect(() => {
    if (userSettings) {
      setLocalSettings(userSettings);
      setOriginalSettings(userSettings);
    }
  }, [userSettings]);
  
  const hasUnsavedChanges = originalSettings !== null && (
    localSettings.showTooltips !== originalSettings.showTooltips ||
    localSettings.pushNotificationsEnabled !== originalSettings.pushNotificationsEnabled ||
    localSettings.breakoutAlertsEnabled !== originalSettings.breakoutAlertsEnabled ||
    localSettings.stopAlertsEnabled !== originalSettings.stopAlertsEnabled ||
    localSettings.emaAlertsEnabled !== originalSettings.emaAlertsEnabled ||
    localSettings.approachingAlertsEnabled !== originalSettings.approachingAlertsEnabled
  );
  
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);
  
  const saveSettingsMutation = useMutation({
    mutationFn: async (settings: Partial<UserSettingsResponse>) => {
      const response = await apiRequest("PUT", "/api/user/settings", settings);
      return response.json();
    },
    onSuccess: (data) => {
      setOriginalSettings(data);
      setLocalSettings(data);
      setTooltipsEnabled(data.showTooltips);
      queryClient.invalidateQueries({ queryKey: ["/api/user/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/data-source/status"] });
      toast({
        title: "Settings Saved",
        description: "Your preferences have been updated.",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to Save",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  
  
  const handleSaveSettings = () => {
    saveSettingsMutation.mutate(localSettings);
  };
  
  const handleDiscardChanges = () => {
    if (originalSettings) {
      setLocalSettings(originalSettings);
    }
    setShowUnsavedDialog(false);
    if (pendingNavigation) {
      navigate(pendingNavigation);
      setPendingNavigation(null);
    }
  };
  
  const handleSaveAndContinue = async () => {
    await saveSettingsMutation.mutateAsync(localSettings);
    setShowUnsavedDialog(false);
    if (pendingNavigation) {
      navigate(pendingNavigation);
      setPendingNavigation(null);
    }
  };

  const { data: brokerStatus } = useQuery<BrokerConnection | null>({
    queryKey: ["/api/broker/status"],
  });

  const { connectionLost } = useBrokerStatus();

  interface SettingsBrokerAccount {
    id: string;
    name: string;
    type: string;
    buyingPower: number;
    equity: number;
    currency: string;
  }

  const { data: brokerAccounts = [] } = useQuery<SettingsBrokerAccount[]>({
    queryKey: ["/api/broker/accounts"],
    enabled: !!brokerStatus?.isConnected,
  });

  useEffect(() => {
    if (!brokerStatus?.isConnected) {
      setHasCheckedAccountPicker(false);
      return;
    }
    if (hasCheckedAccountPicker) return;
    if (!brokerStatus?.preferredAccountId && brokerAccounts.length > 1) {
      setHasCheckedAccountPicker(true);
      setShowAccountPickerDialog(true);
    } else if (!brokerStatus?.preferredAccountId && brokerAccounts.length === 1) {
      setHasCheckedAccountPicker(true);
      setPreferredAccountMutation.mutate(brokerAccounts[0].id);
    }
  }, [brokerStatus, brokerAccounts, hasCheckedAccountPicker]);

  const setPreferredAccountMutation = useMutation({
    mutationFn: async (accountId: string) => {
      const response = await apiRequest("PATCH", "/api/broker/preferred-account", { accountId });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/broker/status"] });
      toast({
        title: "Trading Account Updated",
        description: "Your preferred trading account has been set.",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to Update Account",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const [sandboxToken, setSandboxToken] = useState("");
  const [showSandboxInput, setShowSandboxInput] = useState(false);

  const { data: sandboxStatus } = useQuery<{ hasSandboxToken: boolean }>({
    queryKey: ["/api/broker/sandbox-status"],
    enabled: !!brokerStatus?.isConnected && brokerStatus?.provider === "tradier",
  });

  const saveSandboxTokenMutation = useMutation({
    mutationFn: async (token: string) => {
      const response = await apiRequest("POST", "/api/broker/sandbox-token", { token });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/broker/sandbox-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/broker/accounts"] });
      setSandboxToken("");
      setShowSandboxInput(false);
      toast({
        title: "Paper Trading Enabled",
        description: "Sandbox token saved. Paper trading accounts are now available.",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to Save Token",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const removeSandboxTokenMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("DELETE", "/api/broker/sandbox-token");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/broker/sandbox-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/broker/accounts"] });
      toast({
        title: "Paper Trading Disabled",
        description: "Sandbox token removed.",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to Remove Token",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const { data: snaptradeStatus } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/snaptrade/status"],
  });

  const { data: tradierOAuthStatus } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/tradier/oauth/status"],
  });

  const { data: tradestationOAuthStatus } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/tradestation/oauth/status"],
  });

  // Helper to check if OAuth is available for a provider
  const isOAuthAvailable = (providerId: string): boolean => {
    if (providerId === "tradier") return !!tradierOAuthStatus?.configured;
    if (providerId === "tradestation") return !!tradestationOAuthStatus?.configured;
    return false;
  };

  const { data: snaptradeConnections = [], refetch: refetchSnaptradeConnections } = useQuery<SnaptradeConnection[]>({
    queryKey: ["/api/snaptrade/connections"],
    enabled: !!snaptradeStatus?.configured,
  });

  const [snaptradeDialogOpen, setSnaptradeDialogOpen] = useState(false);
  const [deletingConnectionId, setDeletingConnectionId] = useState<string | null>(null);

  const connectSnaptradesMutation = useMutation({
    mutationFn: async (broker?: string) => {
      const response = await fetch("/api/snaptrade/auth-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ broker, connectionType: "trade" }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to get auth link");
      }
      return response.json();
    },
    onSuccess: (data) => {
      if (data.authLink) {
        window.location.href = data.authLink;
      }
    },
    onError: (error) => {
      toast({
        title: "Connection Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteSnaptradeConnectionMutation = useMutation({
    mutationFn: async (connectionId: string) => {
      const response = await fetch(`/api/snaptrade/connections/${connectionId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to disconnect");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/snaptrade/connections"] });
      setDeletingConnectionId(null);
      toast({
        title: "Disconnected",
        description: "Brokerage account disconnected successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Disconnect Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const connectBrokerMutation = useMutation({
    mutationFn: async ({ provider, accessToken, secretKey }: { provider: string; accessToken: string; secretKey?: string }) => {
      const response = await apiRequest("POST", "/api/broker/connect", { provider, accessToken, secretKey });
      return response.json();
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/broker/status"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/broker/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scan/results", "meta"] });
      setConnectDialogOpen(false);
      setAccessToken("");
      setSecretKey("");
      setSelectedProvider(null);
      toast({
        title: "Broker Connected",
        description: `Successfully connected to ${brokerProviders.find(b => b.id === data.provider)?.name || data.provider}`,
      });
      try {
        const accountsRes = await fetch("/api/broker/accounts");
        if (accountsRes.ok) {
          const accounts = await accountsRes.json();
          if (accounts.length > 1) {
            setShowAccountPickerDialog(true);
          } else if (accounts.length === 1) {
            setPreferredAccountMutation.mutate(accounts[0].id);
          }
        }
      } catch {}
    },
    onError: (error) => {
      toast({
        title: "Connection Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Tradier OAuth mutation
  const tradierOAuthMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/tradier/oauth");
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to initiate Tradier OAuth");
      }
      return response.json();
    },
    onSuccess: (data) => {
      if (data.authUrl) {
        window.location.href = data.authUrl;
      }
    },
    onError: (error) => {
      toast({
        title: "Connection Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const tradestationOAuthMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/tradestation/oauth");
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to initiate TradeStation OAuth");
      }
      return response.json();
    },
    onSuccess: (data) => {
      if (data.authUrl) {
        window.location.href = data.authUrl;
      }
    },
    onError: (error) => {
      toast({
        title: "Connection Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Helper to initiate OAuth for a provider
  const initiateOAuth = (providerId: string) => {
    if (providerId === "tradier") {
      tradierOAuthMutation.mutate();
    } else if (providerId === "tradestation") {
      tradestationOAuthMutation.mutate();
    }
  };

  const isOAuthPending = tradierOAuthMutation.isPending || tradestationOAuthMutation.isPending;

  // Handle OAuth callback query params (Tradier and TradeStation)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tradierSuccess = params.get("tradier_success");
    const tradierError = params.get("tradier_error");
    const tradestationSuccess = params.get("tradestation_success");
    const tradestationError = params.get("tradestation_error");
    
    const errorMessages: Record<string, string> = {
      missing_code: "Authorization code not received",
      missing_state: "Security token not received",
      state_mismatch: "Security token mismatch - please try again",
      session_expired: "Your session expired - please log in and try again",
      token_exchange_failed: "Failed to exchange authorization code",
      no_access_token: "No access token received",
      unknown: "An unexpected error occurred",
    };

    if (tradierSuccess === "true") {
      toast({
        title: "Tradier Connected",
        description: "Your Tradier account has been connected successfully.",
      });
      window.history.replaceState({}, "", "/settings");
      queryClient.invalidateQueries({ queryKey: ["/api/broker/status"] });
    } else if (tradierError) {
      toast({
        title: "Tradier Connection Failed",
        description: errorMessages[tradierError] || tradierError,
        variant: "destructive",
      });
      window.history.replaceState({}, "", "/settings");
    } else if (tradestationSuccess === "true") {
      toast({
        title: "TradeStation Connected",
        description: "Your TradeStation account has been connected successfully.",
      });
      window.history.replaceState({}, "", "/settings");
      queryClient.invalidateQueries({ queryKey: ["/api/broker/status"] });
    } else if (tradestationError) {
      toast({
        title: "TradeStation Connection Failed",
        description: errorMessages[tradestationError] || tradestationError,
        variant: "destructive",
      });
      window.history.replaceState({}, "", "/settings");
    }
  }, [toast, queryClient]);

  const handleProviderClick = (providerId: string) => {
    setSelectedProvider(providerId);
    setAccessToken("");
    setSecretKey("");
    setConnectDialogOpen(true);
  };

  const handleConnect = () => {
    if (!selectedProvider || !accessToken.trim()) return;
    const provider = brokerProviders.find(b => b.id === selectedProvider);
    if (provider?.requiresSecretKey && !secretKey.trim()) return;
    connectBrokerMutation.mutate({ 
      provider: selectedProvider, 
      accessToken: accessToken.trim(),
      secretKey: secretKey.trim() || undefined,
    });
  };

  const disconnectBrokerMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/broker/disconnect", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/broker/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scan/results", "meta"] });
      toast({
        title: "Broker Disconnected",
      });
    },
  });

  const autoReconnectMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      await apiRequest("POST", "/api/broker/auto-reconnect", { enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/broker/status"] });
    },
  });

  const testConnectionMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/broker/test", {});
      return response.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        let description = data.message || "Connection successful";
        if (data.data) {
          const label = data.data.symbol || "Quote";
          const price = data.data.last || data.data.close;
          if (price != null) {
            const priceStr = typeof price === "string" ? price : `$${price}`;
            description = `${label}: ${priceStr}`;
          } else {
            description = label;
          }
        }
        toast({
          title: "Connection Test Passed",
          description,
        });
      } else {
        toast({
          title: "Connection Test Failed",
          description: data.message || data.error,
          variant: "destructive",
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Connection Test Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const enablePushMutation = useMutation({
    mutationFn: async () => {
      if (!("Notification" in window)) {
        throw new Error("This browser does not support notifications");
      }
      if (!("serviceWorker" in navigator)) {
        throw new Error("This browser does not support service workers");
      }
      
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        throw new Error("Notification permission denied");
      }
      
      const vapidResponse = await fetch("/api/push/vapid-key");
      if (!vapidResponse.ok) {
        throw new Error("Push notifications not configured on server");
      }
      const { publicKey } = await vapidResponse.json();
      
      const urlBase64ToUint8Array = (base64String: string) => {
        const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
          outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
      };
      
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      
      await apiRequest("POST", "/api/push/subscribe", subscription.toJSON());
      return true;
    },
    onSuccess: (enabled) => {
      const newSettings = { ...localSettings, pushNotificationsEnabled: enabled };
      setLocalSettings(newSettings);
      if (enabled) {
        saveSettingsMutation.mutate(newSettings);
        toast({
          title: "Push Notifications Enabled",
          description: "You will receive alerts on this device",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Push Notifications Failed",
        description: error.message || "Could not enable push notifications",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="p-6 space-y-6" data-testid="settings-page">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure your trading preferences and connections
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Card
          className="hover-elevate cursor-pointer"
          onClick={() => window.dispatchEvent(new Event("open-setup-wizard"))}
          data-testid="card-reconfigure-setup"
        >
          <CardContent className="p-4 flex items-center gap-3">
            <RotateCcw className="h-5 w-5 text-primary" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">Edit Setup</p>
              <p className="text-xs text-muted-foreground">Reconfigure onboarding</p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </CardContent>
        </Card>
        <Link href="/settings/risk-profile">
          <Card className="hover-elevate cursor-pointer">
            <CardContent className="p-4 flex items-center gap-3">
              <Radio className="h-5 w-5 text-primary" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">My Limits</p>
                <p className="text-xs text-muted-foreground">Daily loss, position size, risk per trade</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/settings/universes">
          <Card className="hover-elevate cursor-pointer">
            <CardContent className="p-4 flex items-center gap-3">
              <List className="h-5 w-5 text-primary" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">Watchlists</p>
                <p className="text-xs text-muted-foreground">Manage ticker lists</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/help">
          <Card className="hover-elevate cursor-pointer">
            <CardContent className="p-4 flex items-center gap-3">
              <HelpCircle className="h-5 w-5 text-primary" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">Help & Guide</p>
                <p className="text-xs text-muted-foreground">Strategies & how-to</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      </div>

      <Tabs defaultValue={initialTab} className="space-y-6">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="trading-style" className="gap-2" data-testid="tab-trading-style">
            <Target className="h-4 w-4" />
            Trading Style
          </TabsTrigger>
          <TabsTrigger value="billing" className="gap-2" data-testid="tab-billing">
            <Zap className="h-4 w-4" />
            Plan & Billing
          </TabsTrigger>
          <TabsTrigger value="broker" className="gap-2" data-testid="tab-broker">
            <Wifi className="h-4 w-4" />
            Broker
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2" data-testid="tab-notifications">
            <Bell className="h-4 w-4" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="display" className="gap-2" data-testid="tab-display">
            <Eye className="h-4 w-4" />
            Display
          </TabsTrigger>
          <TabsTrigger value="trade-prefs" className="gap-2" data-testid="tab-trade-prefs">
            <SlidersHorizontal className="h-4 w-4" />
            Trading Preferences
          </TabsTrigger>
          <TabsTrigger value="scanner" className="gap-2" data-testid="tab-scanner">
            <Database className="h-4 w-4" />
            Opportunity Filters
          </TabsTrigger>
          <TabsTrigger value="legal" className="gap-2" data-testid="tab-legal">
            <FileText className="h-4 w-4" />
            Legal
          </TabsTrigger>
          <TabsTrigger value="account" className="gap-2" data-testid="tab-account">
            <User className="h-4 w-4" />
            Account
          </TabsTrigger>
        </TabsList>

        <TabsContent value="trading-style">
          <TradingStyleSection />
        </TabsContent>

        <TabsContent value="billing">
          <BillingSection />
        </TabsContent>

        <TabsContent value="broker">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-medium">Brokerage Connection</CardTitle>
                <CardDescription>
                  Connect your brokerage account for live market data
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className={`h-3 w-3 rounded-full ${connectionLost ? "bg-destructive" : brokerStatus?.isConnected ? "bg-status-online" : "bg-status-offline"}`} />
                    <div>
                      <p className="font-medium">
                        {connectionLost ? "Access Expired" : brokerStatus?.isConnected ? "Connected" : "Not Connected"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {brokerStatus?.provider
                          ? brokerProviders.find(b => b.id === brokerStatus.provider)?.name || brokerStatus.provider
                          : "No broker selected"
                        }
                      </p>
                    </div>
                  </div>
                  {(brokerStatus?.isConnected || connectionLost) && (
                    <div className="flex items-center gap-2">
                      {connectionLost && brokerStatus?.provider && (
                        <Button
                          variant="default"
                          onClick={() => initiateOAuth(brokerStatus.provider)}
                          disabled={isOAuthPending}
                          data-testid="button-reconnect-broker"
                        >
                          {isOAuthPending ? "Reconnecting..." : "Reconnect"}
                        </Button>
                      )}
                      {brokerStatus?.isConnected && !connectionLost && (
                        <Button
                          variant="outline"
                          onClick={() => testConnectionMutation.mutate()}
                          disabled={testConnectionMutation.isPending}
                          data-testid="button-test-connection"
                        >
                          {testConnectionMutation.isPending ? "Testing..." : "Test Connection"}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        onClick={() => disconnectBrokerMutation.mutate()}
                        disabled={disconnectBrokerMutation.isPending}
                        data-testid="button-disconnect"
                      >
                        Disconnect
                      </Button>
                    </div>
                  )}
                </div>
                {(brokerStatus?.isConnected || connectionLost) && (
                  <div className="flex items-center justify-between gap-4 mt-4 pt-4 border-t">
                    <div>
                      <p className="text-sm font-medium">Keep Connection Alive</p>
                      <p className="text-xs text-muted-foreground">
                        Automatically refresh your access token so you stay connected without re-authorizing
                      </p>
                    </div>
                    <Switch
                      checked={brokerStatus?.autoReconnect ?? false}
                      onCheckedChange={(checked) => autoReconnectMutation.mutate(checked)}
                      disabled={autoReconnectMutation.isPending}
                      data-testid="switch-auto-reconnect"
                    />
                  </div>
                )}
              </CardContent>
            </Card>

            {brokerStatus?.isConnected && brokerAccounts.length >= 1 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-medium">Trading Account</CardTitle>
                  <CardDescription>
                    Select which account to use for placing trades
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {brokerAccounts.map((acc) => {
                      const isSelected = brokerStatus?.preferredAccountId === acc.id;
                      return (
                        <div
                          key={acc.id}
                          className={`flex items-center justify-between gap-4 p-3 rounded-md border ${isSelected ? "border-primary bg-primary/5" : ""}`}
                          data-testid={`account-row-${acc.id}`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium text-sm" data-testid={`account-name-${acc.id}`}>{acc.name}</p>
                              <Badge variant="secondary" className="text-[10px]">{acc.type}</Badge>
                              {isSelected && (
                                <Badge variant={connectionLost ? "destructive" : "default"} className="text-[10px]" data-testid="badge-active-account">
                                  {connectionLost ? "Expired" : "Active"}
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              Buying Power: ${acc.buyingPower.toLocaleString()} · Equity: ${acc.equity.toLocaleString()}
                            </p>
                          </div>
                          {!isSelected && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setPreferredAccountMutation.mutate(acc.id)}
                              disabled={setPreferredAccountMutation.isPending}
                              data-testid={`button-select-account-${acc.id}`}
                            >
                              {setPreferredAccountMutation.isPending ? "Setting..." : "Use This Account"}
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {brokerStatus?.isConnected && brokerStatus?.provider === "tradestation" && (
              <TradeStationSimModeCard />
            )}

            {brokerStatus?.isConnected && brokerStatus?.provider === "tradier" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-medium">Paper Trading</CardTitle>
                  <CardDescription>
                    Practice trading with a Tradier sandbox account using simulated money
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {sandboxStatus?.hasSandboxToken ? (
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-500" />
                        <span className="text-sm">Sandbox token configured</span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => removeSandboxTokenMutation.mutate()}
                        disabled={removeSandboxTokenMutation.isPending}
                        data-testid="button-remove-sandbox"
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        Remove
                      </Button>
                    </div>
                  ) : showSandboxInput ? (
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="sandbox-token">Sandbox API Token</Label>
                        <Input
                          id="sandbox-token"
                          type="password"
                          placeholder="Paste your Tradier sandbox API token"
                          value={sandboxToken}
                          onChange={(e) => setSandboxToken(e.target.value)}
                          data-testid="input-sandbox-token"
                        />
                        <p className="text-xs text-muted-foreground">
                          Get your sandbox token from{" "}
                          <a
                            href="https://sandbox.tradier.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            sandbox.tradier.com
                          </a>
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => saveSandboxTokenMutation.mutate(sandboxToken)}
                          disabled={!sandboxToken.trim() || saveSandboxTokenMutation.isPending}
                          data-testid="button-save-sandbox"
                        >
                          {saveSandboxTokenMutation.isPending ? "Saving..." : "Save Token"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setShowSandboxInput(false);
                            setSandboxToken("");
                          }}
                          data-testid="button-cancel-sandbox"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowSandboxInput(true)}
                      data-testid="button-add-sandbox"
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Add Sandbox Token
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-base font-medium">Connect Your Broker</CardTitle>
                <CardDescription>
                  Use live market data and send self-directed orders after review. Orders are only sent after you review and confirm them.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {brokerProviders.map((broker) => {
                    const isConnected = brokerStatus?.provider === broker.id && brokerStatus?.isConnected;
                    const isExpired = isConnected && connectionLost;
                    return (
                      <Card 
                        key={broker.id}
                        className={`cursor-pointer hover-elevate ${isConnected ? (isExpired ? "border-destructive" : "border-primary") : ""}`}
                        onClick={() => {
                          if (isExpired) {
                            initiateOAuth(broker.id);
                          } else if (!isConnected) {
                            handleProviderClick(broker.id);
                          }
                        }}
                        data-testid={`broker-${broker.id}`}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between">
                            <div>
                              <h3 className="font-medium">{broker.name}</h3>
                              <p className="text-xs text-muted-foreground mt-1">
                                {broker.description}
                              </p>
                            </div>
                            {isConnected && (
                              <Badge variant={isExpired ? "destructive" : "default"} className="text-xs">
                                {isExpired ? "Tap to Reconnect" : "Active"}
                              </Badge>
                            )}
                          </div>
                          {broker.signupUrl && !isConnected && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="mt-2 h-auto p-0 text-xs gap-1 text-primary hover:text-primary/80 hover:bg-transparent"
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(broker.signupUrl, "_blank", "noopener,noreferrer");
                              }}
                              data-testid={`button-${broker.id}-signup`}
                            >
                              <ExternalLink className="h-3 w-3" />
                              Open a {broker.name} Account
                            </Button>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                  {[
                    { id: "schwab", name: "Charles Schwab", description: "Full-service brokerage and wealth management" },
                    { id: "ibkr", name: "Interactive Brokers", description: "Global electronic brokerage for active traders" },
                  ].map((broker) => (
                    <Card
                      key={broker.id}
                      className="opacity-60 cursor-default"
                      data-testid={`broker-${broker.id}`}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-medium">{broker.name}</h3>
                            <p className="text-xs text-muted-foreground mt-1">
                              {broker.description}
                            </p>
                          </div>
                          <Badge variant="outline" className="text-xs shrink-0">
                            Coming Soon
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <Dialog open={showAccountPickerDialog} onOpenChange={setShowAccountPickerDialog}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Select Trading Account</DialogTitle>
                      <DialogDescription>
                        Your broker has multiple accounts. Choose which one to use for placing trades.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2 py-2">
                      {brokerAccounts.map((acc) => (
                        <div
                          key={acc.id}
                          className="flex items-center justify-between gap-4 p-3 rounded-md border hover-elevate cursor-pointer"
                          onClick={() => {
                            setPreferredAccountMutation.mutate(acc.id);
                            setShowAccountPickerDialog(false);
                          }}
                          data-testid={`picker-account-${acc.id}`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium text-sm">{acc.name}</p>
                              <Badge variant="secondary" className="text-[10px]">{acc.type}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              Buying Power: ${acc.buyingPower.toLocaleString()} · Equity: ${acc.equity.toLocaleString()}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </DialogContent>
                </Dialog>

                <Dialog open={connectDialogOpen} onOpenChange={(open) => {
                  setConnectDialogOpen(open);
                  if (!open) {
                    setShowTokenFallback(false);
                    setAccessToken("");
                    setSecretKey("");
                  }
                }}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>
                        Connect to {brokerProviders.find(b => b.id === selectedProvider)?.name}
                      </DialogTitle>
                      <DialogDescription>
                        {selectedProvider && brokerProviders.find(b => b.id === selectedProvider)?.supportsOAuth && isOAuthAvailable(selectedProvider)
                          ? "Sign in securely with your brokerage account"
                          : "Enter your API credentials to connect"
                        }
                      </DialogDescription>
                    </DialogHeader>
                    <div className="py-4 space-y-4">
                      {/* OAuth option - shown first for providers that support it */}
                      {selectedProvider && brokerProviders.find(b => b.id === selectedProvider)?.supportsOAuth && isOAuthAvailable(selectedProvider) && !showTokenFallback && (
                        <div className="space-y-4">
                          <Button
                            className="w-full gap-2"
                            size="lg"
                            onClick={() => {
                              setConnectDialogOpen(false);
                              initiateOAuth(selectedProvider);
                            }}
                            disabled={isOAuthPending}
                            data-testid="button-oauth-connect"
                          >
                            <ExternalLink className="h-4 w-4" />
                            {isOAuthPending ? "Connecting..." : `Sign in with ${brokerProviders.find(b => b.id === selectedProvider)?.name}`}
                          </Button>
                          <p className="text-xs text-muted-foreground text-center">
                            Securely authorize Strategy Agent to access market data from your account
                          </p>
                          
                          <div className="relative py-2">
                            <div className="absolute inset-0 flex items-center">
                              <span className="w-full border-t" />
                            </div>
                            <div className="relative flex justify-center text-xs uppercase">
                              <span className="bg-background px-2 text-muted-foreground">Or</span>
                            </div>
                          </div>
                          
                          <Button
                            variant="outline"
                            className="w-full"
                            onClick={() => setShowTokenFallback(true)}
                            data-testid="button-show-token-fallback"
                          >
                            Connect with API Token instead
                          </Button>
                        </div>
                      )}
                      
                      {/* Token-based connection - shown for providers without OAuth or as fallback */}
                      {(!selectedProvider || !brokerProviders.find(b => b.id === selectedProvider)?.supportsOAuth || !isOAuthAvailable(selectedProvider) || showTokenFallback) && (
                        <>
                          {showTokenFallback && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1 -mt-2 mb-2"
                              onClick={() => setShowTokenFallback(false)}
                              data-testid="button-back-to-oauth"
                            >
                              <ChevronLeft className="h-4 w-4" />
                              Back to sign in
                            </Button>
                          )}
                          
                          {selectedProvider && (
                            <div className="bg-muted p-3 rounded-md space-y-2">
                              <p className="text-sm font-medium">How to get your access token:</p>
                              <p className="text-sm text-muted-foreground">
                                {brokerProviders.find(b => b.id === selectedProvider)?.tokenInstructions}
                              </p>
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-2"
                                onClick={() => window.open(brokerProviders.find(b => b.id === selectedProvider)?.tokenUrl, '_blank')}
                                data-testid="button-open-broker-portal"
                              >
                                <ExternalLink className="h-4 w-4" />
                                Open {brokerProviders.find(b => b.id === selectedProvider)?.name} API Settings
                              </Button>
                            </div>
                          )}
                          <div>
                            <Label htmlFor="accessToken">
                              {brokerProviders.find(b => b.id === selectedProvider)?.requiresSecretKey ? "API Key ID" : "Access Token"}
                            </Label>
                            <Input
                              id="accessToken"
                              type="password"
                              placeholder={brokerProviders.find(b => b.id === selectedProvider)?.requiresSecretKey ? "Paste your API Key ID here" : "Paste your API access token here"}
                              value={accessToken}
                              onChange={(e) => setAccessToken(e.target.value)}
                              className="mt-2"
                              data-testid="input-access-token"
                            />
                          </div>
                          {brokerProviders.find(b => b.id === selectedProvider)?.requiresSecretKey && (
                            <div>
                              <Label htmlFor="secretKey">Secret Key</Label>
                              <Input
                                id="secretKey"
                                type="password"
                                placeholder="Paste your Secret Key here"
                                value={secretKey}
                                onChange={(e) => setSecretKey(e.target.value)}
                                className="mt-2"
                                data-testid="input-secret-key"
                              />
                            </div>
                          )}
                        </>
                      )}
                      
                      <div className="bg-blue-500/10 border border-blue-500/20 p-3 rounded-md space-y-2">
                        <div className="flex items-center gap-2">
                          <Shield className="h-4 w-4 text-blue-500" />
                          <p className="text-sm font-medium text-blue-600 dark:text-blue-400">Security Notice</p>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          By connecting, you authorize Strategy Agent to access account data and (if enabled) place trades on your behalf.
                          Your credentials are encrypted at rest and never shared with third parties.
                        </p>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => setConnectDialogOpen(false)}
                        data-testid="button-cancel-connect"
                      >
                        Cancel
                      </Button>
                      {(!selectedProvider || !brokerProviders.find(b => b.id === selectedProvider)?.supportsOAuth || !isOAuthAvailable(selectedProvider) || showTokenFallback) && (
                        <Button
                          onClick={handleConnect}
                          disabled={!accessToken.trim() || (brokerProviders.find(b => b.id === selectedProvider)?.requiresSecretKey && !secretKey.trim()) || connectBrokerMutation.isPending}
                          data-testid="button-confirm-connect"
                        >
                          {connectBrokerMutation.isPending ? "Connecting..." : "Connect"}
                        </Button>
                      )}
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardContent>
            </Card>

          </div>
        </TabsContent>

        <TabsContent value="notifications">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base font-medium">Push Notifications</CardTitle>
                <CardDescription>
                  Receive instant alerts on your device
                </CardDescription>
              </div>
              {hasUnsavedChanges && (
                <Button 
                  onClick={handleSaveSettings}
                  disabled={saveSettingsMutation.isPending}
                  className="gap-2"
                  data-testid="button-save-settings"
                >
                  <Save className="h-4 w-4" />
                  {saveSettingsMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Enable Push Notifications</p>
                  <p className="text-sm text-muted-foreground">
                    Get notified when breakouts occur
                  </p>
                </div>
                <Switch
                  checked={localSettings.pushNotificationsEnabled}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      enablePushMutation.mutate();
                    } else {
                      setLocalSettings(prev => ({ ...prev, pushNotificationsEnabled: false }));
                    }
                  }}
                  data-testid="switch-push-notifications"
                />
              </div>

              <p className="text-xs text-muted-foreground pt-2">
                Configure specific alert rules on the Alerts page
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="display">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base font-medium">Display Preferences</CardTitle>
                <CardDescription>
                  Customize how information is displayed across the platform
                </CardDescription>
              </div>
              {hasUnsavedChanges && (
                <Button 
                  onClick={handleSaveSettings}
                  disabled={saveSettingsMutation.isPending}
                  className="gap-2"
                  data-testid="button-save-settings-display"
                >
                  <Save className="h-4 w-4" />
                  {saveSettingsMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <Info className="h-5 w-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="font-medium">Show Help Tooltips</p>
                    <p className="text-sm text-muted-foreground">
                      Display helpful explanations when hovering over metrics and terms
                    </p>
                  </div>
                </div>
                <Switch
                  checked={localSettings.showTooltips}
                  onCheckedChange={(checked) => setLocalSettings(prev => ({ ...prev, showTooltips: checked }))}
                  data-testid="switch-tooltips"
                />
              </div>
            </CardContent>
          </Card>

          <TutorialSettings />
        </TabsContent>

        <TabsContent value="trade-prefs">
          <TradePreferencesSection />
        </TabsContent>

        <TabsContent value="scanner">
          <OpportunityDefaultsSettings />
        </TabsContent>

        <TabsContent value="legal">
          <LegalSettings />
        </TabsContent>

        <TabsContent value="account">
          <AccountSettings />
        </TabsContent>
      </Tabs>
      
      <AlertDialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <TriangleAlert className="h-5 w-5 text-yellow-500" />
              Unsaved Changes
            </AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Would you like to save them before leaving?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleDiscardChanges} data-testid="button-discard-changes">
              Discard
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleSaveAndContinue} data-testid="button-save-and-continue">
              Save Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const SCAN_PRESETS = [
  { id: "balanced", name: "Balanced" },
  { id: "conservative", name: "Conservative" },
  { id: "aggressive", name: "Aggressive" },
  { id: "scalp", name: "Scalp" },
  { id: "swing", name: "Swing" },
];

function OpportunityDefaultsSettings() {
  const { toast } = useToast();
  
  const { data: defaults, isLoading } = useQuery<OpportunityDefaults | null>({
    queryKey: ["/api/user/opportunity-defaults"],
  });

  const resetDefaultsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("DELETE", "/api/user/opportunity-defaults", {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/opportunity-defaults"] });
      toast({
        title: "Defaults reset",
        description: "Your scan defaults have been reset to app defaults",
      });
    },
    onError: (error) => {
      toast({
        title: "Reset failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const getStrategyName = (strategyId: string) => {
    const strategy = STRATEGY_CONFIGS.find(s => s.id === strategyId);
    return strategy ? getStrategyDisplayName(strategy.id) : strategyId;
  };

  const getScopeName = (scope: string) => {
    switch (scope) {
      case "watchlist": return "Watchlist";
      case "symbol": return "Single Stock";
      case "universe": return "Market Index";
      default: return scope;
    }
  };

  const getPresetName = (presetId: string) => {
    const preset = SCAN_PRESETS.find(p => p.id === presetId);
    return preset?.name || presetId;
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground">Loading scan defaults...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">Scanner Defaults</CardTitle>
        <CardDescription>
          Your saved default scan settings. Set defaults from the Scanner page using "Save as Default".
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {defaults ? (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Mode</p>
                <p className="font-medium" data-testid="text-default-mode">
                  {defaults.defaultMode === "fusion" ? "Fusion Engine" : "Single Strategy"}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Strategy</p>
                <p className="font-medium" data-testid="text-default-strategy">
                  {getStrategyName(defaults.defaultStrategyId)}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Scan Target</p>
                <p className="font-medium" data-testid="text-default-scope">
                  {getScopeName(defaults.defaultScanScope)}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Filter Preset</p>
                <p className="font-medium" data-testid="text-default-preset">
                  {getPresetName(defaults.defaultFilterPreset)}
                </p>
              </div>
              {defaults.defaultWatchlistId && (
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Watchlist</p>
                  <p className="font-medium" data-testid="text-default-watchlist">
                    {defaults.defaultWatchlistId === "default" ? "Default Watchlist" : defaults.defaultWatchlistId}
                  </p>
                </div>
              )}
              {defaults.defaultSymbol && (
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Symbol</p>
                  <p className="font-medium font-mono" data-testid="text-default-symbol">
                    {defaults.defaultSymbol}
                  </p>
                </div>
              )}
              {defaults.defaultMarketIndex && (
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Market Index</p>
                  <p className="font-medium" data-testid="text-default-index">
                    {defaults.defaultMarketIndex}
                  </p>
                </div>
              )}
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Auto-run on Load</p>
                <p className="font-medium" data-testid="text-default-autorun">
                  {defaults.autoRunOnLoad ? "Enabled" : "Disabled"}
                </p>
              </div>
            </div>

            <div className="pt-2">
              <Button
                variant="outline"
                onClick={() => resetDefaultsMutation.mutate()}
                disabled={resetDefaultsMutation.isPending}
                data-testid="button-reset-defaults"
              >
                {resetDefaultsMutation.isPending ? "Resetting..." : "Reset to App Defaults"}
              </Button>
            </div>
          </>
        ) : (
          <div className="text-center py-6">
            <p className="text-muted-foreground mb-4">No defaults saved yet</p>
            <p className="text-sm text-muted-foreground">
              Go to the Scanner and click "Save as Default" to save your preferred scan settings.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface LegalStatus {
  accepted: boolean;
  currentVersion: string;
  acceptedVersion: string | null;
  acceptedAt: string | null;
}

function AccountSettings() {
  const { toast } = useToast();
  const { data: user, isLoading: userLoading } = useQuery<{ id: string; email: string; firstName?: string | null; lastName?: string | null; createdAt?: string | null }>({
    queryKey: ["/api/auth/user"],
  });

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (user) {
      setFirstName(user.firstName || "");
      setLastName(user.lastName || "");
      setEmail(user.email || "");
    }
  }, [user]);

  const profileMutation = useMutation({
    mutationFn: async (data: { firstName?: string; lastName?: string; email?: string }) => {
      const res = await apiRequest("PATCH", "/api/auth/profile", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: "Profile updated" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to update profile", description: error?.message || "Please try again", variant: "destructive" });
    },
  });

  const passwordMutation = useMutation({
    mutationFn: async (data: { currentPassword: string; newPassword: string }) => {
      const res = await apiRequest("POST", "/api/auth/change-password", data);
      return res.json();
    },
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: "Password changed successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to change password", description: error?.message || "Please try again", variant: "destructive" });
    },
  });

  const deleteAccountMutation = useMutation({
    mutationFn: async (password: string) => {
      const res = await apiRequest("DELETE", "/api/auth/account", { password });
      return res.json();
    },
    onSuccess: () => {
      window.location.href = "/";
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete account", description: error?.message || "Please try again", variant: "destructive" });
    },
  });

  function handleProfileSave() {
    const updates: { firstName?: string; lastName?: string; email?: string } = {};
    if (firstName !== (user?.firstName || "")) updates.firstName = firstName;
    if (lastName !== (user?.lastName || "")) updates.lastName = lastName;
    if (email !== (user?.email || "")) updates.email = email;

    if (Object.keys(updates).length === 0) {
      toast({ title: "No changes to save" });
      return;
    }
    profileMutation.mutate(updates);
  }

  function handlePasswordChange() {
    if (!currentPassword || !newPassword) {
      toast({ title: "Please fill in all password fields", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "New passwords do not match", variant: "destructive" });
      return;
    }
    if (newPassword.length < 6) {
      toast({ title: "New password must be at least 6 characters", variant: "destructive" });
      return;
    }
    passwordMutation.mutate({ currentPassword, newPassword });
  }

  function handleDeleteAccount() {
    if (!deletePassword) {
      toast({ title: "Please enter your password to confirm", variant: "destructive" });
      return;
    }
    deleteAccountMutation.mutate(deletePassword);
  }

  if (userLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Profile Information
          </CardTitle>
          <CardDescription>Update your name and email address</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name</Label>
              <Input
                id="firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name"
                data-testid="input-first-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last Name</Label>
              <Input
                id="lastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last name"
                data-testid="input-last-name"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email Address</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              data-testid="input-email"
            />
          </div>
          {user?.createdAt && (
            <p className="text-xs text-muted-foreground">
              Account created: {new Date(user.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
            </p>
          )}
          <Button
            onClick={handleProfileSave}
            disabled={profileMutation.isPending}
            data-testid="button-save-profile"
          >
            {profileMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Saving...</> : <><Save className="h-4 w-4 mr-2" /> Save Profile</>}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            Change Password
          </CardTitle>
          <CardDescription>Update your account password</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="currentPassword">Current Password</Label>
            <Input
              id="currentPassword"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter current password"
              data-testid="input-current-password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="newPassword">New Password</Label>
            <Input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password (min 6 characters)"
              data-testid="input-new-password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm New Password</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              data-testid="input-confirm-password"
            />
          </div>
          <Button
            onClick={handlePasswordChange}
            disabled={passwordMutation.isPending}
            data-testid="button-change-password"
          >
            {passwordMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Changing...</> : <><KeyRound className="h-4 w-4 mr-2" /> Change Password</>}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-red-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-500">
            <UserX className="h-5 w-5" />
            Delete Account
          </CardTitle>
          <CardDescription>
            Permanently delete your account and all associated data. This action cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!showDeleteConfirm ? (
            <Button
              variant="destructive"
              onClick={() => setShowDeleteConfirm(true)}
              data-testid="button-show-delete-account"
            >
              <Trash2 className="h-4 w-4 mr-2" /> Delete My Account
            </Button>
          ) : (
            <div className="space-y-4 p-4 border border-red-500/30 rounded-lg bg-red-500/5">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-red-500">This will permanently delete:</p>
                  <ul className="mt-1 text-muted-foreground list-disc list-inside space-y-1">
                    <li>Your account and profile information</li>
                    <li>All saved settings and preferences</li>
                    <li>Broker connections and trade history</li>
                    <li>Scan results and watchlists</li>
                  </ul>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="deletePassword">Enter your password to confirm</Label>
                <Input
                  id="deletePassword"
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Your password"
                  data-testid="input-delete-password"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  onClick={handleDeleteAccount}
                  disabled={deleteAccountMutation.isPending}
                  data-testid="button-confirm-delete-account"
                >
                  {deleteAccountMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Deleting...</> : "Yes, Delete My Account"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => { setShowDeleteConfirm(false); setDeletePassword(""); }}
                  data-testid="button-cancel-delete"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LegalSettings() {
  const { data: legalStatus, isLoading } = useQuery<LegalStatus>({
    queryKey: ["/api/auth/legal-status"],
  });

  const handlePrint = () => {
    window.print();
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground">Loading legal information...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Legal Acceptance Status</CardTitle>
          <CardDescription>
            Your acceptance of our legal agreements
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Current Policy Version</p>
              <p className="font-mono font-medium" data-testid="text-legal-version">
                {legalStatus?.currentVersion || "Unknown"}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Your Accepted Version</p>
              <p className="font-mono font-medium" data-testid="text-accepted-version">
                {legalStatus?.acceptedVersion || "Not accepted"}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Status</p>
              <Badge 
                variant={legalStatus?.accepted ? "default" : "destructive"}
                data-testid="badge-legal-status"
              >
                {legalStatus?.accepted ? "Up to date" : "Acceptance required"}
              </Badge>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Accepted On</p>
              <p className="font-medium" data-testid="text-accepted-date">
                {legalStatus?.acceptedAt 
                  ? new Date(legalStatus.acceptedAt).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "Not available"
                }
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Legal Documents</CardTitle>
          <CardDescription>
            Review our terms, disclaimer, and privacy policy
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Link href="/terms" className="block" data-testid="link-settings-terms">
              <Card className="hover-elevate cursor-pointer h-full">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Terms of Use</p>
                      <p className="text-xs text-muted-foreground">Service agreement</p>
                    </div>
                    <ExternalLink className="h-4 w-4 ml-auto text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            </Link>

            <Link href="/disclaimer" className="block" data-testid="link-settings-disclaimer">
              <Card className="hover-elevate cursor-pointer h-full">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <Shield className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Disclaimer</p>
                      <p className="text-xs text-muted-foreground">Risk disclosure</p>
                    </div>
                    <ExternalLink className="h-4 w-4 ml-auto text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            </Link>

            <Link href="/privacy" className="block" data-testid="link-settings-privacy">
              <Card className="hover-elevate cursor-pointer h-full">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Privacy Policy</p>
                      <p className="text-xs text-muted-foreground">Data handling</p>
                    </div>
                    <ExternalLink className="h-4 w-4 ml-auto text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            </Link>

            <Link href="/open-source" className="block" data-testid="link-settings-open-source">
              <Card className="hover-elevate cursor-pointer h-full">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <Code className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Open Source Notices</p>
                      <p className="text-xs text-muted-foreground">Licenses & attributions</p>
                    </div>
                    <ExternalLink className="h-4 w-4 ml-auto text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          </div>

          <div className="pt-4 border-t">
            <Button variant="outline" onClick={handlePrint} data-testid="button-print-legal">
              <Printer className="mr-2 h-4 w-4" />
              Print All Documents
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface AutomationSettingsData {
  isEnabled: boolean;
  webhookUrl: string | null;
  hasApiKey: boolean;
  autoEntryEnabled: boolean;
  autoExitEnabled: boolean;
  minScore: number;
  maxPositions: number;
  defaultPositionSize: number;
}

interface AutomationLogEntry {
  id: string;
  signalType: string;
  symbol: string;
  message: string;
  success: boolean;
  createdAt: string;
}

function AutomationSettings() {
  const { toast } = useToast();
  const [webhookUrl, setWebhookUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [isEnabled, setIsEnabled] = useState(false);
  const [autoEntryEnabled, setAutoEntryEnabled] = useState(true);
  const [autoExitEnabled, setAutoExitEnabled] = useState(true);
  const [minScore, setMinScore] = useState(70);
  const [hasChanges, setHasChanges] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const { data: settings, isLoading } = useQuery<AutomationSettingsData>({
    queryKey: ["/api/automation/settings"],
  });

  const { data: logs } = useQuery<AutomationLogEntry[]>({
    queryKey: ["/api/automation/logs"],
  });

  useEffect(() => {
    if (settings && !initialized) {
      setWebhookUrl(settings.webhookUrl || "");
      setIsEnabled(settings.isEnabled);
      setAutoEntryEnabled(settings.autoEntryEnabled);
      setAutoExitEnabled(settings.autoExitEnabled);
      setMinScore(settings.minScore);
      setInitialized(true);
    }
  }, [settings, initialized]);

  const saveSettingsMutation = useMutation({
    mutationFn: async (data: {
      webhookUrl: string;
      apiKey?: string;
      isEnabled: boolean;
      autoEntryEnabled: boolean;
      autoExitEnabled: boolean;
      minScore: number;
    }) => {
      const response = await apiRequest("POST", "/api/automation/settings", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/automation/settings"] });
      setApiKey("");
      setHasChanges(false);
      toast({
        title: "Settings Saved",
        description: "Automation settings have been updated",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to Save",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const testWebhookMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/automation/test", {});
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/automation/logs"] });
      if (data.success) {
        toast({
          title: "Test Successful",
          description: data.message,
        });
      } else {
        toast({
          title: "Test Failed",
          description: data.error || "Webhook test failed",
          variant: "destructive",
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Test Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    saveSettingsMutation.mutate({
      webhookUrl: webhookUrl.trim(),
      apiKey: apiKey.trim() || undefined,
      isEnabled,
      autoEntryEnabled,
      autoExitEnabled,
      minScore,
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Webhook Integration
          </CardTitle>
          <CardDescription>
            Configure webhook automation for trade execution based on breakout alerts
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Enable Automation</p>
              <p className="text-sm text-muted-foreground">
                Automatically send signals when alerts trigger
              </p>
            </div>
            <Switch
              checked={isEnabled}
              onCheckedChange={(checked) => {
                setIsEnabled(checked);
                setHasChanges(true);
              }}
              data-testid="switch-automation-enabled"
            />
          </div>

          <div className="space-y-4 pt-4 border-t">
            <div className="space-y-2">
              <Label htmlFor="webhookUrl">Webhook URL</Label>
              <Input
                id="webhookUrl"
                type="url"
                placeholder="https://your-webhook-url.com/..."
                value={webhookUrl}
                onChange={(e) => {
                  setWebhookUrl(e.target.value);
                  setHasChanges(true);
                }}
                data-testid="input-webhook-url"
              />
              <p className="text-xs text-muted-foreground">
                Your webhook URL for receiving trade signals
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="apiKey">
                API Key {settings?.hasApiKey && <Badge variant="secondary" className="ml-2 text-xs">Configured</Badge>}
              </Label>
              <Input
                id="apiKey"
                type="password"
                placeholder={settings?.hasApiKey ? "Enter new key to replace existing" : "Enter your API key"}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setHasChanges(true);
                }}
                data-testid="input-api-key"
              />
              <p className="text-xs text-muted-foreground">
                Your API key is encrypted and stored securely
              </p>
            </div>
          </div>

          <div className="space-y-4 pt-4 border-t">
            <h4 className="text-sm font-medium">Signal Types</h4>
            
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="auto-entry">Auto Entry Signals</Label>
                <p className="text-xs text-muted-foreground">Send entry signals on BREAKOUT alerts</p>
              </div>
              <Switch
                id="auto-entry"
                checked={autoEntryEnabled}
                onCheckedChange={(checked) => {
                  setAutoEntryEnabled(checked);
                  setHasChanges(true);
                }}
                data-testid="switch-auto-entry"
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="auto-exit">Auto Exit Signals</Label>
                <p className="text-xs text-muted-foreground">Send exit signals on stop loss triggers</p>
              </div>
              <Switch
                id="auto-exit"
                checked={autoExitEnabled}
                onCheckedChange={(checked) => {
                  setAutoExitEnabled(checked);
                  setHasChanges(true);
                }}
                data-testid="switch-auto-exit"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="minScore">Minimum Score</Label>
              <div className="flex items-center gap-4">
                <Input
                  id="minScore"
                  type="number"
                  min={0}
                  max={100}
                  value={minScore}
                  onChange={(e) => {
                    setMinScore(parseInt(e.target.value) || 0);
                    setHasChanges(true);
                  }}
                  className="w-24 font-mono"
                  data-testid="input-min-score"
                />
                <p className="text-sm text-muted-foreground">
                  Only send signals for alerts with scores above this threshold
                </p>
              </div>
            </div>
          </div>

          <div className="bg-amber-500/10 border border-amber-500/20 p-3 rounded-md space-y-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-500" />
              <p className="text-sm font-medium text-amber-600 dark:text-amber-400">Risk Warning</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Automated trading carries significant risk. Always monitor your positions and ensure 
              proper risk management is in place. Strategy Agent is not responsible for any trading losses.
            </p>
          </div>

          <div className="flex items-center justify-between gap-4 pt-4 border-t">
            <Button
              variant="outline"
              onClick={() => testWebhookMutation.mutate()}
              disabled={!settings?.hasApiKey || !webhookUrl || testWebhookMutation.isPending}
              data-testid="button-test-webhook"
            >
              <Send className="mr-2 h-4 w-4" />
              {testWebhookMutation.isPending ? "Testing..." : "Test Webhook"}
            </Button>
            <Button
              onClick={handleSave}
              disabled={!hasChanges || saveSettingsMutation.isPending}
              data-testid="button-save-automation"
            >
              {saveSettingsMutation.isPending ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <History className="h-5 w-5" />
            Recent Activity
          </CardTitle>
          <CardDescription>
            Latest webhook signals sent to automation endpoints
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!logs || logs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <History className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No signals sent yet</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-center justify-between p-2 rounded-md bg-muted/50"
                  data-testid={`log-entry-${log.id}`}
                >
                  <div className="flex items-center gap-3">
                    {log.success ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-destructive" />
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {log.signalType === "entry" ? "ENTRY" : "EXIT"}
                        </Badge>
                        <span className="font-medium text-sm">{log.symbol}</span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate max-w-xs">
                        {log.message}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AutomationProfiles />
    </div>
  );
}

interface AutomationProfileData {
  id: string;
  name: string;
  webhookUrl: string;
  hasApiKey: boolean;
  isEnabled: boolean;
  mode: "OFF" | "AUTO" | "CONFIRM" | "NOTIFY_ONLY";
  guardrails: {
    maxPerDay?: number;
    cooldownMinutes?: number;
    minScore?: number;
    allowedStrategies?: string[];
    allowedTimeWindow?: { start: string; end: string };
  } | null;
  lastTestStatus: number | null;
  lastTestAt: string | null;
  createdAt: string;
}

function AutomationProfiles() {
  const { toast } = useToast();
  const [editingProfile, setEditingProfile] = useState<AutomationProfileData | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newProfile, setNewProfile] = useState({
    name: "",
    webhookUrl: "",
    apiKey: "",
    mode: "NOTIFY_ONLY" as const,
    maxPerDay: "",
    cooldownMinutes: "",
    minScore: "",
  });

  const { data: profiles, isLoading } = useQuery<AutomationProfileData[]>({
    queryKey: ["/api/automation-profiles"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: {
      name: string;
      webhookUrl: string;
      apiKey?: string;
      mode: string;
      guardrails?: object | null;
    }) => {
      const response = await apiRequest("POST", "/api/automation-profiles", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/automation-profiles"] });
      setCreateDialogOpen(false);
      setNewProfile({ name: "", webhookUrl: "", apiKey: "", mode: "NOTIFY_ONLY", maxPerDay: "", cooldownMinutes: "", minScore: "" });
      toast({ title: "Profile Created", description: "Automation profile has been created" });
    },
    onError: (error) => {
      toast({ title: "Failed to Create", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string; [key: string]: any }) => {
      const response = await apiRequest("PUT", `/api/automation-profiles/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/automation-profiles"] });
      setEditingProfile(null);
      toast({ title: "Profile Updated", description: "Automation profile has been updated" });
    },
    onError: (error) => {
      toast({ title: "Failed to Update", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/automation-profiles/${id}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/automation-profiles"] });
      toast({ title: "Profile Deleted", description: "Automation profile has been deleted" });
    },
    onError: (error) => {
      toast({ title: "Failed to Delete", description: error.message, variant: "destructive" });
    },
  });

  const testMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("POST", `/api/automation-profiles/${id}/test`, {});
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/automation-profiles"] });
      if (data.success) {
        toast({ title: "Test Successful", description: data.message });
      } else {
        toast({ title: "Test Failed", description: data.error || "Webhook test failed", variant: "destructive" });
      }
    },
    onError: (error) => {
      toast({ title: "Test Failed", description: error.message, variant: "destructive" });
    },
  });

  const handleCreateProfile = () => {
    const guardrails: any = {};
    if (newProfile.maxPerDay) guardrails.maxPerDay = parseInt(newProfile.maxPerDay);
    if (newProfile.cooldownMinutes) guardrails.cooldownMinutes = parseInt(newProfile.cooldownMinutes);
    if (newProfile.minScore) guardrails.minScore = parseInt(newProfile.minScore);

    createMutation.mutate({
      name: newProfile.name.trim(),
      webhookUrl: newProfile.webhookUrl.trim(),
      apiKey: newProfile.apiKey.trim() || undefined,
      mode: newProfile.mode,
      guardrails: Object.keys(guardrails).length > 0 ? guardrails : null,
    });
  };

  const getModeColor = (mode: string) => {
    switch (mode) {
      case "AUTO": return "bg-green-500/10 text-green-600 dark:text-green-400";
      case "CONFIRM": return "bg-amber-500/10 text-amber-600 dark:text-amber-400";
      case "NOTIFY_ONLY": return "bg-blue-500/10 text-blue-600 dark:text-blue-400";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const getModeLabel = (mode: string) => {
    switch (mode) {
      case "AUTO": return "Auto-Send";
      case "CONFIRM": return "Requires Approval";
      case "NOTIFY_ONLY": return "Notify Only";
      case "OFF": return "Disabled";
      default: return mode;
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <List className="h-5 w-5" />
              Automation Profiles
            </CardTitle>
            <CardDescription>
              Create multiple webhook destinations with different guardrails
            </CardDescription>
          </div>
          <Button onClick={() => setCreateDialogOpen(true)} data-testid="button-create-profile">
            <Plus className="mr-2 h-4 w-4" />
            New Profile
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!profiles || profiles.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Bot className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No automation profiles configured</p>
            <p className="text-xs mt-1">Create a profile to connect to webhook destinations</p>
          </div>
        ) : (
          <div className="space-y-3">
            {profiles.map((profile) => (
              <div
                key={profile.id}
                className="flex items-center justify-between p-3 rounded-md bg-muted/50"
                data-testid={`profile-item-${profile.id}`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className={`p-2 rounded-md ${profile.isEnabled ? "bg-green-500/10" : "bg-muted"}`}>
                    <Zap className={`h-4 w-4 ${profile.isEnabled ? "text-green-500" : "text-muted-foreground"}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{profile.name}</span>
                      <Badge variant="outline" className={`text-xs ${getModeColor(profile.mode)}`}>
                        {getModeLabel(profile.mode)}
                      </Badge>
                      {profile.hasApiKey && (
                        <Badge variant="secondary" className="text-xs">
                          API Key
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {profile.webhookUrl}
                    </p>
                    {profile.guardrails && (
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {profile.guardrails.maxPerDay && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Target className="h-3 w-3" />
                            {profile.guardrails.maxPerDay}/day
                          </span>
                        )}
                        {profile.guardrails.cooldownMinutes && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {profile.guardrails.cooldownMinutes}m cooldown
                          </span>
                        )}
                        {profile.guardrails.minScore && (
                          <span className="text-xs text-muted-foreground">
                            Min score: {profile.guardrails.minScore}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => testMutation.mutate(profile.id)}
                    disabled={testMutation.isPending || !profile.webhookUrl}
                    title="Test webhook"
                    data-testid={`button-test-profile-${profile.id}`}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setEditingProfile(profile)}
                    title="Edit profile"
                    data-testid={`button-edit-profile-${profile.id}`}
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      if (confirm(`Delete profile "${profile.name}"?`)) {
                        deleteMutation.mutate(profile.id);
                      }
                    }}
                    title="Delete profile"
                    data-testid={`button-delete-profile-${profile.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Automation Profile</DialogTitle>
            <DialogDescription>
              Add a new webhook destination for trade signals
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="profile-name">Profile Name</Label>
              <Input
                id="profile-name"
                placeholder="e.g., My Automation"
                value={newProfile.name}
                onChange={(e) => setNewProfile({ ...newProfile, name: e.target.value })}
                data-testid="input-profile-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-webhook">Webhook URL</Label>
              <Input
                id="profile-webhook"
                type="url"
                placeholder="https://..."
                value={newProfile.webhookUrl}
                onChange={(e) => setNewProfile({ ...newProfile, webhookUrl: e.target.value })}
                data-testid="input-profile-webhook"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-apikey">API Key (optional)</Label>
              <Input
                id="profile-apikey"
                type="password"
                placeholder="Enter API key"
                value={newProfile.apiKey}
                onChange={(e) => setNewProfile({ ...newProfile, apiKey: e.target.value })}
                data-testid="input-profile-apikey"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-mode">Mode</Label>
              <Select
                value={newProfile.mode}
                onValueChange={(value: any) => setNewProfile({ ...newProfile, mode: value })}
              >
                <SelectTrigger data-testid="select-profile-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="AUTO">Auto-Send (immediate)</SelectItem>
                  <SelectItem value="CONFIRM">Requires Approval</SelectItem>
                  <SelectItem value="NOTIFY_ONLY">Notify Only (no webhook)</SelectItem>
                  <SelectItem value="OFF">Disabled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="profile-maxperday">Max/Day</Label>
                <Input
                  id="profile-maxperday"
                  type="number"
                  min="0"
                  placeholder="Unlimited"
                  value={newProfile.maxPerDay}
                  onChange={(e) => setNewProfile({ ...newProfile, maxPerDay: e.target.value })}
                  data-testid="input-profile-maxperday"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-cooldown">Cooldown (min)</Label>
                <Input
                  id="profile-cooldown"
                  type="number"
                  min="0"
                  placeholder="None"
                  value={newProfile.cooldownMinutes}
                  onChange={(e) => setNewProfile({ ...newProfile, cooldownMinutes: e.target.value })}
                  data-testid="input-profile-cooldown"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-minscore">Min Score</Label>
                <Input
                  id="profile-minscore"
                  type="number"
                  min="0"
                  max="100"
                  placeholder="0"
                  value={newProfile.minScore}
                  onChange={(e) => setNewProfile({ ...newProfile, minScore: e.target.value })}
                  data-testid="input-profile-minscore"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateProfile}
              disabled={!newProfile.name || !newProfile.webhookUrl || createMutation.isPending}
              data-testid="button-save-new-profile"
            >
              {createMutation.isPending ? "Creating..." : "Create Profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingProfile} onOpenChange={(open) => !open && setEditingProfile(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Profile</DialogTitle>
            <DialogDescription>
              Update profile settings and guardrails
            </DialogDescription>
          </DialogHeader>
          {editingProfile && (
            <EditProfileForm
              profile={editingProfile}
              onSave={(data) => updateMutation.mutate({ id: editingProfile.id, ...data })}
              onCancel={() => setEditingProfile(null)}
              isPending={updateMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function EditProfileForm({
  profile,
  onSave,
  onCancel,
  isPending,
}: {
  profile: AutomationProfileData;
  onSave: (data: any) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [name, setName] = useState(profile.name);
  const [webhookUrl, setWebhookUrl] = useState(profile.webhookUrl);
  const [apiKey, setApiKey] = useState("");
  const [mode, setMode] = useState(profile.mode);
  const [isEnabled, setIsEnabled] = useState(profile.isEnabled);
  const [maxPerDay, setMaxPerDay] = useState(profile.guardrails?.maxPerDay?.toString() || "");
  const [cooldownMinutes, setCooldownMinutes] = useState(profile.guardrails?.cooldownMinutes?.toString() || "");
  const [minScore, setMinScore] = useState(profile.guardrails?.minScore?.toString() || "");

  const handleSubmit = () => {
    const guardrails: any = {};
    if (maxPerDay) guardrails.maxPerDay = parseInt(maxPerDay);
    if (cooldownMinutes) guardrails.cooldownMinutes = parseInt(cooldownMinutes);
    if (minScore) guardrails.minScore = parseInt(minScore);

    onSave({
      name: name.trim(),
      webhookUrl: webhookUrl.trim(),
      apiKey: apiKey.trim() || undefined,
      mode,
      isEnabled,
      guardrails: Object.keys(guardrails).length > 0 ? guardrails : null,
    });
  };

  return (
    <>
      <div className="space-y-4 py-4">
        <div className="flex items-center justify-between">
          <div>
            <Label>Enabled</Label>
            <p className="text-xs text-muted-foreground">Profile is active and can receive signals</p>
          </div>
          <Switch checked={isEnabled} onCheckedChange={setIsEnabled} data-testid="switch-edit-enabled" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-name">Profile Name</Label>
          <Input
            id="edit-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="input-edit-name"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-webhook">Webhook URL</Label>
          <Input
            id="edit-webhook"
            type="url"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            data-testid="input-edit-webhook"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-apikey">
            API Key {profile.hasApiKey && <Badge variant="secondary" className="ml-2 text-xs">Configured</Badge>}
          </Label>
          <Input
            id="edit-apikey"
            type="password"
            placeholder={profile.hasApiKey ? "Enter new key to replace" : "Enter API key"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            data-testid="input-edit-apikey"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-mode">Mode</Label>
          <Select value={mode} onValueChange={(v: any) => setMode(v)}>
            <SelectTrigger data-testid="select-edit-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="AUTO">Auto-Send (immediate)</SelectItem>
              <SelectItem value="CONFIRM">Requires Approval</SelectItem>
              <SelectItem value="NOTIFY_ONLY">Notify Only</SelectItem>
              <SelectItem value="OFF">Disabled</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-4 grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="edit-maxperday">Max/Day</Label>
            <Input
              id="edit-maxperday"
              type="number"
              min="0"
              placeholder="Unlimited"
              value={maxPerDay}
              onChange={(e) => setMaxPerDay(e.target.value)}
              data-testid="input-edit-maxperday"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-cooldown">Cooldown (min)</Label>
            <Input
              id="edit-cooldown"
              type="number"
              min="0"
              placeholder="None"
              value={cooldownMinutes}
              onChange={(e) => setCooldownMinutes(e.target.value)}
              data-testid="input-edit-cooldown"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-minscore">Min Score</Label>
            <Input
              id="edit-minscore"
              type="number"
              min="0"
              max="100"
              placeholder="0"
              value={minScore}
              onChange={(e) => setMinScore(e.target.value)}
              data-testid="input-edit-minscore"
            />
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={!name || !webhookUrl || isPending} data-testid="button-save-edit-profile">
          {isPending ? "Saving..." : "Save Changes"}
        </Button>
      </DialogFooter>
    </>
  );
}

function TutorialSettings() {
  const { toast } = useToast();
  const [tutorialOpen, setTutorialOpen] = useState(false);

  const resetTutorialsMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", "/api/user/settings", {
        hasSeenWelcomeTutorial: false,
        hasSeenScannerTutorial: false,
        hasSeenVcpTutorial: false,
        hasSeenAlertsTutorial: false,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/settings"] });
      toast({
        title: "Tutorials reset",
        description: "All tutorials will appear again when you visit relevant pages",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to reset tutorials",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <>
      <Card className="mt-4">
        <CardHeader>
          <div>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              Learning Center
            </CardTitle>
            <CardDescription>
              Access tutorials and guides to master Strategy Agent
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="font-medium">Interactive Tutorials</p>
              <p className="text-sm text-muted-foreground">
                Step-by-step guides on VCP patterns and using the platform
              </p>
            </div>
            <Button 
              variant="outline" 
              onClick={() => setTutorialOpen(true)}
              className="gap-2"
              data-testid="button-open-tutorials-settings"
            >
              <BookOpen className="h-4 w-4" />
              Open Tutorials
            </Button>
          </div>
          
          <div className="flex items-center justify-between gap-4 flex-wrap border-t pt-4">
            <div>
              <p className="font-medium">Reset Tutorial Progress</p>
              <p className="text-sm text-muted-foreground">
                Show all tutorials again as if you were a new user
              </p>
            </div>
            <Button 
              variant="ghost" 
              onClick={() => resetTutorialsMutation.mutate()}
              disabled={resetTutorialsMutation.isPending}
              className="gap-2"
              data-testid="button-reset-tutorials"
            >
              <RotateCcw className="h-4 w-4" />
              {resetTutorialsMutation.isPending ? "Resetting..." : "Reset Tutorials"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <InteractiveTutorial
        isOpen={tutorialOpen}
        onClose={() => setTutorialOpen(false)}
      />
    </>
  );
}
