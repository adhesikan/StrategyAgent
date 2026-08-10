/**
 * shared/research-glossary.ts
 *
 * Central Research Glossary — single source of truth for all research
 * terminology displayed across VCP Trader AI surfaces (dashboard, opportunity
 * workspace, research workspace, collections, intelligence pages, modals).
 *
 * RULES:
 *   1. Definitions live here and ONLY here. Components reference glossary keys.
 *   2. Do NOT duplicate definitions inside React components or system prompts.
 *   3. Do NOT overstate methodology beyond what actually exists in server code.
 *   4. Score semantic directions must match actual server computation (see JSDoc).
 *   5. Adding a new score requires a matching entry here AND a review of
 *      existing UI consumers.
 *
 * RISK SCORE DIRECTION (verified from server/services/opportunity-ranking-engine.ts):
 *   The `riskScore` displayed in the UI (from OpportunityScore) is computed by
 *   `computeRiskScore()` with the explicit comment "higher = better risk profile."
 *   A score of 85 indicates a favorable risk/reward profile; 25 indicates poor.
 *   This is the canonical display score — not to be confused with the internal
 *   `riskLevel` label ("low/medium/high") from the intelligence service, where
 *   "high" means more risk.
 *
 * COMMERCIAL EXPERIENCE (documented — no code restrictions):
 *   Free:         Users understand what research scores mean.
 *   Subscriber:   Deeper evidence panels and historical context may be premium later.
 *   Professional: Clear methodology suitable for professional research workflows.
 *   Enterprise:   Org-specific explanatory layers over canonical definitions (future).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GlossaryCategory =
  | "score"
  | "confidence"
  | "risk"
  | "candidate_type"
  | "market_context"
  | "evidence"
  | "data_quality"
  | "research_term";

export interface ResearchGlossaryEntry {
  /** Unique machine-readable key used in all component references. */
  key: string;
  /** Human-readable display label (title case). */
  label: string;
  /** Abbreviated label for compact UI contexts (optional). */
  shortLabel?: string;
  /** One-sentence definition for tooltips and badge labels. */
  shortDefinition: string;
  /**
   * Full definition for the score explanation modal and operations docs.
   * Should describe what the platform actually computes — not aspirations.
   */
  fullDefinition: string;
  /**
   * Optional brief methodology note. Describe actual computation in plain
   * English. Do NOT list internal function names or implementation details.
   */
  methodologySummary?: string;
  /** How to read the score/label in practice. */
  interpretation?: string;
  /**
   * Compliance caution shown below the definition. Required for all score
   * entries to reinforce that scores are not predictions or investment advice.
   */
  caution?: string;
  /** Taxonomy bucket for grouping in the explanation modal. */
  category: GlossaryCategory;
  /**
   * Score direction. true = higher is better. false = lower is better.
   * Undefined = not a numeric score.
   *
   * IMPORTANT: Must match actual server computation. Verify before changing.
   *   riskScore (OpportunityScore): higherIsBetter = true  (better risk profile)
   *   technicalScore:               higherIsBetter = true
   *   institutionalScore:           higherIsBetter = true
   *   fundamentalScore:             higherIsBetter = true
   *   overallScore (researchScore): higherIsBetter = true
   */
  higherIsBetter?: boolean;
  /** Show this entry in user-facing surfaces (true) or admin-only (false). */
  userFacing: boolean;
  /** Alternative keys or display labels that map to this entry. */
  aliases?: string[];
}

// ---------------------------------------------------------------------------
// Glossary data
// ---------------------------------------------------------------------------

