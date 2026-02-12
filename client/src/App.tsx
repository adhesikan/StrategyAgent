import { useState, useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery as useReactQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { AppSidebar } from "@/components/app-sidebar";
import { SmartPanel } from "@/components/smart-panel";
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
import { StatusBanner } from "@/components/status-banner";
import { PullToRefresh } from "@/components/pull-to-refresh";
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
import SnaptradeCallback from "@/pages/snaptrade-callback";
import NewsPage from "@/pages/news";
import CommandCenter from "@/pages/command-center";
import DiscoverPage from "@/pages/discover";
import RiskProfilePage from "@/pages/risk-profile";
import UniversesPage from "@/pages/universes";
import NotFound from "@/pages/not-found";
import { Redirect } from "wouter";

function AppRouter() {
  return (
    <Switch>
      <Route path="/command-center" component={CommandCenter} />
      <Route path="/discover" component={DiscoverPage} />
      <Route path="/automation" component={AutomationPage} />
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

      <Route path="/">{() => <Redirect to="/discover" />}</Route>
      <Route path="/scanner">{() => <Redirect to="/discover?tab=stocks" />}</Route>
      <Route path="/signals">{() => <Redirect to="/discover?tab=stocks" />}</Route>
      <Route path="/watchlists">{() => <Redirect to="/discover?tab=stocks" />}</Route>
      <Route path="/app/stocks">{() => <Redirect to="/discover?tab=stocks" />}</Route>
      <Route path="/app/options">{() => <Redirect to="/discover?tab=options" />}</Route>
      <Route path="/execution">{() => <Redirect to="/automation?view=cockpit" />}</Route>
      <Route path="/opportunities">{() => <Redirect to="/automation?view=outcomes" />}</Route>
      <Route path="/alerts">{() => <Redirect to="/automation?view=alerts" />}</Route>
      <Route path="/app/automation">{() => <Redirect to="/automation" />}</Route>
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
        <Link href="/help" data-testid="link-help">
          <Button variant="ghost" size="icon" data-testid="button-help">
            <HelpCircle className="h-5 w-5" />
          </Button>
        </Link>
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
  const [showLegalModal, setShowLegalModal] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const { user } = useAuth();
  
  const { data: legalStatus, isLoading: legalLoading } = useReactQuery<LegalStatus>({
    queryKey: ["/api/auth/legal-status"],
    enabled: !!user,
  });

  const { data: userSettings } = useReactQuery<{ setupCompleted: boolean }>({
    queryKey: ["/api/user/settings"],
    enabled: !!user,
  });

  useEffect(() => {
    if (legalStatus && !legalStatus.accepted) {
      setShowLegalModal(true);
    }
  }, [legalStatus]);

  useEffect(() => {
    if (userSettings && !userSettings.setupCompleted && legalStatus?.accepted && !showLegalModal && !onboardingDismissed) {
      setShowOnboarding(true);
    }
  }, [userSettings, legalStatus, showLegalModal, onboardingDismissed]);

  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
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
        <SidebarProvider style={sidebarStyle}>
          <div className="flex h-screen w-full">
            <AppSidebar />
            <SmartPanel />
            <SidebarInset className="flex flex-col flex-1 min-w-0">
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
          </div>
        </SidebarProvider>
      </BrokerStatusProvider>
      <LegalAcceptanceModal
        open={showLegalModal}
        onAccepted={() => setShowLegalModal(false)}
      />
      <OnboardingWizard
        open={showOnboarding}
        onComplete={() => {
          setShowOnboarding(false);
          setOnboardingDismissed(true);
        }}
        onClose={() => {
          setShowOnboarding(false);
          setOnboardingDismissed(true);
        }}
      />
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
