// Condensed knowledge base for the interactive Help Assistant.
// Each entry mirrors a User Guide section (client/src/pages/user-guide.tsx)
// plus key application behavior so the AI can answer accurately. Text is
// plain-language and compliance-safe: analysis-only framing, no advice.

export interface HelpTopic {
  id: string; // matches /guide/:section ids where applicable
  title: string;
  keywords: string[];
  text: string;
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    keywords: ["onboarding", "setup", "start", "new", "trial", "pricing", "plan", "subscribe", "signup", "account"],
    text: "VCP Trader AI has one plan: Pro at $99/month with a 14-day free trial. After signing up, users can optionally answer 3 quick setup questions or skip straight to the dashboard. Two ways to use the app: Analysis Mode (no broker connected — AI analysis, educational examples, delayed reference data, no orders) and Connected Broker Mode (broker connected — live data plus InstaTrade order review and submission). The app never auto-trades; every order requires user review and an acknowledgment checkbox.",
  },
  {
    id: "home",
    title: "Home Dashboard",
    keywords: ["dashboard", "home", "today's ideas", "scan from", "stock list", "universe", "watchlist", "snapshot"],
    text: "The Home dashboard shows a prompt bar (type what you want in plain English), status pills, action cards, an AI market snapshot, and Today's Opportunities. The scan-source picker ('Scan from') controls which stock list (watchlist, Dow, Nasdaq-100, S&P 500) feeds the idea tabs. Users can also set a default landing page after login in Settings → Display.",
  },
  {
    id: "grow",
    title: "Grow My Money (Goal Mode)",
    keywords: ["grow", "goal", "growth", "wizard", "capital"],
    text: "Grow (/goal-mode) is a 6-step wizard: capital, goal, risk, activity level, instruments, broker. It produces a Goal Reality Check and ranked candidate scenarios. 'Prepare Order' always opens an order review modal requiring explicit acknowledgment before anything is sent to a broker.",
  },
  {
    id: "income",
    title: "Generate Income",
    keywords: ["income", "covered call", "cash secured put", "csp", "premium", "wheel"],
    text: "Income mode (/income-mode) builds covered-call, cash-secured-put, and defined-risk income ideas from your inputs. Each idea goes through the full InstaTrade review flow — nothing is submitted without your review and acknowledgment.",
  },
  {
    id: "trade",
    title: "Trade Finder",
    keywords: ["trade finder", "prompt", "natural language", "agent", "describe", "plain english"],
    text: "Trade Finder (/trade-finder) lets users describe a setup in everyday words (e.g. 'find me a pullback setup on strong tech stocks'). The Strategy Agent translates it into a structured trade idea with entry, stop, targets, score, and an instrument recommendation (stock vs option).",
  },
  {
    id: "markets",
    title: "Market Intel & News",
    keywords: ["market intel", "news", "sentiment", "briefing", "moving", "catalyst"],
    text: "Markets (/market-intel) includes the Morning Briefing, watchlist sentiment, strongest positive/negative movers, 'Why is X moving?' lookups powered by news sentiment analysis, and Top Catalysts.",
  },
  {
    id: "radar",
    title: "Top Opportunities (Radar)",
    keywords: ["radar", "opportunity", "opportunities", "scanner", "ideas", "rank", "grade", "score"],
    text: "Top Opportunities (/opportunity-radar) shows AI-ranked candidate scenarios across the chosen stock list. Composite score weights: technical 28, momentum 22, sentiment 20, liquidity 15, risk 15; grades A+/A/B/C, anything under 60 is hidden. Every scenario is AI-generated analysis — orders still require your review and acknowledgment. A card/list view toggle is available.",
  },
  {
    id: "instatrade",
    title: "InstaTrade Order Review",
    keywords: ["instatrade", "order", "execute", "place trade", "submit", "broker order", "oco", "bracket", "take profit", "stop loss", "live trading setup"],
    text: "InstaTrade is the only execution path. It is a sheet-based order ticket with a required acknowledgment checkbox. Button states: no broker account → 'Connect Broker to Use InstaTrade' (disabled); live account without Live Trading Setup → 'Complete Live Trading Setup' (opens an inline dialog); setup complete → 'Send to Broker with InstaTrade'. Server-side risk guardrails block orders that violate stored preferences (allowed instruments, defined-risk-only, minimum score, minimum reward/risk).",
  },
  {
    id: "position-protection",
    title: "Position Protection (Exit Rules)",
    keywords: ["position protection", "exit", "stop loss", "take profit", "trailing stop", "protect", "exit rules"],
    text: "Position Protection lets users set their own stop loss, take profit, and trailing stop rules on verified live brokerage positions. The app watches the position during market hours and submits the exit order when the rule triggers. It applies to live broker positions only.",
  },
  {
    id: "extended-hours",
    title: "Pre-Market & After-Hours Trading",
    keywords: ["extended hours", "premarket", "pre-market", "after hours", "after-hours", "overnight"],
    text: "Users can place limit orders outside regular hours and see live extended-session prices where the broker supports it. Extended-hours trading carries added risks (lower liquidity, wider spreads) which the app discloses.",
  },
  {
    id: "risk-controls",
    title: "Risk Controls (My Limits)",
    keywords: ["risk", "limits", "guardrails", "max loss", "risk profile", "my limits", "blocked", "guardrail_blocked"],
    text: "My Limits (/settings/risk-profile) sets personal guardrails: allowed instruments, defined-risk-only, minimum setup score, minimum reward/risk, max risk per trade. The server enforces these on every order — a trade that violates them is blocked with a clear explanation.",
  },
  {
    id: "paper-mode",
    title: "Analysis Mode vs. Connected Broker Mode",
    keywords: ["analysis mode", "connected broker", "modes", "paper", "simulated", "delayed data", "live data"],
    text: "Two modes: Analysis Mode (no broker) gives AI analysis, educational examples, and delayed reference data — no orders. Connected Broker Mode (broker linked) gives live data and InstaTrade order review/submission. Connecting a broker is done in Settings → Broker Connections.",
  },
  {
    id: "brokers",
    title: "Brokers & Connections",
    keywords: ["broker", "connect", "tradier", "tradestation", "snaptrade", "connection", "oauth", "link account"],
    text: "Supported brokers: Tradier and TradeStation (OAuth, primary), plus SnapTrade where available. Connect from Settings → Broker Connections. Connections are encrypted; users pick a preferred trading account. Disconnecting a broker returns the app to Analysis Mode.",
  },
  {
    id: "journal",
    title: "Journal & Trade Setups",
    keywords: ["journal", "history", "setups", "activity", "past trades", "outcomes"],
    text: "My Activity (/history) keeps a history of every setup, scenario, and order with grade, instrument, and outcome filters. Users can record trade outcomes to track results over time.",
  },
  {
    id: "settings",
    title: "Settings & Preferences",
    keywords: ["settings", "preferences", "notifications", "alerts", "watchlist", "default page", "display", "theme", "password", "delete account"],
    text: "Settings covers trading preferences, risk limits, watchlists, scanner filters, broker connections, notifications, and display options including 'Default Page After Login'. Account management (change password, delete account) is under Settings → Account.",
  },
  {
    id: "strategies",
    title: "Strategy Reference",
    keywords: ["strategy", "vcp", "orb", "momentum", "breakout", "pullback", "volatility squeeze", "pattern"],
    text: "Built-in strategies include VCP (Volatility Contraction Pattern), Opening Range Breakout, momentum, breakout, pullback, and Volatility Squeeze. Each idea shows a probability grade (A+/A/B/C) from a 5-factor weighted score: technical 30, realtime 25, news 15, analyst 15, risk 15. The technical Strategy Reference lives at /help; the plain-language guide at /guide.",
  },
  {
    id: "compliance",
    title: "Compliance & Disclaimers",
    keywords: ["compliance", "advice", "disclaimer", "legal", "fiduciary", "guarantee"],
    text: "All output is AI-generated analysis, never investment advice. VCP Trader AI is not a broker-dealer or investment adviser. The app never auto-trades for customers; every live order requires user review and an acknowledgment checkbox. Past performance does not guarantee future results.",
  },
  {
    id: "faq",
    title: "FAQ",
    keywords: ["faq", "question", "cancel", "refund", "billing", "subscription", "manage plan"],
    text: "Common answers: billing is via Stripe — manage or cancel any time from the billing portal in Settings. The 14-day trial gives full Pro access. Data in Analysis Mode is delayed reference data; live data requires a connected broker. Support: use this help assistant, the User Guide at /guide, or email support@sunfishtrading.com.",
  },
  {
    id: "faq",
    title: "Contact Support",
    keywords: [
      "support",
      "contact",
      "email",
      "help",
      "reach",
      "support team",
      "customer service",
      "get in touch",
      "talk to someone",
      "human",
      "report a problem",
      "bug",
      "issue",
    ],
    text: "You can reach the support team by email at support@sunfishtrading.com. You can also use this help assistant for how-to questions, or browse the User Guide at /guide for a full walkthrough of every feature.",
  },
];