export const RESEARCH_GLOSSARY: ReadonlyArray<ResearchGlossaryEntry> = [
  // ── Composite score ────────────────────────────────────────────────────────

  {
    key: "research_score",
    label: "Research Score",
    shortLabel: "Score",
    shortDefinition: "A composite score used to rank research candidates.",
    fullDefinition:
      "Research Score combines deterministic evidence already produced by " +
      "the platform, including technical, institutional, fundamental, and " +
      "risk-related inputs. It is used to organize and compare research " +
      "candidates — not to predict outcomes.",
    methodologySummary:
      "Weighted composite: Technical (40%), Institutional (20%), " +
      "Fundamental (15%), Risk Quality (15%), Regime Alignment (10%).",
    interpretation:
      "Higher scores indicate more supporting evidence. A score of 70+ " +
      "means multiple evidence dimensions are aligned. Below 40 suggests " +
      "weak or mixed evidence.",
    caution:
      "It is not a prediction of future returns, a probability of success, " +
      "or investment advice.",
    category: "score",
    higherIsBetter: true,
    userFacing: true,
    aliases: ["overall_score", "overallScore", "composite_score"],
  },

  // ── Component scores ───────────────────────────────────────────────────────

  {
    key: "technical_score",
    label: "Technical Score",
    shortLabel: "Tech",
    shortDefinition: "Measures the strength of technical evidence.",
    fullDefinition:
      "Measures technical research evidence such as trend quality, price " +
      "structure, volume behavior, support/resistance, and other " +
      "deterministic technical signals available to the platform. Uses " +
      "scanner-reported pattern confidence when available, otherwise derives " +
      "a conservative estimate from ranking position and setup status.",
    methodologySummary:
      "Uses scanner-reported strategyScore (0–100) when present. Falls back " +
      "to a rank-derived estimate (rank 1 → ~85, rank 5 → ~45). Adjusted by " +
      "pattern confidence (+5 for high, −10 for low) and setup maturity.",
    interpretation:
      "70+ indicates strong technical structure. Below 40 suggests the " +
      "pattern lacks confirmation or the setup is still forming.",
    caution:
      "Technical evidence describes historical price behavior. It does not " +
      "predict whether the pattern will continue.",
    category: "score",
    higherIsBetter: true,
    userFacing: true,
    aliases: ["technicalScore", "tech_score", "tech"],
  },

  {
    key: "institutional_score",
    label: "Institutional Score",
    shortLabel: "Inst",
    shortDefinition: "Measures available institutional evidence.",
    fullDefinition:
      "Measures publicly available evidence of institutional participation, " +
      "ownership trends, and related institutional signals. Based on " +
      "SEC Form 13F filings processed by the platform. When no institutional " +
      "data is available for a symbol, the score defaults to neutral (50) " +
      "rather than penalising or rewarding the candidate.",
    methodologySummary:
      "Derived from precomputed institutional signals. Score is adjusted " +
      "toward neutral (50) based on data quality confidence: high confidence " +
      "uses the full signal score; moderate compresses 25% toward 50; " +
      "limited compresses 45% toward 50.",
    interpretation:
      "Above 50 indicates positive institutional evidence (e.g. manager " +
      "accumulation). Below 50 suggests outflows or mixed signals. At exactly " +
      "50, institutional data is unavailable — not necessarily negative.",
    caution:
      "Form 13F data is delayed (filed 45 days after quarter end) and does " +
      "not reflect current institutional positions.",
    category: "score",
    higherIsBetter: true,
    userFacing: true,
    aliases: ["institutionalScore", "inst_score", "inst"],
  },

  {
    key: "fundamental_score",
    label: "Fundamental Score",
    shortLabel: "Fund",
    shortDefinition: "Measures available fundamental business evidence.",
    fullDefinition:
      "Measures available company-related evidence such as earnings " +
      "proximity risk, income-generating strategy characteristics, and " +
      "liquidity signals derived from scanner output. This score is a " +
      "deterministic proxy — not a full financial statement analysis.",
    methodologySummary:
      "Starts at a neutral base (60). Reduced by ~15 points if earnings " +
      "risk is present in the week. Increased by ~15 points for income " +
      "strategies (covered calls, cash-secured puts). Small boost for " +
      "strong-liquidity mentions.",
    interpretation:
      "Above 65 suggests favorable earnings timing and income characteristics. " +
      "Below 45 typically indicates earnings proximity risk or other " +
      "fundamental concern flagged by the scanner.",
    caution:
      "Does not incorporate balance sheet, revenue, or earnings-per-share " +
      "data. It is a deterministic proxy derived from scanner evidence only.",
    category: "score",
    higherIsBetter: true,
    userFacing: true,
    aliases: ["fundamentalScore", "fund_score", "fund"],
  },

  {
    key: "risk_score",
    label: "Risk Score",
    shortLabel: "Risk",
    shortDefinition:
      "Measures risk profile quality — higher means a more favorable profile.",
    fullDefinition:
      "Measures the overall risk profile quality of a research candidate. " +
      "A higher score indicates a more favorable risk/reward setup: good " +
      "reward-to-risk ratio, fits within risk budget parameters, and few " +
      "high-risk warning patterns. A lower score indicates elevated risk " +
      "factors such as poor reward/risk ratio, earnings proximity, or " +
      "gap-risk warnings.",
    methodologySummary:
      "Starts at a neutral base (60). Boosted by strong reward/risk ratio " +
      "(≥3:1 → +18, ≥2:1 → +8). Increased if the setup fits risk budget " +
      "parameters (+15). Reduced by gap-risk, earnings-risk, and " +
      "low-liquidity warnings.",
    interpretation:
      "75+ indicates a favorable risk profile. Below 45 means one or more " +
      "significant risk factors are present. Higher is always better for " +
      "this score.",
    caution:
      "A high Risk Score does not guarantee a favorable outcome. Risk " +
      "assessment is deterministic and based on available scanner evidence only.",
    category: "score",
    higherIsBetter: true, // VERIFIED: computeRiskScore() in ranking engine — higher = better risk profile
    userFacing: true,
    aliases: ["riskScore", "risk"],
  },

  {
    key: "regime_score",
    label: "Regime Alignment Score",
    shortLabel: "Regime",
    shortDefinition:
      "Measures how well the candidate aligns with current market conditions.",
    fullDefinition:
      "Measures alignment between the candidate's strategy and the current " +
      "detected market regime (e.g. trending, risk-off, range-bound). " +
      "Momentum candidates score well in trending regimes; income candidates " +
      "may score better in range-bound markets.",
    methodologySummary:
      "TRENDING + momentum strategy → high (~90). RISK_OFF → low (15–25). " +
      "Unknown or neutral regime → 50.",
    interpretation:
      "A low regime score means the candidate strategy is misaligned with " +
      "current conditions — not that the security is poor.",
    caution: "Regime classification is deterministic and may lag market transitions.",
    category: "score",
    higherIsBetter: true,
    userFacing: true,
    aliases: ["regimeScore", "regime_alignment"],
  },

  // ── Confidence ─────────────────────────────────────────────────────────────

  {
    key: "evidence_confidence",
    label: "Evidence Confidence",
    shortLabel: "Confidence",
    shortDefinition:
      "Describes the amount and consistency of supporting research evidence.",
    fullDefinition:
      "Evidence Confidence reflects how many dimensions of evidence are " +
      "available and how consistently they support the overall picture. " +
      "High confidence means multiple evidence dimensions (technical, " +
      "institutional, fundamental, regime) are all aligned. Low confidence " +
      "means evidence is sparse, mixed, or from limited data sources.",
    interpretation:
      "High: strong multi-dimensional evidence. Medium: some evidence " +
      "present but gaps exist. Low: limited or conflicting evidence.",
    caution:
      "It does not represent the probability that a security will rise or " +
      "fall. Evidence Confidence is not a prediction of success.",
    category: "confidence",
    userFacing: true,
    aliases: ["confidence", "score_confidence"],
  },

  // ── Market context ─────────────────────────────────────────────────────────

  {
    key: "market_regime",
    label: "Market Regime",
    shortDefinition:
      "The current broad market condition detected by the platform.",
    fullDefinition:
      "Market Regime describes the current detected broad market condition " +
      "used to align research candidates with prevailing conditions. " +
      "Common regime labels: TRENDING (strong directional momentum), " +
      "RANGE_BOUND (low-directional, income strategies may be favored), " +
      "RISK_OFF (elevated risk aversion, high-beta candidates deprioritized), " +
      "NEUTRAL (mixed signals).",
    interpretation:
      "Research candidates are scored for regime alignment. A RISK_OFF " +
      "regime reduces the regime score of high-beta breakout candidates " +
      "but does not disqualify them from research.",
    caution:
      "Regime classification is a deterministic assessment and may not " +
      "immediately reflect rapid market transitions.",
    category: "market_context",
    userFacing: true,
    aliases: ["regime", "market_condition"],
  },

  {
    key: "sector",
    label: "Sector",
    shortDefinition:
      "A broad industry grouping used to organize research candidates.",
    fullDefinition:
      "Sector groups research candidates into standard GICS-aligned industry " +
      "buckets (e.g. Technology, Healthcare, Energy). Sector-level scoring " +
      "aggregates the evidence quality across all candidates in that sector " +
      "to identify which sectors show the strongest current research evidence.",
    category: "market_context",
    userFacing: true,
  },

  {
    key: "theme",
    label: "Theme",
    shortDefinition:
      "A curated research topic grouping related candidates by underlying driver.",
    fullDefinition:
      "Themes are curated groupings of research candidates that share an " +
      "underlying market driver (e.g. AI Infrastructure, Defense, Clean " +
      "Energy). Unlike sectors, a theme may span multiple sectors. Theme " +
      "scores reflect the aggregate research evidence strength across all " +
      "theme members.",
    category: "market_context",
    userFacing: true,
  },

  {
    key: "data_freshness",
    label: "Data Freshness",
    shortDefinition:
      "How recently the underlying data was generated or updated.",
    fullDefinition:
      "Data Freshness indicates when the underlying research data was last " +
      "generated. Ranking snapshots are refreshed on a scheduled cycle " +
      "(default: every 4 hours during market hours). Sector and theme " +
      "intelligence snapshots are rebuilt less frequently. " +
      "SEC Form 13F institutional data is filed quarterly with a 45-day delay.",
    interpretation:
      "A freshness timestamp more than a few hours old means the snapshot " +
      "predates the most recent price action. Institutional evidence is " +
      "always at least 45 days delayed by regulation.",
    caution:
      "Older snapshots may not reflect intraday price movements or same-day " +
      "news events.",
    category: "data_quality",
    userFacing: true,
    aliases: ["freshness", "last_updated"],
  },

  {
    key: "time_horizon",
    label: "Time Horizon",
    shortDefinition:
      "The typical holding period implied by a research candidate's strategy.",
    fullDefinition:
      "Time Horizon describes the typical intended holding duration for a " +
      "given research strategy. Swing candidates are typically held days to " +
      "a few weeks. Long-term investment candidates imply months. Income " +
      "strategies (covered calls, cash-secured puts) are typically structured " +
      "around weekly or monthly option expirations.",
    caution:
      "Time horizon is an educational descriptor. It is not a guarantee " +
      "that a position will perform within the stated period.",
    category: "research_term",
    userFacing: true,
  },

  // ── Candidate types ────────────────────────────────────────────────────────

  {
    key: "research_candidate",
    label: "Research Candidate",
    shortDefinition:
      "Any symbol under active research review based on scanner evidence.",
    fullDefinition:
      "A Research Candidate is any symbol that has been surfaced by the " +
      "platform's scanner and is currently under research review. It has " +
      "not yet met full qualification criteria. Being a Research Candidate " +
      "is not a signal to act — it indicates the platform has identified " +
      "evidence worth monitoring.",
    caution:
      "Research Candidate status is not investment advice or a trade signal.",
    category: "candidate_type",
    userFacing: true,
    aliases: ["candidate"],
  },

  {
    key: "qualified_opportunity",
    label: "Qualified Opportunity",
    shortDefinition:
      "A research candidate that has met the platform's qualification criteria.",
    fullDefinition:
      "A Qualified Opportunity is a research candidate that has met the " +
      "platform's deterministic qualification criteria: sufficient technical " +
      "evidence, a defined entry zone, and passing minimum research score " +
      "thresholds. Qualification is based entirely on deterministic evidence " +
      "— not predictions or AI opinion.",
    caution:
      "Qualified Opportunity status is not a recommendation to buy, sell, " +
      "or hold. It reflects that qualifying evidence criteria have been met " +
      "based on available data.",
    category: "candidate_type",
    userFacing: true,
    aliases: ["qualified", "opportunity"],
  },

  {
    key: "growth_candidate",
    label: "Growth Candidate",
    shortDefinition:
      "A research candidate with strong technical momentum evidence.",
    fullDefinition:
      "A Growth Candidate exhibits strong technical structure and momentum " +
      "evidence — typically breakout or trend-continuation patterns. These " +
      "candidates appear in the Top Growth section of the opportunity ranking.",
    caution:
      "Growth research evidence does not predict whether upward movement " +
      "will continue.",
    category: "candidate_type",
    higherIsBetter: undefined,
    userFacing: true,
  },

  {
    key: "income_candidate",
    label: "Income Candidate",
    shortDefinition:
      "A research candidate with evidence supporting income-generating strategies.",
    fullDefinition:
      "An Income Candidate has evidence supporting options income strategies " +
      "such as covered calls or cash-secured puts. These typically have " +
      "range-bound price behavior, elevated implied volatility, or explicit " +
      "income-strategy scanner evidence.",
    caution:
      "Income research evidence does not guarantee premium collection or " +
      "protection from adverse price movement.",
    category: "candidate_type",
    userFacing: true,
  },

  {
    key: "watch_candidate",
    label: "Watch Candidate",
    shortDefinition:
      "A research candidate approaching qualification but not yet qualified.",
    fullDefinition:
      "A Watch Candidate has been identified by the scanner as showing " +
      "early-stage technical evidence but has not yet met full qualification " +
      "criteria. It is placed on the watch list for continued monitoring.",
    caution:
      "Watch status indicates monitoring interest only — not a signal to act.",
    category: "candidate_type",
    userFacing: true,
    aliases: ["watch"],
  },

  {
    key: "long_term_investment_candidate",
    label: "Long-Term Investment Candidate",
    shortDefinition:
      "A research candidate with evidence supporting a longer holding horizon.",
    fullDefinition:
      "A Long-Term Investment Candidate has research evidence aligned with a " +
      "multi-month horizon — typically strong fundamental proxies, sector " +
      "leadership, and institutional accumulation evidence. The platform " +
      "does not provide fundamental analysis for individual company financials.",
    caution:
      "Long-term research evidence does not predict performance over any " +
      "specific holding period.",
    category: "candidate_type",
    userFacing: true,
    aliases: ["long_term", "lt_candidate"],
  },

  {
    key: "momentum_candidate",
    label: "Momentum Candidate",
    shortDefinition:
      "A research candidate with strong recent price and volume momentum evidence.",
    fullDefinition:
      "A Momentum Candidate has scanner evidence of strong recent price " +
      "movement and elevated volume. These are typically shorter-horizon " +
      "candidates aligned with trending market regimes.",
    caution:
      "Momentum evidence reflects past price behavior. Momentum can reverse " +
      "rapidly without warning.",
    category: "candidate_type",
    userFacing: true,
  },

  {
    key: "swing_candidate",
    label: "Swing Research Candidate",
    shortDefinition:
      "A research candidate with evidence supporting a multi-day to multi-week horizon.",
    fullDefinition:
      "A Swing Research Candidate has technical evidence supporting a " +
      "multi-day to multi-week holding horizon. These typically include " +
      "VCP (Volatility Contraction Pattern) setups, breakout confirmations, " +
      "and momentum continuation patterns.",
    caution:
      "Swing research evidence does not predict whether the pattern will " +
      "complete or produce a favorable outcome.",
    category: "candidate_type",
    userFacing: true,
    aliases: ["swing"],
  },

  {
    key: "etf_candidate",
    label: "ETF Research Candidate",
    shortDefinition: "A research candidate that is an exchange-traded fund.",
    fullDefinition:
      "An ETF Research Candidate is an exchange-traded fund that has been " +
      "surfaced by the platform's research engine. ETF candidates may " +
      "represent sector, theme, or broad market exposure rather than " +
      "individual company exposure.",
    caution:
      "ETF research evidence applies to the fund as a tradeable instrument, " +
      "not to any individual security within the fund.",
    category: "candidate_type",
    userFacing: true,
    aliases: ["etf"],
  },

  {
    key: "covered_call_candidate",
    label: "Covered Call Candidate",
    shortDefinition:
      "A research candidate with evidence supporting a covered call income strategy.",
    fullDefinition:
      "A Covered Call Candidate has evidence suggesting the underlying stock " +
      "may be suitable for a covered call income strategy — typically " +
      "elevated implied volatility, range-bound price behavior, and " +
      "sufficient option liquidity. This is not a recommendation to write " +
      "covered calls.",
    caution:
      "Covered call strategies cap upside and do not fully protect against " +
      "downside. Covered Call Candidate status is not investment advice.",
    category: "candidate_type",
    userFacing: true,
    aliases: ["covered_call"],
  },

  {
    key: "cash_secured_put_candidate",
    label: "Cash-Secured Put Candidate",
    shortDefinition:
      "A research candidate with evidence supporting a cash-secured put income strategy.",
    fullDefinition:
      "A Cash-Secured Put Candidate has evidence suggesting the underlying " +
      "stock may be suitable for a cash-secured put income strategy — " +
      "typically elevated implied volatility, defined support levels, and " +
      "sufficient option liquidity. This is not a recommendation to sell puts.",
    caution:
      "Cash-secured put strategies carry the obligation to purchase shares " +
      "at the strike price. Cash-Secured Put Candidate status is not " +
      "investment advice.",
    category: "candidate_type",
    userFacing: true,
    aliases: ["cash_secured_put", "csp_candidate"],
  },

  // ── Evidence ───────────────────────────────────────────────────────────────

  {
    key: "research_evidence",
    label: "Research Evidence",
    shortDefinition:
      "Deterministic signals gathered by the platform to support research.",
    fullDefinition:
      "Research Evidence refers to the deterministic signals gathered and " +
      "processed by the platform — technical patterns, scanner output, " +
      "institutional filings, and other available data. The platform never " +
      "invents evidence. If evidence is unavailable, it is explicitly " +
      "noted rather than omitted or guessed.",
    caution:
      "Evidence describes what has occurred historically. It does not " +
      "predict what will occur next.",
    category: "evidence",
    userFacing: true,
    aliases: ["evidence"],
  },

  {
    key: "primary_evidence",
    label: "Primary Evidence",
    shortDefinition:
      "The strongest available signals directly supporting the research thesis.",
    fullDefinition:
      "Primary Evidence includes the strongest, most direct signals " +
      "supporting the research thesis for a candidate: confirmed technical " +
      "patterns, high-quality institutional accumulation signals, and " +
      "scanner-verified entry setups.",
    caution:
      "Primary evidence strength does not predict outcome probability.",
    category: "evidence",
    userFacing: true,
  },

  {
    key: "secondary_evidence",
    label: "Secondary Evidence",
    shortDefinition:
      "Supporting context that reinforces but does not directly confirm the thesis.",
    fullDefinition:
      "Secondary Evidence provides supporting context — sector tailwind, " +
      "theme momentum, relative strength — that reinforces but does not " +
      "directly confirm the primary thesis. Secondary evidence alone is " +
      "insufficient for qualification.",
    caution:
      "Secondary evidence is context, not confirmation. It should not be " +
      "used as the primary basis for any decision.",
    category: "evidence",
    userFacing: true,
  },

  {
    key: "risk_factor",
    label: "Risk Factor",
    shortDefinition:
      "A signal that may reduce confidence in the research thesis.",
    fullDefinition:
      "Risk Factors are deterministic signals that may reduce confidence in " +
      "a research thesis or indicate elevated risk: earnings proximity, " +
      "gap risk, low liquidity, weak reward/risk ratio, or elevated " +
      "volatility patterns.",
    caution:
      "Risk Factor presence does not mean a position will lose value. It " +
      "indicates elevated uncertainty in the available evidence.",
    category: "evidence",
    userFacing: true,
    aliases: ["risk_factors", "warning"],
  },

  {
    key: "invalidates_thesis",
    label: "Invalidates Thesis",
    shortDefinition:
      "A signal that, if triggered, would undermine the research thesis.",
    fullDefinition:
      "An 'Invalidates Thesis' signal describes a specific condition that " +
      "would undermine the underlying research thesis — typically a price " +
      "break below a key support level, a failed breakout, or a reversal of " +
      "the primary technical pattern. This is an educational planning " +
      "construct, not a stop-loss instruction.",
    caution:
      "Invalidation conditions are educational planning references. They " +
      "are not stop-loss orders or financial advice.",
    category: "evidence",
    userFacing: true,
    aliases: ["invalidation", "thesis_invalidation"],
  },

  // ── Institutional ──────────────────────────────────────────────────────────

  {
    key: "institutional_activity",
    label: "Institutional Activity",
    shortDefinition:
      "Evidence of institutional ownership changes from SEC Form 13F filings.",
    fullDefinition:
      "Institutional Activity reflects changes in institutional ownership " +
      "detected from SEC Form 13F filings. The platform tracks manager " +
      "count changes, position size trends, and accumulation/distribution " +
      "signals. This data is delayed by regulation — 13F filings are " +
      "submitted 45 days after the end of each calendar quarter.",
    caution:
      "SEC Form 13F data is delayed and does not represent current " +
      "institutional positions. Institutions may have significantly " +
      "changed their holdings since the most recent filing period.",
    category: "evidence",
    userFacing: true,
    aliases: ["institutional", "13f_evidence"],
  },

  // ── Data quality ───────────────────────────────────────────────────────────

  {
    key: "opportunity_type",
    label: "Opportunity Type",
    shortDefinition:
      "The strategy classification assigned to a research candidate.",
    fullDefinition:
      "Opportunity Type classifies a research candidate by its primary " +
      "strategy evidence: Growth, Income, Watch, or Avoid. This " +
      "classification is determined by the ranking engine based on " +
      "technical and income-strategy evidence — not by user preference " +
      "or AI opinion.",
    caution:
      "Opportunity type is a research classification, not a trade " +
      "recommendation or instruction.",
    category: "candidate_type",
    userFacing: true,
    aliases: ["category", "candidate_type_label"],
  },
] as const;

