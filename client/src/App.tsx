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
import { HelpAssistant } from "@/components/help-assistant";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import { BrokerStatusProvider } from "@/hooks/use-broker-status";
import { TooltipVisibilityProvider } from "@/hooks/use-tooltips";
import { PersonaProvider } from "@/context/PersonaContext";
import { PlanProvider } from "@/context/PlanContext";
import { StatusBanner, VerifyEmailBanner, CookieConsentBanner } from "@/components/status-banner";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { ErrorBoundary } from "@/components/error-boundary";

import Charts from "@/pages/charts";
import Backtest from "@/pages/backtest";
import SettingsPage from "@/pages/settings";
import AuthPage from "@/pages/auth";
import { VerifyEmailPage, ForgotPasswordPage, ResetPasswordPage } from "@/pages/account-email-actions";
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
import AdminPlatformHealthPage from "@/pages/admin-platform-health";
import AdminOperationsManualPage from "@/pages/admin-operations-manual";
import AdminEmailsPage from "@/pages/admin-emails";
import AdminSupportPage from "@/pages/admin-support";
import AdminSessionsPage from "@/pages/admin-sessions";
import AdminMarketDataPage from "@/pages/admin-market-data";
import DailyAnalysisPage from "@/pages/daily-analysis";
import AdminPositionProtectionPage from "@/pages/admin-position-protection";
import AdminAgentTestsPage from "@/pages/admin-agent-tests";
import AdminInstitutionalMappingsPage from "@/pages/admin-institutional-mappings";
import PortfolioPage from "@/pages/portfolio";
import PortfolioImportPage from "@/pages/portfolio-import";
import PortfolioImportDocumentPage from "@/pages/portfolio-import-document";
import PortfolioConnectPage from "@/pages/portfolio-connect";
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
import CommandCenterPage from "@/pages/command-center";
import StrategyScannerPage from "@/pages/strategy-scanner";
import TradeDetailPage from "@/pages/trade-detail";
import InstaTradePage from "@/pages/instatrade-page";
import ResultsPage from "@/pages/results-page";
import PricingPage from "@/pages/pricing";
import BillingSuccessPage from "@/pages/billing-success";
import BillingCancelPage from "@/pages/billing-cancel";
import AskPage from "@/pages/ask";
import CongressActivityPage from "@/pages/congress-activity";
import MarketResearchHub from "@/pages/market-research-hub";
import ResearchMonitorPage from "@/pages/research-monitor";
import ResearchReportsPage from "@/pages/research-reports";
import ResearchWorkspacePage from "@/pages/research-workspace";
import MarketResearchCommandCenterPage from "@/pages/market-research-command-center";
import GoalsPage from "@/pages/goals";
import GoalDetailPage from "@/pages/goal-detail";
import TradePlanningPage from "@/pages/trade-planning";
import TradePlansPage from "@/pages/trade-plans";
import TradePlanDetailPage from "@/pages/trade-plan-detail";
import ResearchLibraryPage from "@/pages/research-library";
import ResearchDetailPage from "@/pages/research-detail";
import OpportunityResearchPage from "@/pages/opportunity-research";
import OpportunityWorkspacePage from "@/pages/opportunity-workspace";
import OpportunityTodayPage from "@/pages/opportunity-today";
import OpportunityChangesPage from "@/pages/opportunity-changes";
import InstitutionalFundsPage from "@/pages/institutional-funds";
import InstitutionalFundDetailPage from "@/pages/institutional-fund-detail";
import IntelligencePage from "@/pages/intelligence";
import IntelligenceThemeDetailPage from "@/pages/intelligence-theme-detail";
import IntelligenceSectorDetailPage from "@/pages/intelligence-sector-detail";
import DashboardPage from "@/pages/dashboard";
import { ExecutionDetailPage } from "@/pages/executions";
import { resolveLandingPage } from "@/lib/landing-page";
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

