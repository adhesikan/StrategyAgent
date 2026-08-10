/**
 * Research Goal Types — Sprint 2.6.5
 *
 * Research goals express what a user wants to focus their research on.
 * They are PREFERENCE data, not suitability determinations.
 *
 * COMPLIANCE: Goals do not determine suitability, risk capacity, or
 * investment appropriateness. They organize research only.
 */

// ---------------------------------------------------------------------------
// Goal Types
// ---------------------------------------------------------------------------

export const GOAL_TYPES = [
  "long_term_growth",
  "long_term_compounding",
  "income",
  "dividend_income",
  "capital_preservation",
  "lower_volatility",
  "growth",
  "ai_infrastructure",
  "semiconductors",
  "options_income",
  "retirement_research",
  "custom",
] as const;

export type GoalType = typeof GOAL_TYPES[number];

export const GOAL_TYPE_LABELS: Record<GoalType, string> = {
  long_term_growth:      "Long-Term Growth",
  long_term_compounding: "Long-Term Compounding",
  income:                "Income",
  dividend_income:       "Dividend Research",
  capital_preservation:  "Capital Preservation",
  lower_volatility:      "Lower Volatility",
  growth:                "Growth",
  ai_infrastructure:     "AI Infrastructure",
  semiconductors:        "Semiconductors",
  options_income:        "Options Income",
  retirement_research:   "Retirement Research",
  custom:                "Custom Research Objective",
};

export const GOAL_TYPE_DESCRIPTIONS: Record<GoalType, string> = {
  long_term_growth:      "Research focused on companies with strong long-term growth evidence.",
  long_term_compounding: "Research focused on businesses with evidence of durable compounding characteristics.",
  income:                "Research focused on income-generating candidates including dividend payers.",
  dividend_income:       "Research focused on companies with dividend evidence.",
  capital_preservation:  "Research focused on candidates with lower historical volatility evidence.",
  lower_volatility:      "Research emphasizing candidates with lower price variability evidence.",
  growth:                "Research focused on candidates with strong growth evidence across multiple time frames.",
  ai_infrastructure:     "Research focused on AI infrastructure themes including semiconductors, memory, networking, and cloud.",
  semiconductors:        "Research focused on semiconductor and chip candidates.",
  options_income:        "Research covering candidates with options-income research evidence such as covered calls.",
  retirement_research:   "Research focused on long-duration, multi-year candidates with income or preservation evidence.",
  custom:                "A research objective you define based on your own focus areas.",
};

// ---------------------------------------------------------------------------
// Research Horizon
// ---------------------------------------------------------------------------

export const RESEARCH_HORIZONS = [
  "short_term",
  "medium_term",
  "long_term",
  "multi_year",
] as const;

export type ResearchHorizon = typeof RESEARCH_HORIZONS[number];

export const RESEARCH_HORIZON_LABELS: Record<ResearchHorizon, string> = {
  short_term:  "Short Term",
  medium_term: "Medium Term",
  long_term:   "Long Term",
  multi_year:  "Multi-Year",
};

export const RESEARCH_HORIZON_DESCRIPTIONS: Record<ResearchHorizon, string> = {
  short_term:  "Research focused on developments over days to several weeks.",
  medium_term: "Research focused on developments over several months.",
  long_term:   "Research focused on business and market developments over approximately one year or longer.",
  multi_year:  "Research focused on long-duration business, industry, and secular themes.",
};

/** Maps ResearchHorizon to TimeHorizon values from opportunity intelligence */
export const HORIZON_TO_TIME_HORIZON_MAP: Partial<Record<ResearchHorizon, string[]>> = {
  short_term:  ["short"],
  medium_term: ["medium", "medium_term"],
  long_term:   ["long", "long_term"],
  multi_year:  ["long", "long_term", "multi_year"],
};

// ---------------------------------------------------------------------------
// Research Style
// ---------------------------------------------------------------------------

export const RESEARCH_STYLES = [
  "growth",
  "value",
  "income",
  "quality",
  "momentum",
  "balanced",
  "thematic",
  "institutional_activity",
  "technical",
  "fundamental",
] as const;

export type ResearchStyle = typeof RESEARCH_STYLES[number];

export const RESEARCH_STYLE_LABELS: Record<ResearchStyle, string> = {
  growth:                 "Growth",
  value:                  "Value",
  income:                 "Income",
  quality:                "Quality",
  momentum:               "Momentum",
  balanced:               "Balanced",
  thematic:               "Thematic",
  institutional_activity: "Institutional Activity",
  technical:              "Technical",
  fundamental:            "Fundamental",
};