// ---------------------------------------------------------------------------
// Lookup utilities
// ---------------------------------------------------------------------------

/** O(n) lookup by primary key or any alias. Returns undefined for unknown keys. */
export function getGlossaryEntry(key: string): ResearchGlossaryEntry | undefined {
  const normalized = key.trim().toLowerCase();
  return RESEARCH_GLOSSARY.find(
    (e) =>
      e.key === normalized ||
      (e.aliases ?? []).some((a) => a.toLowerCase() === normalized),
  );
}

/** All entries belonging to a specific category. */
export function getGlossaryByCategory(category: GlossaryCategory): ResearchGlossaryEntry[] {
  return RESEARCH_GLOSSARY.filter((e) => e.category === category);
}

/**
 * Score-category entries in display order for the explanation modal.
 * Returns: [research_score, technical_score, institutional_score,
 *           fundamental_score, risk_score, regime_score].
 */
export function getScoreGlossaryEntries(): ResearchGlossaryEntry[] {
  const ORDER = [
    "research_score",
    "technical_score",
    "institutional_score",
    "fundamental_score",
    "risk_score",
    "regime_score",
  ];
  return ORDER.map((k) => getGlossaryEntry(k)).filter(
    (e): e is ResearchGlossaryEntry => e !== undefined,
  );
}

/**
 * Candidate-type entries in display order.
 */
export function getCandidateTypeEntries(): ResearchGlossaryEntry[] {
  const ORDER = [
    "research_candidate",
    "qualified_opportunity",
    "growth_candidate",
    "income_candidate",
    "watch_candidate",
    "momentum_candidate",
    "swing_candidate",
    "long_term_investment_candidate",
    "etf_candidate",
    "covered_call_candidate",
    "cash_secured_put_candidate",
  ];
  return ORDER.map((k) => getGlossaryEntry(k)).filter(
    (e): e is ResearchGlossaryEntry => e !== undefined,
  );
}

// ---------------------------------------------------------------------------
// Portfolio Intelligence glossary terms (Sprint 2.6.1)
// ---------------------------------------------------------------------------

const PORTFOLIO_INTELLIGENCE_ENTRIES: ResearchGlossaryEntry[] = [
  {
    key:              "portfolio_research_coverage",
    label:            "Portfolio Research Coverage",
    shortLabel:       "Coverage",
    shortDefinition:  "How much of a portfolio has each research data dimension available.",
    fullDefinition:
      "Portfolio Research Coverage tracks the proportion of portfolio holdings that have " +
      "each research data dimension available: Opportunity Intelligence, reference prices, " +
      "sector classification, theme membership, fundamental evidence, and institutional evidence. " +
      "Missing data is recorded as unavailable — it is never converted to zero.",
    methodologySummary:
      "Weighted composite: Opportunity Intelligence 40%, market data 25%, sector 15%, " +
      "theme 10%, institutional 10%.",
    interpretation:
      "Higher coverage means more holdings have research context. Low coverage may indicate " +
      "holdings outside the standard research universe.",
    caution:
      "Coverage is not a quality score. A low-covered holding is simply outside current research data, " +
      "not inferior.",
    sources: ["Opportunity Intelligence snapshot", "Theme registry", "Institutional 13F signals"],
  },
  {
    key:              "portfolio_concentration",
    label:            "Portfolio Concentration",
    shortLabel:       "Concentration",
    shortDefinition:  "The degree to which a portfolio is weighted toward a small number of positions, sectors, or themes.",
    fullDefinition:
      "Portfolio Concentration measures how much of the portfolio is represented by the largest " +
      "position, top-3 positions, top-5 positions, and the dominant sector or theme. " +
      "Higher concentration means a smaller number of holdings represent a larger fraction of portfolio value.",
    methodologySummary:
      "Thresholds — Largest position: Low <10%, Moderate 10–20%, High >20%. " +
      "Top-3 positions: Low <25%, Moderate 25–50%, High >50%. " +
      "Sector: Low <30%, Moderate 30–50%, High >50%. " +
      "Theme: Low <20%, Moderate 20–40%, High >40%.",
    interpretation:
      "Labels (Low/Moderate/High) are descriptive. They are not suitability determinations.",
    caution:
      "Concentration is an observed characteristic, not an advisory signal. " +
      "Appropriate concentration levels vary by strategy and individual circumstances.",
    sources: ["Portfolio positions", "Reference prices", "Sector/theme classification"],
  },
  {
    key:              "sector_exposure",
    label:            "Sector Exposure",
    shortLabel:       "Sector",
    shortDefinition:  "The fraction of portfolio market value invested in each sector.",
    fullDefinition:
      "Sector Exposure shows how portfolio market value is distributed across industry sectors. " +
      "Sector classification comes from Opportunity Intelligence and the market_data_symbols table — " +
      "no independent classifications are created.",
    methodologySummary:
      "For each sector: (sum of position market values in sector) / (total portfolio market value) × 100.",
    interpretation:
      "Shows concentration by sector. Compare with sector intelligence to understand market context.",
    caution:
      "Percentages reflect observed portfolio characteristics. They are not rebalancing signals.",
    sources: ["Portfolio positions", "Opportunity Intelligence", "market_data_symbols"],
  },
  {
    key:              "theme_exposure",
    label:            "Theme Exposure",
    shortLabel:       "Theme",
    shortDefinition:  "The fraction of portfolio market value invested in each curated research theme.",
    fullDefinition:
      "Theme Exposure shows how portfolio market value is distributed across curated research themes " +
      "(AI Infrastructure, Cloud Computing, etc.). One holding may belong to multiple themes, so theme " +
      "percentages may exceed 100% in total — this is by design.",
    methodologySummary:
      "For each theme: sum of position market values where the symbol belongs to the theme, divided by " +
      "total portfolio market value. Overlap is preserved.",
    interpretation:
      "Theme percentages can exceed 100% total due to overlap. Each percentage shows that theme's " +
      "share of portfolio value independently.",
    caution:
      "Theme percentages may overlap and therefore may not sum to 100%. This is intentional.",
    sources: ["Theme registry", "Portfolio positions", "Reference prices"],
  },
  {
    key:              "opportunity_overlap",
    label:            "Opportunity Overlap",
    shortLabel:       "Overlap",
    shortDefinition:  "How current portfolio holdings relate to the Opportunity Intelligence snapshot.",
    fullDefinition:
      "Opportunity Overlap classifies each holding based on its presence in the current Opportunity " +
      "Intelligence snapshot: Currently Qualified (topGrowth/topIncome), Approaching Qualification " +
      "(approaching/watchlist), No Longer Qualified (was qualified, now absent), or Not Currently Ranked " +
      "(not in current snapshot). Absence is not a negative quality signal.",
    methodologySummary:
      "Based on _sourceCategory field in CanonicalOpportunity from the current OppIntel snapshot.",
    interpretation:
      "'Not Currently Ranked' means the symbol is not represented in the latest Opportunity Intelligence " +
      "snapshot. It does not indicate poor quality.",
    caution:
      "Do not interpret absence from the current snapshot as negative. Opportunity Intelligence snapshots " +
      "change as market conditions change.",
    sources: ["Opportunity Intelligence snapshot"],
  },
  {
    key:              "research_strengthened",
    label:            "Research Strengthened",
    shortLabel:       "Strengthened",
    shortDefinition:  "A holding whose research evidence improved since the previous portfolio snapshot.",
    fullDefinition:
      "Research Strengthened identifies holdings where the Research Score improved by 2 or more points " +
      "between two consecutive portfolio snapshots. The change is sourced from Portfolio History " +
      "change intelligence — it is not computed independently.",
    methodologySummary:
      "Threshold: score delta ≥ +2 between consecutive portfolio snapshots.",
    interpretation:
      "Indicates that supporting research evidence has strengthened for this holding.",
    caution:
      "Research score movement is a research observation. It is not a trading signal.",
    sources: ["Portfolio History", "Opportunity Intelligence"],
  },
  {
    key:              "research_weakened",
    label:            "Research Weakened",
    shortLabel:       "Weakened",
    shortDefinition:  "A holding whose research evidence declined since the previous portfolio snapshot.",
    fullDefinition:
      "Research Weakened identifies holdings where the Research Score declined by 2 or more points " +
      "between two consecutive portfolio snapshots. The change is sourced from Portfolio History " +
      "change intelligence — it is not computed independently.",
    methodologySummary:
      "Threshold: score delta ≤ −2 between consecutive portfolio snapshots.",
    interpretation:
      "Indicates that supporting research evidence has weakened for this holding.",
    caution:
      "Research evidence weakening is a research observation. It is not a sell signal.",
    sources: ["Portfolio History", "Opportunity Intelligence"],
  },
  {
    key:              "qualified_holding",
    label:            "Qualified Holding",
    shortLabel:       "Qualified",
    shortDefinition:  "A portfolio holding that currently appears in the Opportunity Intelligence snapshot.",
    fullDefinition:
      "A Qualified Holding is a portfolio position whose symbol appears in the current Opportunity " +
      "Intelligence snapshot with at least one research score. This includes Currently Qualified " +
      "(topGrowth/topIncome) and Approaching Qualification (approaching/watchlist) categories.",
    methodologySummary:
      "Symbol present in getOpportunityIntelligence() result.",
    interpretation:
      "Qualified holdings have research context from the platform. Scores come from Opportunity Intelligence " +
      "and are not independently recomputed.",
    caution:
      "Qualified status reflects current Opportunity Intelligence coverage, not a recommendation to hold.",
    sources: ["Opportunity Intelligence snapshot"],
  },
  {
    key:              "uncovered_holding",
    label:            "Uncovered Holding",
    shortLabel:       "Uncovered",
    shortDefinition:  "A portfolio holding that is not currently in the Opportunity Intelligence snapshot.",
    fullDefinition:
      "An Uncovered Holding is a portfolio position whose symbol does not appear in the current " +
      "Opportunity Intelligence snapshot. This means no research scores are available from the platform " +
      "for this holding. It does not indicate the holding is of poor quality.",
    methodologySummary:
      "Symbol absent from getOpportunityIntelligence() result.",
    interpretation:
      "Consider exploring coverage for uncovered holdings in the Research Workspace or requesting " +
      "research coverage expansion.",
    caution:
      "Uncovered status does not imply any quality judgment about the holding.",
    sources: ["Opportunity Intelligence snapshot"],
  },
];

