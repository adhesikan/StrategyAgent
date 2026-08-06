---
name: Research Package Overview Refinement
description: Sprint 2.2.1 — posture bug fix, evidence scores, improved thesis, new overview cards, risk grouping, action card CTA hierarchy
---

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