// Quick reference of in-app destinations the assistant may point users to.
export const HELP_PAGES: { label: string; path: string; hint: string }[] = [
  { label: "Home", path: "/home", hint: "dashboard, today's ideas" },
  { label: "Grow", path: "/goal-mode", hint: "goal wizard, growth ideas" },
  { label: "Income", path: "/income-mode", hint: "covered calls, CSPs" },
  { label: "Trade Finder", path: "/trade-finder", hint: "plain-English setup builder" },
  { label: "Markets", path: "/market-intel", hint: "news, sentiment, briefing" },
  { label: "Top Opportunities", path: "/opportunity-radar", hint: "AI-ranked scenarios" },
  { label: "My Activity", path: "/history", hint: "journal, setup history" },
  { label: "My Limits", path: "/settings/risk-profile", hint: "risk guardrails" },
  { label: "Settings", path: "/settings", hint: "preferences, brokers, billing" },
  { label: "User Guide", path: "/guide", hint: "full plain-language guide" },
];

// Rank in-app pages by label/hint overlap with the question — used to point
// users at the right screen when the guide search alone isn't enough.
export function rankHelpPages(question: string, limit = 2): { label: string; path: string; hint: string }[] {
  const lower = question.toLowerCase();
  const words = lower.split(/[^a-z0-9']+/).filter((w) => w.length > 2);
  const scored = HELP_PAGES.map((p) => {
    let score = 0;
    const labelLower = p.label.toLowerCase();
    const hintLower = p.hint.toLowerCase();
    if (lower.includes(labelLower)) score += 3;
    for (const w of words) {
      if (labelLower.includes(w)) score += 2;
      if (hintLower.includes(w)) score += 1;
    }
    return { p, score };
  });
  return scored
    .filter((s) => s.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.p);
}

// Rank topics by keyword/title overlap with the question. Simple and fast —
// good enough to pick context for the model and drive the no-AI fallback.
export function rankHelpTopics(question: string, limit = 4, minScore = 0): HelpTopic[] {
  const lower = question.toLowerCase();
  const words = lower.split(/[^a-z0-9']+/).filter((w) => w.length > 2);
  const scored = HELP_TOPICS.map((t) => {
    let score = 0;
    for (const kw of t.keywords) {
      if (lower.includes(kw)) score += kw.includes(" ") ? 3 : 2;
    }
    const titleLower = t.title.toLowerCase();
    for (const w of words) {
      if (titleLower.includes(w)) score += 1;
      if (t.text.toLowerCase().includes(w)) score += 0.25;
    }
    return { t, score };
  });
  return scored
    .filter((s) => s.score > Math.max(0, minScore))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.t);
}