export const RESEARCH_STYLE_DESCRIPTIONS: Record<ResearchStyle, string> = {
  growth:                 "The types of evidence you want emphasized when exploring candidates — growth signals.",
  value:                  "Emphasize value evidence including discounted fundamental signals.",
  income:                 "Emphasize income-oriented evidence such as dividend history and yield signals.",
  quality:                "Emphasize quality evidence: earnings consistency, return on capital, and business durability.",
  momentum:               "Emphasize technical momentum and price strength evidence.",
  balanced:               "Consider a mix of growth, income, and technical evidence equally.",
  thematic:               "Emphasize theme membership and sector leadership evidence.",
  institutional_activity: "Emphasize institutional 13F positioning and accumulation evidence.",
  technical:              "Emphasize technical pattern quality and price structure evidence.",
  fundamental:            "Emphasize fundamental business quality and financial evidence.",
};

// ---------------------------------------------------------------------------
// Volatility Preference
// ---------------------------------------------------------------------------

export const VOLATILITY_PREFERENCES = [
  "lower",
  "balanced",
  "higher_accepted",
] as const;

export type VolatilityPreference = typeof VOLATILITY_PREFERENCES[number];

export const VOLATILITY_PREFERENCE_LABELS: Record<VolatilityPreference, string> = {
  lower:           "Lower Volatility Focus",
  balanced:        "Balanced",
  higher_accepted: "Higher Volatility Accepted",
};

export const VOLATILITY_PREFERENCE_DESCRIPTIONS: Record<VolatilityPreference, string> = {
  lower:           "Helps organize research around candidates with lower historical price variability evidence.",
  balanced:        "Research across a balanced range of price variability characteristics.",
  higher_accepted: "Research includes candidates with higher historical price variability.",
};

export const VOLATILITY_DISCLAIMER =
  "This preference helps organize research and does not represent a suitability assessment or investment recommendation.";

// ---------------------------------------------------------------------------
// Goal Status
// ---------------------------------------------------------------------------

export const GOAL_STATUSES = ["active", "paused", "archived"] as const;
export type GoalStatus = typeof GOAL_STATUSES[number];

// ---------------------------------------------------------------------------
// Canonical ResearchGoal model
// ---------------------------------------------------------------------------

export interface ResearchGoal {
  id:                        string;
  userId:                    string;
  name:                      string;
  goalType:                  GoalType;
  description:               string | null;
  horizon:                   ResearchHorizon;
  researchStyle:             ResearchStyle;
  focusAreas:                string[];           // free-form area labels
  preferredSectors:          string[];           // e.g. "Technology", "Healthcare"
  preferredThemes:           string[];           // e.g. "AI Infrastructure", "Semiconductors"
  preferredOpportunityTypes: string[];           // OpportunityType values
  volatilityPreference:      VolatilityPreference;
  optionsInterest:           boolean;
  monitoringEnabled:         boolean;
  isPrimary:                 boolean;
  status:                    GoalStatus;
  createdAt:                 string;
  updatedAt:                 string;
}

export interface CreateResearchGoalInput {
  name:                      string;
  goalType:                  GoalType;
  description?:              string;
  horizon:                   ResearchHorizon;
  researchStyle:             ResearchStyle;
  focusAreas?:               string[];
  preferredSectors?:         string[];
  preferredThemes?:          string[];
  preferredOpportunityTypes?: string[];
  volatilityPreference?:     VolatilityPreference;
  optionsInterest?:          boolean;
  monitoringEnabled?:        boolean;
}

export interface UpdateResearchGoalInput {
  name?:                     string;
  description?:              string;
  horizon?:                  ResearchHorizon;
  researchStyle?:            ResearchStyle;
  focusAreas?:               string[];
  preferredSectors?:         string[];
  preferredThemes?:          string[];
  preferredOpportunityTypes?: string[];
  volatilityPreference?:     VolatilityPreference;
  optionsInterest?:          boolean;
  monitoringEnabled?:        boolean;
  status?:                   GoalStatus;
}

// ---------------------------------------------------------------------------
// Goal matching
// ---------------------------------------------------------------------------

/** Deterministic categorical match states — never a numeric suitability score */
export type GoalMatchState =
  | "strong_match"
  | "match"
  | "partial_match"
  | "outside_filters";

export const GOAL_MATCH_STATE_LABELS: Record<GoalMatchState, string> = {
  strong_match:    "Strong Research Match",
  match:           "Research Match",
  partial_match:   "Partial Match",
  outside_filters: "Outside Current Goal Filters",
};

