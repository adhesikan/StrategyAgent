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
  PlayCircle,
  Lock,
  GraduationCap,
} from "lucide-react";
import logoUrl from "@assets/ChatGPT_Image_Jan_1,_2026,_01_38_07_PM_1767292703801.png";
import { useState } from "react";
import { track } from "@/lib/analytics";
import { MarketingOnboardingWizard } from "@/components/marketing-onboarding-wizard";

/* -----------------------------------------------------------
 * NAV
 * --------------------------------------------------------- */
function NavBar({ onStartTrial }: { onStartTrial: () => void }) {
  const { isAuthenticated } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navLinks = [
    { href: "#features", label: "Features" },
    { href: "#stocks", label: "Stocks" },
    { href: "#options", label: "Options" },
    { href: "#instatrade", label: "InstaTrade™" },
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
            <div className="hidden md:flex items-center gap-6">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                  data-testid={`link-nav-${link.label.toLowerCase()}`}
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
 * MOCK SETUP CARD (used in hero + below)
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
            <Badge variant="secondary" className="text-[11px]">AMD · 15m</Badge>
          </div>
          <p className="text-sm mt-2 italic text-muted-foreground" data-testid="text-hero-prompt">
            "Find me a high-probability bullish setup on AMD with defined risk."
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="border-t pt-3">
            <div className="flex items-center justify-between mb-2">
              <Badge variant="outline" className="text-[11px] bg-background">
                <Sparkles className="h-3 w-3 mr-1" />
                AI Scenario
              </Badge>
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-bold">
                <Award className="h-3 w-3" />
                Grade A · 81
              </div>
            </div>
            <p className="font-bold text-lg">AMD · Bullish Pullback</p>
            <p className="text-xs text-muted-foreground">Candidate vehicle: Bull Call Spread (defined risk)</p>
          </div>

          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-md border bg-background p-2">
              <p className="text-[10px] text-muted-foreground uppercase">Entry</p>
              <p className="font-semibold">$152.40</p>
            </div>
            <div className="rounded-md border bg-background p-2">
              <p className="text-[10px] text-muted-foreground uppercase">Stop</p>
              <p className="font-semibold">$149.80</p>
            </div>
            <div className="rounded-md border bg-background p-2">
              <p className="text-[10px] text-muted-foreground uppercase">Target</p>
              <p className="font-semibold">$158.10</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-md border bg-background p-2">
              <p className="text-[10px] text-muted-foreground uppercase">Max Loss</p>
              <p className="font-semibold text-destructive">$185</p>
            </div>
            <div className="rounded-md border bg-background p-2">
              <p className="text-[10px] text-muted-foreground uppercase">Max Profit</p>
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
            Software-generated scenario. Review before acting.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/* -----------------------------------------------------------
 * HERO
 * --------------------------------------------------------- */
function HeroSection({ onStartTrial }: { onStartTrial: () => void }) {
  const trustBadges = [
    "Stocks + Options",
    "Daily AI Ideas",
    "Risk Checks",
    "InstaTrade™",
    "Broker-Connected Data",
  ];

  return (
    <section className="relative overflow-hidden">
      {/* Subtle trading-grid background */}
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
              AI Trading Assistant for Self-Directed Traders
            </Badge>
            <h1
              className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight"
              data-testid="text-hero-headline"
            >
              Trade Stocks &amp; Options{" "}
              <span className="text-primary">Smarter With AI</span>
            </h1>
            <p
              className="mt-6 text-lg md:text-xl text-muted-foreground max-w-xl mx-auto lg:mx-0"
              data-testid="text-hero-subheadline"
            >
              VCP Trader AI helps self-directed traders discover stock and options opportunities, understand risks, and send reviewed orders through their connected broker with InstaTrade™.
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
                  track("watch_demo_clicked", { location: "hero" });
                  const el = document.getElementById("features");
                  el?.scrollIntoView({ behavior: "smooth" });
                }}
                data-testid="button-hero-demo"
              >
                <PlayCircle className="mr-2 h-4 w-4" />
                Watch Demo
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
              14-day free trial. Explore in paper/simulated mode. Live market data is provided through your connected brokerage account. Informational only — not investment advice.
            </p>
            <p className="mt-2 text-[11px] text-muted-foreground/80">
              Powered by Strategy Agent
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
 * PROBLEM
 * --------------------------------------------------------- */
function ProblemSection() {
  const tabs = ["Scanners", "Charts", "Broker", "Options Chain", "News", "Risk Math", "Journal"];
  return (
    <section className="py-16 md:py-24 bg-muted/30 border-y">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 text-center">
        <h2 className="text-2xl md:text-3xl font-bold" data-testid="text-problem-heading">
          Trading Shouldn't Require 7 Tabs and Guesswork
        </h2>
        <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
          Most traders bounce between scanners, charts, broker platforms, option chains, news feeds, calculators, and spreadsheets just to evaluate one idea.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
          {tabs.map((t) => (
            <Badge
              key={t}
              variant="outline"
              className="text-xs bg-background"
              data-testid={`badge-tab-${t.toLowerCase().replace(/\s/g, "-")}`}
            >
              {t}
            </Badge>
          ))}
        </div>
        <div className="mt-10 flex items-center justify-center gap-3">
          <ArrowRight className="h-5 w-5 text-primary" />
          <p className="text-base md:text-lg font-medium">
            VCP Trader AI brings opportunity discovery, market context, risk checks, and self-directed order review into one simple workflow.
          </p>
        </div>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------
 * BENEFITS
 * --------------------------------------------------------- */
function BenefitsSection() {
  const benefits = [
    {
      icon: Sparkles,
      title: "Daily Stock & Options Ideas",
      copy: "See AI-ranked candidate scenarios based on market data, sentiment, and your selected limits.",
    },
    {
      icon: MessageSquare,
      title: "Simple Plain-English Workflow",
      copy: "Ask for what you want — growth, income, a ticker setup, or market context.",
    },
    {
      icon: Layers,
      title: "Stocks or Options",
      copy: "Review stock setups, long calls/puts, spreads, covered calls, and cash-secured puts.",
    },
    {
      icon: ShieldCheck,
      title: "Built-In Risk Checks",
      copy: "Your selected limits help filter oversized, illiquid, or low-quality scenarios.",
    },
    {
      icon: Zap,
      title: "InstaTrade™ Review",
      copy: "Prepare a broker-ready order after reviewing the setup. Nothing is sent without your confirmation.",
    },
    {
      icon: GraduationCap,
      title: "Learn Over Time",
      copy: "Track reviewed, paper-traded, and executed ideas so you can see what's working.",
    },
  ];

  return (
    <section className="py-16 md:py-24" id="benefits">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold" data-testid="text-benefits-heading">
            Built for Traders Who Want Clarity, Not Noise
          </h2>
          <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
            Find ideas faster, understand the tradeoffs, and stay in control before every order.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {benefits.map((b, i) => (
            <Card key={b.title} className="bg-card hover-elevate" data-testid={`card-benefit-${i}`}>
              <CardContent className="pt-6">
                <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center mb-4">
                  <b.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold text-base">{b.title}</h3>
                <p className="text-sm text-muted-foreground mt-2">{b.copy}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------
 * FEATURE ROWS (A–G)
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

function FeaturesSection() {
  const rows: FeatureRowProps[] = [
    {
      testId: "feature-daily-ideas",
      eyebrow: "A · Daily AI Ideas",
      title: "Daily AI Ideas for Stocks & Options",
      copy: "VCP Trader AI scans your watchlist, market conditions, news sentiment, and selected limits to surface simple candidate scenarios.",
      bullets: [
        "Growth ideas",
        "Income ideas",
        "Watchlist alerts",
        "Market context",
      ],
      visual: (
        <MockPanel title="Today's Ideas">
          <div className="space-y-2 text-sm">
            <div className="rounded-md border bg-background p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold">AMD · Bullish Pullback</span>
                <Badge variant="outline" className="text-[10px]">A · 81</Badge>
              </div>
              <p className="text-xs text-muted-foreground">Stock candidate · Max risk $185</p>
            </div>
            <div className="rounded-md border bg-background p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold">SPY · Cash-Secured Put</span>
                <Badge variant="outline" className="text-[10px]">A · 79</Badge>
              </div>
              <p className="text-xs text-muted-foreground">Income candidate · 28 DTE</p>
            </div>
          </div>
        </MockPanel>
      ),
    },
    {
      testId: "feature-plain-english",
      eyebrow: "B · Plain-English Trade Requests",
      title: "Ask in Plain English",
      copy: "Type what you're looking for, such as \"find income ideas under $200 risk\" or \"show bullish setups on NVDA.\"",
      bullets: [
        "No complex setup required",
        "Beginner-friendly prompts",
        "Advanced controls available when needed",
      ],
      visual: (
        <MockPanel title="Prompt → Ideas">
          <div className="space-y-2 text-sm">
            <div className="rounded-md border bg-muted/50 p-2 italic">
              "Find income ideas under $200 risk."
            </div>
            <div className="rounded-md border bg-background p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold">AAPL · Covered Call</span>
                <Badge variant="outline" className="text-[10px]">B · 73</Badge>
              </div>
              <p className="text-xs text-muted-foreground">Income candidate · Premium ~$165</p>
            </div>
          </div>
        </MockPanel>
      ),
    },
    {
      testId: "feature-scoring",
      eyebrow: "C · AI Scenario Grades",
      title: "AI Scenario Grades",
      copy: "Each candidate scenario receives a clear A+/A/B/C grade with plain-English reasons and risk warnings.",
      bullets: [
        "Single A+ / A / B / C grade per scenario",
        "Plain-English reasons and warnings on every score",
        "Higher-quality scenarios surface automatically",
      ],
      visual: (
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
              <span>Real-time</span>
              <div className="flex items-center gap-2">
                <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full w-[72%] bg-primary" /></div>
                <span className="font-semibold w-7 text-right">72</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span>News</span>
              <div className="flex items-center gap-2">
                <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full w-[60%] bg-primary" /></div>
                <span className="font-semibold w-7 text-right">60</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span>Analyst</span>
              <div className="flex items-center gap-2">
                <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full w-[68%] bg-primary" /></div>
                <span className="font-semibold w-7 text-right">68</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span>Risk</span>
              <div className="flex items-center gap-2">
                <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full w-[75%] bg-primary" /></div>
                <span className="font-semibold w-7 text-right">75</span>
              </div>
            </div>
            <div className="flex items-center justify-between border-t pt-2">
              <span className="font-semibold">Final</span>
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-bold">
                <Award className="h-3 w-3" /> Grade A · 78
              </div>
            </div>
          </div>
        </MockPanel>
      ),
    },
    {
      testId: "feature-instrument",
      eyebrow: "D · Stock vs Options Helper",
      title: "Stocks or Options — Explained Simply",
      copy: "Compare possible vehicles such as shares, long calls/puts, debit spreads, covered calls, or cash-secured puts. The app helps compare possible vehicles.",
      bullets: [
        "Possible vehicle plus an alternative side-by-side",
        "Trade-offs explained in plain English",
        "Honors your defined-risk-only and risk-comfort settings",
      ],
      visual: (
        <MockPanel title="Vehicle Comparison">
          <div className="space-y-2 text-sm">
            <div className="rounded-md border bg-primary/5 border-primary/30 p-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold">Bull Call Spread</span>
                <Badge variant="default" className="text-[10px]">Defined risk</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Defined risk · Lower cost · Capped upside</p>
            </div>
            <div className="rounded-md border bg-background p-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold">Long Call</span>
                <Badge variant="outline" className="text-[10px]">Alternative</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Higher upside · Higher premium · Time decay</p>
            </div>
          </div>
        </MockPanel>
      ),
    },
    {
      testId: "feature-options",
      eyebrow: "E · Options Intelligence",
      title: "Options Made Easier",
      copy: "View key contract details, liquidity checks, max loss, breakeven, and payoff context before acting.",
      bullets: [
        "Open interest and volume checks",
        "Bid/ask spread checks",
        "Max loss and breakeven shown up front",
        "Greeks available in advanced view",
      ],
      visual: (
        <MockPanel title="Selected Contract">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md border bg-background p-2"><p className="text-[10px] text-muted-foreground uppercase">Strike</p><p className="font-semibold">$155 Call</p></div>
            <div className="rounded-md border bg-background p-2"><p className="text-[10px] text-muted-foreground uppercase">Expiry</p><p className="font-semibold">34 DTE</p></div>
            <div className="rounded-md border bg-background p-2"><p className="text-[10px] text-muted-foreground uppercase">Delta</p><p className="font-semibold">0.53</p></div>
            <div className="rounded-md border bg-background p-2"><p className="text-[10px] text-muted-foreground uppercase">IV</p><p className="font-semibold">35%</p></div>
            <div className="rounded-md border bg-background p-2"><p className="text-[10px] text-muted-foreground uppercase">Open Interest</p><p className="font-semibold">1,696</p></div>
            <div className="rounded-md border bg-background p-2"><p className="text-[10px] text-muted-foreground uppercase">Spread</p><p className="font-semibold">3.8%</p></div>
          </div>
        </MockPanel>
      ),
    },
    {
      testId: "feature-risk-controls",
      eyebrow: "F · Risk Controls",
      title: "Built-In Risk Controls",
      copy: "Your rules are checked before an order can be prepared.",
      bullets: [
        "Minimum grade",
        "Max risk per idea",
        "Allowed instruments",
        "Defined-risk preferences",
        "Liquidity filters",
      ],
      visual: (
        <MockPanel title="Risk Check Example">
          <div className="space-y-2 text-sm">
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <div className="flex items-center gap-2 font-semibold text-destructive text-xs">
                <CircleSlash className="h-4 w-4" /> Blocked by your rules
              </div>
              <p className="text-xs text-muted-foreground mt-1">Scenario grade C is below your minimum (B).</p>
            </div>
            <div className="rounded-md border bg-background p-3 text-xs text-muted-foreground">
              Adjust your threshold or pick a higher-graded scenario.
            </div>
          </div>
        </MockPanel>
      ),
    },
    {
      testId: "feature-instatrade",
      eyebrow: "G · InstaTrade™",
      title: "Self-Directed InstaTrade™ Execution",
      copy: "Prepare reviewed orders through your connected broker. You approve every order before it is submitted.",
      bullets: [
        "Tradier, TradeStation, and SnapTrade-connected brokerages",
        "Paper mode available",
        "Live data through your brokerage connection",
        "Explicit confirmation required before submission",
      ],
      visual: (
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
            <Button size="sm" className="w-full mt-2"><Zap className="h-4 w-4 mr-1.5" />Review with InstaTrade™</Button>
            <p className="text-[10px] text-muted-foreground text-center pt-1">You approve every order before submission.</p>
          </div>
        </MockPanel>
      ),
    },
    {
      testId: "feature-history",
      eyebrow: "H · Journal / Learning",
      title: "Track What You Review and Trade",
      copy: "Review your past ideas, paper trades, executed trades, and outcomes to understand what works for you.",
      bullets: [
        "Filter by grade, instrument and executed status",
        "Outcomes inform future scenarios",
        "Compare your edge across strategies and styles",
      ],
      visual: (
        <MockPanel title="Performance by Grade">
          <div className="space-y-2 text-sm">
            {[
              { g: "A+", win: 78, color: "bg-emerald-500" },
              { g: "A", win: 64, color: "bg-emerald-500/80" },
              { g: "B", win: 51, color: "bg-amber-500" },
              { g: "C", win: 34, color: "bg-destructive/70" },
            ].map((r) => (
              <div key={r.g} className="flex items-center gap-3">
                <span className="font-semibold w-8">{r.g}</span>
                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                  <div className={`h-full ${r.color}`} style={{ width: `${r.win}%` }} />
                </div>
                <span className="text-xs text-muted-foreground w-12 text-right">{r.win}% win</span>
              </div>
            ))}
          </div>
        </MockPanel>
      ),
    },
  ];

  return (
    <section className="py-16 md:py-24 bg-muted/30 border-y" id="features">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-2xl md:text-3xl font-bold" data-testid="text-features-heading">
            Everything You Need to Review a Trade — In One Workflow
          </h2>
          <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
            From idea discovery to risk review to InstaTrade™ order preparation.
          </p>
        </div>
        <div className="space-y-20">
          {rows.map((row, i) => (
            <FeatureRow key={row.testId} {...row} reverse={i % 2 === 1} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------
 * GUARDRAILS — major differentiator
 * --------------------------------------------------------- */
function GuardrailsSection() {
  const blocks = [
    { icon: Award, label: "Blocks low-grade setups" },
    { icon: Wallet, label: "Blocks oversized positions" },
    { icon: Activity, label: "Blocks illiquid options" },
    { icon: Lock, label: "Blocks naked options if disabled" },
    { icon: Gauge, label: "Warns on weak reward/risk" },
  ];

  return (
    <section className="py-16 md:py-24" id="risk-controls">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 text-center">
        <Badge variant="outline" className="mb-4 text-[11px] border-primary/30 bg-primary/5 text-primary">
          <ShieldAlert className="h-3 w-3 mr-1" />
          Risk Controls
        </Badge>
        <h2 className="text-2xl md:text-3xl font-bold" data-testid="text-guardrails-heading">
          Your broker lets you place trades.<br className="hidden md:block" />
          VCP Trader AI helps stop the ones that don't fit your rules.
        </h2>
        <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
          Set your bar once. Every order is checked against your rules before you submit it through your broker.
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
 * OPTIONS INCOME
 * --------------------------------------------------------- */
function OptionsIncomeSection({ onStartTrial }: { onStartTrial: () => void }) {
  const stockItems = [
    "Swing setups",
    "Pullbacks",
    "Breakouts",
    "Watchlist opportunities",
  ];
  const optionItems = [
    "Covered calls",
    "Cash-secured puts",
    "Long calls / puts",
    "Defined-risk debit spreads",
    "Liquidity checks",
    "Breakeven and max loss shown before order review",
  ];

  return (
    <section className="py-16 md:py-24 bg-gradient-to-b from-background via-primary/5 to-background border-y" id="stocks">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 grid lg:grid-cols-2 gap-12 items-center">
        <div>
          <Badge variant="outline" className="mb-4 text-[11px] border-primary/30 bg-primary/5 text-primary">
            <PieChart className="h-3 w-3 mr-1" />
            Stocks &amp; Options
          </Badge>
          <h2 id="options" className="text-2xl md:text-3xl font-bold scroll-mt-20" data-testid="text-options-heading">
            Built for Stock and Options Traders
          </h2>
          <p className="mt-4 text-muted-foreground">
            Whether you prefer shares, swing setups, covered calls, cash-secured puts, long calls/puts, or defined-risk spreads, VCP Trader AI helps you review opportunities with risk and liquidity context.
          </p>
          <div className="mt-6 grid sm:grid-cols-2 gap-6">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Stocks</p>
              <ul className="space-y-2">
                {stockItems.map((it) => (
                  <li key={it} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Options</p>
              <ul className="space-y-2">
                {optionItems.map((it) => (
                  <li key={it} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-8">
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
        <MockPanel title="Income Idea">
          <div className="space-y-3 text-sm">
            <div className="rounded-md border bg-background p-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold">SPY · Cash-Secured Put</span>
                <Badge variant="outline" className="text-[10px]">A · 79</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Sell 1 SPY 425P · 28 DTE</p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-md border bg-background p-2"><p className="text-[10px] text-muted-foreground uppercase">Premium</p><p className="font-semibold text-emerald-600 dark:text-emerald-400">$245</p></div>
              <div className="rounded-md border bg-background p-2"><p className="text-[10px] text-muted-foreground uppercase">Breakeven</p><p className="font-semibold">$422.55</p></div>
              <div className="rounded-md border bg-background p-2"><p className="text-[10px] text-muted-foreground uppercase">Max Risk</p><p className="font-semibold">$42,255</p></div>
            </div>
            <p className="text-[10px] text-muted-foreground border-t pt-2">Software-generated scenario. Review before acting.</p>
          </div>
        </MockPanel>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------
 * PRICING — Pro $79 / Elite $149
 * --------------------------------------------------------- */
function PricingSection({ onStartTrial }: { onStartTrial: () => void }) {
  const proFeatures = [
    "Daily AI stock ideas",
    "Daily AI options ideas",
    "Grow, Income, Trade, and Markets modes",
    "News sentiment and market context",
    "Watchlist intelligence",
    "Paper/simulated trading",
    "Basic Opportunity Radar",
    "Broker connection support",
    "InstaTrade™ order preparation",
    "Live market data through connected brokerage account",
  ];
  const eliteFeatures = [
    "Everything in Pro",
    "Advanced Opportunity Radar",
    "Advanced options analytics",
    "Advanced filters",
    "Scenario scoring breakdowns",
    "Portfolio and position context from connected broker",
    "Journal analytics",
    "AI trade review insights",
    "Multi-broker support, where available",
    "Priority scans",
  ];

  const handleSelect = (plan: "pro" | "elite") => {
    track("pricing_plan_selected", { plan });
    onStartTrial();
  };

  return (
    <section className="py-16 md:py-24" id="pricing">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold" data-testid="text-pricing-heading">
            Simple Pricing. Bring Your Broker.
          </h2>
          <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
            Start in paper/simulated mode. Connect your brokerage for live market data and self-directed InstaTrade™ order submission.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            14-day free trial. Upgrade when ready. Cancel anytime.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {/* PRO */}
          <Card className="bg-card flex flex-col" data-testid="card-plan-pro">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-xl">Pro</CardTitle>
                <Badge variant="outline" className="text-[11px]">Best for most traders</Badge>
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-4xl font-bold" data-testid="text-pro-price">$79</span>
                <span className="text-muted-foreground">/month</span>
              </div>
              <CardDescription className="mt-1">Daily AI stock and options ideas, plus broker-connected order preparation.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col">
              <ul className="space-y-2 mb-6 flex-1">
                {proFeatures.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Button
                size="lg"
                variant="outline"
                onClick={() => handleSelect("pro")}
                data-testid="button-select-pro"
              >
                Start Pro Trial
              </Button>
            </CardContent>
          </Card>

          {/* ELITE */}
          <Card className="border-primary bg-card flex flex-col relative shadow-lg" data-testid="card-plan-elite">
            <Badge className="absolute -top-3 left-1/2 -translate-x-1/2" data-testid="badge-elite-best">
              Best for active traders
            </Badge>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-xl">Elite</CardTitle>
                <Badge className="text-[11px]">Most popular</Badge>
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-4xl font-bold" data-testid="text-elite-price">$149</span>
                <span className="text-muted-foreground">/month</span>
              </div>
              <CardDescription className="mt-1">For active stock and options traders who want every edge.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col">
              <ul className="space-y-2 mb-6 flex-1">
                {eliteFeatures.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Button
                size="lg"
                onClick={() => handleSelect("elite")}
                data-testid="button-select-elite"
              >
                Start Elite Trial
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="mt-10 max-w-3xl mx-auto space-y-3 text-xs text-muted-foreground text-center">
          <p>
            VCP Trader AI does not include a separate live market data feed. Live quotes, option chains, account balances, positions, and order submission are available through supported brokerage connections and the user's brokerage entitlements.
          </p>
          <p>
            All scenarios are software-generated for informational and educational purposes only. VCP Trader AI is not a broker-dealer or investment adviser and does not provide personalized investment advice.
          </p>
        </div>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------
 * COMPLIANCE / TRUST
 * --------------------------------------------------------- */
function ComplianceSection() {
  return (
    <section className="py-12 md:py-16">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <Card className="bg-muted/30">
          <CardContent className="pt-6 text-center">
            <ShieldCheck className="h-8 w-8 text-primary mx-auto mb-3" />
            <p className="text-sm text-muted-foreground" data-testid="text-compliance">
              VCP Trader AI provides software-generated trading scenarios, market context, and workflow tools for educational and informational purposes only. It is not a broker-dealer, investment adviser, or fiduciary and does not provide personalized investment advice. Trading stocks and options involves risk, including loss of principal. Live market data and order submission are available only through supported connected brokerage accounts. You are responsible for every trading decision and order submitted.
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
      q: "Does VCP Trader AI place trades automatically?",
      a: "No. VCP Trader AI does not place trades automatically. It can help generate software-based stock and options scenarios and prepare an order ticket through InstaTrade™, but every live order requires your review, acknowledgment, and confirmation before it is submitted to your connected broker.",
    },
    {
      q: "Is this investment advice?",
      a: "No. VCP Trader AI provides software-generated scenarios and market context for educational and informational purposes only. You remain responsible for every decision and order.",
    },
    {
      q: "Do you provide live market data?",
      a: "VCP Trader AI does not provide a separate live market data feed. Live market data is accessed through your connected brokerage account, subject to your broker's entitlements and availability.",
    },
    {
      q: "Can I use paper mode first?",
      a: "Yes. You can explore in paper or simulated mode before connecting a live brokerage account.",
    },
    {
      q: "Does it support both stocks and options?",
      a: "Yes. VCP Trader AI supports stock ideas, long calls/puts, covered calls, cash-secured puts, and defined-risk spreads where supported by your broker.",
    },
    {
      q: "Which brokers are supported?",
      a: "Supported broker connections may include Tradier, TradeStation, SnapTrade-connected brokerages, and others as enabled in the app. Availability may vary by account type and broker support.",
    },
    {
      q: "Can I set my own limits?",
      a: "Yes. You can set allowed instruments, max risk per idea, minimum grade, liquidity preferences, and other risk controls.",
    },
    {
      q: "Can I cancel anytime?",
      a: "Yes. Subscriptions can be managed through the billing portal.",
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
    <section className="py-16 md:py-20" id="instatrade">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 text-center">
        <h2 className="text-2xl md:text-3xl font-bold">Ready to trade with clarity?</h2>
        <p className="mt-3 text-muted-foreground">Start your free 14-day trial. Bring your broker. Review every order before it's sent.</p>
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
          <a href="#features">
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
            <span className="text-sm font-medium text-muted-foreground">VCP Trader AI · Powered by Strategy Agent</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-4 md:gap-6 text-sm">
            <Link href="/terms" className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-footer-terms">Terms</Link>
            <Link href="/disclaimer" className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-footer-disclaimer">Disclaimer</Link>
            <Link href="/privacy" className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-footer-privacy">Privacy</Link>
            <Link href="/open-source" className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-footer-open-source">Open Source</Link>
            <a href="mailto:support@sunfishtechnologies.com" className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-footer-contact">Contact</a>
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

  return (
    <div className="min-h-screen bg-background">
      <NavBar onStartTrial={openWizard} />
      <HeroSection onStartTrial={openWizard} />
      <ProblemSection />
      <BenefitsSection />
      <FeaturesSection />
      <GuardrailsSection />
      <OptionsIncomeSection onStartTrial={openWizard} />
      <PricingSection onStartTrial={openWizard} />
      <ComplianceSection />
      <FAQSection />
      <FinalCtaSection onStartTrial={openWizard} />
      <LandingFooter />
      <MarketingOnboardingWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  );
}
