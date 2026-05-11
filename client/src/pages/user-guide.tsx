import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  BookOpen, Home, TrendingUp, DollarSign, BarChart3, Newspaper, Radar,
  Zap, ShieldCheck, Briefcase, Settings as SettingsIcon, FileText, HelpCircle,
  Search, Sparkles, AlertTriangle, CheckCircle2, ChevronRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";

type Section = {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  summary: string;
  body: React.ReactNode;
  keywords?: string[];
};

const SECTIONS: Section[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    icon: Sparkles,
    summary: "Set up your account, pick a mode, and decide between paper and live data.",
    keywords: ["onboarding", "setup", "first time", "new"],
    body: (
      <>
        <p>
          VCP Trader AI helps you research stock and options ideas in plain English, review them with
          AI-assigned grades, and prepare orders that you submit through your own connected broker.
          You stay in control — no autonomous trading.
        </p>
        <ol className="list-decimal pl-5 space-y-2 mt-3">
          <li><strong>Pick a starting mode</strong> from the sidebar: Home (overview), Grow (growth ideas), Income (covered calls / CSPs), Trade (plain-English builder), or Markets (news + sentiment).</li>
          <li><strong>Set your limits</strong> in <Link href="/settings/risk-profile" className="underline">My Limits</Link> — minimum grade, max risk per trade, allowed instruments. These limits are enforced when you prepare an order.</li>
          <li><strong>Connect a broker</strong> in <Link href="/settings" className="underline">Settings → Connect Your Broker</Link> (Tradier, TradeStation, or SnapTrade) for live quotes and order routing. Without a broker you can still browse ideas in simulated mode.</li>
          <li><strong>Try paper mode first</strong> — every preparation flow can be marked as paper so you can practice without risking capital.</li>
        </ol>
      </>
    ),
  },
  {
    id: "home",
    title: "Home / Agent",
    icon: Home,
    summary: "Your dashboard. Type a prompt, see today's AI ideas, and check market status.",
    body: (
      <>
        <p>
          The <Link href="/home" className="underline">Home</Link> page is your daily starting point.
          It shows the broker connection state, market open/closed, a Today's AI Snapshot panel, and
          quick chips for common requests.
        </p>
        <h4 className="font-semibold mt-3">What you can do:</h4>
        <ul className="list-disc pl-5 space-y-1">
          <li>Type a request like "income ideas this week" or "why is NVDA moving?" — the prompt bar routes you to the right tool.</li>
          <li>Tap a popular chip to jump straight into Grow, Income, Trade, or Markets.</li>
          <li>Review the AI snapshot for market tone, top growth, top income, and watchlist risk.</li>
        </ul>
        <p className="mt-3 text-sm text-muted-foreground">
          Everything you see is informational — no order is sent until you explicitly review and confirm it.
        </p>
      </>
    ),
  },
  {
    id: "grow",
    title: "Grow My Money",
    icon: TrendingUp,
    summary: "Wizard-driven growth ideas based on your capital, risk, and instruments.",
    keywords: ["goal mode", "growth"],
    body: (
      <>
        <p>
          <Link href="/goal-mode" className="underline">Grow</Link> walks you through a 6-step wizard:
          capital → goal → risk → activity → instruments → broker. The output is a Goal Reality Check
          plus AI-ranked candidate scenarios you can act on.
        </p>
        <ul className="list-disc pl-5 space-y-1 mt-2">
          <li>Each card shows entry, stop, target, AI grade, and why-it-was-picked.</li>
          <li>"Prepare Order" opens the Order Review modal — you must check the acknowledgment box before any submission.</li>
          <li>Use paper mode to practice without risking capital.</li>
        </ul>
      </>
    ),
  },
  {
    id: "income",
    title: "Generate Income",
    icon: DollarSign,
    summary: "Covered calls, cash-secured puts, and defined-risk income strategies.",
    body: (
      <>
        <p>
          <Link href="/income-mode" className="underline">Income</Link> is built for premium-selling and
          defined-risk income. Pick a strategy (covered call, CSP, or defined-risk spread), specify the
          ticker / target premium / max risk, and get a candidate idea with full options details.
        </p>
        <ul className="list-disc pl-5 space-y-1 mt-2">
          <li>Each idea includes strike, expiration, breakeven, max loss, premium, and assignment risk.</li>
          <li>The instrument picker can offer a debit-spread alternative if your preferences require defined risk.</li>
          <li>Liquidity guardrails (min open interest, max bid/ask spread) are checked before you can submit.</li>
        </ul>
      </>
    ),
  },
  {
    id: "trade",
    title: "Trade Finder (Plain English)",
    icon: BarChart3,
    summary: "Describe a setup in everyday words and the agent translates it into a structured idea.",
    keywords: ["agent", "prompt", "natural language"],
    body: (
      <>
        <p>
          <Link href="/trade-finder" className="underline">Trade</Link> is the plain-English builder.
          Try prompts like:
        </p>
        <ul className="list-disc pl-5 space-y-1 mt-2">
          <li>"VCP breakout in NVDA"</li>
          <li>"opening range breakout SPY 5-minute"</li>
          <li>"bull call spread on AAPL with defined risk"</li>
          <li>"covered call on T 30 days out"</li>
        </ul>
        <p className="mt-3">
          The agent identifies the symbol, strategy, and bias, then returns a setup with entry, stop,
          target, an A+/A/B/C grade, an instrument recommendation, and a list of conditions that
          passed or failed. You can save it to your <Link href="/trade-setups" className="underline">Trade Setups</Link>.
        </p>
      </>
    ),
  },
  {
    id: "markets",
    title: "Market Intel & News",
    icon: Newspaper,
    summary: "Morning briefing, watchlist sentiment, and 'why is X moving?' lookups.",
    body: (
      <>
        <p>
          <Link href="/market-intel" className="underline">Markets</Link> aggregates news headlines and
          AI-generated sentiment for tickers you care about.
        </p>
        <ul className="list-disc pl-5 space-y-1 mt-2">
          <li><strong>Morning Briefing</strong> — overall market tone for the day with reasoning.</li>
          <li><strong>Watchlist Sentiment</strong> — sentiment chips for each symbol in your watchlist.</li>
          <li><strong>Strongest Positive / Negative</strong> — tickers with the largest sentiment swings.</li>
          <li><strong>Why Is It Moving?</strong> — search a ticker and see article-level drivers.</li>
        </ul>
        <p className="mt-3 text-sm text-muted-foreground">
          Sentiment is informational context — never a buy or sell signal.
        </p>
      </>
    ),
  },
  {
    id: "radar",
    title: "Top Opportunities (Radar)",
    icon: Radar,
    summary: "AI-ranked candidate scenarios across your universe with composite scores.",
    keywords: ["opportunity", "scanner", "ideas"],
    body: (
      <>
        <p>
          <Link href="/opportunity-radar" className="underline">Top Opportunities</Link> ranks candidate
          scenarios using a composite score of technical (28%), sentiment (20%), momentum (22%),
          liquidity (15%), and risk (15%). Scenarios under 60 are hidden by default.
        </p>
        <h4 className="font-semibold mt-3">Filters:</h4>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Basic:</strong> strategy, bias, max loss, min grade, time horizon, universe.</li>
          <li><strong>Advanced:</strong> minimum option volume, avoid earnings days, min reward/risk, liquidity floors.</li>
        </ul>
        <p className="mt-3">
          Each card has a "View Why" drawer showing the factor breakdown and a Review Scenario modal
          that mirrors the standard order review acknowledgment before any paper trade or live order.
        </p>
      </>
    ),
  },
  {
    id: "instatrade",
    title: "InstaTrade™ Order Review",
    icon: Zap,
    summary: "Self-directed order preparation. You approve every order before submission.",
    keywords: ["order", "execute", "place trade", "broker order"],
    body: (
      <>
        <p>
          <Link href="/instatrade" className="underline">InstaTrade™</Link> is the order-review surface.
          It's <strong>not autonomous</strong> — you must review and confirm every order.
        </p>
        <ul className="list-disc pl-5 space-y-1 mt-2">
          <li>Simple mode: ticker, side, quantity, price.</li>
          <li>Advanced mode: bracket orders (entry + stop + target) and Risk Controls exit plan.</li>
          <li>Paper mode is supported via the broker sandbox.</li>
          <li>Live orders require a connected broker (Tradier, TradeStation, or SnapTrade).</li>
        </ul>
        <p className="mt-3 text-sm text-muted-foreground">
          The "Review with InstaTrade™" button on any setup card opens the same review flow with the
          fields pre-filled.
        </p>
      </>
    ),
  },
  {
    id: "risk-controls",
    title: "Risk Controls (My Limits)",
    icon: ShieldCheck,
    summary: "Personal guardrails that block trades exceeding your defined risk.",
    keywords: ["guardrails", "limits", "max loss", "risk profile"],
    body: (
      <>
        <p>
          <Link href="/settings/risk-profile" className="underline">My Limits</Link> stores your personal
          rules. They are enforced before any equity or option order is sent.
        </p>
        <h4 className="font-semibold mt-3">Available controls:</h4>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Allowed instruments</strong> — stock only, options only, or both.</li>
          <li><strong>Defined-risk only</strong> — blocks naked options and unbounded plans.</li>
          <li><strong>Minimum probability score</strong> — only allow setups graded above your floor.</li>
          <li><strong>Minimum reward/risk</strong> — block setups whose payoff is too small.</li>
          <li><strong>Liquidity</strong> — minimum open interest, maximum bid/ask spread percentage.</li>
          <li><strong>Max risk per trade</strong> — caps dollar risk based on stop distance and quantity.</li>
        </ul>
        <p className="mt-3">
          When a guardrail is hit you'll see a clear <code>GUARDRAIL_BLOCKED</code> message explaining
          which limit failed and how to adjust it.
        </p>
      </>
    ),
  },
  {
    id: "paper-mode",
    title: "Paper / Simulated Mode",
    icon: CheckCircle2,
    summary: "Practice with broker sandboxes or simulated data — no real money.",
    body: (
      <>
        <p>
          You can use the platform in two ways:
        </p>
        <ul className="list-disc pl-5 space-y-1 mt-2">
          <li><strong>Simulated</strong> — no broker connected; quotes and balances use deterministic mocks. Great for exploring the UI.</li>
          <li><strong>Paper trading</strong> — connect a broker's paper account (Tradier sandbox or TradeStation sim). Orders route to the broker's sandbox API and behave like real fills.</li>
        </ul>
        <p className="mt-3">
          The data-mode pill on Home shows which mode you're in. Switch to live by connecting a live
          broker account in Settings.
        </p>
      </>
    ),
  },
  {
    id: "brokers",
    title: "Brokers & Connections",
    icon: Briefcase,
    summary: "Connect Tradier, TradeStation, or SnapTrade for live data and execution.",
    keywords: ["broker", "connect", "tradier", "tradestation", "snaptrade"],
    body: (
      <>
        <p>
          Open <Link href="/settings" className="underline">Settings → Connect Your Broker</Link> to link
          a brokerage. Connections are encrypted and you can disconnect at any time.
        </p>
        <ul className="list-disc pl-5 space-y-1 mt-2">
          <li><strong>Tradier</strong> — OAuth; supports live and sandbox (paper).</li>
          <li><strong>TradeStation</strong> — OAuth via TradeStation v3; supports live and sim.</li>
          <li><strong>SnapTrade</strong> — OAuth gateway to 20+ brokerages for order execution.</li>
        </ul>
        <p className="mt-3">
          If multiple connections exist you can pick a preferred trading account. All quotes, balances,
          and positions on Home and Markets pull from the connected account when available.
        </p>
      </>
    ),
  },
  {
    id: "journal",
    title: "Journal & Trade Setups",
    icon: BookOpen,
    summary: "History of every setup, scenario, and order with grade, instrument, and outcome filters.",
    body: (
      <>
        <p>
          <Link href="/journal" className="underline">Journal</Link> shows your positions, P&amp;L, and
          insights. <Link href="/trade-setups" className="underline">Trade Setups</Link> lists every
          generated setup with filters for grade, instrument, executed status, and minimum score.
        </p>
        <ul className="list-disc pl-5 space-y-1 mt-2">
          <li>Mark a setup as Reviewed, Paper Traded, Prepared Order, or Sent Order.</li>
          <li>Sent orders are mirrored to your trade history for performance review.</li>
          <li>Use the outcome tracker to log win/loss and notes after a position closes.</li>
        </ul>
      </>
    ),
  },
  {
    id: "settings",
    title: "Settings & Preferences",
    icon: SettingsIcon,
    summary: "Trading prefs, risk limits, watchlists, scanner filters, broker connections.",
    body: (
      <>
        <p>
          <Link href="/settings" className="underline">Settings</Link> is organized into tabs:
        </p>
        <ul className="list-disc pl-5 space-y-1 mt-2">
          <li><strong>My Limits</strong> — Risk Controls (see above).</li>
          <li><strong>Trading Preferences</strong> — allowed instruments, defined-risk only, min score, min R/R.</li>
          <li><strong>Watchlists</strong> — symbols followed across Markets and Radar.</li>
          <li><strong>Opportunity Filters</strong> — saved scanner presets.</li>
          <li><strong>Connect Your Broker</strong> — manage broker links.</li>
          <li><strong>Account</strong> — profile, password, delete account.</li>
        </ul>
      </>
    ),
  },
  {
    id: "strategies",
    title: "Strategy Reference",
    icon: FileText,
    summary: "Detailed write-ups for VCP, ORB, momentum, breakout, and other strategies.",
    body: (
      <>
        <p>
          The dedicated <Link href="/help" className="underline">Strategy Reference</Link> page covers
          every built-in strategy with overview, characteristics, entry signals, risk management, best
          conditions, and timeframe.
        </p>
      </>
    ),
  },
  {
    id: "compliance",
    title: "Compliance & Disclaimers",
    icon: AlertTriangle,
    summary: "What VCP Trader AI is, what it isn't, and how outputs are framed.",
    body: (
      <>
        <p>
          VCP Trader AI is a software tool for self-directed traders. It is <strong>not</strong> a
          broker-dealer, not a registered investment adviser, and does not provide personalized
          investment advice. All outputs — grades, scenarios, sentiment — are informational
          AI-generated analysis.
        </p>
        <ul className="list-disc pl-5 space-y-1 mt-2">
          <li>Live data and order routing require your own brokerage account.</li>
          <li>Trading involves risk including loss of principal.</li>
          <li>You approve every order before submission. The platform never trades autonomously.</li>
        </ul>
        <p className="mt-3 text-sm text-muted-foreground">
          See <Link href="/disclaimer" className="underline">Disclaimer</Link>, <Link href="/terms" className="underline">Terms</Link>,
          and <Link href="/privacy" className="underline">Privacy</Link> for full details.
        </p>
      </>
    ),
  },
  {
    id: "faq",
    title: "FAQ",
    icon: HelpCircle,
    summary: "Quick answers to common questions.",
    body: (
      <>
        <dl className="space-y-3">
          <div>
            <dt className="font-semibold">Does the app trade for me automatically?</dt>
            <dd className="text-muted-foreground">No. Every order requires your explicit review and confirmation.</dd>
          </div>
          <div>
            <dt className="font-semibold">Do I need a broker to use it?</dt>
            <dd className="text-muted-foreground">You can browse and use simulated mode without a broker. Live quotes and order placement require a connected Tradier, TradeStation, or SnapTrade account.</dd>
          </div>
          <div>
            <dt className="font-semibold">Is this investment advice?</dt>
            <dd className="text-muted-foreground">No. It is software-generated analysis only.</dd>
          </div>
          <div>
            <dt className="font-semibold">Can I trade options?</dt>
            <dd className="text-muted-foreground">Yes — long calls/puts, debit spreads, covered calls, and cash-secured puts. Defined-risk plans only if your preferences require it.</dd>
          </div>
          <div>
            <dt className="font-semibold">How are grades calculated?</dt>
            <dd className="text-muted-foreground">Five weighted factors: technical (30), realtime (25), news (15), analyst (15), risk (15). A+ ≥ 90, A ≥ 80, B ≥ 70, C ≥ 60.</dd>
          </div>
          <div>
            <dt className="font-semibold">Can I cancel my subscription?</dt>
            <dd className="text-muted-foreground">Yes — manage your plan from <Link href="/pricing" className="underline">Pricing</Link> or via the Stripe billing portal.</dd>
          </div>
        </dl>
      </>
    ),
  },
];