// ---------------------------------------------------------------------------
// Portfolio Analytics glossary terms (Sprint 2.6.2)
// ---------------------------------------------------------------------------

const PORTFOLIO_ANALYTICS_ENTRIES: ResearchGlossaryEntry[] = [
  {
    key:              "portfolio_value_change",
    label:            "Portfolio Value Change",
    shortLabel:       "Value Change",
    shortDefinition:  "The change in total portfolio market value over a selected period.",
    fullDefinition:
      "Portfolio Value Change measures the absolute and percentage difference in total portfolio " +
      "market value between two points in time. It reflects the combined effect of market price " +
      "movement AND changes in holdings (positions added or removed). Because holdings may have " +
      "changed during the period, this is NOT equivalent to investment return.",
    methodologySummary:
      "Ending market value − Starting market value. Starting and ending values come from " +
      "portfolio snapshots at the edges of the selected period.",
    interpretation:
      "A positive Portfolio Value Change means the tracked market value increased. " +
      "A negative change means it decreased. The direction and magnitude combine price changes " +
      "and position changes during the period.",
    caution:
      "Portfolio Value Change is not an investment return. It is not adjusted for deposits, " +
      "withdrawals, or time-weighted flows. Do not use it to compare investment performance " +
      "across different portfolios or time periods.",
    sources: ["Portfolio Snapshots", "Reference Prices"],
  },
  {
    key:              "unrealized_gain_loss",
    label:            "Unrealized Gain / Loss",
    shortLabel:       "Unrealized G/L",
    shortDefinition:  "The difference between current market value and total cost basis for tracked positions.",
    fullDefinition:
      "Unrealized Gain / Loss is the difference between the current market value of tracked positions " +
      "and their total cost basis (average purchase price × quantity). It becomes realized only when " +
      "positions are exited. When cost basis data is partial, the figure reflects partial coverage only.",
    methodologySummary:
      "Current market value − total cost basis. Only positions with cost basis data contribute.",
    interpretation:
      "A positive figure indicates total market value exceeds cost basis. " +
      "A negative figure indicates market value is below cost basis.",
    caution:
      "Unrealized Gain / Loss is not a measure of investment performance. It reflects observed " +
      "price movement relative to the cost basis entered or imported — it does not account for " +
      "dividends, fees, taxes, or time. Partial cost basis data produces partial figures.",
    sources: ["Portfolio Positions", "Reference Prices", "Cost Basis data"],
  },
  {
    key:              "position_allocation",
    label:            "Position Allocation",
    shortLabel:       "Allocation",
    shortDefinition:  "The fraction of total portfolio market value invested in each position.",
    fullDefinition:
      "Position Allocation shows the portfolio weight of each holding: " +
      "(position market value / total portfolio market value) × 100. " +
      "It is based on reference prices from the platform's market data store — not live quotes.",
    methodologySummary:
      "Weight = position market value ÷ total portfolio market value × 100.",
    interpretation:
      "Larger weights indicate greater concentration in that position. " +
      "Use with Concentration Analysis to understand position-level risk observations.",
    caution:
      "Position weights reflect reference prices as of the latest snapshot, which may lag current " +
      "market prices. They are not rebalancing recommendations.",
    sources: ["Portfolio Snapshots", "Reference Prices"],
  },
  {
    key:              "portfolio_weight",
    label:            "Portfolio Weight",
    shortLabel:       "Weight",
    shortDefinition:  "A position's share of total portfolio market value, expressed as a percentage.",
    fullDefinition:
      "Portfolio Weight is the percentage of total portfolio market value represented by a single " +
      "position. It is equivalent to Position Allocation at the individual holding level.",
    methodologySummary:
      "(Position market value / Total portfolio market value) × 100.",
    interpretation:
      "Higher portfolio weight = greater concentration in that position.",
    caution:
      "Portfolio Weight is an observed characteristic. It is not a suitability or quality signal.",
    sources: ["Portfolio Snapshots", "Reference Prices"],
  },
  {
    key:              "research_coverage_trend",
    label:            "Research Coverage Trend",
    shortLabel:       "Coverage Trend",
    shortDefinition:  "How the fraction of holdings with Opportunity Intelligence has changed over time.",
    fullDefinition:
      "Research Coverage Trend shows the percentage of portfolio holdings that appear in the " +
      "Opportunity Intelligence snapshot at each portfolio snapshot point. " +
      "Tracking this trend helps identify whether coverage is growing or narrowing over time as " +
      "holdings change or the research universe expands.",
    methodologySummary:
      "At each snapshot: positionsWithOpportunityIntelligence / positionsTotal × 100.",
    interpretation:
      "Rising coverage means more holdings have research context over time. " +
      "Falling coverage may reflect new holdings entering the portfolio that are not yet in the " +
      "Opportunity Intelligence universe.",
    caution:
      "Coverage is not a quality metric. Coverage change is not a trading signal.",
    sources: ["Portfolio Snapshots", "Opportunity Intelligence snapshot"],
  },
  {
    key:              "opportunity_overlap_trend",
    label:            "Opportunity Overlap Trend",
    shortLabel:       "Overlap Trend",
    shortDefinition:  "How many portfolio holdings align with Opportunity Intelligence categories over time.",
    fullDefinition:
      "Opportunity Overlap Trend tracks, at each portfolio snapshot, how many holdings are " +
      "Currently Qualified, Approaching Qualification, or Not Currently Ranked in Opportunity Intelligence. " +
      "This shows whether the research-alignment of the portfolio has shifted across snapshot periods.",
    methodologySummary:
      "At each snapshot: count holdings in each Opportunity Intelligence category.",
    interpretation:
      "Tracks research-alignment shift over time. Does not imply any quality judgment.",
    caution:
      "Absence from the Opportunity Intelligence snapshot does not indicate poor quality. " +
      "The snapshot changes as market conditions change.",
    sources: ["Portfolio Snapshots", "Opportunity Intelligence snapshot"],
  },
  {
    key:              "exposure_change",
    label:            "Exposure Change",
    shortLabel:       "Exposure Δ",
    shortDefinition:  "A percentage-point change in sector or theme allocation between two portfolio snapshots.",
    fullDefinition:
      "Exposure Change is the shift in the fraction of portfolio market value invested in a given " +
      "sector or theme between two consecutive portfolio snapshots. It is measured in percentage points. " +
      "Noise threshold: changes smaller than 0.5pp are not reported.",
    methodologySummary:
      "Current sector/theme % − previous sector/theme %. Noise threshold: |delta| < 0.5pp ignored.",
    interpretation:
      "Positive exposure change = greater portfolio fraction in that sector/theme. " +
      "Negative = reduced fraction.",
    caution:
      "Exposure Change is an observed portfolio characteristic. It is not a rebalancing signal.",
    sources: ["Portfolio Snapshots", "Sector/theme classification"],
  },
  {
    key:              "market_value_history",
    label:            "Market Value History",
    shortLabel:       "Value History",
    shortDefinition:  "A time series of total portfolio market value from captured snapshots.",
    fullDefinition:
      "Market Value History plots the total market value of tracked portfolio positions at each " +
      "portfolio snapshot point. It shows how the aggregate value of the tracked positions has " +
      "moved over the selected period. Cash balances are never included.",
    methodologySummary:
      "At each portfolio snapshot: sum of (quantity × reference price) for all positions with " +
      "available reference prices.",
    interpretation:
      "Upward trend: aggregate tracked value increased. Downward: decreased. " +
      "Flat: limited snapshots or minimal price movement.",
    caution:
      "Market Value History reflects tracked positions only — it excludes cash, untracked accounts, " +
      "and positions without reference price data. It is not an investment return series.",
    sources: ["Portfolio Snapshots", "Reference Prices"],
  },
];

// ===========================================================================
// Trade Planning Terms — Sprint 2.7.0
// ===========================================================================