export const GOAL_MATCH_DISCLAIMER =
  "This means the candidate matches research filters you selected. It does not mean the security is suitable for you or that you should buy it.";

export interface GoalMatchResult {
  goalId:                    string;
  goalName:                  string;
  symbol:                    string;
  companyName:               string | null;
  matchState:                GoalMatchState;
  matchReasons:              string[];
  matchedThemes:             string[];
  matchedSectors:            string[];
  matchedOpportunityTypes:   string[];
  horizonAligned:            boolean;
  styleAligned:              boolean;
}

export interface GoalMatchSummary {
  goalId:       string;
  goalName:     string;
  totalMatched: number;
  strongMatches: number;
  matches:      number;
  partialMatches: number;
  topMatches:   GoalMatchResult[];
  generatedAt:  string;
}

// ---------------------------------------------------------------------------
// Goal activity
// ---------------------------------------------------------------------------

export interface GoalActivityItem {
  type:      "new_candidate" | "strengthened" | "weakened" | "theme_change" | "sector_change" | "institutional_change";
  label:     string;
  detail:    string;
  symbol?:   string;
  theme?:    string;
  sector?:   string;
  direction: "positive" | "negative" | "neutral";
  observedAt: string;
}

export interface GoalActivitySummary {
  goalId:      string;
  goalName:    string;
  newCandidates: number;
  strengthened:  number;
  weakened:      number;
  themeChanges:  number;
  items:         GoalActivityItem[];
  generatedAt:   string;
}

// ---------------------------------------------------------------------------
// Goal research context (for Research Workspace integration)
// ---------------------------------------------------------------------------

export interface GoalResearchContext {
  goalId:                    string;
  goalName:                  string;
  goalType:                  GoalType;
  horizon:                   ResearchHorizon;
  researchStyle:             ResearchStyle;
  preferredSectors:          string[];
  preferredThemes:           string[];
  preferredOpportunityTypes: string[];
  volatilityPreference:      VolatilityPreference;
  matchingSummary:           GoalMatchSummary;
  disclaimer:                string;
}

// ---------------------------------------------------------------------------
// Research Plan (lightweight)
// ---------------------------------------------------------------------------

export interface ResearchPlanAction {
  label:       string;
  description: string;
  url?:        string;
}

export interface ResearchPlan {
  goalId:           string;
  goalName:         string;
  objective:        string;
  horizon:          string;
  monitorItems:     string[];
  researchCandidates: string[];
  suggestedActions: ResearchPlanAction[];
  generatedAt:      string;
}

// ---------------------------------------------------------------------------
// Platform health
// ---------------------------------------------------------------------------

export interface ResearchGoalHealthSnapshot {
  activeGoals:            number;
  usersWithGoals:         number;
  primaryGoals:           number;
  matchRequests:          number;
  matchRequestsOk:        number;
  averageMatchLatencyMs:  number;
  failedMatchRequests:    number;
}

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------

export const GOAL_COMPLIANCE_DISCLAIMER =
  "Research goals and preferences help organize research based on criteria you select. They do not represent a suitability assessment, investment recommendation, financial plan, or advice to buy, sell, hold, or enter any security or strategy.";

export const GOAL_PRIVACY_DISCLOSURE =
  "Your research goals and preferences are used to personalize how VCP Trader AI organizes and presents research within your account. Research goals are not used to determine whether an investment is suitable for you.";

// ---------------------------------------------------------------------------
// Future Trade Planning handoff interface (documented, not implemented)
// ---------------------------------------------------------------------------

/**
 * TradePlanningContext — future handoff interface for Phase 2.7.
 *
 * When Trade Planning is implemented, it will consume:
 *   - researchGoalId: the goal that guided research
 *   - symbol: the qualified research candidate
 *   - researchHorizon: from the research goal
 *   - opportunityType: from the candidate's CanonicalOpportunity
 *   - researchEvidence: top evidence items from the candidate
 *   - riskObservations: risk factors from the candidate
 *
 * Trade Construction MUST NOT recalculate Opportunity Intelligence scores.
 * It MUST consume existing canonical evidence from the snapshot.
 *
 * @future Phase 2.7 — do not implement in Sprint 2.6.5
 */
export interface TradePlanningContextShape {
  researchGoalId:   string;
  symbol:           string;
  researchHorizon:  ResearchHorizon;
  opportunityType:  string;
  researchEvidence: Array<{ label: string; detail: string; strength: string }>;
  riskObservations: Array<{ label: string; detail: string; severity: string }>;
}