export default function UserGuidePage() {
  const [location] = useLocation();
  const [query, setQuery] = useState("");

  useEffect(() => {
    document.title = "User Guide | VCP Trader AI";
    const hash = window.location.hash.replace("#", "");
    if (hash) {
      const el = document.getElementById(hash);
      if (el) {
        setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
      }
    }
  }, [location]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter((s) => {
      const hay = [s.title, s.summary, ...(s.keywords || [])].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [query]);

  return (
    <div className="container mx-auto py-6 px-4 md:px-6 max-w-7xl">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <BookOpen className="h-7 w-7 text-primary" />
            User Guide
          </h1>
          <p className="text-muted-foreground mt-1">
            How every feature in VCP Trader AI works, in plain English.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">VCP Trader AI</Badge>
          <Badge variant="outline">Powered by Strategy Agent</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Sections</CardTitle>
              <CardDescription className="text-xs">Jump to any topic</CardDescription>
              <div className="relative mt-2">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search the guide..."
                  className="pl-7 h-8 text-xs"
                  data-testid="input-guide-search"
                />
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <ScrollArea className="h-[60vh] lg:h-[70vh] pr-2">
                <nav className="space-y-1">
                  {filtered.map((s) => {
                    const Icon = s.icon;
                    return (
                      <a
                        key={s.id}
                        href={`#${s.id}`}
                        className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                        data-testid={`nav-guide-${s.id}`}
                      >
                        <Icon className="h-4 w-4 flex-shrink-0" />
                        <span className="truncate">{s.title}</span>
                        <ChevronRight className="h-3 w-3 ml-auto opacity-0 group-hover:opacity-100" />
                      </a>
                    );
                  })}
                  {filtered.length === 0 && (
                    <p className="text-xs text-muted-foreground px-2 py-1">No matches.</p>
                  )}
                </nav>
              </ScrollArea>
            </CardContent>
          </Card>
        </aside>

        <main className="space-y-8">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            return (
              <section
                key={s.id}
                id={s.id}
                className="scroll-mt-20"
                data-testid={`section-guide-${s.id}`}
              >
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Icon className="h-5 w-5 text-primary" />
                      {s.title}
                    </CardTitle>
                    <CardDescription>{s.summary}</CardDescription>
                  </CardHeader>
                  <CardContent className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed">
                    {s.body}
                  </CardContent>
                </Card>
              </section>
            );
          })}

          <Separator />

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-8">
            <p className="text-xs text-muted-foreground">
              Still have questions? Check the <Link href="/disclaimer" className="underline">Disclaimer</Link>,{" "}
              <Link href="/terms" className="underline">Terms</Link>, or contact support from the Settings page.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link href="/home" data-testid="link-back-home">Back to Home</Link>
            </Button>
          </div>
        </main>
      </div>
    </div>
  );
}
