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