const TRADE_PLANNING_ENTRIES: ReadonlyArray<ResearchGlossaryEntry> = [
  {
    key:   "trade_planning",
    term:  "Trade Planning",
    short: "Exploring how a qualified research thesis could potentially be expressed.",
    full:  "Trade Planning bridges Research and Trade Construction. It converts a qualified " +
           "research candidate into a structured planning context, identifies broad research " +
           "expression families (equity, options, income, defined-risk), and makes explicit what " +
           "conditions support or limit each approach. Trade Planning does not constitute investment " +
           "advice, a recommendation, or a suitability determination.",
    sources: ["Opportunity Intelligence", "Research Goals", "Portfolio Context"],
    caveat:  "Trade Planning is a research workflow, not a recommendation engine. No expression " +
             "family is labeled 'best' or 'recommended.'",
  },
  {
    key:   "research_expression",
    term:  "Research Expression",
    short: "A broad category of how a research thesis could potentially be structured.",
    full:  "A Research Expression describes a general approach to expressing a qualified research " +
           "thesis — for example, equity ownership, covered call, or defined-risk options — without " +
           "specifying a contract, strike, expiration, or order. Research expressions are identified " +
           "for research context only and do not constitute a trade plan or instruction.",
    sources: ["Trade Planning Foundation"],
    caveat:  "A research expression is not a trade instruction. No strike, expiration, or contract " +
             "is selected at this stage.",
  },
  {
    key:   "expression_family",
    term:  "Expression Family",
    short: "A broad group of research expression approaches sharing similar structural characteristics.",
    full:  "Expression Families group related research expression approaches: equity, income, " +
           "defined-risk directional, covered call, cash-secured put, vertical spread, long option, " +
           "neutral options, and monitor-only. Each family is evaluated deterministically against the " +
           "candidate's research profile and the user's planning constraints. No family is ranked as " +
           "'recommended' or 'best.'",
    sources: ["Trade Planning Foundation"],
  },
  {
    key:   "planning_constraints",
    term:  "Planning Constraints",
    short: "User-selected parameters that shape which research expressions are explored.",
    full:  "Planning Constraints are user-selected preferences for a trade planning session: " +
           "capital available for the scenario, maximum capital at risk, maximum loss per position, " +
           "preferred horizon, equity/options allowance, defined-risk preference, income focus, and " +
           "earnings avoidance. They are NOT a risk tolerance assessment, suitability questionnaire, " +
           "or financial questionnaire. No income, net worth, age, tax bracket, or household data " +
           "is collected.",
    sources: ["User Input"],
    caveat:  "Planning constraints are used only to construct research scenarios and do not " +
             "constitute a suitability assessment.",
  },
  {
    key:   "capital_at_risk",
    term:  "Capital at Risk",
    short: "The maximum dollar amount a user indicates they want to model as at risk.",
    full:  "Capital at Risk is a user-entered scenario parameter — the maximum dollar amount " +
           "the user indicates for planning scenario modeling. It is not an account balance, " +
           "a risk capacity measure, or a broker instruction. It does not represent a suitability " +
           "determination. It is used only to scope research expression families.",
    sources: ["User Input"],
    caveat:  "This is a scenario parameter, not a suitability or risk-capacity assessment.",
  },
  {
    key:   "defined_risk",
    term:  "Defined Risk",
    short: "A research expression structure with a capped maximum loss at entry.",
    full:  "Defined-risk structures — such as vertical spreads, long options, or cash-secured " +
           "puts — have a maximum potential loss that is known and fixed at the time the structure " +
           "is entered. Identifying a structure as 'defined risk' in the research context does not " +
           "mean the loss is small or that the structure is suitable. It is a structural characteristic, " +
           "not a risk rating.",
    sources: ["Trade Planning Foundation"],
    caveat:  "Defined risk does not mean low risk or safe. Maximum loss may still be substantial.",
  },
  {
    key:   "income_research",
    term:  "Income Research",
    short: "Exploring research expressions focused on generating potential periodic income.",
    full:  "Income Research explores how a qualified research candidate could potentially support " +
           "income-oriented expression structures such as covered calls or cash-secured puts. It is " +
           "a research lens, not a guaranteed income strategy. Actual income depends on many factors " +
           "including market conditions, pricing, and execution.",
    sources: ["Opportunity Intelligence", "Trade Planning Foundation"],
    caveat:  "Income research does not guarantee periodic income. Past option premiums are not " +
             "indicative of future availability.",
  },
  {
    key:   "directional_research",
    term:  "Directional Research",
    short: "Exploring research expressions with a directional (bullish or bearish) bias.",
    full:  "Directional Research explores how a candidate's thesis — typically bullish for growth " +
           "candidates — could be expressed through directional structures like equity or directional " +
           "options. It does not predict price direction. The research thesis supports a directional " +
           "view, but markets can move against any thesis.",
    sources: ["Opportunity Intelligence", "Trade Planning Foundation"],
    caveat:  "Directional research does not predict or guarantee price movement.",
  },
  {
    key:   "trade_thesis",
    term:  "Trade Thesis",
    short: "The research rationale underlying a potential trade planning scenario.",
    full:  "The Trade Thesis carries the research context — why a candidate qualified, what evidence " +
           "supports the thesis, what could invalidate it, and what risks are present — into the " +
           "trade planning layer. Planning engines use the thesis for context only. The thesis is " +
           "always subordinate to the authoritative research evidence from Opportunity Intelligence.",
    sources: ["Opportunity Intelligence", "Research Evidence"],
    caveat:  "A thesis is a research context, not a prediction or guarantee.",
  },
  {
    key:   "planning_horizon",
    term:  "Planning Horizon",
    short: "The time frame a user selects for exploring research scenarios.",
    full:  "Planning Horizon is a user-selected planning parameter — the time frame over which " +
           "the user wants to explore research scenarios. It is not an expected holding period, " +
           "an investment term, or a suitability factor. It is used to scope which research " +
           "expression families and structures are contextually relevant.",
    sources: ["User Input"],
    caveat:  "Planning horizon is a research scenario parameter, not an implied holding period.",
  },
];

// ===========================================================================
// Equity Trade Planning Terms — Sprint 2.7.1
// ===========================================================================

const EQUITY_PLANNING_ENTRIES: ReadonlyArray<ResearchGlossaryEntry> = [
  {
    key:             "equity_planning",
    label:           "Equity Trade Planning",
    shortDefinition: "Exploring how a qualified research thesis could be structured as an equity research scenario.",
    fullDefinition:  "Equity Trade Planning converts a qualified research candidate and user-selected planning " +
                     "constraints into a hypothetical equity research scenario. It shows potential entry " +
                     "frameworks, research invalidation conditions, hypothetical sizing, scenario analysis, and " +
                     "monitoring considerations. It does not constitute investment advice, a recommendation, " +
                     "a suitability determination, or an instruction to buy, sell, or hold.",
    methodologySummary: "Deterministic computation from TradePlanningContext, user constraints, and stored daily bars.",
    caution:         "Equity Trade Planning provides hypothetical research scenarios only. It is not " +
                     "investment advice, a recommendation, or a suitability determination.",
    category:        "research_term",
    userFacing:      true,
  },
  {
    key:             "entry_framework",
    label:           "Research Entry Framework",
    shortDefinition: "A structured view of conditions under which an equity research thesis may warrant consideration.",
    fullDefinition:  "A Research Entry Framework describes the entry condition type (e.g. current structure, " +
                     "breakout confirmation, pullback to support), available research entry zones derived from " +
                     "canonical technical reference levels, required evidence, and conditions that would negate " +
                     "entry consideration. It is derived only from canonical research evidence and stored " +
                     "technical data — never fabricated.",
    methodologySummary: "Sourced from canonical research evidence and stored EMA technical bars only.",
    caution:         "Entry zones are research reference zones, not buy instructions. If no validated technical " +
                     "level exists, the entry framework is unavailable.",
    category:        "research_term",
    userFacing:      true,
  },
  {
    key:             "research_entry_zone",
    label:           "Research Scenario Entry Zone",
    shortDefinition: "A price range around a canonical technical reference level used for research scenario modeling.",
    fullDefinition:  "A Research Scenario Entry Zone is a price range derived from canonical technical reference " +
                     "levels (e.g. EMA 21, stored support) that a research scenario uses to model hypothetical " +
                     "entry. It is not a \'buy zone\', a recommended entry, or an instruction to trade. If no " +
                     "validated level exists, no zone is presented.",
    methodologySummary: "Zone = ±2% around the nearest EMA level below reference price.",
    caution:         "Research entry zones are not buy instructions or recommended entry prices.",
    category:        "research_term",
    userFacing:      true,
  },
  {
    key:             "hypothetical_position_size",
    label:           "Hypothetical Scenario Size",
    shortDefinition: "The share count computed from user-entered planning constraints for a research scenario.",
    fullDefinition:  "Hypothetical Scenario Size is determined by applying user-entered planning constraints " +
                     "(maximum capital at risk, maximum loss per position) to a reference price. It uses the " +
                     "lesser of: shares by capital limit and shares by risk limit. It is labeled \'Hypothetical\' " +
                     "because it is a planning scenario, not a position-size recommendation.",
    methodologySummary: "effectiveShares = min(floor(maxCapital/price), floor(maxLoss/riskPerShare)). Floor-rounded.",
    caution:         "Planning values illustrate the selected research scenario and are not individualized " +
                     "position-size recommendations.",
    category:        "research_term",
    userFacing:      true,
  },
  {
    key:             "scenario_capital",
    label:           "Scenario Capital",
    shortDefinition: "The planning capital used to construct a hypothetical research scenario.",
    fullDefinition:  "Scenario Capital is the user-entered capital available for planning scenario construction. " +
                     "It is used only to compute scenario parameters such as hypothetical share count and " +
                     "estimated capital required. It is not an account balance, buying power, or broker " +
                     "instruction.",
    caution:         "Scenario Capital is a planning parameter, not a broker instruction or account balance.",
    category:        "research_term",
    userFacing:      true,
  },
  {
    key:             "scenario_loss",
    label:           "Estimated Scenario Loss",
    shortDefinition: "The estimated hypothetical loss if the research thesis is invalidated at the invalidation level.",
    fullDefinition:  "Estimated Scenario Loss is computed as: Hypothetical Shares x Risk Per Share, where " +
                     "Risk Per Share = Reference Price minus Invalidation Level. It is a planning scenario value, " +
                     "not a guaranteed loss or a maximum account drawdown. It requires a validated invalidation " +
                     "level from the research thesis.",
    methodologySummary: "estimatedLoss = effectiveShares x (referencePrice - invalidationPrice).",
    caution:         "Scenario loss is a hypothetical planning estimate, not a guaranteed or expected loss.",
    category:        "risk",
    userFacing:      true,
  },
  {
    key:             "invalidation_level",
    label:           "Research Invalidation Level",
    shortDefinition: "A reference price level derived from canonical research evidence at which the thesis would warrant review.",
    fullDefinition:  "A Research Invalidation Level marks a price or condition at which the research thesis may " +
                     "need to be re-evaluated. It is sourced exclusively from canonical research evidence " +
                     "(invalidatesThesis[], riskFactors[], technical reference levels) -- never fabricated. " +
                     "Breaching the invalidation level does not trigger any automated action.",
    methodologySummary: "Derived from invalidatesThesis[] and riskFactors[] in canonical Opportunity Intelligence.",
    caution:         "Research invalidation levels are thesis review triggers, not stop-loss orders.",
    category:        "research_term",
    userFacing:      true,
  },
  {
    key:             "scenario_analysis",
    label:           "Scenario Analysis",
    shortDefinition: "A grid of hypothetical price moves showing market value and scenario P/L at each level.",
    fullDefinition:  "Scenario Analysis applies a set of percentage price moves (e.g. -20%, -10%, 0%, +10%, " +
                     "+20%) to the reference price to show hypothetical market values and scenario P/L. It is " +
                     "not a price forecast, expected return, or projection. No probability is implied for any " +
                     "scenario point.",
    methodologySummary: "7 default points: -20%, -10%, -5%, 0%, +5%, +10%, +20%. User-configurable range.",
    caution:         "Hypothetical Scenario -- these figures are not a price forecast, projected return, or " +
                     "prediction. No probability is implied.",
    category:        "research_term",
    userFacing:      true,
  },
  {
    key:             "monitoring_plan",
    label:           "Research Monitoring Plan",
    shortDefinition: "A structured set of research conditions to watch after identifying a research candidate.",
    fullDefinition:  "A Research Monitoring Plan organizes the key signals to watch across technical, fundamental, " +
                     "institutional, sector, theme, market regime, portfolio exposure, and event categories. " +
                     "For each item it shows the current state and the condition that would trigger a thesis " +
                     "review. Monitoring plans are research references only -- no automated alerts are configured " +
                     "at this stage.",
    methodologySummary: "8 categories: technical, fundamental, institutional, sector, theme, regime, portfolio, events.",
    caution:         "Alert implementation is a future feature. This monitoring plan is a research reference only.",
    category:        "research_term",
    userFacing:      true,
  },
  {
    key:             "reference_price",
    label:           "Reference Price",
    shortDefinition: "The stored daily close price used as the basis for equity planning scenario calculations.",
    fullDefinition:  "The Reference Price is the last stored daily close price from the market data database. " +
                     "It is used as the basis for entry zone calculations, hypothetical sizing, and scenario " +
                     "analysis. It is not a real-time quote and may be delayed by one or more trading days. " +
                     "Data freshness is always disclosed. Planning scenarios generated from stale reference " +
                     "prices display a STALE INPUT WARNING.",
    methodologySummary: "Sourced from stored daily bars via getReferenceSnapshot(). Zero provider credits.",
    caution:         "Reference Price is a stored daily close. It may not reflect current market conditions. " +
                     "Always check the data freshness indicator.",
    category:        "data_quality",
    userFacing:      true,
  },
];

// Merge portfolio terms into the main glossary
const _extendedGlossary = [
  ...PORTFOLIO_INTELLIGENCE_ENTRIES,
  ...PORTFOLIO_ANALYTICS_ENTRIES,
  ...TRADE_PLANNING_ENTRIES,
  ...EQUITY_PLANNING_ENTRIES,
];