function DefaultLanding() {
  const { data: settings, isLoading } = useReactQuery<{ defaultLandingPage?: string | null }>({
    queryKey: ["/api/user/settings"],
  });
  if (isLoading) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  // resolveLandingPage handles all coercions: null/undefined → /dashboard,
  // legacy "/home" → /dashboard, explicit pins → preserved.
  // See client/src/lib/landing-page.ts for the full rule set and tests.
  const target = resolveLandingPage(settings?.defaultLandingPage);
  return <Redirect to={target} />;
}

function AppRouter() {
  return (
    <Switch>
      {/* /dashboard is the authenticated landing page (Sprint 5.5) */}
      <Route path="/dashboard" component={DashboardPage} />
      {/* /home is the AI Command Center; kept for pinned preferences and deep links */}
      <Route path="/home" component={CommandCenterPage} />
      <Route path="/ideas" component={HomeV2} />
      <Route path="/ask" component={AskPage} />
      <Route path="/portfolio/connect" component={PortfolioConnectPage} />
      <Route path="/portfolio/import/document" component={PortfolioImportDocumentPage} />
      <Route path="/portfolio/import" component={PortfolioImportPage} />
      <Route path="/portfolio" component={PortfolioPage} />
      <Route path="/research/library" component={ResearchLibraryPage} />
      <Route path="/research/:id" component={ResearchDetailPage} />
      <Route path="/research" component={MarketResearchHub} />
      <Route path="/research-monitor" component={ResearchMonitorPage} />
      <Route path="/research-reports" component={ResearchReportsPage} />
      <Route path="/research-workspace" component={ResearchWorkspacePage} />
      {/* Goals — static /goals/new before dynamic /goals/:id */}
      <Route path="/goals/new">{() => <GoalsPage />}</Route>
      <Route path="/goals/:id" component={GoalDetailPage} />
      <Route path="/goals" component={GoalsPage} />
      {/* Trade Planning — static /history guard before dynamic /:symbol */}
      <Route path="/trade-planning/history">{() => <TradePlanningPage />}</Route>
      <Route path="/trade-planning/:symbol" component={TradePlanningPage} />
      {/* Trade Plans — static list before dynamic /:id (route regression rule) */}
      <Route path="/trade-plans" component={TradePlansPage} />
      <Route path="/trade-plans/:id" component={TradePlanDetailPage} />
      <Route path="/market-research-command-center" component={MarketResearchCommandCenterPage} />
      <Route path="/opportunity/:symbol" component={OpportunityResearchPage} />
      {/* Static /opportunities/* routes MUST come before the dynamic /:symbol route.
          Without explicit ordering, Wouter matches /opportunities/today → symbol="today" */}
      <Route path="/opportunities/today" component={OpportunityTodayPage} />
      <Route path="/opportunities/changes" component={OpportunityChangesPage} />
      <Route path="/opportunities/:symbol" component={OpportunityWorkspacePage} />
      <Route path="/institutional/funds" component={InstitutionalFundsPage} />
      <Route path="/institutional/funds/:managerId" component={InstitutionalFundDetailPage} />
      <Route path="/intelligence" component={IntelligencePage} />
      <Route path="/intelligence/themes/:themeId" component={IntelligenceThemeDetailPage} />
      <Route path="/intelligence/sectors/:sector" component={IntelligenceSectorDetailPage} />
      <Route path="/scanner" component={StrategyScannerPage} />
      <Route path="/trade/:ticker" component={TradeDetailPage} />
      <Route path="/instatrade" component={InstaTradePage} />
      <Route path="/results" component={ResultsPage} />
      <Route path="/goal-mode" component={GoalModePage} />
      <Route path="/opportunity-radar" component={OpportunityRadarPage} />
      <Route path="/trade-finder" component={AgentPage} />
      <Route path="/income-mode" component={IncomeModePage} />
      <Route path="/market-intel" component={MarketIntelPage} />
      <Route path="/markets/congress-activity/politician/:slug" component={CongressActivityPage} />
      <Route path="/markets/congress-activity" component={CongressActivityPage} />
      <Route path="/markets" component={MarketIntelPage} />
      <Route path="/journal">
        <Redirect to="/history" />
      </Route>
      <Route path="/history" component={HistoryPage} />
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

      <Route path="/" component={DefaultLanding} />
      <Route path="/signals">{() => <Redirect to="/scanner" />}</Route>
      <Route path="/watchlists">{() => <Redirect to="/scanner" />}</Route>
      <Route path="/app/stocks">{() => <Redirect to="/scanner" />}</Route>
      <Route path="/app/options">{() => <Redirect to="/scanner" />}</Route>
      <Route path="/strategies">{() => <Redirect to="/home" />}</Route>
      <Route path="/my-strategies">{() => <Redirect to="/home" />}</Route>
      <Route path="/broker-connections">{() => <Redirect to="/settings" />}</Route>
      <Route path="/activity">{() => <Redirect to="/home" />}</Route>
      <Route path="/executions/:id" component={ExecutionDetailPage} />
      <Route path="/execution">{() => <AdminOnly><Redirect to="/automation?view=cockpit" /></AdminOnly>}</Route>
      <Route path="/opportunities">{() => <AdminOnly><Redirect to="/automation?view=outcomes" /></AdminOnly>}</Route>
      <Route path="/alerts" component={AlertsPage} />
      <Route path="/trade-alerts" component={TradeAlertsPage} />
      <Route path="/admin">{() => <AdminOnly><AdminHomePage /></AdminOnly>}</Route>
      <Route path="/admin/partners">{() => <AdminOnly><AdminPartnersPage /></AdminOnly>}</Route>
      <Route path="/admin/disclaimer-logs">{() => <AdminOnly><AdminDisclaimerLogs /></AdminOnly>}</Route>
      <Route path="/admin/users">{() => <AdminOnly><AdminUsersPage /></AdminOnly>}</Route>
      <Route path="/admin/emails">{() => <AdminOnly><AdminEmailsPage /></AdminOnly>}</Route>
      <Route path="/admin/support">{() => <AdminOnly><AdminSupportPage /></AdminOnly>}</Route>
      <Route path="/admin/sessions">{() => <AdminOnly><AdminSessionsPage /></AdminOnly>}</Route>
      <Route path="/admin/market-data">{() => <AdminOnly><AdminMarketDataPage /></AdminOnly>}</Route>
      <Route path="/daily-analysis" component={DailyAnalysisPage} />
      <Route path="/admin/position-protection">{() => <AdminOnly><AdminPositionProtectionPage /></AdminOnly>}</Route>
      <Route path="/admin/agent-tests">{() => <AdminOnly><AdminAgentTestsPage /></AdminOnly>}</Route>
      <Route path="/admin/institutional-mappings">{() => <AdminOnly><AdminInstitutionalMappingsPage /></AdminOnly>}</Route>
      <Route path="/admin/platform-health">{() => <AdminOnly><AdminPlatformHealthPage /></AdminOnly>}</Route>
      <Route path="/admin/operations-manual">{() => <AdminOnly><AdminOperationsManualPage /></AdminOnly>}</Route>
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

function RouteErrorBoundary() {
  const [location] = useLocation();
  return (
    <ErrorBoundary key={location}>
      <AppRouter />
    </ErrorBoundary>
  );
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
          <VerifyEmailBanner />
          <StatusBanner />
          <PullToRefresh
            onRefresh={async () => {
              await queryClient.invalidateQueries();
            }}
          >
            <main className="flex-1 w-full">
              <RouteErrorBoundary />
            </main>
            <Footer />
          </PullToRefresh>
        </div>
        <HelpAssistant />
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
  if (location === "/verify-email") return <VerifyEmailPage />;
  if (location === "/forgot-password") return <ForgotPasswordPage />;
  if (location === "/reset-password") return <ResetPasswordPage />;
  
  return null;
}

function AuthenticatedApp() {
  const { isAuthenticated, isLoading } = useAuth();
  const [location] = useLocation();

  const isPartnerRoute = location.startsWith("/partner");
  if (isPartnerRoute) {
    return <PartnerDashboard />;
  }

  const publicRoutes = ["/", "/terms", "/disclaimer", "/privacy", "/open-source", "/auth", "/verify-email", "/forgot-password", "/reset-password"];
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
            <CookieConsentBanner />
            <Toaster />
          </TooltipProvider>
        </TooltipVisibilityProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
