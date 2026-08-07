import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Bot,
  Bell,
  Link2,
  Check,
  ArrowRight,
  Menu,
  X,
  Sparkles,
  Brain,
  BookOpen,
  Zap,
  TrendingUp,
  MessageSquare,
  Layers,
  ShieldCheck,
  Award,
  Activity,
  ShieldAlert,
  Gauge,
  PieChart,
  Search,
  Wallet,
  Repeat,
  Lock,
  Info,
  BarChart2,
  DollarSign,
  Eye,
  Filter,
  Globe,
  Briefcase,
} from "lucide-react";
import { useBranding } from "@/hooks/use-branding";
import { usePricing } from "@/hooks/use-pricing";
import logoUrl from "@assets/ChatGPT_Image_Jan_1,_2026,_01_38_07_PM_1767292703801.png";
import { useEffect, useState } from "react";
import { track } from "@/lib/analytics";
import { MarketingOnboardingWizard } from "@/components/marketing-onboarding-wizard";

/* -----------------------------------------------------------
 * SHARED MOCK PANEL
 * --------------------------------------------------------- */
function MockPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="border-primary/20 shadow-lg bg-card/95">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
          <Badge variant="secondary" className="text-[10px]">Example</Badge>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/* -----------------------------------------------------------
 * NAV
 * --------------------------------------------------------- */
