---
name: Research Package Overview Refinement
description: Sprint 2.2.1 — posture bug fix, evidence scores, improved thesis, new overview cards, risk grouping, action card CTA hierarchy
---

## UAT fix — Sprint 2.2.1 Final (evidence presentation)

**Three root causes fixed:**

1. **Catalysts 100/100 labeled "Moderate"**: `evidenceSignalLabel(stars)` used a 5-star scale. Catalysts max=3 stars, so `evidenceSignalLabel(3)` = "Moderate" even though the score was 100. Fix: added `scoreToLabel(score)` that maps the numeric score to a label. `SignalRow` now uses `scoreToLabel(numericScore)` when a score is available. Score thresholds preserve 5-star semantics exactly (stars×20 maps cleanly into each bucket). 3 catalysts stars → 100 → "Strong" ✓.

2. **Technical 20/100 for rank-#1 candidate without confidence**: `computeTechnicalScore` returns 20 as a hardcoded fallback when `candidate.confidence` is undefined. That is a missing-field default, not a real measurement. Fix: `isTechnicalScoreAvailable(candidate)` checks `!!candidate.confidence`; `computeEvidenceNumericScores` returns null (→ N/A) when unavailable.

3. **Regime 40/100 for strong_bull + Aligned**: The MCP `get_market_regime` tool returns `regime.regime = "strong_bull"` (or similar). `computeRegimeScore("strong_bull")` fell through to the unknown fallback (`{ score:40, available:true }`). Fix: `normalizeRegimeForScoring(regime)` maps MCP strings to canonical TRENDING/CHOPPY/RISK_OFF at the presentation adapter boundary. Unknown strings return null → N/A, not an invented score. Normalization lives ONLY in `computeEvidenceNumericScores` — do NOT change `computeRegimeScore` itself.

**scoreToLabel thresholds** (0-20: Weak, 21-40: Limited, 41-60: Moderate, 61-80: Solid, 81-100: Strong). Congress 3★=60→Moderate is correct by design; Catalysts 3★=100→Strong is now correct.

**normalizeRegimeForScoring keyword rules**: canonical strings pass through; strings containing "BULL" or exactly "STRONG_BULL"/"BULL_TREND" → TRENDING; "RISK_OFF", "RISK-OFF", or containing "BEARISH" → RISK_OFF; exactly "CHOP" or "CHOPPY_MARKET" → CHOPPY. Do NOT add broad keyword matches (e.g. "SIDEWAYS") — they cause false positives.

## Key decisions

**Posture vs Thesis split (critical)**
- `deriveThesis()` (3-way: bullish/neutral/bearish) is kept for backward-compat with Trade Structure Engine.
- `derivePosture()` (6-way: bullish/constructive/neutral/defensive/unrated/bearish) is the new display function.
- Bug fix: warning count alone MUST NOT return "bearish" from either function. Bearish requires RISK_OFF + tech < 65.
- `isBullishBase` in `derivePosture` uses tech + regime ONLY — `computeRiskScore` must NOT gate it (risk score is driven by warning count, creating a circular dependency).

**Warning classification false-positive**
- "er " (bare) keyword in MARKET_KEYWORDS matched "scanner " (word ends in "er"). Removed "er " and " er "; kept "earning" which covers all relevant cases.

**EvidenceStars.congress type**
- Typed as `1|2|3|4|5` — never 0. Comparison to 0 produces TS2367. Use `<= 1` for "minimal/unavailable" check.

## Files changed
- `client/src/components/research/decision/research-decision-card.tsx` — add Posture type + derivePosture(); fix deriveThesis() bearish-from-warnings bug; improve buildThesisExplanation() (rank, strategy, regime, warnings; preserve original casing)
- `client/src/components/research/stock-trade-card.tsx` — replace bare "—" with informative resolution-state text; add resolveFieldState() helper
- `client/src/components/research/evidence-card.tsx` — rename to "Evidence Strength"; add numeric scores (72/100); add optional pkg prop for computeTechnicalScore/computeRegimeScore
- `client/src/components/research/risk-card.tsx` — categorize warnings (market/trade-plan/execution/other); collapse/expand for long lists; all warnings preserved
- `client/src/components/research/action-card.tsx` — primary CTA (Review with InstaTrade™ / Connect Broker) now first and visually dominant; secondary actions below
- `client/src/components/research/compact-market-context.tsx` — NEW: compact regime/alignment/data-source/scan-time card for Overview
- `client/src/components/research/compact-options-overview.tsx` — NEW: compact options structure summary (DTE + strike framework; no premiums/Greeks)
- `client/src/components/research/congress-summary-card.tsx` — NEW: congress disclosure summary with mandatory disclaimer; no fabricated counts
- `client/src/components/research/research-trade-card.tsx` — passes pkg to EvidenceCard for numeric scores
- `client/src/components/research/index.ts` — exports new components + helpers
- `client/src/pages/opportunity-research.tsx` — Overview tab reordered: Thesis → MarketContext → TradeCard → CongressSummary → ScanHistory
- `client/src/components/research/overview-refinement.test.tsx` — NEW: 58 new tests
- `client/src/components/research/decision/research-decision-engine.test.tsx` — 4 existing tests updated to match new correct behavior