// Expose portfolio-specific lookup
export function getPortfolioGlossaryEntry(key: string): ResearchGlossaryEntry | undefined {
  return _extendedGlossary.find(e => e.key === key);
}

// Expose trade-planning-specific lookup
export function getTradePlanningGlossaryEntry(key: string): ResearchGlossaryEntry | undefined {
  return _extendedGlossary.find(e => e.key === key);
}

export { TRADE_PLANNING_ENTRIES };
export { EQUITY_PLANNING_ENTRIES };
export { OPTIONS_STRATEGY_ENTRIES };

// ===========================================================================
// Options Strategy Matching Terms — Sprint 2.7.2
// ===========================================================================

const OPTIONS_STRATEGY_ENTRIES: ReadonlyArray<ResearchGlossaryEntry> = [
  {
    key:             "options_strategy_matching",
    label:           "Options Strategy Matching",
    shortDefinition: "Evaluating which options strategy families are structurally compatible with a research thesis and planning constraints.",
    fullDefinition:  "Options Strategy Matching evaluates 17 strategy families against a qualified research thesis " +
                     "and user-selected planning constraints. Each family receives a status of Applicable, " +
                     "Potentially Applicable, Not Applicable, or Unavailable, with transparent reasons. " +
                     "It does not select a specific strategy, contract, expiration, strike, or trade and " +
                     "does not constitute investment advice or a suitability determination.",
    methodologySummary: "Deterministic rule-based evaluation; no numeric ranking score; pure computation from TradePlanningContext.",
    caution:         "Options Strategy Matching is a research tool, not a recommendation engine. No strategy family is labeled best or recommended.",
    category:        "research_term",
    userFacing:      true,
  },
  {
    key:             "strategy_family",
    label:           "Strategy Family",
    shortDefinition: "A broad category of options structures sharing similar directional, income, or risk characteristics.",
    fullDefinition:  "A Strategy Family groups related options structures that share similar purpose: directional bullish, " +
                     "directional bearish, income, neutral/range-bound, volatility, protective, or monitor-only. " +
                     "Examples include Long Call (directional bullish), Iron Condor (neutral/range-bound), " +
                     "and Covered Call (income). Families do not specify strike, expiration, or contract — " +
                     "those are researched in a later stage.",
    methodologySummary: "17 supported families organized into 7 categories.",
    category:        "research_term",
    userFacing:      true,
  },
  {
    key:             "thesis_direction",
    label:           "Research Thesis Direction",
    shortDefinition: "The directional bias derived from canonical research evidence, used to evaluate options strategy family compatibility.",
    fullDefinition:  "Thesis Direction is derived deterministically from opportunity type, technical scores, risk factors, " +
                     "and market regime — never from a single score. Values: Bullish, Bearish, Neutral, Range-Bound, " +
                     "Volatility Expansion, Volatility Contraction, Mixed, or Unknown. " +
                     "The direction gates which strategy families are considered applicable.",
    methodologySummary: "VCP/BREAKOUT/GAP_AND_GO → Bullish; BREAKDOWN → Bearish; CONSOLIDATION → Range-Bound; multiple high-risk factors reduce confidence → Mixed.",
    caution:         "Thesis direction is a research categorization, not a price prediction or directional forecast.",
    category:        "research_term",
    userFacing:      true,
  },
  {
    key:             "volatility_context",
    label:           "Volatility Context",
    shortDefinition: "A categorical assessment of implied volatility conditions (LOW / NORMAL / ELEVATED / HIGH / UNKNOWN).",
    fullDefinition:  "Volatility Context classifies options market conditions to inform strategy family compatibility. " +
                     "Elevated implied volatility may support premium-selling research structures; " +
                     "low implied volatility may support premium-buying structures. " +
                     "In Sprint 2.7.2, no authoritative IV source is available — context is UNKNOWN. " +
                     "Exact IV data will be evaluated in Contract Research (2.7.3).",
    methodologySummary: "No IV source in 2.7.2; always UNKNOWN; limitation disclosed.",
    caution:         "Volatility context is a research input, not a trading signal. Do not fabricate IV context.",
    category:        "data_quality",
    userFacing:      true,
  },
  {
    key:             "event_risk",
    label:           "Event Risk",
    shortDefinition: "The risk that an earnings report or other event causes unexpected price movement affecting an options position.",
    fullDefinition:  "Event Risk refers to the potential for an earnings report, regulatory decision, economic announcement, " +
                     "or other scheduled event to cause a significant, potentially unexpected price move. " +
                     "Options strategy families have different sensitivities to event risk: income structures " +
                     "(covered call, short spreads) are more exposed; straddles/strangles may be designed for it. " +
                     "Users who select Avoid Earnings Window will see event-sensitive families flagged accordingly.",
    methodologySummary: "Derived from risk factors text analysis; exact event dates unavailable in 2.7.2.",
    caution:         "Event risk cannot be predicted with certainty. Research evidence is not a forecast of event outcomes.",
    category:        "risk",
    userFacing:      true,
  },
  {
    key:             "defined_risk_strategy",
    label:           "Defined-Risk Strategy",
    shortDefinition: "An options structure where the maximum possible loss is known and capped at entry.",
    fullDefinition:  "A Defined-Risk Strategy is an options structure where the maximum possible loss is established " +
                     "at the time the position is opened — typically the net premium paid (long options) or the " +
                     "spread width minus credit received (vertical spreads, iron condors). " +
                     "Examples: Long Call, Bull Call Spread, Iron Condor, Protective Put. " +
                     "Not all options strategies are defined-risk — Covered Call and Cash-Secured Put, " +
                     "for instance, retain underlying equity exposure.",
    methodologySummary: "structure.isDefinedRisk field in StrategyStructureDescription.",
    caution:         "Defined-risk does not mean zero risk. A defined-risk strategy can still lose its entire premium.",
    category:        "risk",
    userFacing:      true,
  },
  {
    key:             "income_strategy",
    label:           "Income-Oriented Strategy",
    shortDefinition: "An options structure that receives a premium credit at entry, with income as a primary research objective.",
    fullDefinition:  "An Income-Oriented Strategy collects premium at entry by selling options or credit spreads. " +
                     "Examples include Covered Call, Cash-Secured Put, Bull Put Spread, Bear Call Spread, " +
                     "Iron Condor, and Iron Butterfly. " +
                     "Income strategies retain exposure to adverse price moves — they are not risk-free. " +
                     "The income focus planning preference surfaces these families more prominently when selected.",
    methodologySummary: "structure.isIncomeFocused field; merged from constraints.incomeFocus + goalContext.incomeFocused.",
    caution:         "Income strategies can lose more than the premium received. They are not guaranteed income.",
    category:        "research_term",
    userFacing:      true,
  },
  {
    key:             "directional_strategy",
    label:           "Directional Strategy",
    shortDefinition: "An options structure that profits from a specific directional move in the underlying price.",
    fullDefinition:  "A Directional Strategy is an options structure designed to benefit from a specific move — " +
                     "bullish (Long Call, Bull Call Spread, Bull Put Spread) or bearish (Long Put, Bear Put Spread, " +
                     "Bear Call Spread). Directional strategies may lose their entire premium if the expected move " +
                     "does not materialize within the expiration window.",
    methodologySummary: "structure.isDirectional field; thesis direction gates applicability.",
    caution:         "Directional strategies are research tools. They do not predict or guarantee a directional move.",
    category:        "research_term",
    userFacing:      true,
  },
  {
    key:             "neutral_strategy",
    label:           "Neutral / Range-Bound Strategy",
    shortDefinition: "An options structure that profits from the underlying remaining within a price range.",
    fullDefinition:  "A Neutral or Range-Bound Strategy benefits from the underlying staying within a defined price range " +
                     "without a large directional move. Examples include Iron Condor, Iron Butterfly, and Calendar Spread. " +
                     "These structures are generally not suited to strong directional theses. " +
                     "Events (earnings, announcements) can break the expected range.",
    methodologySummary: "Applicable for NEUTRAL/RANGE_BOUND/VOLATILITY_CONTRACTION thesis directions.",
    caution:         "Neutral strategies can lose their maximum defined amount if the underlying moves significantly.",
    category:        "research_term",
    userFacing:      true,
  },
  {
    key:             "protective_strategy",
    label:           "Protective Strategy",
    shortDefinition: "An options structure that provides downside protection for an existing underlying position.",
    fullDefinition:  "A Protective Strategy uses options to hedge an existing underlying position against adverse moves. " +
                     "Examples include Protective Put (long put against owned shares) and Collar " +
                     "(protective put + covered call against owned shares). " +
                     "These structures require confirmed underlying ownership — they are NOT applicable " +
                     "without an existing position.",
    methodologySummary: "requiresOwnership = true; NOT_APPLICABLE if portfolioContext.ownsSymbol = false.",
    caution:         "Protective strategies reduce but do not eliminate risk. Premium cost reduces net returns.",
    category:        "risk",
    userFacing:      true,
  },
  {
    key:             "options_liquidity",
    label:           "Options Liquidity Context",
    shortDefinition: "Broad assessment of options chain availability and tradability for a symbol.",
    fullDefinition:  "Options Liquidity Context reflects the broad availability and tradability of options on a symbol: " +
                     "AVAILABLE (active chain with reasonable volume), LIMITED (sparse chain or wide spreads), " +
                     "or UNKNOWN (not evaluated at this stage). " +
                     "In Sprint 2.7.2, liquidity is UNKNOWN — contract-level liquidity assessment belongs to " +
                     "Contract Research (2.7.3) where actual chain data is inspected.",
    methodologySummary: "Always UNKNOWN in 2.7.2; detailed assessment deferred to 2.7.3.",
    caution:         "Poor options liquidity can significantly impact fill quality and effective spread cost. Evaluate in 2.7.3.",
    category:        "data_quality",
    userFacing:      true,
  },
];

// ===========================================================================
// Sprint 2.7.3 — Options Contract Research Glossary Terms
// Declared AFTER OPTIONS_STRATEGY_ENTRIES (same declaration-order rule)
// ===========================================================================

