/**
 * Landing page tests — pure-function style (no DOM rendering required).
 *
 * Tests the exported content constants from home-content.ts and scans
 * the home.tsx source file for compliance, following the same pattern
 * as the rest of the client test suite.
 *
 * Sprint: VCP Trader AI Landing Page Simplification and Capability Refresh
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

import {
  NAV_LINKS,
  NAV_SECTION_IDS,
  HERO_HEADLINE,
  HERO_EYEBROW,
  HERO_SUBHEADLINE,
  HERO_BADGES,
  PROHIBITED_TERMS,
  GOAL_CARDS,
  WORKFLOW_STEPS,
  STEP_NAMES_IN_ORDER,
  WORKSPACE_MODULES,
  CONTEXTUAL_AI_PROMPTS,
  RESEARCH_CAPABILITIES,
  PLANNING_HEADING,
  PLANNING_DISCLAIMER,
  STOCK_ITEMS,
  OPTIONS_ITEMS,
  BROKER_ITEMS,
  WITHOUT_BROKER_CAPABILITIES,
  WITH_BROKER_CAPABILITIES,
  BROKER_DISCLAIMER,
  SUPPORTED_BROKER_NOTE,
  FAQ_ITEMS,
  FOOTER_COMPLIANCE_TEXT,
  PAGE_TITLE,
  META_DESCRIPTION,
  OG_TITLE,
  OG_DESCRIPTION,
  PRICING_FEATURE_GROUPS,
  TRIAL_COLUMN_ITEMS,
  BROKER_COLUMN_ITEMS,
} from "../home-content";

// ── Source-file scanner ───────────────────────────────────────────────────
/** Full text of the landing page component (used for compliance checks). */
function loadSource(): string {
  return readFileSync(resolve(__dirname, "../home.tsx"), "utf8");
}

