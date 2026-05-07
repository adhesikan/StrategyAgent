import { useState, useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery as useReactQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { AppSidebar } from "@/components/app-sidebar";
import { LegalAcceptanceModal } from "@/components/legal-acceptance-modal";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { Footer } from "@/components/footer";
import {
  SidebarProvider,
  SidebarTrigger,
  SidebarInset,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut, User, Loader2, Bell, HelpCircle } from "lucide-react";
import { BrokerStatusProvider } from "@/hooks/use-broker-status";
import { TooltipVisibilityProvider } from "@/hooks/use-tooltips";
import { PersonaProvider, usePersona } from "@/context/PersonaContext";
import { PlanProvider } from "@/context/PlanContext";
import { PersonaSelector } from "@/components/persona-selector";
import { PlanSelector } from "@/components/plan-selector";
import { StatusBanner } from "@/components/status-banner";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import type { AlertEvent } from "@shared/schema";

import Charts from "@/pages/charts";
import Backtest from "@/pages/backtest";
import SettingsPage from "@/pages/settings";
import AuthPage from "@/pages/auth";
import HomePage from "@/pages/home";
import TermsPage from "@/pages/terms";
import DisclaimerPage from "@/pages/disclaimer";
import PrivacyPage from "@/pages/privacy";
import OpenSourcePage from "@/pages/open-source";
import StrategyGuide from "@/pages/strategy-guide";
import AutomationPage from "@/pages/automation";
import AlertsPage from "@/pages/alerts";
import SnaptradeCallback from "@/pages/snaptrade-callback";
import NewsPage from "@/pages/news";
import CommandCenter from "@/pages/command-center";
import DiscoverPage from "@/pages/discover";
import RiskProfilePage from "@/pages/risk-profile";
import UniversesPage from "@/pages/universes";
import TradeAlertsPage from "@/pages/trade-alerts";
import PartnerDashboard from "@/pages/partner-dashboard";
import AdminPartnersPage from "@/pages/admin-partners";
import AdminDisclaimerLogs from "@/pages/admin-disclaimer-logs";
import AdminUsersPage from "@/pages/admin-users";
import AdminHomePage from "@/pages/admin-home";
import AdminEmailsPage from "@/pages/admin-emails";
import AdminSessionsPage from "@/pages/admin-sessions";
import NotFound from "@/pages/not-found";
import AgentPage from "@/pages/agent";
import TradeSetupsPage from "@/pages/trade-setups";
import HomeDashboard from "@/pages/home-dashboard";
import GoalModePage from "@/pages/goal-mode";
import IncomeModePage from "@/pages/income-mode";
import MarketIntelPage from "@/pages/market-intel";
import HistoryPage from "@/pages/history";
import OpportunityRadarPage from "@/pages/opportunity-radar";
import HomeV2 from "@/pages/home-v2";
import StrategyScannerPage from "@/pages/strategy-scanner";
import TradeDetailPage from "@/pages/trade-detail";
import InstaTradePage from "@/pages/instatrade-page";
import JournalV2 from "@/pages/journal-v2";
import ResultsPage from "@/pages/results-page";
import PricingPage from "@/pages/pricing";
import BillingSuccessPage from "@/pages/billing-success";
import BillingCancelPage from "@/pages/billing-cancel";
import { Redirect } from "wouter";

function AdminOnly({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (user?.role !== "admin") {
    return <Redirect to="/home" />;
  }
  return <>{children}</>;
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/home" component={HomeV2} />
      <Route path="/scanner" component={StrategyScannerPage} />
      <Route path="/trade/:ticker" component={TradeDetailPage} />
      <Route path="/instatrade" component={InstaTradePage} />
      <Route path="/journal" component={JournalV2} />
      <Route path="/results" component={ResultsPage} />
      <Route path="/goal-mode" component={GoalModePage} />
      <Route path="/opportunity-radar" component={OpportunityRadarPage} />
      <Route path="/trade-finder" component={AgentPage} />
      <Route path="/income-mode" component={IncomeModePage} />
      <Route path="/market-intel" component={MarketIntelPage} />
      <Route path="/history" component={JournalV2} />
      <Route path="/agent" component={AgentPage} />
      <Route path="/trade-setups" component={TradeSetupsPage} />

      <Route path="/command-center" component={CommandCenter} />
      <Route path="/discover" component={StrategyScannerPage} />
      <Route path="/automation">{() => <AdminOnly><AutomationPage /></AdminOnly>}</Route>
      <Route path="/news" component={NewsPage} />
      <Route path="/help" component={StrategyGuide} />

      <Route path="/settings/risk-profile" component={RiskProfilePage} />
      <Route path="/settings/universes" component={UniversesPage} />
      <Route path="/settings" component={SettingsPage} />

      <Route path="/charts" component={Charts} />
      <Route path="/charts/:ticker" component={Charts} />
      <Route path="/backtest" component={Backtest} />

      <Route path="/terms" component={TermsPage} />
      <Route path="/disclaimer" component={DisclaimerPage} />
      <Route path="/privacy" component={PrivacyPage} />
      <Route path="/open-source" component={OpenSourcePage} />
      <Route path="/snaptrade/callback" component={SnaptradeCallback} />

      <Route path="/pricing" component={PricingPage} />
      <Route path="/billing/success" component={BillingSuccessPage} />
      <Route path="/billing/cancel" component={BillingCancelPage} />

      <Route path="/">{() => <Redirect to="/home" />}</Route>
      <Route path="/signals">{() => <Redirect to="/scanner" />}</Route>
      <Route path="/watchlists">{() => <Redirect to="/scanner" />}</Route>
      <Route path="/app/stocks">{() => <Redirect to="/scanner" />}</Route>
      <Route path="/app/options">{() => <Redirect to="/scanner" />}</Route>
      <Route path="/strategies">{() => <Redirect to="/home" />}</Route>
      <Route path="/my-strategies">{() => <Redirect to="/home" />}</Route>
      <Route path="/broker-connections">{() => <Redirect to="/settings" />}</Route>
      <Route path="/activity">{() => <Redirect to="/home" />}</Route>
      <Route path="/execution">{() => <AdminOnly><Redirect to="/automation?view=cockpit" /></AdminOnly>}</Route>
      <Route path="/opportunities">{() => <AdminOnly><Redirect to="/automation?view=outcomes" /></AdminOnly>}</Route>
      <Route path="/alerts" component={AlertsPage} />
      <Route path="/trade-alerts" component={TradeAlertsPage} />
      <Route path="/admin">{() => <AdminOnly><AdminHomePage /></AdminOnly>}</Route>
      <Route path="/admin/partners">{() => <AdminOnly><AdminPartnersPage /></AdminOnly>}</Route>
      <Route path="/admin/disclaimer-logs">{() => <AdminOnly><AdminDisclaimerLogs /></AdminOnly>}</Route>
      <Route path="/admin/users">{() => <AdminOnly><AdminUsersPage /></AdminOnly>}</Route>
      <Route path="/admin/emails">{() => <AdminOnly><AdminEmailsPage /></AdminOnly>}</Route>
      <Route path="/admin/sessions">{() => <AdminOnly><AdminSessionsPage /></AdminOnly>}</Route>
      <Route path="/app/automation">{() => <AdminOnly><Redirect to="/automation" /></AdminOnly>}</Route>
      <Route path="/learn/news">{() => <Redirect to="/news" />}</Route>
      <Route path="/strategy-guide">{() => <Redirect to="/help" />}</Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function UserMenu() {
  const { user, logout, isLoggingOut } = useAuth();
  
  if (!user) return null;
  
  const initials = [user.firstName?.[0], user.lastName?.[0]]
    .filter(Boolean)
    .join("")
    .toUpperCase() || user.email?.[0]?.toUpperCase() || "U";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" data-testid="button-user-menu">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5">
          <p className="text-sm font-medium" data-testid="text-user-email">{user.email}</p>
          <p className="text-xs text-muted-foreground">
            {user.role === "admin" ? "Administrator" : "Member"}
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href="/settings" className="flex items-center gap-2">
            <User className="h-4 w-4" />
            Settings
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem 
          onClick={() => logout()} 
          disabled={isLoggingOut}
          data-testid="button-logout"
        >
          {isLoggingOut ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <LogOut className="mr-2 h-4 w-4" />
          )}
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AlertBell() {
  const { data: alertEvents } = useReactQuery<AlertEvent[]>({
    queryKey: ["/api/alert-events"],
    refetchInterval: 30000,
  });

  const unreadCount = alertEvents?.filter(e => !e.isRead).length || 0;

  return (
    <Link href="/alerts?tab=history" data-testid="link-alerts-bell">
      <Button 
        variant="ghost" 
        size="icon" 
        className="relative"
        data-testid="button-alert-bell"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span 
            className="absolute -top-1 -right-1 h-4 min-w-4 rounded-full bg-destructive text-destructive-foreground text-xs font-medium flex items-center justify-center px-1"
            data-testid="badge-unread-alerts"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Button>
    </Link>
  );
}

function AppHeader() {
  return (
    <header className="sticky top-0 z-50 flex h-14 items-center justify-between gap-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4">
      <div className="flex items-center gap-4">
        <SidebarTrigger data-testid="button-sidebar-toggle" />
      </div>
      <div className="flex items-center gap-2">
        <AlertBell />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}

interface LegalStatus {
  accepted: boolean;
  currentVersion: string;
  acceptedVersion: string | null;
  acceptedAt: string | null;
}

function AppLayout() {
  return (
    <PlanProvider>
      <PersonaProvider>
        <AppLayoutInner />
      </PersonaProvider>
    </PlanProvider>
  );
}

function AppLayoutInner() {
  const [showLegalModal, setShowLegalModal] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [isEditingSetup, setIsEditingSetup] = useState(false);
  const [showPersonaSelector, setShowPersonaSelector] = useState(false);
  const [showPlanSelector, setShowPlanSelector] = useState(false);
  const [planSelectorDismissed, setPlanSelectorDismissed] = useState(false);
  const { user } = useAuth();
  const { persona, isLoading: personaLoading } = usePersona();
  
  const { data: legalStatus, isLoading: legalLoading } = useReactQuery<LegalStatus>({
    queryKey: ["/api/auth/legal-status"],
    enabled: !!user,
  });

  const { data: userSettings } = useReactQuery<{
    setupCompleted: boolean;
    traderType?: string;
    automationMode?: string;
    safetyLimits?: {
      maxTradesPerDay?: number;
      maxPositions?: number;
      riskPerTradeUsd?: number;
      maxDailyLossUsd?: number;
    };
    positionSizingMethod?: string;
    positionSizingValue?: number;
  }>({
    queryKey: ["/api/user/settings"],
    enabled: !!user,
  });

  useEffect(() => {
    const handler = () => {
      if (userSettings) {
        setIsEditingSetup(true);
        setShowOnboarding(true);
      }
    };
    window.addEventListener("open-setup-wizard", handler);
    return () => window.removeEventListener("open-setup-wizard", handler);
  }, [userSettings]);

  useEffect(() => {
    if (legalStatus && !legalStatus.accepted) {
      setShowLegalModal(true);
    }
  }, [legalStatus]);

  // Step 2: persona selection (required, blocks rest of onboarding)
  useEffect(() => {
    if (
      legalStatus?.accepted &&
      !showLegalModal &&
      !personaLoading &&
      persona === null &&
      user
    ) {
      setShowPersonaSelector(true);
    } else if (persona !== null) {
      setShowPersonaSelector(false);
    }
  }, [legalStatus, showLegalModal, persona, personaLoading, user]);

  // Step 3: plan selector (one-time, dismissible)
  useEffect(() => {
    if (
      legalStatus?.accepted &&
      !showLegalModal &&
      !showPersonaSelector &&
      persona !== null &&
      !planSelectorDismissed
    ) {
      let alreadySeen = false;
      try {
        alreadySeen = localStorage.getItem("plan_selector_seen") === "1";
      } catch {}
      if (!alreadySeen) {
        setShowPlanSelector(true);
      } else {
        setPlanSelectorDismissed(true);
      }
    }
  }, [legalStatus, showLegalModal, showPersonaSelector, persona, planSelectorDismissed]);

  // Step 4: existing setup wizard (only after persona + plan steps clear)
  useEffect(() => {
    if (
      userSettings &&
      !userSettings.setupCompleted &&
      legalStatus?.accepted &&
      !showLegalModal &&
      !showPersonaSelector &&
      !showPlanSelector &&
      !onboardingDismissed
    ) {
      setShowOnboarding(true);
    }
  }, [userSettings, legalStatus, showLegalModal, showPersonaSelector, showPlanSelector, onboardingDismissed]);

  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "4.5rem",
  } as React.CSSProperties;

  if (legalLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <BrokerStatusProvider>
        <SidebarProvider style={sidebarStyle} defaultOpen={false}>
          <div className="flex h-screen w-full">
            <AppSidebar />
            <SidebarInset className="flex flex-col flex-1 min-w-0 pb-16 md:pb-0">
              <AppHeader />
              <StatusBanner />
              <PullToRefresh
                onRefresh={async () => {
                  await queryClient.invalidateQueries();
                }}
              >
                <AppRouter />
                <Footer />
              </PullToRefresh>
            </SidebarInset>
            <MobileBottomNav />
          </div>
        </SidebarProvider>
        <LegalAcceptanceModal
          open={showLegalModal}
          onAccepted={() => setShowLegalModal(false)}
        />
        <PersonaSelector
          open={showPersonaSelector}
          onComplete={() => setShowPersonaSelector(false)}
        />
        <PlanSelector
          open={showPlanSelector}
          onComplete={() => {
            setShowPlanSelector(false);
            setPlanSelectorDismissed(true);
          }}
        />
        <OnboardingWizard
          open={showOnboarding}
          onComplete={() => {
            setShowOnboarding(false);
            setOnboardingDismissed(true);
            setIsEditingSetup(false);
          }}
          onClose={() => {
            setShowOnboarding(false);
            setOnboardingDismissed(true);
            setIsEditingSetup(false);
          }}
          isEditing={isEditingSetup}
          savedSettings={isEditingSetup ? {
            traderType: userSettings?.traderType,
            automationMode: userSettings?.automationMode,
            safetyLimits: userSettings?.safetyLimits,
            positionSizingMethod: userSettings?.positionSizingMethod,
            positionSizingValue: userSettings?.positionSizingValue,
          } : undefined}
        />
      </BrokerStatusProvider>
    </>
  );
}

function PublicRoutes() {
  const [location] = useLocation();
  
  if (location === "/") return <HomePage />;
  if (location === "/terms") return <TermsPage />;
  if (location === "/disclaimer") return <DisclaimerPage />;
  if (location === "/privacy") return <PrivacyPage />;
  if (location === "/open-source") return <OpenSourcePage />;
  if (location === "/auth") return <AuthPage />;
  
  return null;
}

function AuthenticatedApp() {
  const { isAuthenticated, isLoading } = useAuth();
  const [location] = useLocation();

  const isPartnerRoute = location.startsWith("/partner");
  if (isPartnerRoute) {
    return <PartnerDashboard />;
  }

  const publicRoutes = ["/", "/terms", "/disclaimer", "/privacy", "/open-source", "/auth"];
  const isPublicRoute = publicRoutes.includes(location);
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isPublicRoute && !isAuthenticated) {
    return <PublicRoutes />;
  }

  if (!isAuthenticated) {
    return <AuthPage />;
  }

  return <AppLayout />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipVisibilityProvider>
          <TooltipProvider>
            <AuthenticatedApp />
            <Toaster />
          </TooltipProvider>
        </TooltipVisibilityProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
