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
    { href: "#options", label: "Options" },
    { href: "#guardrails", label: "Guardrails" },
    { href: "#pricing", label: "Pricing" },
    { href: "#faq", label: "FAQ" },
  ];

  return (
    <nav className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-4">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2">
              <img src={logoUrl} alt="Strategy Agent" className="h-8 w-auto" data-testid="img-logo" />
              <span className="font-semibold text-lg hidden sm:inline">Strategy Agent</span>
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
                AI Setup
              </Badge>
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-bold">
                <Award className="h-3 w-3" />
                Grade A · 81
              </div>
            </div>
            <p className="font-bold text-lg">AMD · Bullish Pullback</p>
            <p className="text-xs text-muted-foreground">Recommended: Bull Call Spread (defined risk)</p>
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
            Execute via InstaTrade™
          </Button>

          <p className="text-[10px] text-muted-foreground border-t pt-2 flex items-center gap-1">
            <Activity className="h-3 w-3" />
            Software-generated, not investment advice.
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
    "AI Probability Grades",
    "Risk Guardrails",
    "Broker-Ready Orders",
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
              AI Co-Pilot for Active Traders
            </Badge>
            <h1
              className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight"
              data-testid="text-hero-headline"
            >
              Your AI Co-Pilot for{" "}
              <span className="text-primary">Stocks &amp; Options</span>
            </h1>
            <p
              className="mt-6 text-lg md:text-xl text-muted-foreground max-w-xl mx-auto lg:mx-0"
              data-testid="text-hero-subheadline"
            >
              Turn a plain-English trade idea into a broker-ready stock or options setup in seconds — with probability scoring, risk controls, and one-click execution.
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
            <p className="mt-4 text-xs text-muted-foreground" data-testid="text-hero-disclaimer">
              14-day free trial · No credit card to explore in paper mode · Informational only — not investment advice.
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
  const tabs = ["Scanners", "Charts", "Broker", "Options Chain", "News", "Calculators", "Spreadsheets"];
  return (
    <section className="py-16 md:py-24 bg-muted/30 border-y">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 text-center">
        <h2 className="text-2xl md:text-3xl font-bold" data-testid="text-problem-heading">
          Trading Shouldn't Require 7 Tabs and Guesswork
        </h2>
        <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
          Most traders juggle a dozen tools just to size a single trade — switching between scanners, charts, broker platforms, options chains, news feeds, calculators, and spreadsheets.
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
            Strategy Agent is one AI command center for the entire workflow.
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
      icon: Search,
      title: "Find Better Trades",
      copy: "Just type what you're looking for. The agent scans, ranks, and shows only setups worth your time.",
    },
    {
      icon: Layers,
      title: "Trade Stocks or Options",
      copy: "Pick shares, long calls/puts, or defined-risk spreads — the agent recommends the best vehicle.",
    },
    {
      icon: Award,
      title: "Get Probability Grades",
      copy: "Every setup gets a clear A+/A/B/C grade so you know which ideas actually deserve capital.",
    },
    {
      icon: ShieldAlert,
      title: "Avoid Bad Trades",
      copy: "Built-in guardrails block low-quality setups, oversized positions, and illiquid options before you click.",
    },
    {
      icon: Zap,
      title: "Execute Faster",
      copy: "Send orders straight to your connected broker with InstaTrade™ — no copy-pasting tickers.",
    },
    {
      icon: GraduationCap,
      title: "Improve Over Time",
      copy: "Every trade outcome is tracked so you can see what's working and refine your edge.",
    },
  ];

  return (
    <section className="py-16 md:py-24" id="benefits">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold" data-testid="text-benefits-heading">
            Built for Traders Who Want Discipline, Not Noise
          </h2>
          <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
            Outcomes you can feel from day one.
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
      testId: "feature-natural-language",
      eyebrow: "A · Natural Language",
      title: "Natural-Language Trade Setups",
      copy: "Describe what you want like you're texting a smart trading buddy. The agent does the structuring.",
      bullets: [
        "Plain English prompts — symbol, bias, timeframe, style",
        "Pre-built and custom strategies",
        "Structured output: entry, stop, target, R/R, reasoning",
      ],
      visual: (
        <MockPanel title="Prompt → Setup">
          <div className="space-y-2 text-sm">
            <div className="rounded-md border bg-muted/50 p-2 italic">
              "Find me a bullish pullback on NVDA with at least 2R reward."
            </div>
            <div className="rounded-md border bg-background p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold">NVDA · Pullback</span>
                <Badge variant="outline" className="text-[10px]">2.3R</Badge>
              </div>
              <p className="text-xs text-muted-foreground">Entry $478.10 · Stop $471.50 · Target $493.30</p>
            </div>
          </div>
        </MockPanel>
      ),
    },
    {
      testId: "feature-probability",
      eyebrow: "B · Probability Engine",
      title: "AI Probability Engine",
      copy: "Every setup is scored across technical, real-time, news, analyst, and risk factors — then graded.",
      bullets: [
        "Single A+ / A / B / C grade you can trust",
        "Plain-English reasons and warnings on every score",
        "Higher-quality setups float to the top automatically",
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
      eyebrow: "C · Instrument Selector",
      title: "Smart Stock vs Options Selector",
      copy: "The agent picks the best vehicle — shares, long calls/puts, or debit spreads — based on your setup, account, and rules.",
      bullets: [
        "Recommended trade plus an alternative side-by-side",
        "Trade-offs explained in plain English",
        "Honors your defined-risk-only and risk-comfort settings",
      ],
      visual: (
        <MockPanel title="Vehicle Recommendation">
          <div className="space-y-2 text-sm">
            <div className="rounded-md border bg-primary/5 border-primary/30 p-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold">Bull Call Spread</span>
                <Badge variant="default" className="text-[10px]">Recommended</Badge>
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
      eyebrow: "D · Options Intelligence",
      title: "Options Intelligence",
      copy: "Strikes, expiries, and Greeks chosen for you — with liquidity checks built in.",
      bullets: [
        "Auto-selected strikes inside your DTE window",
        "Open interest, volume and bid/ask spread filters",
        "Max profit, max loss, breakeven shown up front",
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
      testId: "feature-guardrails-row",
      eyebrow: "E · Trade Guardrails™",
      title: "Trade Guardrails™",
      copy: "Your rules, enforced before the order leaves the app. Block what doesn't fit; ship what does.",
      bullets: [
        "Minimum probability score and reward/risk floor",
        "Allowed instruments and defined-risk-only modes",
        "Liquidity checks on every options contract",
      ],
      visual: (
        <MockPanel title="Guardrail Block Example">
          <div className="space-y-2 text-sm">
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <div className="flex items-center gap-2 font-semibold text-destructive text-xs">
                <CircleSlash className="h-4 w-4" /> Order Blocked
              </div>
              <p className="text-xs text-muted-foreground mt-1">Setup grade C is below your minimum (B).</p>
            </div>
            <div className="rounded-md border bg-background p-3 text-xs text-muted-foreground">
              Adjust your threshold or pick a higher-graded setup.
            </div>
          </div>
        </MockPanel>
      ),
    },
    {
      testId: "feature-instatrade",
      eyebrow: "F · InstaTrade™",
      title: "InstaTrade™ Execution",
      copy: "Send orders straight to your connected broker without leaving the agent.",
      bullets: [
        "One-click execution for stocks and options",
        "Tradier, TradeStation and Tastytrade supported",
        "Paper mode for risk-free practice",
      ],
      visual: (
        <MockPanel title="One-Click Order">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Account</span>
              <span className="font-semibold">Tradier · Live</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Order</span>
              <span className="font-semibold">BUY 1 AMD 155C 5/22 @ $3.90</span>
            </div>
            <Button size="sm" className="w-full mt-2"><Zap className="h-4 w-4 mr-1.5" />Send Order</Button>
          </div>
        </MockPanel>
      ),
    },
    {
      testId: "feature-history",
      eyebrow: "G · Learning Loop",
      title: "Trade History &amp; Learning",
      copy: "Every executed trade is logged with its outcome — so you can finally see what's actually working.",
      bullets: [
        "Filter by grade, instrument and executed status",
        "Outcomes feed future recommendations",
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
            Everything You Need, In One Agent
          </h2>
          <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
            From idea to execution — and the learning loop after.
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
    <section className="py-16 md:py-24" id="guardrails">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 text-center">
        <Badge variant="outline" className="mb-4 text-[11px] border-primary/30 bg-primary/5 text-primary">
          <ShieldAlert className="h-3 w-3 mr-1" />
          Trade Guardrails™
        </Badge>
        <h2 className="text-2xl md:text-3xl font-bold" data-testid="text-guardrails-heading">
          Your broker lets you place trades.<br className="hidden md:block" />
          Strategy Agent helps stop the ones that don't fit your rules.
        </h2>
        <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
          Set your bar once. Every order is checked against your rules before it ever reaches your broker.
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
  const items = [
    "Covered calls",
    "Cash-secured puts",
    "Long calls / puts",
    "Defined-risk debit spreads",
    "Liquidity checks on every contract",
    "Greeks, breakeven and max loss shown up front",
  ];

  return (
    <section className="py-16 md:py-24 bg-gradient-to-b from-background via-primary/5 to-background border-y" id="options">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 grid lg:grid-cols-2 gap-12 items-center">
        <div>
          <Badge variant="outline" className="mb-4 text-[11px] border-primary/30 bg-primary/5 text-primary">
            <PieChart className="h-3 w-3 mr-1" />
            Options
          </Badge>
          <h2 className="text-2xl md:text-3xl font-bold" data-testid="text-options-heading">
            Built for Options Income Traders Too
          </h2>
          <p className="mt-4 text-muted-foreground">
            Find covered call, cash-secured put, long option, and defined-risk spread ideas with liquidity checks, Greeks, breakevens, and max loss shown before you act.
          </p>
          <ul className="mt-6 grid sm:grid-cols-2 gap-2">
            {items.map((it) => (
              <li key={it} className="flex items-start gap-2 text-sm">
                <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <span>{it}</span>
              </li>
            ))}
          </ul>
          <div className="mt-8">
            <Button
              size="lg"
              onClick={() => {
                track("start_free_trial_clicked", { location: "options_section" });
                onStartTrial();
              }}
              data-testid="button-options-cta"
            >
              Explore Options Mode
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
            <p className="text-[10px] text-muted-foreground border-t pt-2">Software-generated, not investment advice.</p>
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
    "AI Trade Finder",
    "Stock and options setups",
    "Probability grades",
    "Watchlist ideas",
    "Paper / simulated mode",
    "Basic trade history",
  ];
  const eliteFeatures = [
    "Everything in Pro",
    "Live broker connection",
    "InstaTrade™ execution",
    "Advanced options intelligence",
    "Trade Guardrails™",
    "Portfolio insights",
    "AI trade review coach",
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
            Simple Pricing. 14-Day Free Trial.
          </h2>
          <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
            Start free. Upgrade when you're ready to go live. Cancel anytime.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {/* PRO */}
          <Card className="bg-card flex flex-col" data-testid="card-plan-pro">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-xl">Pro</CardTitle>
                <Badge variant="outline" className="text-[11px]">Get started</Badge>
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-4xl font-bold" data-testid="text-pro-price">$79</span>
                <span className="text-muted-foreground">/month</span>
              </div>
              <CardDescription className="mt-1">For traders building a structured workflow.</CardDescription>
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
                Start 14-Day Free Trial
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
                Start 14-Day Free Trial
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* TODO: Wire selected plan to Stripe Checkout (existing javascript_stripe integration). */}
        {/* TODO: Capture pricing_plan_selected event in your analytics provider. */}

        <p className="text-center mt-8 text-xs text-muted-foreground max-w-2xl mx-auto">
          14-day free trial included on both plans. No credit card required to explore in paper mode.
        </p>
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
              Strategy Agent provides software-generated analysis and trading tools for educational and informational purposes only. It does not provide personalized investment advice. You remain responsible for every trade decision and order submitted.
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
      q: "Does Strategy Agent place trades automatically?",
      a: "No. By default, you review and approve every trade. Optional automation modes only act within rules you set explicitly, and you can pause or stop them at any time.",
    },
    {
      q: "Is this investment advice?",
      a: "No. Strategy Agent is software for self-directed traders. It generates structured analysis and setups for informational purposes only — not personalized investment advice. You stay in control of every decision.",
    },
    {
      q: "Can I use paper mode first?",
      a: "Yes. You can explore setups, grades, and the full workflow in paper / simulated mode before connecting a live broker.",
    },
    {
      q: "Does it support options?",
      a: "Yes. Strategy Agent supports long calls, long puts, debit spreads, covered calls, and cash-secured puts — with liquidity checks, Greeks, breakeven, and max loss shown for every recommendation.",
    },
    {
      q: "Can I set my own risk rules?",
      a: "Absolutely. You set the minimum probability grade, reward/risk floor, allowed instruments, options liquidity filters, and execution defaults. Trade Guardrails™ block anything that doesn't fit.",
    },
    {
      q: "Which brokers are supported?",
      a: "Tradier, TradeStation, and Tastytrade are supported today, with more on the roadmap. You can connect your broker from Settings.",
    },
    {
      q: "Can I cancel anytime?",
      a: "Yes — both plans are month-to-month with no long-term commitment. You can cancel from your settings at any time.",
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
        <h2 className="text-2xl md:text-3xl font-bold">Ready to trade with discipline?</h2>
        <p className="mt-3 text-muted-foreground">Start your free 14-day trial — under 60 seconds to set up.</p>
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
            <img src={logoUrl} alt="Strategy Agent" className="h-6 w-auto" />
            <span className="text-sm font-medium text-muted-foreground">Strategy Agent</span>
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