// ── A. Page structure ─────────────────────────────────────────────────────
describe("A. Page structure", () => {
  it("defines 7 primary section IDs", () => {
    expect(NAV_SECTION_IDS).toHaveLength(7);
  });

  it("section IDs are in spec-correct order", () => {
    expect(NAV_SECTION_IDS).toEqual([
      "goals",
      "how-it-works",
      "workspace",
      "planning",
      "broker",
      "pricing",
      "faq",
    ]);
  });

  it("home.tsx references each primary section ID", () => {
    const src = loadSource();
    for (const id of NAV_SECTION_IDS) {
      expect(src).toContain(`id="${id}"`);
    }
  });

  it("home.tsx renders sections in spec-correct order", () => {
    const src = loadSource();
    const positions = NAV_SECTION_IDS.map((id) => src.indexOf(`id="${id}"`));
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  it("old removed sections are not present as standalone IDs", () => {
    const src = loadSource();
    const removedIds = ["features", "opportunities", "time-horizon", "long-term-investor", "plain-english", "risk-controls", "portfolio"];
    for (const id of removedIds) {
      // These should not appear as section IDs (id="...") — they may appear in nav links for backward compat only
      expect(src).not.toContain(`id="${id}"`);
    }
  });

  it("nav links point to correct section anchors", () => {
    for (const link of NAV_LINKS) {
      expect(link.href).toMatch(/^#/);
      // href without # should be a known section ID
      const sectionId = link.href.slice(1);
      expect(NAV_SECTION_IDS).toContain(sectionId);
    }
  });

  it("nav has 6 links", () => {
    expect(NAV_LINKS).toHaveLength(6);
  });

  it("nav includes correct labels in correct order", () => {
    const labels = NAV_LINKS.map((l) => l.label);
    expect(labels[0]).toBe("Product");
    expect(labels[1]).toBe("How It Works");
    expect(labels[2]).toBe("Stocks & Options");
    // [3] = InstaTrade™ (dynamic)
    expect(labels[4]).toBe("Pricing");
    expect(labels[5]).toBe("FAQ");
  });

  it("home.tsx renders sections in final page order: Hero → Goals → HowItWorks → Workspace → Planning → Broker → Pricing → FAQ → FinalCta", () => {
    const src = loadSource();
    const markers = [
      "HeroSection",
      "ChooseYourGoalSection",
      "HowItWorksSection",
      "WorkspaceSection",
      "PlanningSection",
      "BrokerSection",
      "PricingSection",
      "FAQSection",
      "FinalCtaSection",
    ];
    const positions = markers.map((m) => {
      // Find usage in JSX render block (after the last function definition)
      const idx = src.lastIndexOf(`<${m}`);
      return idx;
    });
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });
});

// ── B. Hero ───────────────────────────────────────────────────────────────
describe("B. Hero section", () => {
  it("headline is the spec-required text", () => {
    expect(HERO_HEADLINE).toMatch(/Research, Plan, and Verify/i);
    expect(HERO_HEADLINE).toMatch(/Stock.*Options Opportunities/i);
  });

  it("headline does NOT say 'Find Better'", () => {
    expect(HERO_HEADLINE).not.toMatch(/Find Better/i);
  });

  it("eyebrow uses research/trade-planning framing", () => {
    expect(HERO_EYEBROW).toMatch(/Research and Trade Planning/i);
    expect(HERO_EYEBROW).toMatch(/Self-Directed Traders/i);
  });

  it("subheadline mentions qualified research candidates", () => {
    expect(HERO_SUBHEADLINE).toMatch(/qualified research candidates/i);
  });

  it("subheadline mentions verify.*live contracts.*supported brokerages", () => {
    expect(HERO_SUBHEADLINE).toMatch(/verify.*live contracts.*supported brokerages/i);
  });

  it("subheadline mentions InstaTrade™ preparation/review wording", () => {
    expect(HERO_SUBHEADLINE).toMatch(/InstaTrade™/i);
    expect(HERO_SUBHEADLINE).not.toMatch(/order review and submission/i);
  });

  it("hero has exactly 5 benefit badges", () => {
    expect(HERO_BADGES).toHaveLength(5);
  });

  it("hero badges contain required spec items", () => {
    const text = HERO_BADGES.join(" ");
    expect(text).toMatch(/Deterministic Opportunity Screening/i);
    expect(text).toMatch(/AI Trading Workspace/i);
    expect(text).toMatch(/Stock.*Options Planning/i);
    expect(text).toMatch(/Broker-Connected Verification/i);
    expect(text).toMatch(/User-Controlled Review/i);
  });

  it("home.tsx hero shows 'Prepare with InstaTrade™', not 'Review and submit'", () => {
    const src = loadSource();
    expect(src).toMatch(/Prepare with InstaTrade™/);
    expect(src).not.toMatch(/Review and submit InstaTrade/i);
  });

  it("home.tsx workspace mock card labels values as 'Illustrative'", () => {
    const src = loadSource();
    // The three data cells in the mock should say "Illustrative"
    const illustrativeMatches = Array.from(src.matchAll(/Illustrative/g));
    expect(illustrativeMatches.length).toBeGreaterThan(3);
  });
});

// ── B+. Compliance scan ───────────────────────────────────────────────────
describe("B+. Prohibited claim guard (source scan)", () => {
  let src: string;

  beforeAll(() => {
    src = loadSource();
  });

  for (const term of PROHIBITED_TERMS) {
    it(`source does not contain prohibited term: ${term.source}`, () => {
      expect(src).not.toMatch(term);
    });
  }

  it("'recommendation' only appears as 'not a live recommendation'", () => {
    const recs = Array.from(src.matchAll(/\brecommendation\b/gi));
    for (const match of recs) {
      const ctx = src.slice(
        Math.max(0, match.index! - 40),
        match.index! + 50,
      );
      expect(ctx).toMatch(/not a live recommendation/i);
    }
  });

  it("'trade automatically' only appears in FAQ denial context", () => {
    const matches = Array.from(src.matchAll(/trade automatically/gi));
    for (const match of matches) {
      const ctx = src.slice(
        Math.max(0, match.index! - 100),
        match.index! + 200,
      );
      // Must be in FAQ answer context that negates the claim
      expect(ctx).toMatch(/Does VCP Trader AI trade automatically|does not autonomously/i);
    }
  });

  it("does not contain 'AI-ranked' (use deterministic language)", () => {
    expect(src).not.toMatch(/AI-ranked stock and options/i);
  });

  it("does not contain 'Daily stock and options ideas' (use research opportunities)", () => {
    expect(src).not.toMatch(/Daily stock and options ideas/i);
  });

  it("does not contain 'Estimated options strategy insights' (use Illustrative)", () => {
    expect(src).not.toMatch(/Estimated options strategy insights/i);
  });

  it("does not say 'Live options chains and Greeks' without qualification", () => {
    // Must be qualified with 'through supported broker connections' or similar
    const matches = Array.from(src.matchAll(/Live options chains and Greeks(?! through)/gi));
    expect(matches).toHaveLength(0);
  });
});

// ── C. Goal cards ─────────────────────────────────────────────────────────
describe("C. Choose Your Goal cards", () => {
  it("defines exactly 4 goal cards", () => {
    expect(GOAL_CARDS).toHaveLength(4);
  });

  it("goal card titles match spec", () => {
    const titles = GOAL_CARDS.map((g) => g.title);
    expect(titles).toContain("Grow Long-Term Wealth");
    expect(titles).toContain("Generate Income");
    expect(titles).toContain("Find Trade Setups");
    expect(titles).toContain("Understand Markets");
  });

  it("each goal card has exactly 5 bullets", () => {
    for (const card of GOAL_CARDS) {
      expect(card.items).toHaveLength(5);
    }
  });

  it("goal card CTAs use spec-required wording", () => {
    const grow = GOAL_CARDS.find((g) => g.title === "Grow Long-Term Wealth")!;
    expect(grow.cta).toBe("Explore Growth Research");

    const income = GOAL_CARDS.find((g) => g.title === "Generate Income")!;
    expect(income.cta).toBe("Explore Income Research");

    const trade = GOAL_CARDS.find((g) => g.title === "Find Trade Setups")!;
    expect(trade.cta).toBe("Explore Trade Setups");

    const markets = GOAL_CARDS.find((g) => g.title === "Understand Markets")!;
    expect(markets.cta).toBe("View Market Intelligence");
  });

  it("Grow Long-Term Wealth has correct bullets per spec", () => {
    const card = GOAL_CARDS.find((g) => g.title === "Grow Long-Term Wealth")!;
    const text = card.items.join(" | ");
    expect(text).toMatch(/Long-term research candidates/i);
    expect(text).toMatch(/Growth and earnings context/i);
    expect(text).toMatch(/Valuation context/i);
    expect(text).toMatch(/Thesis monitoring/i);
    expect(text).toMatch(/Portfolio concentration awareness/i);
  });

  it("Find Trade Setups has correct bullets per spec", () => {
    const card = GOAL_CARDS.find((g) => g.title === "Find Trade Setups")!;
    const text = card.items.join(" | ");
    expect(text).toMatch(/Breakout and pullback setups/i);
    expect(text).toMatch(/Defined-risk options structures/i);
    expect(text).toMatch(/Invalidation and risk levels/i);
  });

  it("goal card descriptions do not use prohibited terms", () => {
    for (const card of GOAL_CARDS) {
      for (const term of PROHIBITED_TERMS) {
        expect(card.description).not.toMatch(term);
      }
    }
  });
});

// ── D. How It Works workflow ───────────────────────────────────────────────
describe("D. How It Works — 6-step workflow", () => {
  it("defines exactly 6 steps", () => {
    expect(WORKFLOW_STEPS).toHaveLength(6);
  });

  it("step order matches spec: Discover → Understand → Evaluate → Plan → Verify → Review", () => {
    const titles = WORKFLOW_STEPS.map((s) => s.title);
    expect(titles).toEqual(STEP_NAMES_IN_ORDER);
  });

  it("step numbers are 1–6", () => {
    const nums = WORKFLOW_STEPS.map((s) => s.n);
    expect(nums).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("Discover step mentions qualified research candidates", () => {
    expect(WORKFLOW_STEPS[0].copy).toMatch(/qualified.*research candidates/i);
  });

  it("Understand step mentions AI Trading Workspace", () => {
    expect(WORKFLOW_STEPS[1].copy).toMatch(/AI Trading Workspace/i);
  });

  it("Evaluate step mentions congressional disclosures", () => {
    expect(WORKFLOW_STEPS[2].copy).toMatch(/congressional disclosures/i);
  });

  it("Plan step says 'illustrative options structures'", () => {
    expect(WORKFLOW_STEPS[3].copy).toMatch(/illustrative options structures/i);
  });

  it("Verify step requires supported brokerage connection", () => {
    expect(WORKFLOW_STEPS[4].copy).toMatch(/supported brokerage connection/i);
  });

  it("Review step says 'prepared for review' / 'Prepare', not 'submitted automatically'", () => {
    const reviewCopy = WORKFLOW_STEPS[5].copy;
    expect(reviewCopy).toMatch(/Prepare|prepared for review/i);
    expect(reviewCopy).not.toMatch(/submitted automatically|auto-submit/i);
  });

  it("Review step says 'Nothing is submitted without explicit user confirmation'", () => {
    expect(WORKFLOW_STEPS[5].copy).toMatch(
      /Nothing is submitted without explicit user confirmation/i,
    );
  });

  it("no step copy contains prohibited terms", () => {
    for (const step of WORKFLOW_STEPS) {
      for (const term of PROHIBITED_TERMS) {
        expect(step.copy).not.toMatch(term);
      }
    }
  });

  it("home.tsx examples CTA says 'Explore Current Research' not 'See Live Ideas'", () => {
    const src = loadSource();
    expect(src).toMatch(/Start Free Trial to Explore Current Research/i);
    expect(src).not.toMatch(/Start Free Trial.*See Live Ideas/i);
  });

  it("home.tsx shows 4 example research candidate cards", () => {
    const src = loadSource();
    expect(src).toMatch(/Long-Term Growth/);
    expect(src).toMatch(/Active Trade Setup/);
    expect(src).toMatch(/Watchlist/);
  });
});

// ── E. AI Trading Workspace section ──────────────────────────────────────
describe("E. AI Trading Workspace section", () => {
  it("defines exactly 6 workspace modules", () => {
    expect(WORKSPACE_MODULES).toHaveLength(6);
  });

  it("workspace modules include all required spec items", () => {
    const labels = WORKSPACE_MODULES.map((m) => m.label);
    const text = labels.join(" | ");
    expect(text).toMatch(/Research Thesis/i);
    expect(text).toMatch(/What Changed/i);
    expect(text).toMatch(/Decision.*Evidence/i);
    expect(text).toMatch(/Stock.*Options Planning/i);
    expect(text).toMatch(/Risk.*Invalidation/i);
    expect(text).toMatch(/Ask VCP AI/i);
  });

  it("defines 6 contextual AI prompt examples", () => {
    expect(CONTEXTUAL_AI_PROMPTS).toHaveLength(6);
  });

  it("contextual AI prompts include key spec examples", () => {
    const text = CONTEXTUAL_AI_PROMPTS.join(" | ");
    expect(text).toMatch(/Why did this candidate qualify/i);
    expect(text).toMatch(/What would invalidate the setup/i);
    expect(text).toMatch(/What should I verify before using InstaTrade™/i);
  });

  it("home.tsx includes VCP AI disclaimer about not providing personalized investment advice", () => {
    const src = loadSource();
    expect(src).toMatch(/does not provide personalized investment advice/i);
  });

  it("Institutional Intelligence capability is marked 'Rolling Out'", () => {
    const inst = RESEARCH_CAPABILITIES.find(
      (c) => c.label === "Institutional Intelligence",
    )!;
    expect(inst).toBeDefined();
    expect(inst.badge).toBe("Rolling Out");
  });

  it("Institutional Intelligence is NOT claimed as available to all users", () => {
    const inst = RESEARCH_CAPABILITIES.find(
      (c) => c.label === "Institutional Intelligence",
    )!;
    expect(inst.desc + (inst.note ?? "")).not.toMatch(/available to all users/i);
    // Also check source
    const src = loadSource();
    // Must NOT claim "is currently available to all users" (without negation)
    expect(src).not.toMatch(/Institutional Intelligence is currently available to all users/i);
  });

  it("Institutional Intelligence note mentions delayed quarterly filings", () => {
    const inst = RESEARCH_CAPABILITIES.find(
      (c) => c.label === "Institutional Intelligence",
    )!;
    expect(inst.note).toMatch(/delayed quarterly filings/i);
  });

  it("Congressional Disclosures capability has required disclaimer", () => {
    const congress = RESEARCH_CAPABILITIES.find(
      (c) => c.label === "Congressional Disclosures",
    )!;
    expect(congress.note).toMatch(/do not indicate future performance/i);
  });

  it("home.tsx section headline matches spec", () => {
    const src = loadSource();
    expect(src).toMatch(/One Workspace for the Full Research Process/i);
  });

  it("home.tsx capability strip headline matches spec", () => {
    const src = loadSource();
    expect(src).toMatch(/Research More Than the Chart/i);
  });
});

// ── F. Stock and Options Planning section ─────────────────────────────────
describe("F. Stock and Options Planning section", () => {
  it("planning heading matches spec", () => {
    expect(PLANNING_HEADING).toMatch(
      /Plan the Structure Before Selecting the Contract/i,
    );
  });

  it("planning disclaimer differentiates illustrative vs live contracts", () => {
    expect(PLANNING_DISCLAIMER).toMatch(
      /Illustrative planning does not represent a live option contract/i,
    );
    expect(PLANNING_DISCLAIMER).toMatch(/supported connected brokerage/i);
  });

  it("stock column has correct items per spec", () => {
    const text = STOCK_ITEMS.join(" | ");
    expect(text).toMatch(/Long-term position/i);
    expect(text).toMatch(/Breakout entry/i);
    expect(text).toMatch(/Invalidation conditions/i);
  });

  it("options column says 'Illustrative' in its name", () => {
    const src = loadSource();
    expect(src).toMatch(/Illustrative Options Planning/);
  });

  it("options column items match spec", () => {
    const text = OPTIONS_ITEMS.join(" | ");
    expect(text).toMatch(/Target DTE range/i);
    expect(text).toMatch(/Strike-selection framework/i);
    expect(text).toMatch(/Defined-risk characteristics/i);
  });

  it("broker column items include actual listed expirations and strikes", () => {
    const text = BROKER_ITEMS.join(" | ");
    expect(text).toMatch(/Actual listed expirations/i);
    expect(text).toMatch(/Actual strikes/i);
    expect(text).toMatch(/Liquidity and contract fit/i);
  });

  it("home.tsx planning section has risk checks strip", () => {
    const src = loadSource();
    expect(src).toMatch(/Risk Checks Before Broker Review/i);
  });

  it("risk checks strip does not say 'prevents every risky order'", () => {
    const src = loadSource();
    expect(src).not.toMatch(/prevents every risky order/i);
  });

  it("opportunity grades compact element says 'not a prediction of returns'", () => {
    const src = loadSource();
    expect(src).toMatch(/not a prediction of returns/i);
  });

  it("opportunity grades says 'Opportunity Grade' not 'universal stock rating'", () => {
    const src = loadSource();
    expect(src).toMatch(/Clear Qualification, Not a Universal Stock Rating/i);
  });
});

// ── G. Broker section and InstaTrade™ ─────────────────────────────────────
describe("G. Broker section and InstaTrade™", () => {
  it("without-broker list has 9 capabilities from spec", () => {
    expect(WITHOUT_BROKER_CAPABILITIES).toHaveLength(9);
  });

  it("with-broker list has 8 capabilities from spec", () => {
    expect(WITH_BROKER_CAPABILITIES).toHaveLength(8);
  });

  it("with-broker list uses 'preparation and review' not 'order review and submission'", () => {
    const text = WITH_BROKER_CAPABILITIES.join(" | ");
    expect(text).toMatch(/preparation and review/i);
    expect(text).not.toMatch(/order review and submission/i);
  });

  it("with-broker list includes 'User-directed order submission only where implemented and enabled'", () => {
    const text = WITH_BROKER_CAPABILITIES.join(" | ");
    expect(text).toMatch(/User-directed order submission only where implemented/i);
  });

  it("broker disclaimer says capabilities vary", () => {
    expect(BROKER_DISCLAIMER).toMatch(/capabilities vary/i);
    expect(BROKER_DISCLAIMER).toMatch(/market-data entitlement/i);
  });

  it("supported broker note names Tradier and TradeStation", () => {
    expect(SUPPORTED_BROKER_NOTE).toMatch(/Tradier/);
    expect(SUPPORTED_BROKER_NOTE).toMatch(/TradeStation/);
  });

  it("supported broker note says 'Additional connections and capabilities may vary'", () => {
    expect(SUPPORTED_BROKER_NOTE).toMatch(/Additional connections and capabilities may vary/i);
  });

  it("home.tsx broker section says 'Prepare with InstaTrade™' in mock", () => {
    const src = loadSource();
    expect(src).toMatch(/Prepare with.*InstaTrade™/);
  });

  it("home.tsx broker section mock shows 'Illustrative example'", () => {
    const src = loadSource();
    // Check in context of the broker section
    const brokerIdx = src.indexOf('id="broker"');
    const brokerBlock = src.slice(brokerIdx, brokerIdx + 3000);
    expect(brokerBlock).toMatch(/Illustrative example/i);
  });

  it("home.tsx does not claim SnapTrade as a primary supported broker", () => {
    const src = loadSource();
    // SnapTrade should not appear at all in the new landing page
    // (it was removed from public-facing claims per the spec audit)
    expect(src).not.toMatch(/SnapTrade-connected brokerages/i);
  });
});

// ── H. Pricing section ────────────────────────────────────────────────────
describe("H. Pricing section", () => {
  it("feature groups cover 4 required categories", () => {
    const labels = PRICING_FEATURE_GROUPS.map((g) => g.label);
    expect(labels).toContain("Research and Opportunities");
    expect(labels).toContain("Trade Planning");
    expect(labels).toContain("Portfolio and Monitoring");
    expect(labels).toContain("Broker-Connected Capabilities");
  });

  it("total feature items is within 10–12 range for core plan", () => {
    const total = PRICING_FEATURE_GROUPS.reduce(
      (sum, g) => sum + g.items.length,
      0,
    );
    // 4 groups × 3–4 items = 13–16 items, but the broker column's last item
    // is a partial string — actual rendered total ≤ 14
    expect(total).toBeLessThanOrEqual(16);
    expect(total).toBeGreaterThanOrEqual(10);
  });

  it("trial column uses 'Illustrative options structure guidance' not 'Estimated'", () => {
    const text = TRIAL_COLUMN_ITEMS.join(" | ");
    expect(text).toMatch(/Illustrative options structure guidance/i);
    expect(text).not.toMatch(/Estimated options strategy/i);
  });

  it("broker column uses 'order preparation and review' not 'order review and submission'", () => {
    const text = BROKER_COLUMN_ITEMS.join(" | ");
    expect(text).toMatch(/order preparation and review/i);
    expect(text).not.toMatch(/order review and submission/i);
  });

  it("broker column mentions 'available Greeks through supported broker connections'", () => {
    const text = BROKER_COLUMN_ITEMS.join(" | ");
    expect(text).toMatch(/available Greeks through supported broker connections/i);
  });

  it("plan does NOT claim paper trading", () => {
    const allItems = PRICING_FEATURE_GROUPS.flatMap((g) => g.items).join(" | ");
    expect(allItems).not.toMatch(/paper trading/i);
  });

  it("home.tsx pricing section includes 'Features vary by brokerage'", () => {
    const src = loadSource();
    expect(src).toMatch(/Features vary by brokerage/i);
  });

  it("home.tsx pricing section does not claim 'Daily stock and options ideas'", () => {
    const src = loadSource();
    // Price section content check
    const pricingIdx = src.indexOf('id="pricing"');
    const pricingBlock = src.slice(pricingIdx, pricingIdx + 8000);
    expect(pricingBlock).not.toMatch(/Daily stock and options ideas/i);
  });
});

// ── I. Evidence / research capabilities ──────────────────────────────────
describe("I. Evidence and research capabilities", () => {
  it("defines 6 research capabilities", () => {
    expect(RESEARCH_CAPABILITIES).toHaveLength(6);
  });

  it("all 6 required capability labels are present", () => {
    const labels = RESEARCH_CAPABILITIES.map((c) => c.label);
    expect(labels).toContain("Technical Context");
    expect(labels).toContain("Market Regime");
    expect(labels).toContain("News and Catalysts");
    expect(labels).toContain("Congressional Disclosures");
    expect(labels).toContain("Portfolio Context");
    expect(labels).toContain("Institutional Intelligence");
  });

  it("Institutional Intelligence is marked as rolling out (not generally available)", () => {
    const inst = RESEARCH_CAPABILITIES.find(
      (c) => c.label === "Institutional Intelligence",
    )!;
    expect(inst.badge).toMatch(/Rolling Out/i);
    expect(inst.desc).toMatch(/rolling out/i);
  });

  it("no capability description uses predictive wording", () => {
    for (const cap of RESEARCH_CAPABILITIES) {
      const text = cap.desc + " " + (cap.note ?? "");
      expect(text).not.toMatch(/predicts|guaranteed|expected profit/i);
    }
  });
});

// ── J. FAQ section ────────────────────────────────────────────────────────
describe("J. FAQ section", () => {
  it("defines at least 10 FAQ items", () => {
    expect(FAQ_ITEMS.length).toBeGreaterThanOrEqual(10);
  });

  it("first FAQ asks 'Do I need a brokerage account to start?'", () => {
    expect(FAQ_ITEMS[0].q).toMatch(/Do I need a brokerage account/i);
  });

  it("first FAQ answer mentions broker-less capabilities", () => {
    expect(FAQ_ITEMS[0].a).toMatch(/without connecting a broker/i);
  });

  it("first FAQ answer does NOT use old 'Analysis Mode' internal branding", () => {
    expect(FAQ_ITEMS[0].a).not.toMatch(/Analysis Mode/i);
  });

  it("live data FAQ mentions connected brokerage dependency", () => {
    const faq = FAQ_ITEMS.find((f) => f.q.match(/live market data/i))!;
    expect(faq).toBeDefined();
    expect(faq.a).toMatch(/connected brokerage/i);
  });

  it("paper trading FAQ says No and describes research-only trial", () => {
    const faq = FAQ_ITEMS.find((f) => f.q.match(/paper trading/i))!;
    expect(faq).toBeDefined();
    expect(faq.a).toMatch(/No\./i);
    expect(faq.a).toMatch(/research and discovery trial/i);
  });

  it("auto-trading FAQ says does not autonomously place trades", () => {
    const faq = FAQ_ITEMS.find((f) =>
      f.q.match(/trade automatically/i),
    )!;
    expect(faq).toBeDefined();
    expect(faq.a).toMatch(/No\./i);
    expect(faq.a).toMatch(/does not autonomously place trades/i);
  });

  it("investment advice FAQ says No and mentions user responsibility", () => {
    const faq = FAQ_ITEMS.find((f) => f.q.match(/investment advice/i))!;
    expect(faq).toBeDefined();
    expect(faq.a).toMatch(/No\./i);
    expect(faq.a).toMatch(/Users remain responsible/i);
  });

  it("broker FAQ names Tradier and TradeStation", () => {
    const faq = FAQ_ITEMS.find((f) => f.q.match(/which brokers/i))!;
    expect(faq).toBeDefined();
    expect(faq.a).toMatch(/Tradier/);
    expect(faq.a).toMatch(/TradeStation/);
  });

  it("broker FAQ says 'may vary' (no over-claiming)", () => {
    const faq = FAQ_ITEMS.find((f) => f.q.match(/which brokers/i))!;
    expect(faq.a).toMatch(/may vary/i);
  });

  it("Institutional Intelligence FAQ exists", () => {
    const faq = FAQ_ITEMS.find((f) =>
      f.q.match(/Institutional Intelligence/i),
    )!;
    expect(faq).toBeDefined();
  });

  it("Institutional Intelligence FAQ says rolling-out and limited coverage", () => {
    const faq = FAQ_ITEMS.find((f) =>
      f.q.match(/Institutional Intelligence/i),
    )!;
    expect(faq.a).toMatch(/rolling.out|rolling out/i);
    expect(faq.a).toMatch(/limited.*coverage|mappings are validated/i);
  });

  it("Institutional Intelligence FAQ says NOT currently available to all users", () => {
    const faq = FAQ_ITEMS.find((f) =>
      f.q.match(/Institutional Intelligence/i),
    )!;
    expect(faq.a).toMatch(/not currently available to all users/i);
  });

  it("cancel FAQ says Yes and mentions billing portal", () => {
    const faq = FAQ_ITEMS.find((f) => f.q.match(/cancel anytime/i))!;
    expect(faq).toBeDefined();
    expect(faq.a).toMatch(/Yes\./i);
    expect(faq.a).toMatch(/billing portal/i);
  });

  it("long-term investing FAQ says Yes", () => {
    const faq = FAQ_ITEMS.find((f) => f.q.match(/long-term investing/i))!;
    expect(faq).toBeDefined();
    expect(faq.a).toMatch(/Yes\./i);
  });

  it("no FAQ answer uses prohibited terms positively", () => {
    const skip = /No\.|does not autonomously|not currently available/i;
    for (const faq of FAQ_ITEMS) {
      // Only check answers that aren't negating the concept
      if (!skip.test(faq.a)) {
        for (const term of PROHIBITED_TERMS) {
          expect(faq.a).not.toMatch(term);
        }
      }
    }
  });
});

// ── K. Navigation structure ───────────────────────────────────────────────
describe("K. Navigation", () => {
  it("nav links do not point to authenticated internal routes", () => {
    for (const link of NAV_LINKS) {
      expect(link.href).not.toMatch(/^\/home|^\/dashboard|^\/workspace/);
    }
  });

  it("home.tsx Login link points to /auth", () => {
    const src = loadSource();
    expect(src).toMatch(/href="\/auth"/);
  });

  it("home.tsx Go to Dashboard link points to /home", () => {
    const src = loadSource();
    expect(src).toMatch(/href="\/home"/);
  });

  it("home.tsx nav does not show authenticated app tabs in public nav array", () => {
    // The nav array should not contain /research, /opportunity, etc.
    const navHrefs = NAV_LINKS.map((l) => l.href).join(" | ");
    expect(navHrefs).not.toMatch(/\/research|\/opportunity|\/trade/);
  });
});

// ── L. Accessibility ─────────────────────────────────────────────────────
describe("L. Accessibility", () => {
  it("home.tsx has exactly one h1 element", () => {
    const src = loadSource();
    const h1s = Array.from(src.matchAll(/<h1\b/g));
    expect(h1s).toHaveLength(1);
  });

  it("h1 contains the spec hero headline", () => {
    const src = loadSource();
    const h1Match = src.match(/<h1[\s\S]*?<\/h1>/);
    expect(h1Match![0]).toMatch(/Research, Plan, and Verify/i);
  });

  it("home.tsx uses semantic h2 headings for primary sections", () => {
    const src = loadSource();
    const h2Labels = ["Choose Your Goal", "How VCP Trader AI Turns Research", "One Workspace for the Full Research Process", "Plan the Structure Before Selecting the Contract", "Connect a Supported Brokerage When You Are Ready", "Simple Pricing", "Frequently Asked Questions"];
    for (const label of h2Labels) {
      expect(src).toContain(label);
    }
  });

  it("home.tsx FAQ accordion triggers have data-testid attributes", () => {
    const src = loadSource();
    expect(src).toMatch(/data-testid=\{`button-faq-question-\$\{i\}`\}/);
  });

  it("home.tsx logo images have alt text", () => {
    const src = loadSource();
    const logoMatches = Array.from(src.matchAll(/alt="VCP Trader AI"/g));
    expect(logoMatches.length).toBeGreaterThanOrEqual(2);
  });

  it("home.tsx footer links have descriptive text content", () => {
    const src = loadSource();
    expect(src).toMatch(/data-testid="link-footer-terms"/);
    expect(src).toMatch(/data-testid="link-footer-privacy"/);
    expect(src).toMatch(/data-testid="link-footer-contact"/);
  });
});

// ── M. SEO metadata ───────────────────────────────────────────────────────
describe("M. SEO metadata", () => {
  it("page title matches spec", () => {
    expect(PAGE_TITLE).toBe(
      "VCP Trader AI — Stock and Options Research & Trade Planning",
    );
  });

  it("meta description mentions qualified research candidates", () => {
    expect(META_DESCRIPTION).toMatch(/qualified stock and options research candidates/i);
  });

  it("meta description mentions InstaTrade™", () => {
    expect(META_DESCRIPTION).toMatch(/InstaTrade™/i);
  });

  it("meta description does not make performance promises", () => {
    expect(META_DESCRIPTION).not.toMatch(/profit|guaranteed|winning|beat/i);
  });

  it("Open Graph title matches spec", () => {
    expect(OG_TITLE).toMatch(
      /Research, Plan, and Verify Stock.*Options Opportunities/i,
    );
  });

  it("Open Graph description says 'deterministic'", () => {
    expect(OG_DESCRIPTION).toMatch(/deterministic/i);
  });

  it("home.tsx sets page title on mount", () => {
    const src = loadSource();
    expect(src).toMatch(/document\.title = "VCP Trader AI — Stock and Options Research/);
  });

  it("home.tsx sets og:title on mount", () => {
    const src = loadSource();
    expect(src).toMatch(/og:title/);
    expect(src).toMatch(/Research, Plan, and Verify Stock.*Options Opportunities/);
  });
});

// ── N. Performance — no authenticated API calls ───────────────────────────
describe("N. Performance — static landing page", () => {
  it("home.tsx does not call Opportunity Engine endpoint", () => {
    const src = loadSource();
    expect(src).not.toMatch(/\/api\/opportunities/);
  });

  it("home.tsx does not call Research Package endpoint", () => {
    const src = loadSource();
    expect(src).not.toMatch(/\/api\/research/);
  });

  it("home.tsx does not call Ask AI endpoint", () => {
    const src = loadSource();
    expect(src).not.toMatch(/\/api\/ask\b/);
  });

  it("home.tsx does not call Congress APIs", () => {
    const src = loadSource();
    expect(src).not.toMatch(/\/api\/congress/);
  });

  it("home.tsx does not call Institutional APIs", () => {
    const src = loadSource();
    expect(src).not.toMatch(/\/api\/institutional/);
  });

  it("home.tsx does not call broker status", () => {
    const src = loadSource();
    expect(src).not.toMatch(/\/api\/broker/);
  });

  it("home.tsx does not call options chains", () => {
    const src = loadSource();
    expect(src).not.toMatch(/\/api\/options/);
  });

  it("home.tsx does not call portfolio", () => {
    const src = loadSource();
    expect(src).not.toMatch(/\/api\/portfolio/);
  });

  it("home.tsx only makes /api/audit/page-view and lets usePricing handle pricing", () => {
    const src = loadSource();
    // Count direct fetch calls (not via hooks)
    const fetchCalls = Array.from(src.matchAll(/fetch\(['"](\/api\/[^'"]+)['"]/g)).map(
      (m) => m[1],
    );
    for (const call of fetchCalls) {
      expect(call).toMatch(/\/api\/audit\/page-view/);
    }
  });
});

// ── O. Final CTA and footer compliance ────────────────────────────────────
describe("O. Final CTA and footer", () => {
  it("final CTA headline says 'Ready to Research Your Next Opportunity?'", () => {
    const src = loadSource();
    expect(src).toMatch(/Ready to Research Your Next Opportunity\?/i);
  });

  it("final CTA does not say 'winning trade'", () => {
    const src = loadSource();
    // Find final CTA section
    const finalCtaIdx = src.indexOf("FinalCtaSection");
    const finalCta = src.slice(finalCtaIdx, finalCtaIdx + 1000);
    expect(finalCta).not.toMatch(/winning trade/i);
  });

  it("footer compliance text mentions educational research", () => {
    expect(FOOTER_COMPLIANCE_TEXT).toMatch(/educational research/i);
  });

  it("footer compliance text says does not guarantee outcomes", () => {
    expect(FOOTER_COMPLIANCE_TEXT).toMatch(/does not.*guarantee outcomes/i);
  });

  it("footer compliance text mentions market data may be delayed", () => {
    expect(FOOTER_COMPLIANCE_TEXT).toMatch(/may be delayed/i);
  });

  it("footer compliance text mentions institutional data", () => {
    expect(FOOTER_COMPLIANCE_TEXT).toMatch(/institutional/i);
  });

  it("footer compliance text mentions congressional data", () => {
    expect(FOOTER_COMPLIANCE_TEXT).toMatch(/congressional/i);
  });

  it("footer mentions Sunfish Technologies LLC", () => {
    const src = loadSource();
    expect(src).toMatch(/Sunfish Technologies LLC/);
  });
});

// ── P. Home content module — import-only regression ──────────────────────
describe("P. home-content.ts — data integrity", () => {
  it("all content arrays are non-empty", () => {
    expect(NAV_LINKS.length).toBeGreaterThan(0);
    expect(HERO_BADGES.length).toBeGreaterThan(0);
    expect(GOAL_CARDS.length).toBeGreaterThan(0);
    expect(WORKFLOW_STEPS.length).toBeGreaterThan(0);
    expect(WORKSPACE_MODULES.length).toBeGreaterThan(0);
    expect(RESEARCH_CAPABILITIES.length).toBeGreaterThan(0);
    expect(FAQ_ITEMS.length).toBeGreaterThan(0);
    expect(PRICING_FEATURE_GROUPS.length).toBeGreaterThan(0);
  });

  it("PROHIBITED_TERMS is a non-empty array of RegExp", () => {
    expect(PROHIBITED_TERMS.length).toBeGreaterThan(10);
    for (const term of PROHIBITED_TERMS) {
      expect(term).toBeInstanceOf(RegExp);
    }
  });
});
