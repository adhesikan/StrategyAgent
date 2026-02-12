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
  Search,
  Bell,
  BarChart3,
  Smartphone,
  Link2,
  SlidersHorizontal,
  Target,
  Check,
  ArrowRight,
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  LineChart,
  Brain,
  BookOpen,
  TestTube,
} from "lucide-react";
import logoUrl from "@assets/ChatGPT_Image_Jan_1,_2026,_01_38_07_PM_1767292703801.png";
import vcpChartImg from "@assets/VCPChart_1767652266272.png";
import vcpAlertConfigImg from "@assets/VCPAlertConfig_1767652266274.png";
import { useState, useRef, useCallback, useMemo } from "react";
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
            Early Bird Access — 50% off VCP Trader Pro until {PROMO_CONFIG.endDateDisplay}.
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
          Claim Early Bird
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
              <img src={logoUrl} alt="VCP Trader" className="h-8 w-auto" data-testid="img-logo" />
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
                <Link href="/dashboard">
                  <Button data-testid="button-go-to-dashboard">Go to Dashboard</Button>
                </Link>
              ) : (
                <>
                  <Link href="/auth">
                    <Button variant="ghost" data-testid="button-sign-in">Sign In</Button>
                  </Link>
                  <Link href="/auth">
                    <Button data-testid="button-start-trial">Start 14-Day Free Trial</Button>
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
                  <Link href="/dashboard">
                    <Button className="w-full" data-testid="button-go-to-dashboard-mobile">Go to Dashboard</Button>
                  </Link>
                ) : (
                  <>
                    <Link href="/auth">
                      <Button variant="outline" className="w-full" data-testid="button-sign-in-mobile">Sign In</Button>
                    </Link>
                    <Link href="/auth">
                      <Button className="w-full" data-testid="button-start-trial-mobile">Start 14-Day Free Trial</Button>
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
        <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight max-w-4xl mx-auto" data-testid="text-hero-headline">
          Institutional-Grade Multi-Strategy Intelligence & User-Controlled Automation for Everyday Traders
        </h1>
        <p className="mt-6 text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto" data-testid="text-hero-subheadline">
          Scan the entire market, detect tightening bases, and get real-time alerts when momentum ignites — with full control over every trade.
        </p>
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          {isAuthenticated ? (
            <Link href="/dashboard">
              <Button size="lg" data-testid="button-hero-dashboard">
                Go to Dashboard
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          ) : (
            <>
              <Link href="/auth">
                <Button size="lg" data-testid="button-hero-trial">
                  Start 14-Day Free Trial
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <a href="#pricing">
                <Button variant="outline" size="lg" data-testid="button-hero-pricing">
                  View Pricing
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

function ScreenshotCarousel() {
  const { isAuthenticated } = useAuth();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const screenshots = [
    { src: vcpChartImg, alt: "VCP Chart Analysis", caption: "Interactive charts with technical analysis" },
    { src: vcpAlertConfigImg, alt: "Alert Configuration", caption: "Customizable alert rules for any stock" },
  ];

  const updateScrollButtons = useCallback(() => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
      setCanScrollLeft(scrollLeft > 0);
      setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 10);
    }
  }, []);

  const scroll = (direction: "left" | "right") => {
    if (scrollRef.current) {
      const scrollAmount = scrollRef.current.clientWidth * 0.85;
      scrollRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
      setTimeout(updateScrollButtons, 350);
    }
  };

  return (
    <section className="py-12 md:py-16 bg-muted/30">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold" data-testid="text-carousel-heading">
            See VCP Trader in Action
          </h2>
          <p className="mt-3 text-muted-foreground max-w-2xl mx-auto">
            Powerful tools designed for active traders
          </p>
        </div>

        <div className="relative px-12 md:px-14">
          <Button
            variant="outline"
            size="icon"
            className={`absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-background shadow-md border ${!canScrollLeft ? "opacity-30 pointer-events-none" : ""}`}
            onClick={() => scroll("left")}
            data-testid="button-carousel-left"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>

          <div
            ref={scrollRef}
            className="flex gap-6 overflow-x-auto snap-x snap-mandatory pb-4 px-1"
            onScroll={updateScrollButtons}
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          >
            {screenshots.map((screenshot, index) => (
              <div
                key={index}
                className="flex-shrink-0 snap-center"
                style={{ width: "min(90vw, 900px)" }}
              >
                <div className="rounded-lg overflow-hidden border-2 border-border bg-card shadow-lg">
                  <img
                    src={screenshot.src}
                    alt={screenshot.alt}
                    className="w-full h-auto"
                    style={{ imageRendering: "auto" }}
                    data-testid={`img-screenshot-${index}`}
                  />
                </div>
                <p className="mt-4 text-center text-base font-medium text-foreground" data-testid={`text-screenshot-caption-${index}`}>
                  {screenshot.caption}
                </p>
              </div>
            ))}
          </div>

          <Button
            variant="outline"
            size="icon"
            className={`absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-background shadow-md border ${!canScrollRight ? "opacity-30 pointer-events-none" : ""}`}
            onClick={() => scroll("right")}
            data-testid="button-carousel-right"
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>

        <div className="text-center mt-10">
          <Link href={isAuthenticated ? "/dashboard" : "/auth"}>
            <Button size="lg" data-testid="button-carousel-cta">
              {isAuthenticated ? "Go to Dashboard" : "Start 14-Day Free Trial"}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}

function TrustStrip() {
  const features = [
    { icon: Search, text: "Market-wide scanning" },
    { icon: Bell, text: "Real-time alerts (push + email)" },
    { icon: Link2, text: "Broker-connected data" },
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

function VCPTraderProSection() {
  const { isAuthenticated } = useAuth();
  const promoActive = useMemo(() => isPromoActive(), []);

  const featureGroups = [
    {
      title: "Market Scanner",
      icon: Search,
      features: [
        "Scan the entire U.S. stock market",
        "VCP pattern detection (FORMING, READY, BREAKOUT)",
        "Price, volume, RVOL, ATR% filters",
        "Multi-timeframe support",
      ],
    },
    {
      title: "Alerts",
      icon: Bell,
      features: [
        "Real-time breakout alerts",
        "Stop-loss & EMA-21 exit alerts",
        '"Approaching breakout" notifications',
        "Push notifications (mobile PWA)",
        "Email & in-app alerts",
      ],
    },
    {
      title: "Charts & Levels",
      icon: LineChart,
      features: [
        "Interactive candlestick charts",
        "EMA 9 & EMA 21",
        "Auto-drawn resistance lines",
        "Auto-calculated stops",
      ],
    },
    {
      title: "AI Analysis",
      icon: Brain,
      features: [
        "AI explanations for every setup",
        "Pattern quality scores",
        "Ranked opportunity list",
      ],
    },
    {
      title: "Signal Feed",
      icon: BookOpen,
      features: [
        '"Today\'s Breakouts"',
        '"Forming Bases"',
        '"Ready Setups"',
        "Model-generated alerts",
      ],
    },
    {
      title: "Broker Connectivity",
      icon: Link2,
      features: [
        "Tradier / tastytrade market data (optional)",
        "Live bid/ask breakout confirmation",
      ],
    },
    {
      title: "Backtesting",
      icon: TestTube,
      features: [
        "Test how VCP breakouts performed historically",
      ],
    },
    {
      title: "Mobile App",
      icon: Smartphone,
      features: [
        "Installable PWA",
        "Real-time push alerts",
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
            <Badge className="absolute -top-3 left-1/2 -translate-x-1/2" data-testid="badge-early-bird">
              Early Bird 50% Off
            </Badge>
          )}
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-2xl" data-testid="text-plan-name">
              {PROMO_CONFIG.planName}
            </CardTitle>
            <CardDescription>
              Complete VCP scanning, alerting, and analysis platform
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
                  {isAuthenticated ? "Manage Subscription" : "Start 14-Day Free Trial"}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        <p className="text-center mt-8 text-xs text-muted-foreground max-w-2xl mx-auto" data-testid="text-compliance">
          All data, alerts, and model outputs are provided for informational purposes only. VCP Trader does not provide investment advice.
        </p>
      </div>
    </section>
  );
}

function FeaturesSection() {
  const features = [
    { icon: Search, title: "Entire-market scanning", description: "Scan thousands of US equities in seconds" },
    { icon: SlidersHorizontal, title: "Powerful filters", description: "Price, volume, RVOL, ATR% and more" },
    { icon: Target, title: "Breakout + stop-loss alerts", description: "Get notified when setups trigger" },
    { icon: BarChart3, title: "Interactive charts", description: "Full charting inside the app" },
    { icon: Smartphone, title: "PWA mobile install", description: "Install on phone + push notifications" },
    { icon: Link2, title: "Broker connections", description: "Optional market data from your broker" },
  ];

  return (
    <section className="py-16 md:py-24 bg-muted/30" id="features">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold" data-testid="text-features-heading">Features</h2>
          <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
            Everything you need for systematic market scanning
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
    { number: "1", title: "Filter the market", description: "Set your criteria for price, volume, and pattern stage" },
    { number: "2", title: "Identify VCP setups", description: "The scanner detects volatility contraction patterns forming" },
    { number: "3", title: "Get alerts and act on your plan", description: "Receive notifications when conditions are met" },
  ];

  return (
    <section className="py-16 md:py-24" id="how-it-works">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold" data-testid="text-hiw-heading">How It Works</h2>
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
          You control the rules. You control the trades.
        </p>
      </div>
    </section>
  );
}


function FAQSection() {
  const faqs = [
    {
      question: "Is this investment advice?",
      answer: "No. VCP Trader is an informational platform for self-directed traders. We do not provide personalized investment recommendations or advice. All alerts and scan results are for informational purposes only.",
    },
    {
      question: "What is a VCP setup?",
      answer: "VCP stands for Volatility Contraction Pattern. It's a technical market structure where price ranges tighten as a stock consolidates near resistance. This behavior can reflect decreasing selling pressure while buyers remain active, and may precede a breakout when demand overwhelms supply.",
    },
    {
      question: "Do I need a brokerage connection?",
      answer: "No, it's optional. You can use the platform without connecting a broker. If you do connect, you'll get real-time market data from your broker instead of delayed data.",
    },
    {
      question: "How do alerts work?",
      answer: "Alerts are delivered via push notifications (mobile/desktop), email, and in-app notifications. You can configure which alert types you want to receive in your settings.",
    },
    {
      question: "Can I use it on mobile?",
      answer: "Yes! VCP Trader is a Progressive Web App (PWA). You can install it on your phone's home screen for a native app-like experience with push notifications.",
    },
    {
      question: "What markets do you support?",
      answer: "Currently we support US equities. We plan to expand to other markets in the future based on user demand.",
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
            <img src={logoUrl} alt="VCP Trader" className="h-6 w-auto" />
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
      <ScreenshotCarousel />
      <TrustStrip />
      <VCPTraderProSection />
      <FeaturesSection />
      <HowItWorksSection />
      <FAQSection />
      <LandingFooter />
    </div>
  );
}
