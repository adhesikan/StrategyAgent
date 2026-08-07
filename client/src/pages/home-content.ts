/**
 * Landing page content constants — exported for testing.
 *
 * Keeping content separate from the component allows pure-function tests
 * without requiring DOM rendering or @testing-library/react.
 */

// ── Navigation ─────────────────────────────────────────────────────────────
export const NAV_LINKS = [
  { href: "#goals", label: "Product" },
  { href: "#how-it-works", label: "How It Works" },
  { href: "#planning", label: "Stocks & Options" },
  // InstaTrade™ label comes from useBranding at runtime — anchor is always #broker
  { href: "#broker", label: "InstaTrade™" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

export const NAV_SECTION_IDS = ["goals", "how-it-works", "workspace", "planning", "broker", "pricing", "faq"];

// ── Hero ────────────────────────────────────────────────────────────────────
export const HERO_HEADLINE = "Research, Plan, and Verify Stock & Options Opportunities";
export const HERO_EYEBROW = "AI-Powered Research and Trade Planning for Self-Directed Traders";
export const HERO_SUBHEADLINE =
  "Discover qualified research candidates, understand why they matter, compare stock and options structures, verify live contracts through supported brokerages, and prepare trades for review with InstaTrade™.";

export const HERO_BADGES = [
  "Deterministic Opportunity Screening",
  "AI Trading Workspace",
  "Stock & Options Planning",
  "Broker-Connected Verification",
  "User-Controlled Review",
];

// ── Prohibited terms ───────────────────────────────────────────────────────
/** Terms that must NEVER appear as positive product claims on the landing page. */
export const PROHIBITED_TERMS: RegExp[] = [
  /\bwinning trade\b/i,
  /\bguaranteed\b/i,
  /\bhigh.?probability\b/i,
  /\bAI predicts\b/i,
  /\bone.?click execution\b/i,
  /\bautomatically place trades\b/i,
  /\bfully automated\b/i,
  /\bautonomous trading\b/i,
  /\bstock picks\b/i,
  /\bAI picks\b/i,
  /\bBeat the market\b/i,
  /\brisk.?free\b/i,
  /\bexpected profit\b/i,
  /\bexpected return\b/i,
  /InstaTrade™ order review and submission/i,
  /See Live Ideas/i,
  /Find Better Stock.*Opportunities With AI/i,
];

/**
 * Phrases that are ONLY acceptable when appearing in a negating FAQ context.
 * e.g. "Does it trade automatically? No."
 */
export const CONTEXT_RESTRICTED_TERMS: RegExp[] = [
  /trade automatically/i,
  /\brecommendation\b/i,
];

// ── Choose Your Goal cards ─────────────────────────────────────────────────
export interface GoalCard {
  title: string;
  description: string;
  items: string[];
  cta: string;
  testId: string;
}

export const GOAL_CARDS: GoalCard[] = [
  {
    title: "Grow Long-Term Wealth",
    description:
      "Research companies with durable growth drivers, improving fundamentals, favorable long-term trends, and clearer entry conditions.",
    items: [
      "Long-term research candidates",
      "Growth and earnings context",
      "Valuation context",
      "Thesis monitoring",
      "Portfolio concentration awareness",
    ],
    cta: "Explore Growth Research",
    testId: "card-goal-grow",
  },
  {
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
  },
  {
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
  },
  {
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
  },
];

// ── How It Works steps ─────────────────────────────────────────────────────
export interface WorkflowStep {
  n: string;
  title: string;
  copy: string;
}

export const WORKFLOW_STEPS: WorkflowStep[] = [
  {
    n: "1",
    title: "Discover",
    copy: "VCP Trader AI scans supported market data and surfaces qualified growth, income, trading, watchlist, and approaching-qualification research candidates.",
  },
  {
    n: "2",
    title: "Understand",
    copy: "Open the AI Trading Workspace to see why a candidate qualified, its lifecycle state, market regime, rank, evidence, and active risks.",
  },
  {
    n: "3",
    title: "Evaluate",
    copy: "Review technical context, news, catalysts, congressional disclosures, available institutional context, and thesis invalidation conditions.",
  },
  {
    n: "4",
    title: "Plan",
    copy: "Compare possible stock and illustrative options structures, including holding period, DTE framework, strike-selection framework, advantages, and trade-offs.",
  },
  {
    n: "5",
    title: "Verify",
    copy: "With a supported brokerage connection, resolve actual listed expirations and strikes, inspect available quotes, liquidity, and Greeks, and compare verified contract candidates.",
  },
  {
    n: "6",
    title: "Review",
    copy: "Prepare the selected stock or options structure for review through InstaTrade™. Nothing is submitted without explicit user confirmation.",
  },
];

export const STEP_NAMES_IN_ORDER = ["Discover", "Understand", "Evaluate", "Plan", "Verify", "Review"];

// ── Workspace modules ──────────────────────────────────────────────────────
export const WORKSPACE_MODULES = [
  { label: "Research Thesis", desc: "Candidate rationale and qualification reasons" },
  { label: "What Changed", desc: "Lifecycle state and scan-over-scan comparison" },
  { label: "Decision & Evidence", desc: "Scored evidence across technical, market, and news" },
  { label: "Stock & Options Planning", desc: "Illustrative structure comparison and frameworks" },
  { label: "Risk & Invalidation", desc: "Active risks and conditions that break the thesis" },
  { label: "Ask VCP AI", desc: "Contextual questions answered about this opportunity" },
];

export const CONTEXTUAL_AI_PROMPTS = [
  "Why did this candidate qualify?",
  "What changed since the previous scan?",
  "What evidence weakens the thesis?",
  "What would invalidate the setup?",
  "Explain the illustrative options structure.",
  "What should I verify before using InstaTrade™?",
];

// ── Research capabilities strip ────────────────────────────────────────────
export interface ResearchCapability {
  label: string;
  desc: string;
  note?: string;
  badge?: string;
}

export const RESEARCH_CAPABILITIES: ResearchCapability[] = [
  {
    label: "Technical Context",
    desc: "Trend, momentum, setup quality, and invalidation.",
  },
  {
    label: "Market Regime",
    desc: "Market environment and candidate alignment.",
  },
  {
    label: "News and Catalysts",
    desc: "Recent coverage, sentiment, earnings, and event risks.",
  },
  {
    label: "Congressional Disclosures",
    desc: "Publicly disclosed congressional transactions with transaction and reporting dates.",
    note: "May be disclosed after the transaction date and do not indicate future performance.",
  },
  {
    label: "Portfolio Context",
    desc: "Concentration, sector exposure, earnings overlap, and capital impact where available.",
  },
  {
    label: "Institutional Intelligence",
    desc: "Rolling out with delayed SEC Form 13F data and verified security mappings.",
    note: "Based on delayed quarterly filings. Coverage may be limited while mappings are validated.",
    badge: "Rolling Out",
  },
];

// ── Planning section ───────────────────────────────────────────────────────
export const PLANNING_HEADING = "Plan the Structure Before Selecting the Contract";
export const PLANNING_DISCLAIMER =
  "Illustrative planning does not represent a live option contract. Actual contract availability and pricing require a supported connected brokerage.";

export const STOCK_ITEMS = [
  "Long-term position",
  "Breakout entry",
  "Pullback entry",
  "Swing position",
  "Holding horizon",
  "Entry, stop, and objective framework",
  "Invalidation conditions",
];

export const OPTIONS_ITEMS = [
  "Structure selection",
  "Target DTE range",
  "Strike-selection framework",
  "Debit versus credit characteristics",
  "Time decay",
  "Assignment risk",
  "Defined-risk characteristics",
];

export const BROKER_ITEMS = [
  "Actual listed expirations",
  "Actual strikes",
  "Displayed bid and ask",
  "Available open interest and volume",
  "Available Greeks",
  "Quote timestamp",
  "Liquidity and contract fit",
];

// ── Broker section ─────────────────────────────────────────────────────────
export const WITHOUT_BROKER_CAPABILITIES = [
  "Daily-close and stored market research",
  "Qualified research candidates",
  "AI Trading Workspace",
  "Stock structure planning",
  "Illustrative options structures",
  "DTE and strike frameworks",
  "News, catalysts, and Congress research",
  "Contextual AI explanations",
  "Saved research and watchlists",
];

export const WITH_BROKER_CAPABILITIES = [
  "Current broker-supplied quotes",
  "Live options chains",
  "Actual listed expirations and strikes",
  "Available bid/ask, liquidity, and Greeks",
  "Account and position context",
  "Buying-power validation where supported",
  // InstaTrade™ name from useBranding at runtime — checked via pattern
  "preparation and review",
  "User-directed order submission only where implemented and enabled",
];

export const BROKER_DISCLAIMER =
  "Connect a supported brokerage. Capabilities vary by brokerage, account type, market-data entitlement, and integration status.";

export const SUPPORTED_BROKER_NOTE =
  "Supported brokerage connections include Tradier and TradeStation. Additional connections and capabilities may vary.";

// ── FAQ items ──────────────────────────────────────────────────────────────
export interface FaqItem {
  q: string;
  a: string;
}

export const FAQ_ITEMS: FaqItem[] = [
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
    a: "Discover research candidates, review evidence, compare stock and illustrative options structures, explore DTE and strike frameworks, save research, use supported Congress, news, catalyst, and market-context tools, and ask contextual questions with VCP AI.",
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

// ── Compliance / footer ────────────────────────────────────────────────────
export const FOOTER_COMPLIANCE_TEXT =
  "VCP Trader AI provides educational research, market analysis, and user-directed trade planning tools. It does not provide personalized investment advice, guarantee outcomes, or independently determine whether a trade is suitable for a user. Market, options, broker, congressional, institutional, and news data may be delayed, incomplete, or unavailable. Users should verify all information with their brokerage and conduct independent due diligence before making financial decisions.";

// ── SEO metadata ───────────────────────────────────────────────────────────
export const PAGE_TITLE = "VCP Trader AI — Stock and Options Research & Trade Planning";
export const META_DESCRIPTION =
  "Discover qualified stock and options research candidates, evaluate evidence, compare trade structures, verify live contracts through supported brokerages, and prepare trades for review with InstaTrade™.";
export const OG_TITLE = "VCP Trader AI — Research, Plan, and Verify Stock & Options Opportunities";
export const OG_DESCRIPTION =
  "A deterministic research and trade-planning platform for self-directed stock and options traders.";

// ── Pricing ────────────────────────────────────────────────────────────────
export const PRICING_FEATURE_GROUPS = [
  {
    label: "Research and Opportunities",
    items: [
      "Qualified stock and options research candidates",
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
      // InstaTrade™ name filled at runtime — check pattern in tests
      "preparation and review",
    ],
  },
];

export const TRIAL_COLUMN_ITEMS = [
  "Daily-close stock research",
  "Long-term opportunity analysis",
  "Delayed or snapshot market context",
  "Illustrative options structure guidance",
];

export const BROKER_COLUMN_ITEMS = [
  "Current stock quotes",
  "Live options chains and available Greeks through supported broker connections",
  "Account and position context",
  // InstaTrade™ order preparation and review — name from useBranding
  "order preparation and review",
];
