import { useState, useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery as useReactQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme-provider";
import { TopNav } from "@/components/top-nav";
import { LegalAcceptanceModal } from "@/components/legal-acceptance-modal";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { Footer } from "@/components/footer";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import { BrokerStatusProvider } from "@/hooks/use-broker-status";
import { TooltipVisibilityProvider } from "@/hooks/use-tooltips";
import { PersonaProvider } from "@/context/PersonaContext";
import { PlanProvider } from "@/context/PlanContext";
import { StatusBanner } from "@/components/status-banner";
import { PullToRefresh } from "@/components/pull-to-refresh";

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
import UserGuidePage from "@/pages/user-guide";
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
import AskPage from "@/pages/ask";
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
      <Route path="/ask" component={AskPage} />
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
      <Route path="/markets" component={MarketIntelPage} />
      <Route path="/history" component={JournalV2} />
      <Route path="/agent" component={AgentPage} />
      <Route path="/trade-setups" component={TradeSetupsPage} />

      <Route path="/command-center" component={CommandCenter} />
      <Route path="/discover" component={StrategyScannerPage} />
      <Route path="/automation">{() => <AdminOnly><AutomationPage /></AdminOnly>}</Route>
      <Route path="/news" component={NewsPage} />
      <Route path="/help" component={StrategyGuide} />
      <Route path="/guide" component={UserGuidePage} />
      <Route path="/guide/:section" component={UserGuidePage} />

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
  const [isEditingSetup, setIsEditingSetup] = useState(false);
  const { user } = useAuth();

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

  // Setup wizard is no longer auto-shown for new users — they go straight to the
  // dashboard. It can still be opened manually from Settings via this event.
  useEffect(() => {
    const handler = () => {
      setIsEditingSetup(!!userSettings);
      setShowOnboarding(true);
    };
    window.addEventListener("open-setup-wizard", handler);
    return () => window.removeEventListener("open-setup-wizard", handler);
  }, [userSettings]);

  useEffect(() => {
    if (legalStatus && !legalStatus.accepted) {
      setShowLegalModal(true);
    }
  }, [legalStatus]);

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
        <div className="flex flex-col min-h-screen w-full">
          <TopNav />
          <StatusBanner />
          <PullToRefresh
            onRefresh={async () => {
              await queryClient.invalidateQueries();
            }}
          >
            <main className="flex-1 w-full">
              <AppRouter />
            </main>
            <Footer />
          </PullToRefresh>
        </div>
        <LegalAcceptanceModal
          open={showLegalModal}
          onAccepted={() => setShowLegalModal(false)}
        />
        <OnboardingWizard
          open={showOnboarding}
          onComplete={() => {
            setShowOnboarding(false);
            setIsEditingSetup(false);
          }}
          onClose={() => {
            setShowOnboarding(false);
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
