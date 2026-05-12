import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  BookOpen, Home, TrendingUp, DollarSign, BarChart3, Newspaper, Radar,
  Zap, ShieldCheck, Briefcase, Settings as SettingsIcon, FileText, HelpCircle,
  Search, Sparkles, AlertTriangle, CheckCircle2, ChevronRight, Moon, Rocket,
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
    id: "whats-new",
    title: "What's New",
    icon: Rocket,
    summary: "Recent updates: scan-source picker, full Income order ticket, starter watchlist, and more.",
    keywords: ["changelog", "updates", "release", "new"],
    body: (
      <>
        <p className="text-sm text-muted-foreground">Latest improvements you'll see across the app:</p>
        <ul className="list-disc pl-5 space-y-2 mt-3">
          <li>
            <strong>"Scan from" picker on Home.</strong> The "Today's Ideas For You" section now has an
            inline selector so you can choose the universe each tab scans — <em>My Watchlist, Dow 30,
            Nasdaq 100, S&amp;P 500, High Volume, Options Liquid,</em> or <em>Custom symbols</em>. Your
            choice is saved as a preference and persists across sessions. See the{" "}
            <Link href="/guide#home" className="underline">Home</Link> section.
          </li>
          <li>
            <strong>Full InstaTrade™ order review on Income.</strong> The Income mode "Review Details"
            and "Prepare Order" buttons now open the same order-review modal used by Grow — with
            broker-aware button labels (Paper Trade vs. Send to Broker) and the required acknowledgment
            checkbox. See <Link href="/guide#income" className="underline">Generate Income</Link>.
          </li>
          <li>
            <strong>Starter Watchlist auto-seeded for new accounts.</strong> Every new user gets a
            10-symbol starter list (AAPL, MSFT, NVDA, AMD, TSLA, META, AMZN, GOOGL, MU, PLTR) so the
            scanners and Markets pages have something to work with on day one.
          </li>
          <li>
            <strong>Universe source chip on Top Opportunities.</strong> The Radar now shows which
            symbol set it scanned (your watchlist, a fallback, a major index, or your custom list) and
            highlights it in amber when a fallback was used so you know to build your watchlist.
          </li>
          <li>
            <strong>Single Pro plan with 14-day free trial.</strong> Pricing has been simplified to one
            plan — <strong>VCP Trader AI Pro at $99/month</strong>, with a 14-day free trial.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "getting-started",
    title: "Getting Started",
    icon: Sparkles,
    summary: "Set up your account, pick a mode, and start your 14-day free trial.",
    keywords: ["onboarding", "setup", "first time", "new", "trial", "pro plan", "pricing"],
    body: (
      <>
        <p>
          VCP Trader AI helps you research stock and options ideas in plain English, review them with
          AI-assigned grades, and prepare orders that you submit through your own connected broker.
          You stay in control — no autonomous trading.
        </p>
        <ol className="list-decimal pl-5 space-y-2 mt-3">
          <li><strong>Start your free trial.</strong> There's one plan — <strong>Pro at $99/month with a 14-day free trial</strong>. You can cancel anytime from the Stripe billing portal.</li>
          <li><strong>Complete the persona wizard.</strong> A short 7-step questionnaire computes your trader persona (buyer / seller / complex / learner), suggests a strategy bundle, and seeds safety limits like max risk per trade and max daily loss.</li>
          <li><strong>Pick a starting mode</strong> from the sidebar: Home (overview), Grow (growth ideas), Income (covered calls / CSPs), Trade (plain-English builder), or Markets (news + sentiment).</li>
          <li><strong>Set your limits</strong> in <Link href="/settings/risk-profile" className="underline">My Limits</Link> — minimum grade, max risk per trade, allowed instruments. These limits are enforced when you prepare an order.</li>
          <li><strong>Connect a broker</strong> in <Link href="/settings" className="underline">Settings → Connect Your Broker</Link> (Tradier or TradeStation, both via OAuth; SnapTrade also supported) for live quotes and order routing. Without a broker you can still browse ideas with simulated examples.</li>
          <li><strong>Try paper mode first.</strong> Connect a broker sandbox account to practice with realistic order routing before going live.</li>
        </ol>
        <p className="mt-3 text-sm text-muted-foreground">
          New accounts are seeded with a 10-symbol Starter Watchlist so Home, Markets, and the scanners
          have something to show before you build your own list.
        </p>
      </>
    ),
  },
  {
    id: "home",
    title: "Home Dashboard",
    icon: Home,
    summary: "Daily ideas, market snapshot, and a scan-source picker that controls every tab.",
    keywords: ["dashboard", "today's ideas", "scan from", "universe", "watchlist", "dow", "nasdaq", "sp500"],
    body: (
      <>
        <p>
          The <Link href="/home" className="underline">Home</Link> page is your daily starting point.
          It shows the broker connection state, market open/closed, an AI snapshot panel, and the
          "Today's Ideas For You" board with tabs for All, Stocks, Options, Income, Watchlist, and
          Market Alerts.
        </p>

        <h4 className="font-semibold mt-3">"Scan from" picker</h4>
        <p>
          In the top-right of the Today's Ideas section there's a <strong>Scan from</strong> dropdown.
          It controls the symbol universe used by every tab. Your selection is saved to your account,
          so it sticks across devices and sessions.
        </p>
        <ul className="list-disc pl-5 space-y-1 mt-2">
          <li><strong>Auto (recommended)</strong> — uses your watchlist with smart fallbacks if the watchlist is empty or returns nothing.</li>
          <li><strong>My Watchlist</strong> — only the symbols you've saved.</li>
          <li><strong>Dow 30</strong> — 30 blue-chip stocks.</li>
          <li><strong>Nasdaq 100</strong> — top 100 Nasdaq names.</li>
          <li><strong>S&amp;P 500</strong> — top 500 US stocks (sampled to keep scans fast).</li>
          <li><strong>High Volume</strong> — most-traded liquid names.</li>
          <li><strong>Options Liquid</strong> — best names for option ideas (tight spreads, deep open interest).</li>
          <li><strong>Custom symbols…</strong> — opens an inline input where you type your own list (e.g. <code>AAPL, MSFT, NVDA</code>) and click Apply. Up to 30 tickers, comma-separated.</li>
        </ul>
        <p className="mt-2 text-sm text-muted-foreground">
          When you pin a specific universe, the scanner respects your choice and won't silently widen
          to a different list — so an empty tab really means nothing in your selected universe meets
          the filter for that tab. Switch to Auto to let the system pick a fallback.
        </p>

        <h4 className="font-semibold mt-3">Other things on Home</h4>
        <ul className="list-disc pl-5 space-y-1">
          <li>Type a request like "income ideas this week" or "why is NVDA moving?" — the prompt bar routes you to the right tool.</li>
          <li>Tap a popular chip to jump straight into Grow, Income, Trade, or Markets.</li>
          <li>Review the AI snapshot for market tone, top growth, top income, and watchlist risk.</li>
          <li>A "Simulated data" badge appears when you don't have a broker connected and we're using example quotes.</li>
        </ul>
        <p className="mt-3 text-sm text-muted-foreground">
          Everything on this screen is informational — no order is sent until you explicitly review and confirm it.
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
    summary: "Covered calls, cash-secured puts, defined-risk income — with full InstaTrade™ review.",
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
        <h4 className="font-semibold mt-3">Reviewing &amp; preparing an order</h4>
        <p>
          Both <strong>Review Details</strong> and <strong>Prepare Order</strong> on each idea card open
          the full order-review modal — the same one used in Grow. You'll see strategy, capital
          required, max loss, and a required acknowledgment checkbox before you can submit.
        </p>
        <ul className="list-disc pl-5 space-y-1 mt-2">
          <li><strong>Broker connected (live)</strong> — the action button reads <em>Send to Broker via InstaTrade™</em>.</li>
          <li><strong>Broker connected (sandbox)</strong> — the button reads <em>Paper Trade</em>.</li>
          <li><strong>No broker connected</strong> — the button is disabled and prompts you to connect one.</li>
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
        <h4 className="font-semibold mt-3">Universe source chip</h4>
        <p>
          A chip at the top of the page shows which symbol set the radar actually scanned —
          <em> My Watchlist</em>, <em>Large Cap (Dow 30)</em>, <em>High Volume</em>, <em>Options
          Liquid</em>, <em>Nasdaq 100</em>, <em>S&amp;P 500</em>, or <em>Custom</em>. If your watchlist
          was empty and the system fell back to a starter list, the chip turns amber so you know to
          build your watchlist for personalized results.
        </p>
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
          <li>
            Outside regular hours, a <strong>Pre-Market / After-Hours</strong> toggle appears on the
            ticket — see the <Link href="/guide#extended-hours" className="underline">Pre-Market &amp; After-Hours</Link>{" "}
            section.
          </li>
        </ul>
        <p className="mt-3 text-sm text-muted-foreground">
          The "Review with InstaTrade™" button on any setup card opens the same review flow with the
          fields pre-filled.
        </p>
      </>
    ),
  },
  {
    id: "extended-hours",
    title: "Pre-Market & After-Hours Trading",
    icon: Moon,
    summary: "Place limit orders outside regular hours, see live extended-session prices, and understand the risks.",
    keywords: [
      "pre-market", "premarket", "after-hours", "afterhours", "extended hours",
      "extended session", "overnight", "early trading", "late trading",
    ],
    body: (
      <>
        <p>
          VCP Trader AI supports US extended trading sessions in addition to regular hours.
          The market badge in the app header shows which session is active right now:
        </p>
        <ul className="list-disc pl-5 space-y-1 mt-2">
          <li><strong className="text-blue-400">Pre-Market</strong> — 4:00 AM – 9:30 AM ET (weekdays).</li>
          <li><strong className="text-emerald-400">Market Open</strong> — 9:30 AM – 4:00 PM ET (regular session).</li>
          <li><strong className="text-orange-400">After-Hours</strong> — 4:00 PM – 8:00 PM ET (weekdays).</li>
          <li><strong className="text-muted-foreground">Market Closed</strong> — outside the windows above, weekends, and US market holidays.</li>
        </ul>

        <h4 className="font-semibold mt-4">How to place a pre-market or after-hours order</h4>
        <ol className="list-decimal pl-5 space-y-1 mt-2">
          <li>Open the <Link href="/instatrade" className="underline">InstaTrade™ ticket</Link> on any stock during a pre-market or after-hours window.</li>
          <li>Toggle on the blue <strong>Pre-Market Session</strong> or <strong>After-Hours Session</strong> switch on the ticket.</li>
          <li>The ticket auto-switches to <strong>Limit</strong> order type and disables bracket exits — both required by the brokers.</li>
          <li>Set your limit price (use the Current / Resistance / ±$0.05 chips to nudge it).</li>
          <li>Review the order and tap <strong>Send Pre-Market Order</strong> or <strong>Send After-Hours Order</strong>.</li>
        </ol>

        <h4 className="font-semibold mt-4">Important things to know</h4>
        <ul className="list-disc pl-5 space-y-1 mt-2">
          <li><strong>Limit orders only.</strong> Pre/after sessions don't accept market orders. The ticket enforces this.</li>
          <li><strong>No bracket exits.</strong> OCO/OTOCO bracket orders aren't available in extended sessions. Submit your entry first; managed exits resume at the next regular session.</li>
          <li><strong>Wider spreads &amp; thinner volume.</strong> Bid/ask gaps can be much larger than during the regular session, so fills aren't guaranteed and the price you see may move sharply.</li>
          <li><strong>Broker support.</strong> Tradier supports pre-market and after-hours routing today. TradeStation accounts will get a clear error message until extended-hours mapping is added.</li>
          <li><strong>Volume &amp; RVOL filters relax automatically.</strong> Scanners loosen volume thresholds outside regular hours since extended-session volume is naturally light.</li>
          <li><strong>Risk Controls still apply.</strong> All My Limits checks (allowed instruments, min score, R:R, max risk per trade) run on extended-hours orders too.</li>
          <li><strong>Exit Protection runs through 8:00 PM ET.</strong> Managed option exits stay active across both extended sessions, using marketable limit orders at the current mid (instead of market) so they comply with broker rules.</li>
        </ul>

        <p className="mt-3 text-sm text-muted-foreground">
          When the market is fully closed (between 8:00 PM and 4:00 AM ET, weekends, or holidays) the
          extended-hours toggle is hidden and order submission is disabled until the next session opens.
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
          <div>
            <dt className="font-semibold">How much does it cost? Is there a trial?</dt>
            <dd className="text-muted-foreground">There's one plan — <strong>VCP Trader AI Pro at $99/month</strong> with a <strong>14-day free trial</strong>. No charge until the trial ends; cancel anytime.</dd>
          </div>
          <div>
            <dt className="font-semibold">Why is my "Today's Ideas" tab empty?</dt>
            <dd className="text-muted-foreground">The filters for that tab didn't surface anything in the universe you selected. Try the <em>Scan from</em> picker on Home to switch to Dow 30, Nasdaq 100, S&amp;P 500, or a custom list — or go back to <em>Auto</em> to let the system fall back to a broader set.</dd>
          </div>
          <div>
            <dt className="font-semibold">Can I scan a custom list of stocks?</dt>
            <dd className="text-muted-foreground">Yes. On Home, choose <em>Custom symbols…</em> in the Scan from picker, type a comma-separated list (up to 30 tickers), and click Apply. The choice is saved to your account.</dd>
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
