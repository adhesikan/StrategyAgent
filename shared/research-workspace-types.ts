/**
 * Research Workspace Types — Sprint 2.6.4
 *
 * Shared between server and client.
 * COMPLIANCE: "recommendation", "buy", "sell", "target price" are never used.
 */

import type { CanonicalOpportunity } from "./opportunity-intelligence-types";

// ---------------------------------------------------------------------------
// Core enums
// ---------------------------------------------------------------------------

export type ResearchMode =
  | "opportunity"
  | "company"
  | "theme"
  | "sector"
  | "institutional"
  | "market"
  | "collection"
  | "comparison";

export const RESEARCH_MODE_LABELS: Record<ResearchMode, string> = {
  opportunity:   "Opportunity Research",
  company:       "Company Research",
  theme:         "Theme Research",
  sector:        "Sector Research",
  institutional: "Institutional Research",
  market:        "Market Research",
  collection:    "Collection Research",
  comparison:    "Comparison Research",
};

export const RESEARCH_MODE_DESCRIPTIONS: Record<ResearchMode, string> = {
  opportunity:   "Explore ranked research candidates and their evidence",
  company:       "Deep-dive into a specific company's research profile",
  theme:         "Investigate thematic trends across the market",
  sector:        "Analyze sector-level intelligence and dynamics",
  institutional: "Examine 13F institutional positioning signals",
  market:        "Review overall market health and regime signals",
  collection:    "Research candidates within a specific collection",
  comparison:    "Compare multiple candidates side by side",
};

export type ContextScope =
  | "entire_market"
  | "my_collections"
  | "ai-infrastructure"
  | "semiconductors"
  | "memory"
  | "networking"
  | "cybersecurity"
  | "cloud"
  | "energy"
  | "healthcare"
  | "financials"
  | "consumer"
  | "industrials"
  | "dividend"
  | "income"
  | "growth"
  | "momentum"
  | "value"
  | "etf"
  | "long-term-investments"
  | "swing-trading"
  | "covered-calls"
  | "cash-secured-puts"
  | "market-leaders"
  | "recently-improved"
  | "institutional-activity"
  | "new-opportunities"
  | "future_portfolio";

export const CONTEXT_SCOPE_LABELS: Record<ContextScope, string> = {
  entire_market:          "Entire Market",
  my_collections:         "My Collections",
  "ai-infrastructure":    "AI Infrastructure",
  semiconductors:         "Semiconductors",
  memory:                 "Memory",
  networking:             "Networking",
  cybersecurity:          "Cybersecurity",
  cloud:                  "Cloud",
  energy:                 "Energy",
  healthcare:             "Healthcare",
  financials:             "Financials",
  consumer:               "Consumer",
  industrials:            "Industrials",
  dividend:               "Dividend Income",
  income:                 "Income Strategies",
  growth:                 "Growth",
  momentum:               "Momentum",
  value:                  "Value",
  etf:                    "ETF & Funds",
  "long-term-investments":"Long-Term Investments",
  "swing-trading":        "Swing Trading",
  "covered-calls":        "Covered Calls",
  "cash-secured-puts":    "Cash Secured Puts",
  "market-leaders":       "Market Leaders",
  "recently-improved":    "Recently Improved",
  "institutional-activity":"Institutional Activity",
  "new-opportunities":    "New Opportunities",
  future_portfolio:       "Future Portfolio (Coming Soon)",
};

export const SYSTEM_SCOPE_KEYS: ContextScope[] = [
  "ai-infrastructure", "semiconductors", "memory", "networking", "cybersecurity", "cloud",
  "energy", "healthcare", "financials", "consumer", "industrials",
  "dividend", "income", "growth", "momentum", "value", "etf",
  "long-term-investments", "swing-trading", "covered-calls", "cash-secured-puts",
  "market-leaders", "recently-improved", "institutional-activity", "new-opportunities",
];

// ---------------------------------------------------------------------------
// Sprint 2.6.4 — Research Context (canonical entry model)
// ---------------------------------------------------------------------------