const CONTRACT_RESEARCH_ENTRIES: ReadonlyArray<ResearchGlossaryEntry> = [
  {
    key:              "contract_research_candidate",
    label:            "Contract Research Candidate",
    shortDefinition:  "A specific option structure (legs, strikes, expiration) surfaced during research — not a recommendation.",
    fullDefinition:   "A contract research candidate is a multi-leg option structure assembled from live broker chain data that satisfies the active liquidity, DTE, and moneyness filters for the selected strategy family. Candidates are sorted by data quality (EXCELLENT → STRONG → ACCEPTABLE → LIMITED). They are research inputs, not trade recommendations.",
    category:         "options",
    userFacing:       true,
    caution:          "A candidate appearing in research does not imply suitability, profitability, or recommendation. Market conditions change quickly.",
  },
  {
    key:              "expiration_research",
    label:            "Expiration Research",
    shortDefinition:  "Analysis of option expiration dates within your target DTE range.",
    fullDefinition:   "Expiration research evaluates all listed expirations for a symbol and classifies each by whether it falls within the strategy family's target DTE range, contains an earnings or event window, and has sufficient chain liquidity. Each expiration is labelled RESEARCH_CANDIDATE, OUTSIDE_HORIZON, EVENT_EXCLUDED, or EXPIRED_OR_INVALID.",
    category:         "options",
    userFacing:       true,
  },
  {
    key:              "strike_research",
    label:            "Strike Research",
    shortDefinition:  "Filtering and ordering option strikes by delta, moneyness, and liquidity for a given expiration.",
    fullDefinition:   "Strike research uses the live option chain to identify call or put strikes near target delta bands. When delta is unavailable from the provider, moneyness (distance from the underlying price) is used as a fallback. Strikes are filtered by open interest, volume, and bid/ask spread constraints before being assembled into candidate structures.",
    category:         "options",
    userFacing:       true,
  },
  {
    key:              "moneyness",
    label:            "Moneyness (ITM / ATM / OTM)",
    shortDefinition:  "Whether an option's strike is below (ITM call), near (ATM), or above (OTM call) the underlying price.",
    fullDefinition:   "Moneyness describes the relationship between an option's strike price and the current underlying price. In-the-money (ITM): the option has intrinsic value. At-the-money (ATM): strike is within ±2% of the underlying. Out-of-the-money (OTM): the option has no intrinsic value but retains time value. The ATM band threshold is 2% for research classification.",
    category:         "options",
    userFacing:       true,
  },
  {
    key:              "open_interest",
    label:            "Open Interest (OI)",
    shortDefinition:  "Total number of outstanding option contracts at a given strike and expiration.",
    fullDefinition:   "Open interest is the total count of option contracts that have been opened but not yet closed, exercised, or expired. Higher OI generally indicates a more liquid and active contract. In contract research, the minimum OI threshold is 10 by default; STRONG liquidity requires ≥500 OI.",
    category:         "options",
    userFacing:       true,
  },
  {
    key:              "bid_ask_spread",
    label:            "Bid/Ask Spread",
    shortDefinition:  "The gap between the highest buyer price (bid) and the lowest seller price (ask).",
    fullDefinition:   "The bid/ask spread reflects the transaction cost of entering or exiting an option position. A narrow spread (e.g. <5% of midpoint) indicates good liquidity; a wide spread (>30%) means higher effective transaction cost. Contract research uses bid/ask spread percentage as a key liquidity filter. The midpoint is (bid + ask) / 2 and is NOT a guaranteed fill price.",
    category:         "options",
    userFacing:       true,
    caution:          "Options can be difficult to fill at the midpoint in illiquid markets. Actual fill price may differ materially.",
  },
  {
    key:              "implied_volatility",
    label:            "Implied Volatility (IV)",
    shortDefinition:  "The market's forward-looking expectation of price movement, derived from option prices.",
    fullDefinition:   "Implied volatility is extracted from the market price of options using an options pricing model. It represents the annualized expected price movement. IV is neither a prediction nor a directional signal. Higher IV means options cost more (more expensive to buy premium). IV differs per expiration (term structure) and per strike (IV skew). The IV shown is from the provider and should be interpreted in context.",
    category:         "options",
    userFacing:       true,
  },
  {
    key:              "delta",
    label:            "Delta (Δ)",
    shortDefinition:  "Approximate change in option price for a $1 move in the underlying.",
    fullDefinition:   "Delta estimates how much an option's price changes when the underlying moves $1. For calls, delta ranges from 0 to +1; for puts, 0 to -1. Deep ITM options have delta near ±1; deep OTM near 0. Delta is also commonly used as an approximate moneyness proxy (e.g., 0.50 delta ≈ ATM). Delta is not a probability of profit.",
    category:         "options",
    userFacing:       true,
    caution:          "Delta changes as the underlying price, time, and volatility change. It is not a static measure.",
  },
  {
    key:              "gamma",
    label:            "Gamma (Γ)",
    shortDefinition:  "Rate of change of delta for a $1 move in the underlying.",
    fullDefinition:   "Gamma measures how quickly delta changes as the underlying price moves. High gamma (near ATM, near expiration) means delta can shift rapidly. Long option positions have positive gamma; short positions have negative gamma. Elevated gamma near expiration can lead to rapid P&L swings.",
    category:         "options",
    userFacing:       true,
  },
  {
    key:              "theta",
    label:            "Theta (Θ) — Time Decay",
    shortDefinition:  "Daily erosion of an option's time value as expiration approaches.",
    fullDefinition:   "Theta represents the daily dollar loss in option value due solely to the passage of time, assuming all else is equal. Long options have negative theta (time works against you). Short options have positive theta (time works for you). Theta accelerates as expiration approaches, especially for ATM options.",
    category:         "options",
    userFacing:       true,
  },
  {
    key:              "vega",
    label:            "Vega (ν) — Volatility Sensitivity",
    shortDefinition:  "Option price change for a 1-point change in implied volatility.",
    fullDefinition:   "Vega measures how much an option's price changes when IV moves by 1 percentage point. Long options have positive vega (benefit from rising IV). Short options have negative vega. Vega is highest for ATM options and longer-dated expirations. Options bought in low-IV environments benefit if IV expands; options sold in high-IV environments can benefit if IV contracts.",
    category:         "options",
    userFacing:       true,
  },
  {
    key:              "net_debit",
    label:            "Estimated Net Debit",
    shortDefinition:  "Approximate cost to enter a debit structure (paid upfront), based on midpoint pricing.",
    fullDefinition:   "Net debit is the estimated total cost per-share (per-contract = × 100) of entering an options structure that requires an upfront cash outlay. It is computed from the midpoint prices of each leg. A debit structure has a defined maximum loss equal to the net debit paid. Actual fill cost may differ from the midpoint estimate.",
    category:         "options",
    userFacing:       true,
    caution:          "Midpoint-based estimate only. Actual fill may be higher.",
  },
  {
    key:              "net_credit",
    label:            "Estimated Net Credit",
    shortDefinition:  "Approximate premium received for selling a credit structure, based on midpoint pricing.",
    fullDefinition:   "Net credit is the estimated premium received per-share (per-contract = × 100) when entering an options structure that generates upfront income. Credit received represents the maximum gain for many credit strategies. The maximum loss of a defined-risk credit structure is spread width minus the credit received. Actual fill may differ from the midpoint.",
    category:         "options",
    userFacing:       true,
    caution:          "Midpoint-based estimate only. Actual credit received may be lower.",
  },
  {
    key:              "estimated_midpoint",
    label:            "Estimated Midpoint",
    shortDefinition:  "The average of the bid and ask prices — an estimate of fair value, not a guaranteed fill.",
    fullDefinition:   "The estimated midpoint is (bid + ask) / 2. It is commonly used to estimate the fair value of an option or multi-leg structure. However, actual fills are negotiated with market makers and may deviate from the midpoint — especially in illiquid markets or during fast-moving conditions.",
    category:         "options",
    userFacing:       true,
    caution:          "The midpoint is not a guaranteed fill price. Wide spreads make midpoint fills less likely.",
    methodologySummary: "Midpoint = (bid + ask) / 2. Applied per leg; net debit/credit sums per-leg midpoints with appropriate sign.",
  },
  {
    key:              "liquidity_quality",
    label:            "Liquidity Quality",
    shortDefinition:  "A 4-tier label (STRONG / ACCEPTABLE / LIMITED / POOR) summarizing how tradeable a contract is.",
    fullDefinition:   "Liquidity quality is a composite classification based on open interest, volume, and bid/ask spread percentage. STRONG: OI ≥ 500, volume ≥ 50, spread < 5%. ACCEPTABLE: OI ≥ 100, spread < 15%. LIMITED: OI ≥ 10, spread < 30%. POOR: below all thresholds. Structures with POOR liquidity legs are excluded from research candidates.",
    category:         "options",
    userFacing:       true,
    methodologySummary: "Tier thresholds are fixed in contract-research-types.ts LIQUIDITY_THRESHOLDS. Overall structure liquidity = worst leg.",
  },
  {
    key:              "event_window",
    label:            "Event Window",
    shortDefinition:  "An expiration that falls on or after a known earnings or catalyst date.",
    fullDefinition:   "An event window expiration is one where the expiration date falls after an upcoming earnings announcement or material event, meaning the option will capture the volatility of that event. These expirations typically have elevated IV. The avoidEarningsWindow filter excludes them from research; when disabled, they are included with a prominent warning.",
    category:         "options",
    userFacing:       true,
    caution:          "Event window options often experience significant IV crush after earnings. Premium paid before the event may deflate rapidly after.",
  },
];

// ===========================================================================
// Sprint 2.7.4 — Trade Risk & Scenario Analysis Glossary Terms
// Declared AFTER CONTRACT_RESEARCH_ENTRIES (same declaration-order rule)
// ===========================================================================

