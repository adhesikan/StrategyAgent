import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  BarChart3,
  Link2,
  Target,
  Check,
  ArrowRight,
  Menu,
  X,
  Sparkles,
  LineChart,
  Brain,
  BookOpen,
  Zap,
  TrendingUp,
  MessageSquare,
  Layers,
  ShieldCheck,
} from "lucide-react";
import logoUrl from "@assets/ChatGPT_Image_Jan_1,_2026,_01_38_07_PM_1767292703801.png";
import { useState, useMemo } from "react";
import { isPromoActive, PROMO_CONFIG, PROMO_CODE } from "@shared/promo";

function PromoBanner() {
  const promoActive = useMemo(() => isPromoActive(), []);

  if (!promoActive) return null;

  const handleClick = () => {
    const pricingSection = document.getElementById("pricing");
    if (pricingSection) {
      pricingSection.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <div className="bg-primary text-primary-foreground py-2 px-4" data-testid="banner-promo">
      <div className="mx-auto max-w-7xl flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 text-center">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          <span className="font-medium text-sm">
            Early Access — 50% off Strategy Agent Pro until {PROMO_CONFIG.endDateDisplay}.
          </span>
        </div>
        <span className="text-xs opacity-90 hidden md:inline">
          Lock in ${PROMO_CONFIG.promoPrice}/mo (normally ${PROMO_CONFIG.standardPrice}/mo). Cancel anytime.
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleClick}
          className="shrink-0"
          data-testid="button-promo-cta"
        >
          Claim Early Access
        </Button>
      </div>
    </div>
  );
}