/** All supported context entry types */
export type ResearchContextType =
  | "market"
  | "opportunity"
  | "company"
  | "theme"
  | "sector"
  | "institutional"
  | "collection"
  | "comparison"
  | "monitor"
  | "report"
  | "portfolio"
  | "portfolio_holding"
  | "goal"
  | "custom";

/** Workspace action param — maps to prefilled questions */
export type WorkspaceAction =
  | "explain_concept"
  | "challenge"
  | "explain_change"
  | "risk"
  | "institutional"
  | "compare";

/**
 * Canonical research context — assembled server-side or derived from URL params.
 * Client uses this to display the context banner, pre-fill tickers/mode,
 * and persist context metadata in workspace_conversations.
 */
export interface ResearchContext {
  contextType:        ResearchContextType;
  /** Opaque entity ID (collectionId, themeId, portfolioId, etc.) */
  contextId?:         string;
  /** Human-readable label: "Researching: NVDA" or "AI Infrastructure Theme" */
  label:              string;
  /** Primary ticker(s) pre-filled into the ticker pin list */
  symbols:            string[];
  /** Suggested workspace mode */
  defaultMode:        ResearchMode;
  /** Suggested context scope */
  defaultScope:       ContextScope;
  // Entity-specific fields
  collectionId?:      string;
  collectionName?:    string;
  themeId?:           string;
  themeName?:         string;
  sector?:            string;
  reportId?:          string;
  reportTitle?:       string;
  portfolioId?:       string;
  portfolioName?:     string;
  watchId?:           string;
  watchLabel?:        string;
  comparisonSymbols?: string[];
  /** Page that originated this workspace session (for "Back to …" links) */
  sourceRoute?:       string;
}

/** Pre-filled question mapping for workspace action params */
export const ACTION_QUESTIONS: Record<WorkspaceAction, (symbol: string) => string> = {
  explain_concept:  (s) => `Explain why ${s} qualified as a research candidate. Walk through the technical evidence, fundamental health indicators, institutional signals, and key risk factors in detail.`,
  challenge:        (s) => `Challenge the investment thesis for ${s}. Steel-man the bear case — what evidence argues against it being a qualified opportunity? What conditions would invalidate the thesis?`,
  explain_change:   (s) => `Explain what changed for ${s} in the most recent ranking cycle. What evidence improved or deteriorated? Why did its research score move?`,
  risk:             (s) => `Explain the risk factors for ${s}. What are the primary thesis invalidators, and what conditions would cause this candidate to exit the qualified list?`,
  institutional:    (s) => `Explain the institutional positioning signals for ${s}. What does the 13F data show about accumulation patterns, concentration changes, and conviction level?`,
  compare:          (s) => `Compare ${s} with similar research candidates. Look for matching themes, technical patterns, and institutional signals. What differentiates ${s} from its closest peers?`,
};

/** Map workspace action → ResearchMode */
export const ACTION_MODE_MAP: Record<WorkspaceAction, ResearchMode> = {
  explain_concept: "company",
  challenge:       "company",
  explain_change:  "opportunity",
  risk:            "company",
  institutional:   "institutional",
  compare:         "comparison",
};

// ---------------------------------------------------------------------------
// Evidence panel
// ---------------------------------------------------------------------------

export interface EvidenceItem {
  label: string;
  value: string;
  strength: "strong" | "moderate" | "weak";
  source: string;
}

export interface EvidencePanel {
  summary:              string;
  supportingEvidence:   EvidenceItem[];
  technicalEvidence:    EvidenceItem[];
  fundamentalEvidence:  EvidenceItem[];
  institutionalEvidence: EvidenceItem[];
  riskFactors:          string[];
  thesisInvalidators:   string[];
  researchSourcesUsed:  string[];
}

// ---------------------------------------------------------------------------
// Structured AI response
// ---------------------------------------------------------------------------