const RISK_SCENARIO_ENTRIES: ReadonlyArray<ResearchGlossaryEntry> = [
  {
    key:              "trade_risk_analysis",
    label:            "Trade Risk & Scenario Analysis",
    shortDefinition:  "Deterministic hypothetical scenario engine showing how a selected research structure reacts to price, volatility, and time changes.",
    fullDefinition:   "Trade Risk & Scenario Analysis evaluates the economic and risk characteristics of a user-selected contract research candidate under deterministic scenarios. It answers: what is the maximum loss, maximum gain, breakeven, and how does the structure react to underlying price moves, implied volatility changes, and time decay? It does NOT provide a recommendation, a probability of profit, or an instruction to transact.",
    category:         "options",
    userFacing:       true,
    caution:          "Scenarios are hypothetical and not forecasts. Actual outcomes depend on market conditions and execution prices.",
  },
  {
    key:              "maximum_loss",
    label:            "Maximum Loss",
    shortDefinition:  "The worst-case dollar loss for a defined-risk structure — mathematically derived, not a prediction.",
    fullDefinition:   "Maximum Loss is the largest possible loss on a structure where the payoff is mathematically defined at expiration. For debit structures (long call, long put, debit spreads), it equals the net premium paid. For credit spreads, it equals the spread width minus the credit received. Some structures (covered call, cash-secured put) carry substantial undefined downside that is not expressible as a single number.",
    category:         "options",
    userFacing:       true,
    caution:          "A defined maximum loss does not imply low risk — premiums can represent a large percentage of a position's cost basis.",
  },
  {
    key:              "maximum_gain",
    label:            "Maximum Gain",
    shortDefinition:  "The largest possible gain for a defined or bounded structure — applicable only where mathematically derivable.",
    fullDefinition:   "Maximum Gain is the theoretical upper bound on a structure's return where payoff is bounded at expiration. For debit verticals, it is the spread width minus the net debit. For credit structures, it is the net credit received. Long calls have theoretically unlimited upside. Calendar and diagonal spreads are path-dependent — a single maximum gain figure is not valid.",
    category:         "options",
    userFacing:       true,
  },
  {
    key:              "breakeven",
    label:            "Breakeven Price",
    shortDefinition:  "The underlying price at which the structure neither gains nor loses at expiration.",
    fullDefinition:   "Breakeven is the underlying price at which the structure's expiration payoff equals zero. For a long call, it is the strike plus the premium paid. For a credit spread, it depends on which short strike and the net credit. Iron condors and iron butterflies have two breakevens — one on the put side and one on the call side.",
    category:         "options",
    userFacing:       true,
  },
  {
    key:              "payoff_profile",
    label:            "Payoff Profile",
    shortDefinition:  "The structure's gain/loss characteristics at expiration across different underlying prices.",
    fullDefinition:   "A payoff profile shows how much a structure gains or loses at expiration for each underlying price scenario. It is computed from intrinsic value math — not a model price. For path-dependent structures like calendars and diagonals, a clean payoff profile cannot be derived without multi-expiration modeling.",
    category:         "options",
    userFacing:       true,
  },
  {
    key:              "scenario_analysis",
    label:            "Scenario Analysis",
    shortDefinition:  "Hypothetical outcomes under a range of deterministic price, volatility, and time assumptions.",
    fullDefinition:   "Scenario analysis presents how a selected structure would perform under a set of defined hypothetical conditions — for example, if the underlying falls 10%, or if implied volatility increases 20%. Results are labeled Hypothetical Price Scenario and are not forecasts. No probability of outcome is assigned.",
    category:         "options",
    userFacing:       true,
    caution:          "Scenarios do not represent expected or likely outcomes. Actual market behavior is not captured by deterministic models.",
  },
  {
    key:              "price_scenario",
    label:            "Price Scenario",
    shortDefinition:  "A hypothetical move in the underlying price and its estimated effect on the structure.",
    fullDefinition:   "A price scenario sets the underlying to a specific hypothetical level and computes the structure's expiration intrinsic payoff at that level. A separate delta approximation is shown for pre-expiration estimates. The expiration payoff is mathematically exact; the pre-expiration estimate is a first-order approximation only.",
    category:         "options",
    userFacing:       true,
  },
  {
    key:              "net_delta",
    label:            "Net Delta",
    shortDefinition:  "The structure's aggregate sensitivity to a $1 change in the underlying price, all else equal.",
    fullDefinition:   "Net delta is the sum of signed delta contributions across all legs: long legs add their delta; short legs subtract theirs. A net delta of +0.40 means the structure's value is estimated to change by approximately $40 per 1-point move in the underlying (per contract). Delta is a directional sensitivity measure — it is NOT a probability of profit or finishing in-the-money.",
    category:         "options",
    userFacing:       true,
    caution:          "Delta is a local, instantaneous sensitivity and changes as price and time change. It is not a stable forecast.",
  },
  {
    key:              "net_theta",
    label:            "Net Theta",
    shortDefinition:  "The structure's estimated sensitivity to the passage of one calendar day, all else equal.",
    fullDefinition:   "Net theta is the aggregate time-decay rate across all legs. A net theta of −0.05 means the structure is estimated to lose approximately $5 per calendar day from time decay alone, holding everything else constant. Actual daily P/L will differ from theta because theta itself changes over time — particularly accelerating as expiration approaches.",
    category:         "options",
    userFacing:       true,
    caution:          "Theta is a local approximation. Linear theta extrapolation over many days is materially inaccurate.",
  },
  {
    key:              "net_vega",
    label:            "Net Vega",
    shortDefinition:  "The structure's estimated sensitivity to a 1-percentage-point change in implied volatility, all else equal.",
    fullDefinition:   "Net vega is the aggregate implied-volatility sensitivity across all legs. A net vega of +0.12 means the structure value is estimated to increase by approximately $12 per 1-pct-pt increase in IV. Long options have positive vega (gain from rising IV); short options have negative vega. Vega approximations are linear and local — actual non-linear IV behavior may differ.",
    category:         "options",
    userFacing:       true,
  },
  {
    key:              "assignment_risk",
    label:            "Assignment Risk",
    shortDefinition:  "The possibility that a short option leg is exercised by the holder before or at expiration.",
    fullDefinition:   "Assignment risk is the risk that the holder of a short option exercises it, obligating the seller to buy (short put) or sell (short call) the underlying at the strike price. For American-style equity options, early assignment is possible at any time prior to expiration, though it is uncommon for out-of-the-money options. Assignment at expiration is automatic when a short option is in-the-money.",
    category:         "options",
    userFacing:       true,
    caution:          "Assignment risk is elevated around dividends, earnings, and when options are deep in-the-money.",
  },
  {
    key:              "early_exercise_risk",
    label:            "Early Exercise Risk",
    shortDefinition:  "The risk of unexpected early assignment on short option legs for American-style equity options.",
    fullDefinition:   "American-style equity options can be exercised at any time before expiration. Early exercise may occur when a short call or put is sufficiently in-the-money, especially around ex-dividend dates. Covered calls face early exercise if the call is deep in-the-money near a dividend date. Cash-secured puts can be assigned early if the put is deep in-the-money.",
    category:         "options",
    userFacing:       true,
  },
  {
    key:              "path_dependent_payoff",
    label:            "Path-Dependent Payoff",
    shortDefinition:  "A payoff structure whose outcome depends on the price path and volatility over time, not just the final price.",
    fullDefinition:   "Calendar and diagonal spreads are path-dependent because the value of the near-expiration short leg and the far-expiration long leg evolve at different rates depending on implied volatility and the time path. Unlike vertical spreads with a fixed max gain/loss at expiration, these structures cannot be characterized by a single closed-form maximum gain or loss figure.",
    category:         "options",
    userFacing:       true,
    caution:          "Path-dependent strategies require dynamic monitoring. Static scenario analysis is indicative only.",
  },
  {
    key:              "quote_risk",
    label:            "Quote Risk",
    shortDefinition:  "The risk that scenario values differ materially from actual execution prices due to bid-ask spreads and stale quotes.",
    fullDefinition:   "Quote risk arises because scenario analysis uses midpoint references — the average of bid and ask prices — which may not reflect actual executable prices. Wide bid-ask spreads, low liquidity, and stale quotes all increase the gap between research midpoints and market fills. Scenarios based on stale quotes may not reflect current market conditions.",
    category:         "options",
    userFacing:       true,
  },
  {
    key:              "planning_constraint_status",
    label:            "Planning Constraint Status",
    shortDefinition:  "A deterministic comparison of the structure's scenario maximum loss against the user's selected planning constraint.",
    fullDefinition:   "Planning Constraint Status compares the scenario maximum loss (where defined) to the user-entered maximum capital-at-risk planning constraint. Status is WITHIN_CONSTRAINT if the defined max loss is within the constraint, EXCEEDS_CONSTRAINT if it exceeds it, NO_CONSTRAINT_SET if no constraint was entered, or UNDEFINED_RISK if the max loss is not a defined dollar amount. This is NOT a suitability determination.",
    category:         "risk",
    userFacing:       true,
    caution:          "This comparison is mechanical — it does not account for individual financial circumstances or risk tolerance. It is not investment advice.",
  },
];

/** Full merged glossary (all modules) — use this for full lookup */
// ============================================================================
// Trade Plan Workspace Glossary (Sprint 2.7.5)
// ============================================================================

const TRADE_PLAN_ENTRIES: ReadonlyArray<ResearchGlossaryEntry> = [
  {
    key:             "trade_plan",
    label:           "Trade Plan",
    shortDefinition: "A user-saved research record combining thesis, structure, risk analysis, and monitoring conditions.",
    fullDefinition:  "A Trade Plan is a user-saved research record that preserves the research evidence, planning assumptions, selected hypothetical structure, risk analysis, and monitoring conditions the user reviewed at a point in time. It does not constitute investment advice, a personalized recommendation, suitability determination, or instruction to transact.",
    caution:         "A Trade Plan is a personal research record — not a system recommendation or authorization to trade.",
  },
  {
    key:             "trade_plan_status",
    label:           "Trade Plan Status",
    shortDefinition: "The lifecycle state of a trade plan: Draft, Research Complete, Monitoring, Archived, or Invalidated.",
    fullDefinition:  "Trade Plan Status tracks where a user is in their research process. DRAFT: still assembling the plan. RESEARCH_COMPLETE: research reviewed and plan saved. MONITORING: watching research conditions over time. ARCHIVED: no longer active. INVALIDATED: a documented thesis invalidation condition was observed.",
    caution:         "Status does not imply a trade recommendation or authorization. INVALIDATED means a research condition was observed — not an instruction to exit a position.",
  },
  {
    key:             "research_review_checklist",
    label:           "Research Review Checklist",
    shortDefinition: "A personal research aid tracking which research areas the user has reviewed.",
    fullDefinition:  "The Research Review Checklist helps users track which research areas they have personally reviewed before saving a plan. It covers research evidence, risk factors, thesis invalidation conditions, data freshness, event/earnings exposure, liquidity, and planning constraints. It is not an approval, compliance certification, or determination that a trade is appropriate.",
    caution:         "The checklist is a personal aid — not a regulatory approval or compliance certification.",
  },
  {
    key:             "saved_research_snapshot",
    label:           "Saved Research Snapshot",
    shortDefinition: "An immutable record of research evidence captured at the time the plan was created.",
    fullDefinition:  "The Saved Research Snapshot preserves research scores, evidence items, risk factors, and invalidation conditions as they existed when the user saved the plan. It is never automatically updated when current research changes. The snapshot enables comparison between creation-time evidence and current evidence.",
    caution:         "Snapshot data reflects what was available at plan creation. Current market data may differ.",
  },
  {
    key:             "current_research_comparison",
    label:           "Current Research Comparison",
    shortDefinition: "Deterministic comparison between saved research snapshot and current authoritative research.",
    fullDefinition:  "The Current Research Comparison shows how research evidence has changed since the plan was created. It computes score changes, risk level changes, market regime changes, qualification changes, and whether any thesis invalidation conditions are now observed. It uses existing Change Intelligence thresholds — no new scoring formulas.",
    caution:         "Changes in research evidence are informational. They do not constitute advice to act or exit a position.",
  },
  {
    key:             "plan_health",
    label:           "Plan Health",
    shortDefinition: "Deterministic research state indicating how current evidence compares to evidence at plan creation.",
    fullDefinition:  "Plan Health is a deterministic, non-prescriptive assessment of how current research evidence compares to the saved snapshot. States: CURRENT (research consistent), CHANGED (minor change), REQUIRES_REVIEW (material change detected), THESIS_INVALIDATED (invalidation condition observed), DATA_STALE (data too old to evaluate reliably), UNKNOWN (current research unavailable).",
    caution:         "Plan Health is a research state — not a trade status or instruction. THESIS_INVALIDATED does not mean exit a position.",
  },
  {
    key:             "research_requires_review",
    label:           "Research Requires Review",
    shortDefinition: "Plan health state indicating a material evidence change since plan creation.",
    fullDefinition:  "REQUIRES_REVIEW is triggered when a material evidence change is detected: research score changed by 5+ points, qualification status changed, or a material risk level or market regime shift occurred. The user should compare current and saved research to decide how to proceed.",
    caution:         "Requires Review is informational — it is not a recommendation to act.",
  },
  {
    key:             "thesis_invalidated",
    label:           "Thesis Invalidation Observed",
    shortDefinition: "A documented research thesis invalidation condition was observed in current research.",
    fullDefinition:  "THESIS_INVALIDATED is triggered when a canonical invalidation condition — previously documented by the research engine — is now observed in current authoritative research. Examples include a stock closing below a key level documented as an invalidation condition at plan creation.",
    caution:         "Thesis Invalidation is a research observation — not an instruction to exit a position or take any action. If you have an open position, consult your risk management plan.",
  },
  {
    key:             "plan_version",
    label:           "Plan Version",
    shortDefinition: "An integer counter incremented when the user explicitly updates authoritative plan components.",
    fullDefinition:  "Plan versioning allows users to track when they have materially updated a trade plan. When a user creates a new version, the previous snapshot is preserved in the version history before updating. The version integer starts at 1 and increments with each explicit update. This ensures traceability without silently overwriting the original research record.",
    caution:         "Versions preserve research records — not trade performance records.",
  },
];

export const ALL_GLOSSARY_ENTRIES: ReadonlyArray<ResearchGlossaryEntry> = [
  ..._extendedGlossary,
  ...OPTIONS_STRATEGY_ENTRIES,
  ...CONTRACT_RESEARCH_ENTRIES,
  ...RISK_SCENARIO_ENTRIES,
  ...TRADE_PLAN_ENTRIES,
];

/** Alias for backward compatibility */
export const RESEARCH_GLOSSARY_ENTRIES: ReadonlyArray<ResearchGlossaryEntry> = ALL_GLOSSARY_ENTRIES;

/** Map from a score display label to its glossary key. */
export const SCORE_LABEL_TO_GLOSSARY_KEY: Readonly<Record<string, string>> = {
  Tech: "technical_score",
  Technical: "technical_score",
  Inst: "institutional_score",
  Institutional: "institutional_score",
  Fund: "fundamental_score",
  Fundamental: "fundamental_score",
  Risk: "risk_score",
  Overall: "research_score",
  Regime: "regime_score",
  Confidence: "evidence_confidence",
};