function NavBar() {
  const { isAuthenticated } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navLinks = [
    { href: "#features", label: "Features" },
    { href: "#how-it-works", label: "How It Works" },
    { href: "#pricing", label: "Pricing" },
    { href: "#faq", label: "FAQ" },
    { href: "/terms", label: "Legal" },
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
                link.href.startsWith("#") ? (
                  <a
                    key={link.href}
                    href={link.href}
                    className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                    data-testid={`link-nav-${link.label.toLowerCase().replace(/\s/g, "-")}`}
                  >
                    {link.label}
                  </a>
                ) : (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                    data-testid={`link-nav-${link.label.toLowerCase().replace(/\s/g, "-")}`}
                  >
                    {link.label}
                  </Link>
                )
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
                    <Button variant="ghost" data-testid="button-sign-in">Sign In</Button>
                  </Link>
                  <Link href="/auth">
                    <Button data-testid="button-start-trial">Start Free Trial</Button>
                  </Link>
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
                link.href.startsWith("#") ? (
                  <a
                    key={link.href}
                    href={link.href}
                    className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors py-2"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {link.label}
                  </a>
                ) : (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors py-2"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {link.label}
                  </Link>
                )
              ))}
              <div className="flex flex-col gap-2 pt-4 border-t">
                {isAuthenticated ? (
                  <Link href="/home">
                    <Button className="w-full" data-testid="button-go-to-dashboard-mobile">Go to Dashboard</Button>
                  </Link>
                ) : (
                  <>
                    <Link href="/auth">
                      <Button variant="outline" className="w-full" data-testid="button-sign-in-mobile">Sign In</Button>
                    </Link>
                    <Link href="/auth">
                      <Button className="w-full" data-testid="button-start-trial-mobile">Start Free Trial</Button>
                    </Link>
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

function HeroSection() {
  const { isAuthenticated } = useAuth();

  return (
    <section className="py-16 md:py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
        <Badge variant="outline" className="mb-6 text-xs py-1 px-3 border-primary/30 bg-primary/5 text-primary">
          <Bot className="h-3 w-3 mr-1" />
          AI-Powered Trading Intelligence
        </Badge>
        <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight max-w-4xl mx-auto" data-testid="text-hero-headline">
          Describe Your Strategy. Get Structured Setups. Execute with Confidence.
        </h1>
        <p className="mt-6 text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto" data-testid="text-hero-subheadline">
          Strategy Agent turns your trading ideas into structured, actionable setups with entry, stop, targets, and reasoning — powered by AI analysis.
        </p>
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          {isAuthenticated ? (
            <Link href="/home">
              <Button size="lg" data-testid="button-hero-dashboard">
                Go to Dashboard
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          ) : (
            <>
              <Link href="/auth">
                <Button size="lg" data-testid="button-hero-trial">
                  Get Started Free
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <a href="#how-it-works">
                <Button variant="outline" size="lg" data-testid="button-hero-how">
                  See How It Works
                </Button>
              </a>
            </>
          )}
        </div>
        <p className="mt-4 text-sm text-muted-foreground" data-testid="text-hero-disclaimer">
          Informational only — not investment advice.
        </p>
      </div>
    </section>
  );
}

function TrustStrip() {
  const features = [
    { icon: MessageSquare, text: "Natural language setup generation" },
    { icon: Brain, text: "AI-powered strategy analysis" },
    { icon: Link2, text: "Broker-connected execution" },
    { icon: ShieldCheck, text: "Compliance-safe outputs" },
  ];

  return (
    <section className="py-8 border-y bg-muted/30">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row items-center justify-center gap-6 sm:gap-12">
          {features.map((feature, index) => (
            <div key={index} className="flex items-center gap-2 text-sm text-muted-foreground">
              <feature.icon className="h-4 w-4 text-primary" />
              <span data-testid={`text-trust-${index}`}>{feature.text}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  const features = [
    { icon: MessageSquare, title: "Natural language prompts", description: "Describe setups in plain English — the agent interprets and structures them" },
    { icon: Target, title: "Structured trade setups", description: "Get clear entry, stop-loss, targets, reward/risk, and strategy reasoning" },
    { icon: Layers, title: "Built-in + custom strategies", description: "Use pre-built strategies or create your own with plain-text rules" },
    { icon: Brain, title: "AI strategy analysis", description: "Intelligent pattern matching and scoring for every generated setup" },
    { icon: Zap, title: "InstaTrade™ execution", description: "Send setups directly to your broker for streamlined order placement" },
    { icon: Link2, title: "Broker connections", description: "Connect Tradier, TradeStation, or Tastytrade for live data and execution" },
    { icon: LineChart, title: "Interactive charts", description: "Review setups with full charting, support and resistance levels" },
    { icon: Bell, title: "Alert & notification system", description: "Get notified when setups trigger or conditions change" },
    { icon: BookOpen, title: "Activity & history tracking", description: "Full audit trail of every setup generated, reviewed, and executed" },
  ];

  return (
    <section className="py-16 md:py-24 bg-muted/30" id="features">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold" data-testid="text-features-heading">
            Everything You Need for AI-Powered Trading
          </h2>
          <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
            From idea to execution, Strategy Agent handles the entire workflow
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <Card key={index} className="bg-background">
              <CardContent className="pt-6">
                <div className="flex items-start gap-4">
                  <div className="p-2 rounded-md bg-primary/10">
                    <feature.icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-medium" data-testid={`text-feature-title-${index}`}>{feature.title}</h3>
                    <p className="text-sm text-muted-foreground mt-1" data-testid={`text-feature-desc-${index}`}>{feature.description}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  const steps = [
    { number: "1", title: "Describe your setup", description: 'Use plain English like "Give me a 15-minute ORB setup on TSLA"' },
    { number: "2", title: "Agent generates a structured setup", description: "AI interprets your prompt and produces entry, stop, targets, and reasoning" },
    { number: "3", title: "Review and execute", description: "Examine the TradeSetupCard, view the chart, and optionally send to InstaTrade™" },
  ];

  return (
    <section className="py-16 md:py-24" id="how-it-works">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold" data-testid="text-hiw-heading">How It Works</h2>
          <p className="mt-3 text-muted-foreground">Three steps from idea to execution</p>
        </div>
        <div className="grid md:grid-cols-3 gap-8">
          {steps.map((step, index) => (
            <div key={index} className="text-center">
              <div className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-lg font-bold mx-auto mb-4" data-testid={`text-step-number-${index}`}>
                {step.number}
              </div>
              <h3 className="font-semibold text-lg mb-2" data-testid={`text-step-title-${index}`}>{step.title}</h3>
              <p className="text-muted-foreground text-sm" data-testid={`text-step-desc-${index}`}>{step.description}</p>
            </div>
          ))}
        </div>
        <p className="text-center mt-10 text-sm text-muted-foreground" data-testid="text-hiw-note">
          You control the strategy. You control the trade. The agent structures the analysis.
        </p>
      </div>
    </section>
  );
}

function PricingSection() {
  const { isAuthenticated } = useAuth();
  const promoActive = useMemo(() => isPromoActive(), []);

  const featureGroups = [
    {
      title: "AI Agent",
      icon: Bot,
      features: [
        "Natural language setup generation",
        "Multi-strategy analysis",
        "Structured TradeSetupCards",
        "Strategy scoring & reasoning",
      ],
    },
    {
      title: "Strategies",
      icon: Layers,
      features: [
        "Built-in strategy library",
        "Custom strategy creation",
        "Plain-text rule parsing",
        "Strategy validation",
      ],
    },
    {
      title: "Charts & Analysis",
      icon: LineChart,
      features: [
        "Interactive candlestick charts",
        "Auto-drawn support & resistance",
        "EMA overlays",
        "Setup visualization",
      ],
    },
    {
      title: "Execution",
      icon: Zap,
      features: [
        "InstaTrade™ one-click orders",
        "Tradier, TradeStation, Tastytrade",
        "Paper & live trading modes",
      ],
    },
    {
      title: "Market Data",
      icon: BarChart3,
      features: [
        "Broker-connected live data",
        "Real-time quotes & positions",
        "Market-wide scanning",
      ],
    },
    {
      title: "Alerts",
      icon: Bell,
      features: [
        "Push notifications (PWA)",
        "Email alerts",
        "Breakout & stop-loss triggers",
      ],
    },
    {
      title: "History & Activity",
      icon: BookOpen,
      features: [
        "Full setup history",
        "Activity audit trail",
        "Filterable by symbol & status",
      ],
    },
    {
      title: "Trading",
      icon: TrendingUp,
      features: [
        "Equities",
        "Options",
        "Futures (coming soon)",
      ],
    },
  ];

  const ctaUrl = isAuthenticated
    ? "/settings"
    : promoActive
      ? `/auth?promo=${PROMO_CODE}`
      : "/auth";

  return (
    <section className="py-16 md:py-24" id="pricing">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold" data-testid="text-pricing-heading">
            One plan. Everything included.
          </h2>
          <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
            Cancel anytime. No long-term commitment.
          </p>
        </div>

        <Card className="max-w-4xl mx-auto border-primary relative">
          {promoActive && (
            <Badge className="absolute -top-3 left-1/2 -translate-x-1/2" data-testid="badge-early-access">
              Early Access 50% Off
            </Badge>
          )}
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-2xl" data-testid="text-plan-name">
              Strategy Agent Pro
            </CardTitle>
            <CardDescription>
              AI-powered strategy analysis, setup generation, and optional execution
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center mb-8">
              {promoActive ? (
                <div className="flex items-center justify-center gap-3">
                  <span className="text-4xl font-bold text-primary" data-testid="text-promo-price">
                    ${PROMO_CONFIG.promoPrice}
                  </span>
                  <span className="text-xl text-muted-foreground line-through" data-testid="text-standard-price">
                    ${PROMO_CONFIG.standardPrice}
                  </span>
                  <span className="text-muted-foreground">/mo</span>
                </div>
              ) : (
                <div>
                  <span className="text-4xl font-bold" data-testid="text-price">
                    ${PROMO_CONFIG.standardPrice}
                  </span>
                  <span className="text-muted-foreground">/mo</span>
                </div>
              )}
              {promoActive && (
                <p className="text-sm text-muted-foreground mt-2" data-testid="text-promo-ends">
                  Ends {PROMO_CONFIG.endDateDisplay}
                </p>
              )}
              <p className="text-sm font-medium text-primary mt-3" data-testid="text-trial-info">
                14-day free trial included
              </p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              {featureGroups.map((group, groupIndex) => (
                <div key={groupIndex} className="space-y-2">
                  <div className="flex items-center gap-2 font-medium">
                    <group.icon className="h-4 w-4 text-primary" />
                    <span data-testid={`text-feature-group-${groupIndex}`}>{group.title}</span>
                  </div>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {group.features.map((feature, featureIndex) => (
                      <li key={featureIndex} className="flex items-start gap-2">
                        <Check className="h-3 w-3 text-primary mt-1 shrink-0" />
                        <span data-testid={`text-feature-${groupIndex}-${featureIndex}`}>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div className="text-center">
              <Link href={ctaUrl}>
                <Button size="lg" className="px-8" data-testid="button-subscribe">
                  {isAuthenticated ? "Manage Subscription" : "Start Free Trial"}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        <p className="text-center mt-8 text-xs text-muted-foreground max-w-2xl mx-auto" data-testid="text-compliance">
          All data, analysis, and setup outputs are provided for informational purposes only. Strategy Agent does not provide investment advice.
        </p>
        <p className="text-center mt-3 text-xs text-muted-foreground max-w-2xl mx-auto" data-testid="text-tradier-credit">
          New Tradier brokerage accounts may be eligible for a $200 account credit. Subject to Tradier's terms and conditions. Visit{" "}
          <a href="https://join.tradier.com/partner?platform=261" target="_blank" rel="noopener noreferrer" className="underline">tradier.com</a>{" "}
          for details.
        </p>
      </div>
    </section>
  );
}

function FAQSection() {
  const faqs = [
    {
      question: "Is this investment advice?",
      answer: "No. Strategy Agent is an informational platform for self-directed traders. We do not provide personalized investment recommendations or advice. All setups, analysis, and outputs are for informational purposes only.",
    },
    {
      question: "What is a TradeSetupCard?",
      answer: "A TradeSetupCard is a structured output generated by the Strategy Agent. It includes entry price, stop-loss, price targets, reward/risk ratio, strategy reasoning, and a model confidence score. Each card includes compliance microcopy confirming it is informational only.",
    },
    {
      question: "How does the natural language input work?",
      answer: 'You describe your setup idea in plain English — for example, "Give me a 15-minute ORB setup on TSLA" — and the agent interprets your intent, selects the appropriate strategy, and generates a structured setup with entry, stop, and targets.',
    },
    {
      question: "Do I need a brokerage connection?",
      answer: "No, it's optional. You can generate and review setups without connecting a broker. If you do connect, you'll get live market data and can execute setups through InstaTrade™.",
    },
    {
      question: "What strategies are available?",
      answer: "Strategy Agent includes built-in strategies like Opening Range Breakout (ORB), VWAP Reclaim, Pullback, and Volatility Breakout. You can also create custom strategies by describing rules in plain English or using the structured form.",
    },
    {
      question: "What markets do you support?",
      answer: "Currently we support US equities and options. Futures support is coming soon. You can connect Tradier, TradeStation, or Tastytrade as your broker.",
    },
  ];

  return (
    <section className="py-16 md:py-24" id="faq">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold" data-testid="text-faq-heading">Frequently Asked Questions</h2>
        </div>
        <Accordion type="single" collapsible className="w-full">
          {faqs.map((faq, index) => (
            <AccordionItem key={index} value={`item-${index}`}>
              <AccordionTrigger className="text-left" data-testid={`button-faq-question-${index}`}>
                {faq.question}
              </AccordionTrigger>
              <AccordionContent data-testid={`text-faq-answer-${index}`}>
                {faq.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}

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
            <Link href="/terms" className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-footer-terms">
              Terms
            </Link>
            <Link href="/disclaimer" className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-footer-disclaimer">
              Disclaimer
            </Link>
            <Link href="/privacy" className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-footer-privacy">
              Privacy
            </Link>
            <Link href="/open-source" className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-footer-open-source">
              Open Source
            </Link>
            <a href="mailto:support@sunfishtechnologies.com" className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-footer-contact">
              Contact
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      <PromoBanner />
      <NavBar />
      <HeroSection />
      <TrustStrip />
      <FeaturesSection />
      <HowItWorksSection />
      <PricingSection />
      <FAQSection />
      <LandingFooter />
    </div>
  );
}