export interface FollowUpAction {
  label:        string;
  description:  string;
  /** Routing hint: where should the client navigate? */
  action:
    | { type: "ask"; question: string; mode?: ResearchMode; scope?: ContextScope }
    | { type: "navigate"; path: string }
    | { type: "set_scope"; scope: ContextScope }
    | { type: "relax_filter"; filterName: string; suggestedScope?: ContextScope };
}

export interface ResearchDiagnostics {
  universeSearched:       string;
  collectionsSearched:    string[];
  filtersApplied:         string[];
  candidatesEvaluated:    number;
  candidatesQualified:    number;
  rejectionReasons:       string[];
  evidenceStrength:       "strong" | "moderate" | "weak" | "insufficient";
  dataFreshness:          string;
}

export interface WorkspaceAIResponse {
  /** Short headline answer */
  headline:            string;
  /** Narrative explanation — never invents data, always cites evidence */
  answer:              string;
  keyPoints:           string[];
  riskNote:            string;
  confidence:          "low" | "medium" | "high";
  evidencePanel:       EvidencePanel;
  followUpActions:     FollowUpAction[];
  /** Only present when result set is empty */
  diagnostics?:        ResearchDiagnostics;
  /** Canonical opportunities referenced in this response */
  referencedOpportunities?: CanonicalOpportunity[];
  /** Tickers explicitly mentioned */
  referencedTickers:   string[];
  researchMode:        ResearchMode;
  contextScope:        ContextScope;
  source:              "openai" | "rule_based";
  disclaimer:          string;
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export interface ConversationMessage {
  id:          string;
  role:        "user" | "assistant";
  plainText?:  string;
  response?:   WorkspaceAIResponse;
  createdAt:   string;
}

export interface ConversationSummary {
  id:            string;
  title:         string;
  researchMode:  ResearchMode;
  contextScope:  ContextScope;
  tickers:       string[];
  isPinned:      boolean;
  pinnedAt?:     string;
  lastMessageAt: string;
  createdAt:     string;
  messageCount?: number;
  /** Sprint 2.6.4 context metadata */
  contextType?:       string;
  contextLabel?:      string;
  primarySymbol?:     string;
  comparisonSymbols?: string[];
  sourceRoute?:       string;
}

export interface ConversationDetail extends ConversationSummary {
  messages: ConversationMessage[];
}

// ---------------------------------------------------------------------------
// Research Templates
// ---------------------------------------------------------------------------

export interface ResearchTemplate {
  id:           string;
  label:        string;
  description:  string;
  mode:         ResearchMode;
  defaultScope: ContextScope;
  promptText:   string;
  /** Optional ticker placeholder — client substitutes a real symbol */
  requiresTicker: boolean;
}

export const RESEARCH_TEMPLATES: ResearchTemplate[] = [
  {
    id:           "qualify-explain",
    label:        "Explain Why This Qualified",
    description:  "Walk through the evidence that put this candidate on the radar",
    mode:         "company",
    defaultScope: "entire_market",
    promptText:   "Explain why {TICKER} qualified as a research candidate. Walk through the technical evidence, institutional signals, and risk factors.",
    requiresTicker: true,
  },
  {
    id:           "challenge-thesis",
    label:        "Challenge This Investment Thesis",
    description:  "Steel-man the bear case for a candidate",
    mode:         "company",
    defaultScope: "entire_market",
    promptText:   "Challenge the investment thesis for {TICKER}. What evidence argues against it being a qualified opportunity? What would invalidate the thesis?",
    requiresTicker: true,
  },
  {
    id:           "explain-change",
    label:        "Explain What Changed",
    description:  "Why did this candidate's ranking or evidence shift?",
    mode:         "opportunity",
    defaultScope: "recently-improved",
    promptText:   "Explain what changed for {TICKER} in the most recent ranking cycle. What evidence improved or deteriorated?",
    requiresTicker: true,
  },
  {
    id:           "risk-profile",
    label:        "Explain Risk Profile",
    description:  "Deep dive into risk factors and thesis invalidators",
    mode:         "company",
    defaultScope: "entire_market",
    promptText:   "Explain the risk factors for {TICKER}. What are the primary thesis invalidators and under what conditions would it exit the qualified list?",
    requiresTicker: true,
  },
  {
    id:           "compare-two",
    label:        "Compare Two Companies",
    description:  "Side-by-side evidence comparison of two candidates",
    mode:         "comparison",
    defaultScope: "entire_market",
    promptText:   "Compare {TICKER1} and {TICKER2} as research candidates. Show technical evidence, institutional positioning, and which has stronger evidence.",
    requiresTicker: false,
  },
  {
    id:           "ai-infra-leaders",
    label:        "Strongest AI Infrastructure Candidates",
    description:  "Top ranked candidates in the AI Infrastructure theme",
    mode:         "collection",
    defaultScope: "ai-infrastructure",
    promptText:   "Show the strongest research candidates in the AI Infrastructure theme right now. Rank by evidence strength and explain what's driving each.",
    requiresTicker: false,
  },
  {
    id:           "market-summary",
    label:        "Summarize Today's Market Intelligence",
    description:  "Market regime, leading themes, and sector signals",
    mode:         "market",
    defaultScope: "entire_market",
    promptText:   "Summarize today's market intelligence. What is the current market regime? Which themes and sectors show the strongest signals?",
    requiresTicker: false,
  },
  {
    id:           "institutional-explain",
    label:        "Explain Institutional Activity",
    description:  "What the 13F data shows about institutional positioning",
    mode:         "institutional",
    defaultScope: "entire_market",
    promptText:   "Explain the current institutional activity signals. Which candidates show accumulation? What does the 13F positioning data indicate?",
    requiresTicker: false,
  },
  {
    id:           "theme-leadership",
    label:        "Explain Theme Leadership",
    description:  "Which themes are leading and why",
    mode:         "theme",
    defaultScope: "entire_market",
    promptText:   "Which investment themes are showing the strongest signals right now? Explain why each is leading and which candidates are driving the theme.",
    requiresTicker: false,
  },
  {
    id:           "sector-leadership",
    label:        "Explain Sector Leadership",
    description:  "Which sectors are outperforming on evidence",
    mode:         "sector",
    defaultScope: "entire_market",
    promptText:   "Which sectors are showing the strongest research signals right now? Explain the evidence behind each and identify the leading candidates.",
    requiresTicker: false,
  },
  {
    id:           "find-similar",
    label:        "Find Similar Opportunities",
    description:  "Find candidates with similar evidence profiles",
    mode:         "opportunity",
    defaultScope: "entire_market",
    promptText:   "Find research candidates with a similar evidence profile to {TICKER}. Look for matching themes, technical patterns, and institutional signals.",
    requiresTicker: true,
  },
  {
    id:           "recent-changes",
    label:        "Show Recent Changes",
    description:  "What changed in the opportunity landscape recently",
    mode:         "opportunity",
    defaultScope: "recently-improved",
    promptText:   "What changed in the research candidate landscape recently? Which opportunities improved and what evidence drove the change?",
    requiresTicker: false,
  },
];

// ---------------------------------------------------------------------------
// Request / Response types for the workspace API
// ---------------------------------------------------------------------------

export interface WorkspaceAskRequest {
  question:       string;
  researchMode:   ResearchMode;
  contextScope:   ContextScope;
  tickers?:       string[];
  conversationId?: string;
  /** Sprint 2.6.4 — optional context metadata for conversation persistence */
  researchContext?: {
    contextType?:      string;
    contextLabel?:     string;
    primarySymbol?:    string;
    comparisonSymbols?: string[];
    sourceRoute?:      string;
  };
}

export interface WorkspaceAskResponse {
  conversationId: string;
  messageId:      string;
  response:       WorkspaceAIResponse;
}

export interface ConversationListResponse {
  pinned:  ConversationSummary[];
  recent:  ConversationSummary[];
  all:     ConversationSummary[];
}

// ---------------------------------------------------------------------------
// Sprint 2.6.4 — Context endpoint response
// ---------------------------------------------------------------------------

export interface ResearchContextResponse {
  context:      ResearchContext;
  limitations:  string[];
  assembledAt:  string;
}