function NavBar({ onStartTrial }: { onStartTrial: () => void }) {
  const { isAuthenticated } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { instaTradeName } = useBranding();

  const navLinks = [
    { href: "#goals", label: "Product" },
    { href: "#how-it-works", label: "How It Works" },
    { href: "#planning", label: "Stocks & Options" },
    { href: "#broker", label: instaTradeName },
    { href: "#pricing", label: "Pricing" },
    { href: "#faq", label: "FAQ" },
  ];

  return (
    <nav className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-4">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2">
              <img src={logoUrl} alt="VCP Trader AI" className="h-8 w-auto" data-testid="img-logo" />
              <span className="font-semibold text-lg hidden sm:inline">VCP Trader AI</span>
            </Link>
            <div className="hidden md:flex items-center gap-5">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                  data-testid={`link-nav-${link.label.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <div className="hidden sm:flex items-center gap-3">
              {isAuthenticated ? (
                <Link href="/home">
                  <Button data-testid="button-go-to-dashboard">Go to Dashboard</Button>
                </Link>
              ) : (
                <>
                  <Link href="/auth">
                    <Button variant="ghost" data-testid="button-login">Login</Button>
                  </Link>
                  <Button
                    onClick={() => {
                      track("start_free_trial_clicked", { location: "nav" });
                      onStartTrial();
                    }}
                    data-testid="button-start-trial"
                  >
                    Start Free Trial
                  </Button>
                </>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              data-testid="button-mobile-menu"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>
        {mobileMenuOpen && (
          <div className="md:hidden py-4 border-t">
            <div className="flex flex-col gap-3">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors py-2"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {link.label}
                </a>
              ))}
              <div className="flex flex-col gap-2 pt-4 border-t">
                {isAuthenticated ? (
                  <Link href="/home">
                    <Button className="w-full" data-testid="button-go-to-dashboard-mobile">Go to Dashboard</Button>
                  </Link>
                ) : (
                  <>
                    <Link href="/auth">
                      <Button variant="outline" className="w-full" data-testid="button-login-mobile">Login</Button>
                    </Link>
                    <Button
                      className="w-full"
                      onClick={() => {
                        track("start_free_trial_clicked", { location: "mobile_nav" });
                        setMobileMenuOpen(false);
                        onStartTrial();
                      }}
                      data-testid="button-start-trial-mobile"
                    >
                      Start Free Trial
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}

/* -----------------------------------------------------------
 * HERO PRODUCT VISUAL — AI Trading Workspace mockup
 * --------------------------------------------------------- */
function WorkspaceMockCard() {
  return (
    <div className="relative" aria-hidden>
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-primary/20 via-primary/5 to-transparent blur-2xl" />
      <Card className="border-primary/30 shadow-xl bg-card/95 backdrop-blur">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <Badge variant="outline" className="text-[11px] bg-background">
              <Sparkles className="h-3 w-3 mr-1" />
              AI Trading Workspace
            </Badge>
            <Badge variant="secondary" className="text-[11px]">MU · Qualified Opportunity</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Opportunity Thesis */}
          <div className="rounded-md border bg-background p-2.5 space-y-1">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Opportunity Thesis</p>
            <p className="text-xs">Memory technology company with improving demand cycle, constructive technical structure, and confirmed breakout entry conditions.</p>
          </div>

          {/* Evidence Summary */}
          <div className="space-y-1.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Evidence Summary</p>
            {[
              { label: "Technical", score: 84, w: "84%" },
              { label: "Market context", score: 73, w: "73%" },
              { label: "News & catalyst", score: 61, w: "61%" },
            ].map((e) => (
              <div key={e.label} className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground w-24 shrink-0">{e.label}</span>
                <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: e.w }} />
                </div>
                <span className="font-semibold w-5 text-right">{e.score}</span>
              </div>
            ))}
          </div>

          {/* Structure */}
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-md border bg-background p-2">
              <p className="text-[10px] text-muted-foreground uppercase">Entry zone</p>
              <p className="font-semibold">Illustrative</p>
            </div>
            <div className="rounded-md border bg-background p-2">
              <p className="text-[10px] text-muted-foreground uppercase">Risk ref.</p>
              <p className="font-semibold">Illustrative</p>
            </div>
            <div className="rounded-md border bg-background p-2">
              <p className="text-[10px] text-muted-foreground uppercase">Objective</p>
              <p className="font-semibold">Illustrative</p>
            </div>
          </div>

          {/* Top Risk + Broker state */}
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-400">
            <ShieldAlert className="h-3 w-3 inline mr-1" />
            Top Risk: Earnings event overlap — verify timing before entry
          </div>
          <div className="rounded-md border border-primary/20 bg-primary/5 p-2 text-xs text-primary flex items-center gap-1.5">
            <Link2 className="h-3 w-3 shrink-0" />
            Contract Verification — Connect a supported broker to resolve live expirations and strikes
          </div>

          <Button className="w-full" size="sm" data-testid="button-mock-execute">
            <Zap className="h-4 w-4 mr-1.5" />
            Prepare with InstaTrade™
          </Button>

          <p className="text-[10px] text-muted-foreground border-t pt-2 flex items-center gap-1">
            <Activity className="h-3 w-3" />
            Illustrative example — not a live recommendation
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/* -----------------------------------------------------------
 * 1. HERO
 * --------------------------------------------------------- */
function HeroSection({ onStartTrial }: { onStartTrial: () => void }) {
  const trustBadges = [
    "Deterministic Opportunity Screening",
    "AI Trading Workspace",
    "Stock & Options Planning",
    "Broker-Connected Verification",
    "User-Controlled Review",
  ];

  return (
    <section className="relative overflow-hidden" data-testid="section-hero">
      <div
        className="absolute inset-0 -z-10 opacity-40 dark:opacity-30"
        aria-hidden
        style={{
          backgroundImage:
            "linear-gradient(to right, hsl(var(--border)) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--border)) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage:
            "radial-gradient(ellipse 80% 50% at 50% 0%, black 40%, transparent 100%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 80% 50% at 50% 0%, black 40%, transparent 100%)",
        }}
      />
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16 md:py-24">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div className="text-center lg:text-left">
            <Badge variant="outline" className="mb-6 text-xs py-1 px-3 border-primary/30 bg-primary/5 text-primary">
              <Bot className="h-3 w-3 mr-1" />
              AI-Powered Opportunity Intelligence for Self-Directed Traders
            </Badge>
            <h1
              className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight"
              data-testid="text-hero-headline"
            >
              Find, Evaluate, and Plan{" "}
              <span className="text-primary">Stock &amp; Options Opportunities</span>
            </h1>
            <p
              className="mt-6 text-lg md:text-xl text-muted-foreground max-w-xl mx-auto lg:mx-0"
              data-testid="text-hero-subheadline"
            >
              Discover qualified setups, understand the evidence and risks, compare stock and
              options structures, verify live contracts through supported brokerages, and prepare
              trades for review with InstaTrade™.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-center lg:items-start justify-center lg:justify-start gap-3">
              <Button
                size="lg"
                onClick={() => {
                  track("start_free_trial_clicked", { location: "hero" });
                  onStartTrial();
                }}
                data-testid="button-hero-trial"
              >
                Start Free Trial
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => {
                  track("see_how_it_works_clicked", { location: "hero" });
                  document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" });
                }}
                data-testid="button-hero-how-it-works"
              >
                <Repeat className="mr-2 h-4 w-4" />
                See How It Works
              </Button>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-center lg:justify-start gap-2">
              {trustBadges.map((b, i) => (
                <Badge
                  key={b}
                  variant="secondary"
                  className="text-[11px]"
                  data-testid={`badge-trust-${i}`}
                >
                  <Check className="h-3 w-3 mr-1" />
                  {b}
                </Badge>
              ))}
            </div>
            <p className="mt-4 text-[11px] text-muted-foreground/80">
              Powered by Sunfish Technologies LLC
            </p>
          </div>
          <div className="lg:pl-6">
            <WorkspaceMockCard />
          </div>
        </div>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------
 * 2. CHOOSE YOUR GOAL
 * --------------------------------------------------------- */
function ChooseYourGoalSection({ onStartTrial }: { onStartTrial: () => void }) {
  const goals = [
    {
      icon: TrendingUp,
      title: "Grow Long-Term Wealth",
      description:
        "Research companies with durable growth drivers, improving fundamentals, favorable long-term trends, and clearer entry conditions.",
      items: [
        "Long-term market opportunities",
        "Growth and earnings context",
        "Valuation context",
        "Thesis monitoring",
        "Portfolio concentration awareness",
      ],
      cta: "Explore Growth Research",
      testId: "card-goal-grow",
      color: "border-emerald-500/30 bg-emerald-500/5",
      iconColor: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
    },
    {
      icon: DollarSign,
      title: "Generate Income",
      description:
        "Evaluate covered calls, cash-secured puts, credit spreads, dividend opportunities, and defined-risk income structures.",
      items: [
        "Covered calls",
        "Cash-secured puts",
        "Credit spreads",
        "Dividend and income research",
        "Capital and risk requirements",
      ],
      cta: "Explore Income Research",
      testId: "card-goal-income",
      color: "border-sky-500/30 bg-sky-500/5",
      iconColor: "text-sky-600 dark:text-sky-400 bg-sky-500/10",
    },
    {
      icon: Zap,
      title: "Find Trade Setups",
      description:
        "Discover breakouts, pullbacks, momentum candidates, swing opportunities, and defined-risk options structures.",
      items: [
        "Breakout and pullback setups",
        "Momentum and swing candidates",
        "Trigger and freshness context",
        "Defined-risk options structures",
        "Invalidation and risk levels",
      ],
      cta: "Explore Trade Setups",
      testId: "card-goal-trade",
      color: "border-primary/30 bg-primary/5",
      iconColor: "text-primary bg-primary/10",
    },
    {
      icon: Globe,
      title: "Understand Markets",
      description:
        "Follow market regime, sector strength, sentiment, volatility, earnings, and the risks shaping current opportunities.",
      items: [
        "Market regime",
        "Sector strength",
        "News and sentiment",
        "Earnings and catalysts",
        "Market-risk observations",
      ],
      cta: "View Market Intelligence",
      testId: "card-goal-markets",
      color: "border-amber-500/30 bg-amber-500/5",
      iconColor: "text-amber-600 dark:text-amber-400 bg-amber-500/10",
    },
  ];

  return (
    <section className="py-16 md:py-24 bg-muted/30 border-y" id="goals" data-testid="section-goals">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold" data-testid="text-goals-heading">
            Choose Your Goal
          </h2>
          <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
            Start with what you want to accomplish. VCP Trader AI adapts the opportunity view,
            evidence, planning framework, and risk context to your objective.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {goals.map((g) => (
            <Card key={g.title} className={`flex flex-col border ${g.color}`} data-testid={g.testId}>
              <CardContent className="pt-6 flex flex-col flex-1">
                <div className={`h-10 w-10 rounded-md flex items-center justify-center mb-4 ${g.iconColor}`}>
                  <g.icon className="h-5 w-5" />
                </div>
                <h3 className="font-semibold text-base mb-2">{g.title}</h3>
                <p className="text-sm text-muted-foreground mb-4">{g.description}</p>
                <ul className="space-y-1 mb-6 flex-1">
                  {g.items.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <Check className="h-3 w-3 text-primary mt-0.5 shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    track("choose_goal_clicked", { goal: g.testId });
                    onStartTrial();
                  }}
                  data-testid={`button-goal-${g.testId}`}
                >
                  {g.cta}
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------
 * 3. HOW IT WORKS  (6-step: Discover → Review)
 * --------------------------------------------------------- */
function HowItWorksSection({ onStartTrial }: { onStartTrial: () => void }) {
  const steps = [
    {
      n: "1",
      icon: Search,
      title: "Discover",
      copy: "VCP Trader AI scans supported market data and surfaces qualified growth, income, trading, watchlist, and approaching-qualification market opportunities.",
    },
    {
      n: "2",
      icon: Brain,
      title: "Understand",
      copy: "Open the AI Trading Workspace to see why a candidate qualified, its lifecycle state, market regime, rank, evidence, and active risks.",
    },
    {
      n: "3",
      icon: Eye,
      title: "Evaluate",
      copy: "Review technical context, news, catalysts, congressional disclosures, available institutional context, and thesis invalidation conditions.",
    },
    {
      n: "4",
      icon: Layers,
      title: "Plan",
      copy: "Compare possible stock and illustrative options structures, including holding period, DTE framework, strike-selection framework, advantages, and trade-offs.",
    },
    {
      n: "5",
      icon: Link2,
      title: "Verify",
      copy: "With a supported brokerage connection, resolve actual listed expirations and strikes, inspect available quotes, liquidity, and Greeks, and compare verified contract candidates.",
    },
    {
      n: "6",
      icon: Zap,
      title: "Review",
      copy: "Prepare the selected stock or options structure for review through InstaTrade™. Nothing is submitted without explicit user confirmation.",
    },
  ];

  const exampleCards = [
    {
      label: "Long-Term Growth",
      sublabel: "Qualified opportunity with durable growth thesis",
      tone: "text-emerald-600 dark:text-emerald-400 border-emerald-500/40 bg-emerald-500/10",
    },
    {
      label: "Income",
      sublabel: "Covered call or cash-secured put scenario",
      tone: "text-sky-600 dark:text-sky-400 border-sky-500/40 bg-sky-500/10",
    },
    {
      label: "Active Trade Setup",
      sublabel: "Breakout or pullback with trigger conditions",
      tone: "text-primary border-primary/40 bg-primary/10",
    },
    {
      label: "Watchlist",
      sublabel: "Developing setup approaching qualification",
      tone: "text-muted-foreground border-muted",
    },
  ];

  return (
    <section className="py-16 md:py-24" id="how-it-works" data-testid="section-how-it-works">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold" data-testid="text-features-heading">
            How VCP Trader AI Surfaces and Evaluates Market Opportunities
          </h2>
          <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
            A transparent workflow for different goals, strategies, and time horizons.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
          {steps.map((s) => (
            <div key={s.n} className="flex gap-4" data-testid={`card-step-${s.n}`}>
              <div className="flex-shrink-0 h-10 w-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                <span className="text-sm font-bold text-primary">{s.n}</span>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <s.icon className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold text-sm">{s.title}</h3>
                </div>
                <p className="text-sm text-muted-foreground">{s.copy}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Examples of Qualified Market Opportunities */}
        <div className="border-t pt-12">
          <div className="text-center mb-6">
            <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              What VCP Trader AI Can Surface
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {exampleCards.map((ex) => (
              <div
                key={ex.label}
                className="rounded-lg border bg-card p-4 space-y-2"
                data-testid={`card-example-${ex.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <Badge variant="outline" className={`text-[10px] ${ex.tone}`}>
                  {ex.label}
                </Badge>
                <p className="text-sm text-muted-foreground">{ex.sublabel}</p>
                <p className="text-[9px] text-muted-foreground/70">
                  Illustrative example — not a live recommendation
                </p>
              </div>
            ))}
          </div>
          <div className="text-center">
            <Button
              onClick={() => {
                track("start_free_trial_clicked", { location: "examples_section" });
                onStartTrial();
              }}
              data-testid="button-examples-cta"
            >
              Start Free Trial to Explore Current Opportunities
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------
 * 4. AI TRADING WORKSPACE
 * --------------------------------------------------------- */
function WorkspaceSection({ onStartTrial }: { onStartTrial: () => void }) {
  const modules = [
    { icon: BookOpen, label: "Opportunity Thesis", desc: "Opportunity rationale and qualification reasons" },
    { icon: Activity, label: "What Changed", desc: "Lifecycle state and scan-over-scan comparison" },
    { icon: Award, label: "Decision & Evidence", desc: "Scored evidence across technical, market, and news" },
    { icon: Layers, label: "Stock & Options Planning", desc: "Illustrative structure comparison and frameworks" },
    { icon: ShieldAlert, label: "Risk & Invalidation", desc: "Active risks and conditions that break the thesis" },
    { icon: MessageSquare, label: "Ask VCP AI", desc: "Contextual questions answered about this opportunity" },
  ];

  const capabilities = [
    { icon: Globe, label: "Market regime and lifecycle context" },
    { icon: BookOpen, label: "Congress, news, and catalyst research" },
    { icon: Briefcase, label: "Portfolio and watchlist context" },
    { icon: Link2, label: "Live contract verification when connected" },
    { icon: Eye, label: "Saved research and decision journal" },
  ];

  const prompts = [
    "Why did this candidate qualify?",
    "What changed since the previous scan?",
    "What evidence weakens the thesis?",
    "What would invalidate the setup?",
    "Explain the illustrative options structure.",
    "What should I verify before using InstaTrade™?",
  ];

  return (
    <section className="py-16 md:py-24 bg-muted/30 border-y" id="workspace" data-testid="section-workspace">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold" data-testid="text-workspace-heading">
            One Workspace for the Full Opportunity Evaluation Process
          </h2>
          <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
            Instead of moving between disconnected scanners, research tools, options calculators,
            and broker screens, VCP Trader AI organizes the decision-support workflow around the
            selected opportunity.
          </p>
        </div>

        {/* 6 compact modules */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8" data-testid="grid-workspace-modules">
          {modules.map((m) => (
            <div
              key={m.label}
              className="flex gap-3 rounded-lg border bg-card p-4"
              data-testid={`card-ws-module-${m.label.toLowerCase().replace(/[\s&]+/g, "-")}`}
            >
              <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                <m.icon className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-sm">{m.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{m.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Capability labels */}
        <div className="flex flex-wrap items-center justify-center gap-3 mb-10">
          {capabilities.map((c) => (
            <div key={c.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <c.icon className="h-3.5 w-3.5 text-primary/70 shrink-0" />
              <span>{c.label}</span>
            </div>
          ))}
        </div>

        {/* Contextual AI panel */}
        <div className="max-w-2xl mx-auto mb-8">
          <MockPanel title="Ask VCP AI About the Opportunity in Front of You">
            <div className="space-y-2">
              <div className="grid sm:grid-cols-2 gap-1.5">
                {prompts.map((p) => (
                  <div
                    key={p}
                    className="rounded-md border bg-muted/50 px-2.5 py-1.5 text-xs italic text-muted-foreground"
                  >
                    "{p}"
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground border-t pt-2">
                VCP AI explains available platform research and deterministic outputs. It may be
                incomplete when source data is unavailable and does not provide personalized
                investment advice.
              </p>
            </div>
          </MockPanel>
        </div>

        {/* Research capabilities compact strip */}
        <div className="border-t pt-8">
          <p className="text-center text-sm font-semibold mb-6" data-testid="text-research-strip-heading">
            Research More Than the Chart
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            {[
              { icon: BarChart2, label: "Technical Context", desc: "Trend, momentum, setup quality, and invalidation." },
              { icon: Globe, label: "Market Regime", desc: "Market environment and candidate alignment." },
              { icon: Bell, label: "News and Catalysts", desc: "Recent coverage, sentiment, earnings, and event risks." },
              {
                icon: BookOpen,
                label: "Congressional Disclosures",
                desc: "Publicly disclosed congressional transactions with transaction and reporting dates.",
                note: "May be disclosed after the transaction date and do not indicate future performance.",
              },
              { icon: Briefcase, label: "Portfolio Context", desc: "Concentration, sector exposure, earnings overlap, and capital impact where available." },
              {
                icon: Layers,
                label: "Institutional Intelligence",
                desc: "Rolling out with delayed SEC Form 13F data and verified security mappings.",
                note: "Based on delayed quarterly filings. Coverage may be limited while mappings are validated.",
                badge: "Rolling Out",
              },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border bg-card p-4" data-testid={`card-research-${item.label.toLowerCase().replace(/\s+/g, "-")}`}>
                <div className="flex items-center gap-2 mb-1">
                  <item.icon className="h-4 w-4 text-primary shrink-0" />
                  <span className="font-semibold text-sm">{item.label}</span>
                  {item.badge && (
                    <Badge variant="outline" className="text-[9px] ml-auto border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/5">
                      {item.badge}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
                {item.note && (
                  <p className="text-[10px] text-muted-foreground/70 mt-1 italic">{item.note}</p>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="text-center">
          <Button
            size="lg"
            onClick={() => {
              track("start_free_trial_clicked", { location: "workspace_section" });
              onStartTrial();
            }}
            data-testid="button-workspace-cta"
          >
            Explore the AI Trading Workspace
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------
 * 5. STOCK AND OPTIONS PLANNING
 * --------------------------------------------------------- */
function PlanningSection({ onStartTrial }: { onStartTrial: () => void }) {
  const stockItems = [
    "Long-term position",
    "Breakout entry",
    "Pullback entry",
    "Swing position",
    "Holding horizon",
    "Entry, stop, and objective framework",
    "Invalidation conditions",
  ];
  const optionsItems = [
    "Structure selection",
    "Target DTE range",
    "Strike-selection framework",
    "Debit versus credit characteristics",
    "Time decay",
    "Assignment risk",
    "Defined-risk characteristics",
  ];
  const brokerItems = [
    "Actual listed expirations",
    "Actual strikes",
    "Displayed bid and ask",
    "Available open interest and volume",
    "Available Greeks",
    "Quote timestamp",
    "Liquidity and contract fit",
  ];

  const riskItems = [
    { icon: Filter, label: "Minimum qualification filters" },
    { icon: Wallet, label: "Risk-budget validation" },
    { icon: Gauge, label: "Liquidity and spread checks" },
    { icon: Lock, label: "Defined-risk structure controls" },
    { icon: ShieldAlert, label: "Reward/risk and invalidation warnings" },
  ];

  return (
    <section className="py-16 md:py-24 bg-gradient-to-b from-background via-primary/5 to-background border-y" id="planning" data-testid="section-planning">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
          <Badge variant="outline" className="mb-4 text-[11px] border-primary/30 bg-primary/5 text-primary">
            <PieChart className="h-3 w-3 mr-1" />
            Stocks &amp; Options
          </Badge>
          <h2 className="text-2xl md:text-3xl font-bold" data-testid="text-planning-heading">
            Plan the Structure Before Selecting the Contract
          </h2>
          <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
            VCP Trader AI separates research, structure planning, and live contract verification
            so users can understand the trade-offs before reviewing an order.
          </p>
        </div>

        {/* 3-column planning */}
        <div className="grid md:grid-cols-3 gap-5 mb-6">
          <Card className="bg-card" data-testid="col-planning-stock">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <CardTitle className="text-sm">Stock Research</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {stockItems.map((it) => (
                  <li key={it} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card className="bg-card" data-testid="col-planning-options">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-primary" />
                <CardTitle className="text-sm">Illustrative Options Planning</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {optionsItems.map((it) => (
                  <li key={it} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card className="bg-card border-primary/30" data-testid="col-planning-broker">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                <CardTitle className="text-sm">Broker-Verified Contracts</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {brokerItems.map((it) => (
                  <li key={it} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 text-sky-600 dark:text-sky-400 mt-0.5 shrink-0" />
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        <p className="text-center text-xs text-muted-foreground mb-10" data-testid="text-planning-disclaimer">
          Illustrative planning does not represent a live option contract. Actual contract
          availability and pricing require a supported connected brokerage.
        </p>

        {/* Opportunity Grades — compact */}
        <div className="rounded-xl border bg-card p-6 mb-8" data-testid="section-grades-compact">
          <div className="grid md:grid-cols-2 gap-6 items-start">
            <div>
              <Badge variant="outline" className="mb-3 text-[11px] border-primary/30 bg-primary/5 text-primary">
                <Award className="h-3 w-3 mr-1" />
                Opportunity Grade
              </Badge>
              <h3 className="font-bold text-base mb-2">Clear Qualification, Not a Universal Stock Rating</h3>
              <p className="text-sm text-muted-foreground">
                Each candidate is evaluated for a specific objective and time horizon. A stock may
                qualify differently for long-term growth, an active trade, a covered call, or
                portfolio fit.
              </p>
            </div>
            <div className="space-y-2">
              {[
                { label: "Technical", w: "83%" },
                { label: "Market context", w: "72%" },
                { label: "Evidence", w: "68%" },
                { label: "Risk", w: "75%" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground w-24 shrink-0">{item.label}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: item.w }} />
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between pt-1 border-t">
                <span className="text-xs font-semibold">Opportunity grade</span>
                <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-bold">
                  <Award className="h-3 w-3" /> Grade A · 78
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Illustrative example — not a prediction of returns.
              </p>
            </div>
          </div>
        </div>

        {/* Risk checks compact strip */}
        <div className="rounded-xl border bg-muted/30 p-5 mb-8" data-testid="section-risk-checks">
          <div className="flex items-center gap-2 mb-4">
            <ShieldAlert className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Risk Checks Before Broker Review</span>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {riskItems.map((r) => (
              <div key={r.label} className="flex items-start gap-2 text-xs text-muted-foreground">
                <r.icon className="h-3.5 w-3.5 text-primary/70 mt-0.5 shrink-0" />
                <span>{r.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="text-center">
          <Button
            size="lg"
            onClick={() => {
              track("start_free_trial_clicked", { location: "planning_section" });
              onStartTrial();
            }}
            data-testid="button-planning-cta"
          >
            Explore Stocks &amp; Options Research
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------
 * 6. BROKER VERIFICATION AND INSTATRADE™
 * --------------------------------------------------------- */
function BrokerSection({ onStartTrial }: { onStartTrial: () => void }) {
  const { instaTradeName } = useBranding();

  const withoutBroker = [
    "Daily-close and stored market data",
    "Qualified market opportunities",
    "AI Trading Workspace",
    "Stock structure planning",
    "Illustrative options structures",
    "DTE and strike frameworks",
    "News, catalysts, and Congress research",
    "Contextual AI explanations",
    "Saved research and watchlists",
  ];

  const withBroker = [
    "Current broker-supplied quotes",
    "Live options chains",
    "Actual listed expirations and strikes",
    "Available bid/ask, liquidity, and Greeks",
    "Account and position context",
    "Buying-power validation where supported",
    `${instaTradeName} preparation and review`,
    "User-directed order submission only where implemented and enabled",
  ];

  return (
    <section className="py-16 md:py-24 bg-muted/30 border-y" id="broker" data-testid="section-broker">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <Badge variant="outline" className="mb-4 text-[11px] border-primary/30 bg-primary/5 text-primary">
            <Link2 className="h-3 w-3 mr-1" />
            {instaTradeName}
          </Badge>
          <h2 className="text-2xl md:text-3xl font-bold" data-testid="text-broker-heading">
            Connect a Supported Brokerage When You Are Ready
          </h2>
          <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
            The platform works without a broker from day one. Connect when you're ready to verify
            live contracts and prepare trades for review.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-5 mb-8">
          <Card className="bg-card" data-testid="col-broker-without">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-muted-foreground uppercase tracking-wide">
                Without a Broker
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {withoutBroker.map((it) => (
                  <li key={it} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card className="bg-card border-primary/30" data-testid="col-broker-with">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-primary uppercase tracking-wide">
                With a Supported Broker
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {withBroker.map((it) => (
                  <li key={it} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        {/* InstaTrade mock */}
        <div className="max-w-sm mx-auto mb-6">
          <MockPanel title={`Prepare with ${instaTradeName}`}>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Connection</span>
                <span className="font-semibold">Supported broker</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Order</span>
                <span className="font-semibold text-muted-foreground italic">Illustrative example</span>
              </div>
              <Button
                size="sm"
                className="w-full mt-2"
                onClick={() => {
                  track("start_free_trial_clicked", { location: "instatrade_mock" });
                  onStartTrial();
                }}
                data-testid="button-instatrade-mock"
              >
                <Zap className="h-4 w-4 mr-1.5" />
                Prepare with {instaTradeName}
              </Button>
              <p className="text-[10px] text-muted-foreground text-center pt-1">
                You approve every order before submission. Illustrative example — not a live recommendation.
              </p>
            </div>
          </MockPanel>
        </div>

        <div className="text-center space-y-3">
          <p className="text-xs text-muted-foreground" data-testid="text-broker-disclaimer">
            Connect a supported brokerage. Capabilities vary by brokerage, account type,
            market-data entitlement, and integration status.
          </p>
          <p className="text-xs text-muted-foreground">
            Supported brokerage connections include Tradier and TradeStation. Additional
            connections and capabilities may vary.
          </p>
          <Button
            size="lg"
            onClick={() => {
              track("start_free_trial_clicked", { location: "broker_section" });
              onStartTrial();
            }}
            data-testid="button-broker-cta"
          >
            Start Free Trial — No Broker Required
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------
 * 7. PRICING
 * --------------------------------------------------------- */
function PricingSection({ onStartTrial }: { onStartTrial: () => void }) {
  const { instaTradeName, instaTradeFooterNotice } = useBranding();
  const pricing = usePricing();

  const featureGroups = [
    {
      label: "Opportunities and Market Intelligence",
      items: [
        "Qualified stock and options market opportunities",
        "Long-term, income, and active-trading views",
        "Market regime and evidence context",
        "Saved research and watchlists",
      ],
    },
    {
      label: "Trade Planning",
      items: [
        "Stock structure guidance",
        "Illustrative options structure guidance",
        "DTE and strike frameworks",
        "Risk, breakeven, and capital-review tools",
      ],
    },
    {
      label: "Portfolio and Monitoring",
      items: [
        "Portfolio and watchlist intelligence",
        "News, earnings, and catalyst context",
        "Decision journal",
      ],
    },
    {
      label: "Broker-Connected Capabilities",
      items: [
        "Current quotes through supported connections",
        "Options-chain and listed-contract verification",
        "Available Greeks and liquidity context",
        `${instaTradeName} preparation and review`,
      ],
    },
  ];

  return (
    <section className="py-16 md:py-24" id="pricing" data-testid="section-pricing">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold" data-testid="text-pricing-heading">
            Simple Pricing. Bring Your Broker.
          </h2>
          <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
            One complete platform for discovering, evaluating, and planning stock and options
            research across long-term growth, income, and active trading goals.
          </p>
        </div>

        <div className="max-w-xl mx-auto">
          <Card className="border-primary bg-card relative shadow-xl" data-testid="card-plan-pro">
            {pricing.foundingActive && (
              <Badge className="absolute -top-3 left-1/2 -translate-x-1/2" data-testid="badge-founding-member">
                Founding Member Access
              </Badge>
            )}
            <CardHeader className="text-center pt-8">
              <div className="flex justify-center">
                <Badge variant="secondary" data-testid="badge-trial">14-Day Free Trial</Badge>
              </div>
              <CardTitle className="text-2xl mt-3">VCP Trader AI Pro</CardTitle>
              <div className="mt-3 flex items-baseline justify-center gap-2">
                {pricing.foundingActive && (
                  <span className="text-2xl font-semibold text-muted-foreground line-through" data-testid="text-standard-price">
                    ${pricing.standardMonthlyPrice}
                  </span>
                )}
                <span className="text-5xl font-bold" data-testid="text-pro-price">${pricing.monthlyPrice}</span>
                <span className="text-muted-foreground">/month</span>
              </div>
              {pricing.foundingActive && (
                <>
                  <p className="text-sm font-medium text-primary mt-2" data-testid="text-founding-price-label">
                    Founding Member Price
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Lock in this price while your subscription remains continuously active.
                  </p>
                  <p className="text-xs text-muted-foreground mt-1" data-testid="text-planned-standard-price">
                    Standard price: ${pricing.standardMonthlyPrice}/month
                  </p>
                </>
              )}
            </CardHeader>
            <CardContent className="flex flex-col">
              {/* Trial / Broker breakdown */}
              <div className="grid sm:grid-cols-2 gap-3 mb-6 text-xs">
                <div className="rounded-md border bg-muted/30 p-3 space-y-1">
                  <p className="font-medium text-foreground/80">Trial — No Broker Required</p>
                  <ul className="space-y-0.5 text-muted-foreground">
                    <li>· Daily-close stock research</li>
                    <li>· Long-term opportunity analysis</li>
                    <li>· Delayed or snapshot market context</li>
                    <li>· Illustrative options structure guidance</li>
                  </ul>
                </div>
                <div className="rounded-md border bg-primary/5 border-primary/20 p-3 space-y-1">
                  <p className="font-medium text-foreground/80">Broker Connected</p>
                  <ul className="space-y-0.5 text-muted-foreground">
                    <li>· Current stock quotes</li>
                    <li>· Live options chains and available Greeks through supported broker connections</li>
                    <li>· Account and position context</li>
                    <li>· {instaTradeName} order preparation and review</li>
                  </ul>
                </div>
              </div>

              {/* Feature groups */}
              <div className="grid sm:grid-cols-2 gap-4 mb-6">
                {featureGroups.map((group) => (
                  <div key={group.label}>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                      {group.label}
                    </p>
                    <ul className="space-y-1.5">
                      {group.items.map((f) => (
                        <li key={f} className="flex items-start gap-2 text-sm">
                          <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              <div
                className="rounded-lg border border-border bg-muted/40 p-3 flex items-start gap-2 text-xs text-muted-foreground mb-4"
                role="note"
                data-testid="box-trial-disclosure"
              >
                <Info className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                <p>
                  Features vary by brokerage and account entitlement. Live quotes, options chains,
                  Greeks, and order capabilities require a supported connected broker.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Button
                  size="lg"
                  onClick={() => {
                    track("pricing_plan_selected", { plan: "pro" });
                    onStartTrial();
                  }}
                  data-testid="button-select-pro"
                >
                  Start Free Trial
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <p className="text-xs text-muted-foreground text-center" data-testid="text-supporting-copy">
                  No broker connection required to explore research. Connect when you are ready.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mt-8 max-w-3xl mx-auto space-y-2 text-xs text-muted-foreground text-center">
          <p>
            Live data availability depends on your connected brokerage, broker entitlements, and
            market data permissions.
          </p>
          <p data-testid="text-trademark-notice-pricing">{instaTradeFooterNotice}</p>
        </div>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------
 * FAQ
 * --------------------------------------------------------- */
function FAQSection() {
  const faqs = [
    {
      q: "Do I need a brokerage account to start?",
      a: "No. You can use Opportunity Research, the AI Trading Workspace, stock and illustrative options planning, delayed or daily-close market context, and supported research tools without connecting a broker. A broker is needed for live contract verification, account context, and broker-connected review capabilities.",
    },
    {
      q: "Does VCP Trader AI include live market data?",
      a: "The platform includes daily-close or stored market data for research. Current quotes, live options chains, and broker-specific market data require a supported connected brokerage and appropriate account entitlements.",
    },
    {
      q: "What can I do without connecting a broker?",
      a: "Discover qualified opportunities, review evidence, compare stock and illustrative options structures, explore DTE and strike frameworks, save research, use supported Congress, news, catalyst, and market-context tools, and ask contextual questions with VCP AI.",
    },
    {
      q: "Does the trial include paper trading?",
      a: "No. VCP Trader AI does not provide built-in paper trading, virtual cash, or simulated fills. The trial is a research and discovery trial — connect a supported brokerage for account data and order preparation.",
    },
    {
      q: "Does VCP Trader AI trade automatically?",
      a: "No. VCP Trader AI supports research, planning, verification, and user-directed order review. It does not autonomously place trades or manage a user's assets.",
    },
    {
      q: "Is this investment advice?",
      a: "No. VCP Trader AI provides educational research, analysis, and user-directed planning tools. Users remain responsible for their own decisions and should independently verify all data.",
    },
    {
      q: "Can I use it for long-term investing?",
      a: "Yes. The platform supports long-term thesis research, growth and earnings context, valuation context, technical conditions, portfolio concentration, and thesis monitoring, in addition to active trading workflows.",
    },
    {
      q: "Which brokers are supported?",
      a: "Supported brokerage connections include Tradier and TradeStation. Additional connections and capabilities may vary by account type and integration status.",
    },
    {
      q: "Can I cancel anytime?",
      a: "Yes. Subscriptions can be managed and canceled through the billing portal at any time.",
    },
    {
      q: "What is Institutional Intelligence?",
      a: "Institutional Intelligence is a rolling-out research capability based on delayed SEC Form 13F filings. Coverage may be limited while data, amendments, and security mappings are validated. It is not currently available to all users.",
    },
  ];

  return (
    <section className="py-16 md:py-24 bg-muted/30 border-y" id="faq" data-testid="section-faq">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold" data-testid="text-faq-heading">
            Frequently Asked Questions
          </h2>
        </div>
        <Accordion type="single" collapsible className="w-full">
          {faqs.map((faq, i) => (
            <AccordionItem key={faq.q} value={`item-${i}`}>
              <AccordionTrigger className="text-left" data-testid={`button-faq-question-${i}`}>
                {faq.q}
              </AccordionTrigger>
              <AccordionContent data-testid={`text-faq-answer-${i}`}>
                {faq.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------
 * FINAL CTA
 * --------------------------------------------------------- */
function FinalCtaSection({ onStartTrial }: { onStartTrial: () => void }) {
  return (
    <section className="py-16 md:py-20" data-testid="section-final-cta">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 text-center">
        <h2 className="text-2xl md:text-3xl font-bold">Ready to Research Your Next Opportunity?</h2>
        <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
          Start with daily-close research and structured trade planning. Connect a supported
          brokerage when you are ready to verify live contracts and prepare a trade for review.
        </p>
        <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Button
            size="lg"
            onClick={() => {
              track("start_free_trial_clicked", { location: "final_cta" });
              onStartTrial();
            }}
            data-testid="button-final-trial"
          >
            Start Free Trial
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
          <a href="#how-it-works">
            <Button size="lg" variant="outline" data-testid="button-final-tour">
              <Repeat className="h-4 w-4 mr-2" />
              See How It Works
            </Button>
          </a>
        </div>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------
 * FOOTER (with consolidated compliance)
 * --------------------------------------------------------- */
function LandingFooter() {
  return (
    <footer className="py-12 border-t">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6 mb-8">
          <div className="flex items-center gap-2">
            <img src={logoUrl} alt="VCP Trader AI" className="h-6 w-auto" />
            <span className="text-sm font-medium text-muted-foreground">
              VCP Trader AI · Powered by Sunfish Technologies LLC
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-4 md:gap-6 text-sm">
            <Link href="/terms" className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-footer-terms">Terms</Link>
            <Link href="/disclaimer" className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-footer-disclaimer">Disclaimer</Link>
            <Link href="/privacy" className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-footer-privacy">Privacy</Link>
            <Link href="/open-source" className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-footer-open-source">Open Source</Link>
            <a href="mailto:support@sunfishtrading.com" className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-footer-contact">Contact</a>
          </div>
        </div>
        <div className="border-t pt-6">
          <div className="flex items-start gap-2 max-w-4xl mx-auto">
            <ShieldCheck className="h-4 w-4 text-muted-foreground/60 mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground" data-testid="text-compliance">
              VCP Trader AI provides educational research, market analysis, and user-directed trade
              planning tools. It does not provide personalized investment advice, guarantee outcomes,
              or independently determine whether a trade is suitable for a user. Market, options,
              broker, congressional, institutional, and news data may be delayed, incomplete, or
              unavailable. Users should verify all information with their brokerage and conduct
              independent due diligence before making financial decisions.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}

/* -----------------------------------------------------------
 * PAGE
 * --------------------------------------------------------- */
export default function HomePage() {
  const [wizardOpen, setWizardOpen] = useState(false);
  const openWizard = () => setWizardOpen(true);

  useEffect(() => {
    document.title = "VCP Trader AI — Stock and Options Opportunity Intelligence";
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "description";
      document.head.appendChild(meta);
    }
    meta.content =
      "Discover qualified stock and options opportunities, evaluate evidence and risk, compare trade structures, verify live contracts through supported brokerages, and prepare trades for review with InstaTrade™.";

    // Open Graph
    const setOg = (property: string, content: string) => {
      let el = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute("property", property);
        document.head.appendChild(el);
      }
      el.content = content;
    };
    setOg("og:title", "VCP Trader AI — Stock and Options Opportunity Intelligence");
    setOg("og:description", "Discover qualified stock and options opportunities, evaluate evidence and risk, compare trade structures, verify live contracts through supported brokerages, and prepare trades for review with InstaTrade™.");
  }, []);

  useEffect(() => {
    const KEY = "sa.landingViewLogged";
    try {
      if (sessionStorage.getItem(KEY)) return;
      sessionStorage.setItem(KEY, "1");
    } catch {
      // sessionStorage may be blocked; still log once per page load
    }
    fetch("/api/audit/page-view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType: "landing_view",
        path: window.location.pathname + window.location.search,
        referrer: document.referrer || null,
      }),
      credentials: "include",
      keepalive: true,
    }).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <NavBar onStartTrial={openWizard} />
      <HeroSection onStartTrial={openWizard} />
      <ChooseYourGoalSection onStartTrial={openWizard} />
      <HowItWorksSection onStartTrial={openWizard} />
      <WorkspaceSection onStartTrial={openWizard} />
      <PlanningSection onStartTrial={openWizard} />
      <BrokerSection onStartTrial={openWizard} />
      <PricingSection onStartTrial={openWizard} />
      <FAQSection />
      <FinalCtaSection onStartTrial={openWizard} />
      <LandingFooter />
      <MarketingOnboardingWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  );
}
