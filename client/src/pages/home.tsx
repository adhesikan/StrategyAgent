import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
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
  Target,
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
  CircleSlash,
  Gauge,
  PieChart,
  Search,
  Wallet,
  Repeat,
  Lock,
  GraduationCap,
  Info,
  BarChart2,
  ListChecks,
  DollarSign,
  Eye,
  Filter,
  Clock,
  Globe,
  Briefcase,
  ArrowDown,
  SplitSquare,
  Columns,
} from "lucide-react";
import { useBranding } from "@/hooks/use-branding";
import { usePricing } from "@/hooks/use-pricing";
import logoUrl from "@assets/ChatGPT_Image_Jan_1,_2026,_01_38_07_PM_1767292703801.png";
import { useEffect, useState } from "react";
import { track } from "@/lib/analytics";
import { MarketingOnboardingWizard } from "@/components/marketing-onboarding-wizard";

/* -----------------------------------------------------------
 * NAV
 * --------------------------------------------------------- */
function NavBar({ onStartTrial }: { onStartTrial: () => void }) {
  const { isAuthenticated } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { instaTradeName } = useBranding();

  // Keep the existing 7-link nav; "Choose Your Goal" cards handle goal segmentation
  const navLinks = [
    { href: "#features", label: "Features" },
    { href: "#opportunities", label: "Daily Ideas" },
    { href: "#stocks", label: "Stocks" },
    { href: "#options", label: "Options" },
    { href: "#instatrade", label: instaTradeName },
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
                  data-testid={`link-nav-${link.label.toLowerCase().replace(/\s/g, "-")}`}
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
 * MOCK SETUP CARD (used in hero)
 * --------------------------------------------------------- */
function MockSetupCard() {
  return (
    <div className="relative">
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-primary/20 via-primary/5 to-transparent blur-2xl" aria-hidden />
      <Card className="border-primary/30 shadow-xl bg-card/95 backdrop-blur">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <Badge variant="outline" className="text-[11px] bg-background">
              <MessageSquare className="h-3 w-3 mr-1" />
              You asked
            </Badge>
            <Badge variant="secondary" className="text-[11px]">AMD · Daily</Badge>
          </div>
          <p className="text-sm mt-2 italic text-muted-foreground" data-testid="text-hero-prompt">
            "Find a bullish setup on AMD with defined risk."
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="border-t pt-3">
            <div className="flex items-center justify-between mb-2">
              <Badge variant="outline" className="text-[11px] bg-background">
                <Sparkles className="h-3 w-3 mr-1" />
                Opportunity
              </Badge>
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-bold">
                <Award className="h-3 w-3" />
                Grade A · 81
              </div>
            </div>
            <p className="font-bold text-lg">AMD · Bullish Pullback</p>
            <p className="text-xs text-muted-foreground">Possible structure: Bull Call Spread (defined risk)</p>
          </div>

          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-md border bg-background p-2">
              <p className="text-[10px] text-muted-foreground uppercase">Entry zone</p>
              <p className="font-semibold">$152.40</p>
            </div>
            <div className="rounded-md border bg-background p-2">
              <p className="text-[10px] text-muted-foreground uppercase">Risk ref.</p>
              <p className="font-semibold">$149.80</p>
            </div>
            <div className="rounded-md border bg-background p-2">
              <p className="text-[10px] text-muted-foreground uppercase">Objective</p>
              <p className="font-semibold">$158.10</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-md border bg-background p-2">
              <p className="text-[10px] text-muted-foreground uppercase">Max Loss</p>
              <p className="font-semibold text-destructive">$185</p>
            </div>
            <div className="rounded-md border bg-background p-2">
              <p className="text-[10px] text-muted-foreground uppercase">Max Gain</p>
              <p className="font-semibold text-emerald-600 dark:text-emerald-400">$315</p>
            </div>
            <div className="rounded-md border bg-background p-2">
              <p className="text-[10px] text-muted-foreground uppercase">Breakeven</p>
              <p className="font-semibold">$153.85</p>
            </div>
          </div>

          <Button className="w-full" size="sm" data-testid="button-mock-execute">
            <Zap className="h-4 w-4 mr-1.5" />
            Review with InstaTrade™
          </Button>

          <p className="text-[10px] text-muted-foreground border-t pt-2 flex items-center gap-1">
            <Activity className="h-3 w-3" />
            Example scenario only — not a live recommendation.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/* -----------------------------------------------------------
 * HERO  (§2 — broadened for traders + investors)
 * --------------------------------------------------------- */
function HeroSection({ onStartTrial }: { onStartTrial: () => void }) {
  const { instaTradeName } = useBranding();
  const trustBadges = [
    "Long-Term Growth Ideas",
    "Daily Trade Setups",
    "Income Opportunities",
    "Plain-English Explanations",
    "Portfolio Intelligence",
    "14-Day Free Trial",
  ];

  return (
    <section className="relative overflow-hidden">
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
              AI Trade Intelligence for Self-Directed Traders and Investors
            </Badge>
            <h1
              className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight"
              data-testid="text-hero-headline"
            >
              Find Better Stock &amp; Options{" "}
              <span className="text-primary">Opportunities With AI</span>
            </h1>
            <p
              className="mt-6 text-lg md:text-xl text-muted-foreground max-w-xl mx-auto lg:mx-0"
              data-testid="text-hero-subheadline"
            >
              Discover growth, income, and trading opportunities, understand why they qualify, monitor the risks, and make your own informed decisions.
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
                  const el = document.getElementById("how-it-works");
                  el?.scrollIntoView({ behavior: "smooth" });
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
            <p className="mt-4 text-xs text-muted-foreground max-w-xl mx-auto lg:mx-0" data-testid="text-hero-disclaimer">
              The trial provides AI-generated market analysis with delayed or snapshot market context. Live market data and order submission require a supported connected brokerage account. Informational only — not investment advice.
            </p>
            <p className="mt-2 text-[11px] text-muted-foreground/80">
              Powered by Sunfish Technologies LLC
            </p>
          </div>
          <div className="lg:pl-6">
            <MockSetupCard />
          </div>
        </div>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------
 * CHOOSE YOUR GOAL  (§3 — new, immediately after hero)
 * --------------------------------------------------------- */
function ChooseYourGoalSection({ onStartTrial }: { onStartTrial: () => void }) {
  const goals = [
    {
      icon: TrendingUp,
      title: "Grow Long-Term Wealth",
      description:
        "Discover companies with durable growth themes, improving business conditions, constructive long-term trends, and clearer entry considerations.",
      items: [
        "Long-term growth candidates",
        "AI infrastructure and secular themes",
        "Earnings and fundamental context",
        "Valuation context",
        "Thesis monitoring",
        "Portfolio concentration awareness",
      ],
      cta: "Explore Growth Opportunities",
      anchor: "#long-term-investor",
      testId: "card-goal-grow",
      color: "border-emerald-500/30 bg-emerald-500/5",
      iconColor: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
    },
    {
      icon: DollarSign,
      title: "Generate Income",
      description:
        "Explore covered calls, cash-secured puts, credit spreads, dividend opportunities, and defined-risk income scenarios.",
      items: [
        "Covered calls",
        "Cash-secured puts",
        "Credit spreads",
        "Dividend and income ideas",
        "Capital and risk requirements",
        "Stocks you may be willing to own",
      ],
      cta: "Explore Income Opportunities",
      anchor: "#stocks",
      testId: "card-goal-income",
      color: "border-sky-500/30 bg-sky-500/5",
      iconColor: "text-sky-600 dark:text-sky-400 bg-sky-500/10",
    },
    {
      icon: Zap,
      title: "Find Trade Setups",
      description:
        "Discover breakouts, pullbacks, momentum setups, swing opportunities, and defined-risk options structures.",
      items: [
        "Breakout setups",
        "Pullbacks",
        "Momentum candidates",
        "Swing opportunities",
        "Defined-risk options",
        "Freshness and trigger conditions",
      ],
      cta: "Find Trade Setups",
      anchor: "#opportunities",
      testId: "card-goal-trade",
      color: "border-primary/30 bg-primary/5",
      iconColor: "text-primary bg-primary/10",
    },
    {
      icon: Globe,
      title: "Understand Markets",
      description:
        "Follow market regime, sector rotation, sentiment, volatility, earnings, and the risks shaping current opportunities.",
      items: [
        "Market regime",
        "Sector strength",
        "Sentiment",
        "Earnings calendar",
        "Volatility",
        "Market risk observations",
      ],
      cta: "View Market Intelligence",
      anchor: "#plain-english",
      testId: "card-goal-markets",
      color: "border-amber-500/30 bg-amber-500/5",
      iconColor: "text-amber-600 dark:text-amber-400 bg-amber-500/10",
    },
  ];

  return (
    <section className="py-16 md:py-24 bg-muted/30 border-y" id="goals">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold" data-testid="text-goals-heading">
            Choose Your Goal
          </h2>
          <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
            Start with what you want to accomplish. VCP Trader AI adapts the opportunity view, evidence, and risk context to your objective.
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
                <a href={g.anchor}>
                  <Button variant="outline" size="sm" className="w-full" data-testid={`button-goal-${g.testId}`}>
                    {g.cta}
                    <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                </a>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------
 * MOCK PANEL helper
 * --------------------------------------------------------- */
function MockPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="border-primary/20 shadow-lg bg-card/95">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
          <Badge variant="secondary" className="text-[10px]">Preview</Badge>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/* -----------------------------------------------------------
 * WHAT YOU GET EVERY DAY  (§4 — updated for traders + investors)
 * --------------------------------------------------------- */
function DailyValueSection() {
  const cards = [
    {
      icon: Sparkles,
      title: "Today's Opportunities",
      copy: "See AI-ranked stock and options opportunities based on current market conditions and deterministic qualification rules.",
    },
    {
      icon: TrendingUp,
      title: "Long-Term Growth Ideas",
      copy: "Discover companies with durable growth drivers, improving conditions, and favorable long-term technical trends.",
    },
    {
      icon: DollarSign,
      title: "Income Opportunities",
      copy: "Explore covered calls, cash-secured puts, dividend ideas, and defined-risk income scenarios.",
    },
    {
      icon: Zap,
      title: "Trade Setups",
      copy: "Find breakouts, pullbacks, momentum candidates, and swing opportunities.",
    },
    {
      icon: ListChecks,
      title: "Portfolio & Watchlist Intelligence",
      copy: "Monitor holdings, concentration, earnings exposure, thesis changes, and symbols worth watching.",
    },
    {
      icon: Globe,
      title: "Market Context",
      copy: "Understand market regime, sectors, sentiment, volatility, earnings, and major risks.",
    },
  ];

  return (
    <section className="py-16 md:py-24" id="features">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold" data-testid="text-problem-heading">
            What You Get Every Day
          </h2>
          <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
            A focused view of the opportunities, market conditions, and risks that deserve your attention — whether you're growing long-term, generating income, or actively trading.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {cards.map((c, i) => (
            <Card key={c.title} className="bg-card hover-elevate" data-testid={`card-benefit-${i}`}>
              <CardContent className="pt-6">
                <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center mb-4">
                  <c.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold text-base">{c.title}</h3>
                <p className="text-sm text-muted-foreground mt-2">{c.copy}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------
 * TODAY'S OPPORTUNITIES PREVIEW  (§5 — organized by goal, 7 examples)
 * --------------------------------------------------------- */
function TodaysOpportunitiesSection({ onStartTrial }: { onStartTrial: () => void }) {
  const groups = [
    {
      label: "Long-Term Growth",
      labelClass: "text-emerald-600 dark:text-emerald-400",
      examples: [
        { symbol: "NVDA", sublabel: "AI Infrastructure Growth Candidate", badge: "Long-Term View",  tone: "text-emerald-600 dark:text-emerald-400 border-emerald-500/40 bg-emerald-500/10" },
        { symbol: "MU",   sublabel: "Memory Cycle Growth Candidate",     badge: "Thesis Monitoring", tone: "text-emerald-600 dark:text-emerald-400 border-emerald-500/40 bg-emerald-500/10" },
      ],
    },
    {
      label: "Income",
      labelClass: "text-sky-600 dark:text-sky-400",
      examples: [
        { symbol: "AAPL", sublabel: "Covered Call Scenario",    badge: "Income",  tone: "text-sky-600 dark:text-sky-400 border-sky-500/40 bg-sky-500/10" },
        { symbol: "SPY",  sublabel: "Cash-Secured Put Scenario", badge: "Income",  tone: "text-sky-600 dark:text-sky-400 border-sky-500/40 bg-sky-500/10" },
      ],
    },
    {
      label: "Trade",
      labelClass: "text-primary",
      examples: [
        { symbol: "BA",   sublabel: "Momentum Breakout",  badge: "Grade B", tone: "text-amber-600 dark:text-amber-400 border-amber-500/40 bg-amber-500/10" },
        { symbol: "AMD",  sublabel: "Bullish Pullback",   badge: "Grade A", tone: "text-emerald-600 dark:text-emerald-400 border-emerald-500/40 bg-emerald-500/10" },
      ],
    },
    {
      label: "Watch",
      labelClass: "text-muted-foreground",
      examples: [
        { symbol: "CRDO", sublabel: "Developing Setup", badge: "Watchlist", tone: "text-muted-foreground border-muted" },
      ],
    },
  ];

  return (
    <section className="py-16 md:py-24 bg-muted/30 border-y" id="opportunities">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <Badge variant="outline" className="mb-4 text-[11px] border-primary/30 bg-primary/5 text-primary">
            <Sparkles className="h-3 w-3 mr-1" />
            Example Preview
          </Badge>
          <h2 className="text-2xl md:text-3xl font-bold" data-testid="text-opportunities-heading">
            Today's Opportunities
          </h2>
          <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
            A preview of the types of stock and options opportunities VCP Trader AI can surface and explain across different goals.
          </p>
        </div>

        <div className="space-y-6 mb-8">
          {groups.map((group) => (
            <div key={group.label}>
              <p className={`text-xs font-semibold uppercase tracking-wide mb-3 ${group.labelClass}`}>
                {group.label}
              </p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {group.examples.map((ex) => (
                  <div
                    key={ex.symbol}
                    className="rounded-lg border bg-card p-4 space-y-2"
                    data-testid={`card-opportunity-preview-${ex.symbol.toLowerCase()}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-base">{ex.symbol}</span>
                      <Badge variant="outline" className={`text-[10px] ${ex.tone}`}>
                        {ex.badge}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{ex.sublabel}</p>
                    <Badge variant="secondary" className="text-[9px] font-normal">
                      Example · Not a live recommendation
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-muted-foreground mb-6">
          These are illustrative examples only. They are not current live signals, recommendations, or verified outcomes.
        </p>
        <div className="text-center">
          <Button
            onClick={() => {
              track("start_free_trial_clicked", { location: "opportunities_section" });
              onStartTrial();
            }}
            data-testid="button-opportunities-cta"
          >
            Start Free Trial — See Live Ideas
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------
 * HOW VCP TRADER AI FINDS OPPORTUNITIES  (§9 — broadened)
 * --------------------------------------------------------- */
function HowItFindsSection() {
  const steps = [
    {
      n: "1",
      icon: Search,
      title: "Discover",
      copy: "Scans stocks, options, themes, sectors, and market conditions across growth, income, and active trading objectives.",
    },
    {
      n: "2",
      icon: Brain,
      title: "Evaluate",
      copy: "Applies deterministic technical, market, event, and portfolio criteria to each opportunity.",
    },
    {
      n: "3",
      icon: Filter,
      title: "Qualify",
      copy: "Separates qualified, developing, rejected, and unavailable opportunities for each goal and time horizon.",
    },
    {
      n: "4",
      icon: MessageSquare,
      title: "Explain",
      copy: "Shows the evidence, risks, limitations, and what conditions matter — in plain English.",
    },
    {
      n: "5",
      icon: Eye,
      title: "Monitor",
      copy: "Tracks saved ideas, watchlists, thesis changes, earnings, and market conditions over time.",
    },
    {
      n: "6",
      icon: Zap,
      title: "Prepare",
      copy: "Helps you review a stock or options order through a connected broker with explicit confirmation before submission.",
    },
  ];

  return (
    <section className="py-16 md:py-24" id="how-it-works">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold" data-testid="text-features-heading">
            How VCP Trader AI Finds Opportunities
          </h2>
          <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
            From market scan to reviewed order — a consistent, transparent workflow for every goal and time horizon.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {steps.map((s) => (
            <div key={s.n} className="flex gap-4" data-testid={`card-how-step-${s.n}`}>
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
      </div>
    </section>
  );
}

/* -----------------------------------------------------------
 * INVEST WITH A CLEARER THESIS  (§6 — new long-term investor section)
 * --------------------------------------------------------- */
function LongTermInvestorSection({ onStartTrial }: { onStartTrial: () => void }) {
  const benefits = [
    "Long-Term Opportunity Analysis",
    "Growth Drivers and Business Context",
    "Earnings and Fundamental Trends",
    "Valuation Context",
    "Technical Entry Conditions",
    "Portfolio Concentration Review",
  ];

  const workflow = [
    "Discover",
    "Evaluate the Thesis",
    "Review Valuation and Risks",
    "Monitor Conditions",
    "Save and Revisit",
  ];

  return (
    <section className="py-16 md:py-24 bg-muted/30 border-y" id="long-term-investor">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <Badge variant="outline" className="mb-4 text-[11px] border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400">
              <TrendingUp className="h-3 w-3 mr-1" />
              Long-Term Investing
            </Badge>
            <h2 className="text-2xl md:text-3xl font-bold" data-testid="text-long-term-heading">
              Invest With a Clearer Thesis
            </h2>
            <p className="mt-4 text-muted-foreground">
              VCP Trader AI helps long-term investors evaluate companies, understand growth drivers and risks, monitor thesis changes, and identify more disciplined entry conditions.
            </p>
            <div className="mt-6 grid sm:grid-cols-2 gap-2">
              {benefits.map((b) => (
                <div key={b} className="flex items-start gap-2 text-sm">
                  <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                  <span>{b}</span>
                </div>
              ))}
            </div>
            <div className="mt-8">
              <Button
                onClick={() => {
                  track("start_free_trial_clicked", { location: "long_term_section" });
                  onStartTrial();
                }}
                data-testid="button-long-term-cta"
              >
                Explore Long-Term Opportunities
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Workflow illustration */}
          <div className="flex flex-col items-center gap-1">
            {workflow.map((step, i) => (
              <div key={step} className="flex flex-col items-center">
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-6 py-3 text-sm font-medium text-center min-w-[220px]">
                  {step}
                </div>
                {i < workflow.length - 1 && (
                  <div className="flex flex-col items-center py-1">
                    <div className="w-px h-4 bg-border" />
                    <ArrowDown className="h-4 w-4 text-muted-foreground" />
                    <div className="w-px h-1 bg-border" />
                  </div>
                )}
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground mt-4 text-center max-w-xs">
              Illustrative workflow — you make every decision.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------
 * THE RIGHT VIEW FOR YOUR TIME HORIZON  (§7 — trading vs investing)
 * --------------------------------------------------------- */
function TimeHorizonSection() {
  const tradingItems = [
    "Setup freshness",
    "Trigger or confirmation",
    "Invalidation",
    "Technical objective",
    "Momentum",
    "Reward/risk",
    "Options structure",
    "Liquidity",
  ];

  const investingItems = [
    "Investment thesis",
    "Growth drivers",
    "Competitive positioning",
    "Earnings trajectory",
    "Valuation context",
    "Long-term trend",
    "Thesis risks",
    "Conditions that strengthen or weaken conviction",
    "Portfolio concentration",
    "Review horizon",
  ];

  return (
    <section className="py-16 md:py-24" id="time-horizon">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold" data-testid="text-time-horizon-heading">
            The Right View for Your Time Horizon
          </h2>
          <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
            A short-term setup can fail to qualify while the long-term investment thesis remains intact. VCP Trader AI keeps these views distinct so you never confuse a trade signal with an investment conclusion.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Trading View */}
          <Card className="border-primary/30 bg-primary/5" data-testid="card-trading-view">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center">
                  <Zap className="h-4 w-4 text-primary" />
                </div>
                <CardTitle className="text-base">Trading View</CardTitle>
              </div>
              <CardDescription className="text-xs">Short-term setup evaluation</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {tradingItems.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Long-Term Investment View */}
          <Card className="border-emerald-500/30 bg-emerald-500/5" data-testid="card-investing-view">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-md bg-emerald-500/10 flex items-center justify-center">
                  <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                </div>
                <CardTitle className="text-base">Long-Term Investment View</CardTitle>
              </div>
              <CardDescription className="text-xs">Thesis and conviction evaluation</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {investingItems.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        <p className="mt-8 text-center text-sm text-muted-foreground max-w-2xl mx-auto">
          Each view uses goal-appropriate evidence. A stock may qualify as a long-term growth candidate while its short-term setup remains developing or unconfirmed — and vice versa.
        </p>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------
 * FEATURE ROW (shared layout)
 * --------------------------------------------------------- */
type FeatureRowProps = {
  eyebrow: string;
  title: string;
  copy: string;
  bullets: string[];
  visual: React.ReactNode;
  reverse?: boolean;
  testId: string;
};

function FeatureRow({ eyebrow, title, copy, bullets, visual, reverse, testId }: FeatureRowProps) {
  return (
    <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center" data-testid={testId}>
      <div className={reverse ? "lg:order-2" : ""}>
        <Badge variant="outline" className="mb-3 text-[11px] bg-primary/5 text-primary border-primary/30">
          {eyebrow}
        </Badge>
        <h3 className="text-2xl md:text-3xl font-bold tracking-tight">{title}</h3>
        <p className="mt-3 text-muted-foreground">{copy}</p>
        <ul className="mt-5 space-y-2">
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-2 text-sm">
              <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className={reverse ? "lg:order-1" : ""}>{visual}</div>
    </div>
  );
}

/* -----------------------------------------------------------
 * ASK ABOUT OPPORTUNITIES IN PLAIN ENGLISH  (§8 — updated prompts)
 * --------------------------------------------------------- */
function PlainEnglishSection() {
  const promptGroups = [
    {
      label: "Long-Term",
      prompts: [
        "Analyze MU as a three-year investment",
        "Find long-term AI infrastructure opportunities",
        "Compare NVDA, AVGO, and AMD for long-term growth",
        "Which holdings have strengthening long-term conditions?",
        "What could weaken the investment thesis for MU?",
      ],
    },
    {
      label: "Income",
      prompts: [
        "Find covered call opportunities from stocks I own",
        "Find cash-secured puts using stocks I would be willing to own",
        "Show income opportunities under $500 risk",
      ],
    },
    {
      label: "Trading",
      prompts: [
        "Show bullish setups on NVDA",
        "Find stocks near breakout confirmation",
        "Find swing setups under $500 risk",
        "Show developing momentum candidates",
      ],
    },
    {
      label: "Markets",
      prompts: [
        "What is the current market regime?",
        "Which sectors are strengthening?",
        "What earnings events matter this week?",
      ],
    },
  ];

  return (
    <section className="py-16 md:py-24 bg-muted/30 border-y" id="plain-english">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <FeatureRow
          testId="feature-plain-english"
          eyebrow="For All Goals"
          title="Ask About Opportunities in Plain English"
          copy="Describe what you're looking for — whether it's a long-term growth thesis, an income setup, an active trade, or a market overview — and VCP Trader AI surfaces qualified opportunities with evidence and risk context."
          bullets={[
            "No complex setup required",
            "Long-term, income, trading, and market prompts",
            "Advanced controls available when needed",
          ]}
          visual={
            <MockPanel title="Prompt Examples">
              <div className="space-y-3 text-sm">
                {promptGroups.map((group) => (
                  <div key={group.label}>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{group.label}</p>
                    <div className="space-y-1">
                      {group.prompts.slice(0, 2).map((p) => (
                        <div key={p} className="rounded-md border bg-muted/50 px-2 py-1 text-xs italic text-muted-foreground">
                          "{p}"
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <p className="text-[10px] text-muted-foreground border-t pt-2">Example prompts only.</p>
              </div>
            </MockPanel>
          }
        />
      </div>
    </section>
  );
}

/* -----------------------------------------------------------
 * OPPORTUNITY GRADES  (§10 — updated with multi-goal note)
 * --------------------------------------------------------- */
function OpportunityGradesSection() {
  return (
    <section className="py-16 md:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <FeatureRow
          testId="feature-scoring"
          eyebrow="Built-In Quality Filters"
          title="Opportunity Grades"
          copy="Each opportunity or scenario receives a clear grade based on the evidence available for that specific objective and time horizon — not as a universal verdict on the stock."
          bullets={[
            "One clear grade per scenario and objective",
            "Plain-English qualification reasons",
            "Risks and limitations shown alongside the opportunity",
            "Higher-quality candidates surface first",
            "A stock may receive different grades for long-term growth, swing trade, covered call, or portfolio fit",
          ]}
          reverse
          visual={
            <MockPanel title="Grade Breakdown">
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span>Technical</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full w-[83%] bg-primary" /></div>
                    <span className="font-semibold w-7 text-right">83</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span>Market context</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full w-[72%] bg-primary" /></div>
                    <span className="font-semibold w-7 text-right">72</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span>News sentiment</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full w-[60%] bg-primary" /></div>
                    <span className="font-semibold w-7 text-right">60</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span>Risk factors</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full w-[75%] bg-primary" /></div>
                    <span className="font-semibold w-7 text-right">75</span>
                  </div>
                </div>
                <div className="flex items-center justify-between border-t pt-2">
                  <span className="font-semibold">Opportunity grade</span>
                  <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-bold">
                    <Award className="h-3 w-3" /> Grade A · 78
                  </div>
                </div>
              </div>
            </MockPanel>
          }
        />
      </div>
    </section>
  );
}

/* -----------------------------------------------------------
 * INVEST OR TRADE WITH STOCKS AND OPTIONS  (§11 — 3 subsections)
 * --------------------------------------------------------- */
function StocksOptionsSection({ onStartTrial }: { onStartTrial: () => void }) {
  const longTermItems = [
    "Durable growth themes",
    "Earnings trends",
    "Valuation context",
    "Long-term technical conditions",
    "Thesis risks",
  ];
  const activeItems = [
    "Breakouts",
    "Pullbacks",
    "Momentum",
    "Watch conditions",
    "Risk levels",
  ];
  const optionsItems = [
    "Long calls and puts",
    "Spreads",
    "Covered calls",
    "Cash-secured puts",
    "Income and defined-risk scenarios",
  ];

  return (
    <section className="py-16 md:py-24 bg-gradient-to-b from-background via-primary/5 to-background border-y" id="stocks">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
          <Badge variant="outline" className="mb-4 text-[11px] border-primary/30 bg-primary/5 text-primary">
            <PieChart className="h-3 w-3 mr-1" />
            Stocks &amp; Options
          </Badge>
          <h2 id="options" className="text-2xl md:text-3xl font-bold scroll-mt-20" data-testid="text-options-heading">
            Invest or Trade With Stocks and Options
          </h2>
          <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
            Evaluate long-term stock opportunities, active trade setups, and options scenarios in one consistent decision-support workflow.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <Card className="bg-card">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <CardTitle className="text-sm">Long-Term Stock Opportunities</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {longTermItems.map((it) => (
                  <li key={it} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card className="bg-card">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                <CardTitle className="text-sm">Active Stock Setups</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {activeItems.map((it) => (
                  <li key={it} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card className="bg-card">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                <CardTitle className="text-sm">Options Opportunities</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {optionsItems.map((it) => (
                  <li key={it} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 text-sky-600 dark:text-sky-400 mt-0.5 shrink-0" />
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        <div className="text-center">
          <Button
            size="lg"
            onClick={() => {
              track("start_free_trial_clicked", { location: "options_section" });
              onStartTrial();
            }}
            data-testid="button-options-cta"
          >
            Explore Stocks &amp; Options
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------
 * FIND THE RIGHT OPTIONS STRUCTURE  (keep from previous build)
 * --------------------------------------------------------- */
function OptionsStructureSection() {
  return (
    <section className="py-16 md:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <FeatureRow
          testId="feature-options"
          eyebrow="Options Intelligence"
          title="Find the Right Options Structure"
          copy="Compare possible options structures, review liquidity and risk, and understand the trade-offs before preparing an order. Live data depends on your connected brokerage."
          bullets={[
            "Open interest and volume checks",
            "Bid/ask spread checks",
            "Max loss and breakeven shown up front",
            "Greeks available in advanced view",
            "Estimated structures clearly separated from live broker data",
          ]}
          visual={
            <MockPanel title="Selected Contract">
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md border bg-background p-2"><p className="text-[10px] text-muted-foreground uppercase">Strike</p><p className="font-semibold">$155 Call</p></div>
                  <div className="rounded-md border bg-background p-2"><p className="text-[10px] text-muted-foreground uppercase">Expiry</p><p className="font-semibold">34 DTE</p></div>
                  <div className="rounded-md border bg-background p-2"><p className="text-[10px] text-muted-foreground uppercase">Delta</p><p className="font-semibold">0.53</p></div>
                  <div className="rounded-md border bg-background p-2"><p className="text-[10px] text-muted-foreground uppercase">IV</p><p className="font-semibold">35%</p></div>
                  <div className="rounded-md border bg-background p-2"><p className="text-[10px] text-muted-foreground uppercase">Open Interest</p><p className="font-semibold">1,696</p></div>
                  <div className="rounded-md border bg-background p-2"><p className="text-[10px] text-muted-foreground uppercase">Spread</p><p className="font-semibold">3.8%</p></div>
                </div>
                <p className="text-[10px] text-muted-foreground border-t pt-2">Live data requires broker connection.</p>
              </div>
            </MockPanel>
          }
        />
      </div>
    </section>
  );
}

/* -----------------------------------------------------------
 * SEE HOW AN OPPORTUNITY FITS YOUR PORTFOLIO  (§12 — new)
 * --------------------------------------------------------- */
function PortfolioFitSection() {
  const items = [
    "Existing AI exposure",
    "Semiconductor concentration",
    "Position size impact",
    "Earnings clustering",
    "Cash utilization",
    "Diversification observations",
  ];

  return (
    <section className="py-16 md:py-24 bg-muted/30 border-y" id="portfolio">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <FeatureRow
          testId="feature-portfolio"
          eyebrow="Portfolio Intelligence"
          title="See How an Opportunity Fits Your Portfolio"
          copy="Understand concentration, sector exposure, earnings overlap, cash utilization, and how a candidate could change your portfolio — so you can make a more informed self-directed decision."
          bullets={[
            "Existing sector and theme concentration",
            "Position size and capital impact",
            "Earnings overlap and clustering",
            "Cash utilization context",
            "Neutral observations — you decide what to do",
          ]}
          reverse
          visual={
            <MockPanel title="Portfolio Context">
              <div className="space-y-2 text-sm">
                {items.map((item, i) => (
                  <div key={item} className="flex items-center justify-between border-b last:border-0 pb-1 last:pb-0">
                    <span className="text-xs text-muted-foreground">{item}</span>
                    <Badge
                      variant="outline"
                      className={`text-[9px] ${i < 2 ? "text-amber-600 border-amber-500/40 bg-amber-500/10 dark:text-amber-400" : "text-muted-foreground"}`}
                    >
                      {i < 2 ? "Elevated" : "Moderate"}
                    </Badge>
                  </div>
                ))}
                <p className="text-[10px] text-muted-foreground pt-1">
                  Illustrative example. You decide how to act on this context.
                </p>
              </div>
            </MockPanel>
          }
        />
      </div>
    </section>
  );
}

/* -----------------------------------------------------------
 * BUILT-IN RISK CHECKS  (keep from previous build)
 * --------------------------------------------------------- */
function RiskChecksSection() {
  const blocks = [
    { icon: Award, label: "Filters setups below your minimum grade" },
    { icon: Wallet, label: "Prevents orders that exceed your risk limits" },
    { icon: Activity, label: "Filters illiquid options" },
    { icon: Lock, label: "Restricts naked options when disabled" },
    { icon: Gauge, label: "Warns on weak reward/risk ratios" },
  ];

  return (
    <section className="py-16 md:py-24" id="risk-controls">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 text-center">
        <Badge variant="outline" className="mb-4 text-[11px] border-primary/30 bg-primary/5 text-primary">
          <ShieldAlert className="h-3 w-3 mr-1" />
          Risk Controls
        </Badge>
        <h2 className="text-2xl md:text-3xl font-bold" data-testid="text-guardrails-heading">
          Built-In Risk Checks
        </h2>
        <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
          Your rules are checked before an order can be prepared. Set your limits once — every setup is evaluated against them.
        </p>
        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {blocks.map((b, i) => (
            <Card key={b.label} className="bg-card hover-elevate" data-testid={`card-guardrail-${i}`}>
              <CardContent className="pt-6 pb-5 text-center">
                <div className="mx-auto h-10 w-10 rounded-full border border-destructive/30 bg-destructive/5 flex items-center justify-center mb-3">
                  <b.icon className="h-5 w-5 text-destructive" />
                </div>
                <p className="text-sm font-medium">{b.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------
 * INSTATRADE  (keep from previous build)
 * --------------------------------------------------------- */
function InstaTradeSection({ onStartTrial }: { onStartTrial: () => void }) {
  const { instaTradeName } = useBranding();
  return (
    <section className="py-16 md:py-24 bg-muted/30 border-y" id="instatrade">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <FeatureRow
          testId="feature-instatrade"
          eyebrow={`${instaTradeName} — Order Review`}
          title={`Review and Prepare Orders With ${instaTradeName}`}
          copy="Prepare a reviewed stock or options order through your connected broker. You approve every order before submission — nothing is sent automatically."
          bullets={[
            "Tradier, TradeStation, and SnapTrade-connected brokerages",
            "Explicit confirmation required before submission",
            "Live data through your brokerage connection",
            "Nothing is submitted without your approval",
          ]}
          visual={
            <MockPanel title="Order Review">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Account</span>
                  <span className="font-semibold">Tradier · Live</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Order</span>
                  <span className="font-semibold">BUY 1 AMD 155C 5/22 @ $3.90</span>
                </div>
                <Button
                  size="sm"
                  className="w-full mt-2"
                  onClick={() => {
                    track("start_free_trial_clicked", { location: "instatrade_mock" });
                    onStartTrial();
                  }}
                >
                  <Zap className="h-4 w-4 mr-1.5" />Review with {instaTradeName}
                </Button>
                <p className="text-[10px] text-muted-foreground text-center pt-1">You approve every order before submission.</p>
              </div>
            </MockPanel>
          }
        />
      </div>
    </section>
  );
}

/* -----------------------------------------------------------
 * BUILD YOUR INVESTMENT AND TRADING RECORD  (§13 — updated)
 * --------------------------------------------------------- */
function ProcessSection() {
  return (
    <section className="py-16 md:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <FeatureRow
          testId="feature-history"
          eyebrow="Track Your Process"
          title="Build Your Investment and Trading Record"
          copy="Save opportunity snapshots, record your own thesis and plans, revisit what changed, and improve your decision process over time."
          bullets={[
            "Save long-term investment theses",
            "Save active trade setups",
            "Record user-created decision notes",
            "Track watch conditions",
            "Review thesis changes",
            "Compare previous and current evidence",
          ]}
          reverse
          visual={
            <MockPanel title="Review Summary">
              <div className="space-y-2 text-sm">
                {[
                  { g: "Grade A+", count: 12, color: "bg-emerald-500", w: "100%" },
                  { g: "Grade A",  count: 31, color: "bg-emerald-500/80", w: "80%" },
                  { g: "Grade B",  count: 18, color: "bg-amber-500", w: "50%" },
                  { g: "Grade C",  count:  5, color: "bg-destructive/70", w: "20%" },
                ].map((r) => (
                  <div key={r.g} className="flex items-center gap-3">
                    <span className="text-xs font-medium w-16 text-muted-foreground">{r.g}</span>
                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full ${r.color}`} style={{ width: r.w }} />
                    </div>
                    <span className="text-xs text-muted-foreground w-16 text-right">{r.count} saved</span>
                  </div>
                ))}
                <p className="text-[10px] text-muted-foreground border-t pt-2">
                  Illustrative example — your saved history will vary.
                </p>
              </div>
            </MockPanel>
          }
        />
      </div>
    </section>
  );
}

/* -----------------------------------------------------------
 * PRICING  (§14 — updated for traders + investors)
 * --------------------------------------------------------- */
function PricingSection({ onStartTrial }: { onStartTrial: () => void }) {
  const { instaTradeName, instaTradeFooterNotice } = useBranding();
  const pricing = usePricing();
  const planFeatures = [
    "Long-term stock opportunity analysis",
    "Daily stock and options ideas",
    "Growth and income opportunity discovery",
    "Multi-strategy technical analysis",
    "Portfolio intelligence",
    "Watchlists",
    "Saved research and decision journal",
    "Options strategy insights for calls, puts, debit spreads, credit spreads, covered calls, and cash-secured puts",
    "Risk, reward, breakeven, and capital-requirement review",
    "Opportunity Radar and market condition monitoring",
    "News sentiment and market context",
    "Tradier and TradeStation connections",
    "Broker-connected market data",
    `${instaTradeName} order review and submission`,
    "Defined-risk options controls",
    "Opportunity-to-order workflow",
    "Bonus: Congress trade activity from public disclosures, organized with search, sort, and AI integration",
  ];

  return (
    <section className="py-16 md:py-24 bg-muted/30 border-y" id="pricing">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold" data-testid="text-pricing-heading">
            Simple Pricing. Bring Your Broker.
          </h2>
          <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
            One complete platform for discovering, evaluating, monitoring, and reviewing stock and options opportunities across long-term growth, income, and active trading goals.
          </p>
        </div>

        <div className="max-w-xl mx-auto">
          <Card className="border-primary bg-card flex flex-col relative shadow-xl" data-testid="card-plan-pro">
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
                  <span className="text-2xl font-semibold text-muted-foreground line-through" data-testid="text-standard-price">${pricing.standardMonthlyPrice}</span>
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
              <CardDescription className="mt-2">
                One complete plan for discovering, evaluating, and reviewing stock and options opportunities, with broker-connected data and self-directed order preparation.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col">
              {/* Trial breakdown */}
              <div className="grid sm:grid-cols-2 gap-3 mb-6 text-xs">
                <div className="rounded-md border bg-muted/30 p-3 space-y-1">
                  <p className="font-medium text-foreground/80">Trial — No broker required</p>
                  <ul className="space-y-0.5 text-muted-foreground">
                    <li>· Historical/daily-close stock analysis</li>
                    <li>· Long-term opportunity analysis</li>
                    <li>· Delayed or snapshot market context</li>
                    <li>· Estimated options strategy insights</li>
                  </ul>
                </div>
                <div className="rounded-md border bg-primary/5 border-primary/20 p-3 space-y-1">
                  <p className="font-medium text-foreground/80">Broker connected</p>
                  <ul className="space-y-0.5 text-muted-foreground">
                    <li>· Current stock quotes</li>
                    <li>· Live options chains and Greeks</li>
                    <li>· Account and position context</li>
                    <li>· {instaTradeName} order review and submission</li>
                  </ul>
                </div>
              </div>
              <ul className="space-y-2 mb-6 flex-1">
                {planFeatures.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <div
                className="rounded-lg border border-border bg-muted/40 p-3 flex items-start gap-2 text-xs text-muted-foreground mb-4"
                role="note"
                data-testid="box-trial-disclosure"
              >
                <Info className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                <p>
                  Trial access includes historical daily stock analysis and options strategy insights. Current stock and option prices, options chains, Greeks, bid/ask data, liquidity, account eligibility, buying power, positions, and order submission require a supported brokerage connection.
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
                <p className="text-xs text-muted-foreground text-center">
                  No broker connection required to explore analysis.
                </p>
                <p className="text-xs text-muted-foreground text-center" data-testid="text-supporting-copy">
                  Explore stock and options opportunities without connecting a broker. Connect when you are ready to review current market data and self-directed orders.
                </p>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => {
                    track("explore_analysis_mode_clicked", { location: "pricing" });
                    onStartTrial();
                  }}
                  data-testid="button-explore-analysis"
                >
                  Explore Daily Ideas
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mt-10 max-w-3xl mx-auto space-y-3 text-xs text-muted-foreground text-center">
          <p>
            VCP Trader AI does not provide a separate live market data feed. Live data availability depends on your connected brokerage account, broker entitlements, and market data permissions.
          </p>
          <p>
            All scenarios are AI-generated for informational and educational purposes only. VCP Trader AI is not a broker-dealer or investment adviser and does not provide personalized investment advice.
          </p>
          <p data-testid="text-trademark-notice-pricing">{instaTradeFooterNotice}</p>
        </div>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------
 * COMPLIANCE / TRUST  (§18 — updated disclosure)
 * --------------------------------------------------------- */
function ComplianceSection() {
  return (
    <section className="py-12 md:py-16">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <Card className="bg-muted/30">
          <CardContent className="pt-6 text-center">
            <ShieldCheck className="h-8 w-8 text-primary mx-auto mb-3" />
            <p className="text-sm text-muted-foreground" data-testid="text-compliance">
              VCP Trader AI provides market analysis, opportunity discovery, educational information, and self-directed trade-preparation tools. It does not provide personalized investment advice or manage customer assets. Trading stocks and options involves risk, including loss of principal. Live market data and order submission are available only through supported connected brokerage accounts. You are responsible for every trading and investment decision.
            </p>
          </CardContent>
        </Card>
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
      a: "No. You can start the 14-day trial in Analysis Mode with AI-generated candidates and market context. To access live market data, account balances, options chains, and InstaTrade™ order submission, connect a supported brokerage account such as Tradier or TradeStation.",
    },
    {
      q: "Does VCP Trader AI include live market data?",
      a: "No separate live market data feed is included. Live data comes through your connected brokerage account and depends on your broker's entitlements and permissions.",
    },
    {
      q: "What can I do without connecting a broker?",
      a: "In Analysis Mode you get AI-generated market candidates, long-term opportunity analysis, Opportunity Radar, scoring, news sentiment, Market Intel, watchlists, and educational strategy examples using delayed or snapshot market context. Order submission requires a connected broker.",
    },
    {
      q: "Does the trial include paper trading?",
      a: "No. VCP Trader AI does not provide built-in paper trading, virtual cash, or simulated fills. The trial is an analysis and discovery trial — connect a supported brokerage account for account data and order submission.",
    },
    {
      q: "Does it trade automatically?",
      a: "No. VCP Trader AI does not automatically place trades. Every live order requires user review, acknowledgment, and confirmation through InstaTrade™.",
    },
    {
      q: "Is this investment advice?",
      a: "No. VCP Trader AI provides AI-generated scenarios and market context for educational and informational purposes only. It does not provide personalized investment advice or manage customer assets. You remain responsible for every trading and investment decision.",
    },
    {
      q: "Can I use it for long-term investing, not just trading?",
      a: "Yes. VCP Trader AI supports long-term growth opportunity analysis, thesis monitoring, valuation context, earnings trends, and portfolio intelligence alongside active trade setups and income ideas.",
    },
    {
      q: "Which brokers are supported?",
      a: "Tradier and TradeStation are the primary supported integrations. SnapTrade-connected brokerages are also supported where available. Availability may vary by account type and broker entitlements.",
    },
    {
      q: "Can I cancel anytime?",
      a: "Yes. Subscriptions can be managed and canceled through the billing portal at any time.",
    },
  ];

  return (
    <section className="py-16 md:py-24 bg-muted/30 border-y" id="faq">
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
    <section className="py-16 md:py-20">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 text-center">
        <h2 className="text-2xl md:text-3xl font-bold">Ready to find your next opportunity?</h2>
        <p className="mt-3 text-muted-foreground">Start your 14-day free trial with historical daily market analysis. Connect your broker when you're ready. Review every order before it's sent.</p>
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
 * FOOTER
 * --------------------------------------------------------- */
function LandingFooter() {
  return (
    <footer className="py-12 border-t">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <img src={logoUrl} alt="VCP Trader AI" className="h-6 w-auto" />
            <span className="text-sm font-medium text-muted-foreground">VCP Trader AI · Powered by Sunfish Technologies LLC</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-4 md:gap-6 text-sm">
            <Link href="/terms" className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-footer-terms">Terms</Link>
            <Link href="/disclaimer" className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-footer-disclaimer">Disclaimer</Link>
            <Link href="/privacy" className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-footer-privacy">Privacy</Link>
            <Link href="/open-source" className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-footer-open-source">Open Source</Link>
            <a href="mailto:support@sunfishtrading.com" className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-footer-contact">Contact</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

/* -----------------------------------------------------------
 * PAGE — final section order
 * --------------------------------------------------------- */
export default function HomePage() {
  const [wizardOpen, setWizardOpen] = useState(false);
  const openWizard = () => setWizardOpen(true);

  useEffect(() => {
    // §19 SEO metadata — trader + investor positioning
    document.title = "VCP Trader AI — AI Stock & Options Opportunities for Traders and Investors";
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "description";
      document.head.appendChild(meta);
    }
    meta.content =
      "Discover long-term growth ideas, income opportunities, and active stock and options setups. Understand the evidence, monitor risk, and make your own informed decisions.";
  }, []);

  useEffect(() => {
    const KEY = "sa.landingViewLogged";
    try {
      if (sessionStorage.getItem(KEY)) return;
      sessionStorage.setItem(KEY, "1");
    } catch {
      // sessionStorage may be blocked; still log once per page load
    }
    const payload = {
      eventType: "landing_view",
      path: window.location.pathname + window.location.search,
      referrer: document.referrer || null,
    };
    fetch("/api/audit/page-view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
      keepalive: true,
    }).catch(() => {
      // analytics must never break the UI
    });
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <NavBar onStartTrial={openWizard} />
      <HeroSection onStartTrial={openWizard} />
      <ChooseYourGoalSection onStartTrial={openWizard} />
      <DailyValueSection />
      <TodaysOpportunitiesSection onStartTrial={openWizard} />
      <HowItFindsSection />
      <LongTermInvestorSection onStartTrial={openWizard} />
      <TimeHorizonSection />
      <PlainEnglishSection />
      <OpportunityGradesSection />
      <StocksOptionsSection onStartTrial={openWizard} />
      <OptionsStructureSection />
      <PortfolioFitSection />
      <RiskChecksSection />
      <InstaTradeSection onStartTrial={openWizard} />
      <ProcessSection />
      <PricingSection onStartTrial={openWizard} />
      <ComplianceSection />
      <FAQSection />
      <FinalCtaSection onStartTrial={openWizard} />
      <LandingFooter />
      <MarketingOnboardingWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  );
}
