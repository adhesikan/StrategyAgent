# 18 — Research Glossary & Score Methodology

Sprint: 2.5.3A — Research Transparency, Explainability & Central Research Glossary

---

## Overview

The Central Research Glossary is the single source of truth for all research terminology displayed across VCP Trader AI. Every score label, badge, tooltip, and explanation modal consumes the glossary. Definitions are never duplicated inside React components.

---

## Glossary Source File

**`shared/research-glossary.ts`**

This file is the canonical, authoritative definition of every research term. It is importable by both client (`@shared/research-glossary`) and server (`../shared/research-glossary`).

### Architecture

```
shared/research-glossary.ts          ← Single source of truth
  ↓ imported by
client/src/components/
  research-definition-tooltip.tsx    ← Tooltip component (all surfaces)
  score-explanation-modal.tsx        ← "Understanding Research Scores" modal

Used on:
  Dashboard                          ← ScorePill labels, confidence badge, overall score
  Opportunity Workspace              ← ScoreBar labels, modal link
  Research Hub                       ← (modal link can be added as needed)
  Research Workspace                 ← (modal link can be added as needed)
  AI Research Workspace              ← AI assistant can reference canonical definitions
  Collections                        ← (tooltip hooks available)
  Portfolio Intelligence             ← (tooltip hooks available)
  Institutional Fund Explorer        ← (tooltip hooks available)
```

---

## GlossaryEntry Interface

```typescript
interface ResearchGlossaryEntry {
  key: string;           // Machine-readable unique key
  label: string;         // Display label (title case)
  shortLabel?: string;   // Abbreviated form (e.g. "Tech", "Inst")
  shortDefinition: string;   // One-sentence tooltip text
  fullDefinition: string;    // Modal paragraph — no overstating
  methodologySummary?: string; // How it's actually computed in code
  interpretation?: string;   // How to read the score in practice
  caution?: string;          // Compliance caution (required for all scores)
  category: GlossaryCategory; // score | confidence | risk | candidate_type | ...
  higherIsBetter?: boolean;  // Verified against server computation
  userFacing: boolean;       // Controls admin-only vs user-visible
  aliases?: string[];        // Alternative lookup keys
}
```

---

## All Canonical Terms

### Score Terms

| Key | Label | shortLabel | Higher Is Better | Category |
|-----|-------|-----------|-----------------|----------|
| `research_score` | Research Score | Score | ✓ | score |
| `technical_score` | Technical Score | Tech | ✓ | score |
| `institutional_score` | Institutional Score | Inst | ✓ | score |
| `fundamental_score` | Fundamental Score | Fund | ✓ | score |
| `risk_score` | Risk Score | Risk | ✓ (better profile) | score |
| `regime_score` | Regime Alignment Score | Regime | ✓ | score |

### Confidence Terms

| Key | Label | Category |
|-----|-------|----------|
| `evidence_confidence` | Evidence Confidence | confidence |

### Market Context Terms

| Key | Label | Category |
|-----|-------|----------|
| `market_regime` | Market Regime | market_context |
| `sector` | Sector | market_context |
| `theme` | Theme | market_context |

### Data Quality Terms

| Key | Label | Category |
|-----|-------|----------|
| `data_freshness` | Data Freshness | data_quality |
| `time_horizon` | Time Horizon | research_term |
| `opportunity_type` | Opportunity Type | candidate_type |

### Evidence Terms

| Key | Label | Category |
|-----|-------|----------|
| `research_evidence` | Research Evidence | evidence |
| `primary_evidence` | Primary Evidence | evidence |
| `secondary_evidence` | Secondary Evidence | evidence |
| `risk_factor` | Risk Factor | evidence |
| `invalidates_thesis` | Invalidates Thesis | evidence |
| `institutional_activity` | Institutional Activity | evidence |

### Candidate Type Terms

| Key | Label | Category |
|-----|-------|----------|
| `research_candidate` | Research Candidate | candidate_type |
| `qualified_opportunity` | Qualified Opportunity | candidate_type |
| `growth_candidate` | Growth Candidate | candidate_type |
| `income_candidate` | Income Candidate | candidate_type |
| `watch_candidate` | Watch Candidate | candidate_type |
| `long_term_investment_candidate` | Long-Term Investment Candidate | candidate_type |
| `momentum_candidate` | Momentum Candidate | candidate_type |
| `swing_candidate` | Swing Research Candidate | candidate_type |
| `etf_candidate` | ETF Research Candidate | candidate_type |
| `covered_call_candidate` | Covered Call Candidate | candidate_type |
| `cash_secured_put_candidate` | Cash-Secured Put Candidate | candidate_type |

---

## Score Semantic Direction

**Critical: Score direction must match actual server computation. Never change this table without verifying the server code first.**

| Score | Server File | Function | Direction | Verified |
|-------|-------------|----------|-----------|---------|
| `technicalScore` | `server/services/opportunity-ranking-engine.ts` | `computeTechnicalScore()` | Higher = better | ✓ |
| `institutionalScore` | `server/services/opportunity-ranking-engine.ts` | `computeInstitutionalScore()` | Higher = better | ✓ |
| `fundamentalScore` | `server/services/opportunity-ranking-engine.ts` | `computeFundamentalScore()` | Higher = better | ✓ |
| `riskScore` | `server/services/opportunity-ranking-engine.ts` | `computeRiskScore()` | Higher = better risk profile | ✓ |
| `regimeScore` | `server/services/opportunity-ranking-engine.ts` | `computeRegimeScore()` | Higher = better alignment | ✓ |
| `overallScore` | `server/services/opportunity-ranking-engine.ts` | `computeOverallScore()` | Higher = better | ✓ |

**Risk Score special note:** `riskScore` in the UI (from `OpportunityScore`) is computed by `computeRiskScore()`. The code explicitly documents: *"Risk score — higher = better risk profile."* A score of 85 means excellent risk/reward setup. A score of 25 means poor risk profile. This is the display score — not to be confused with internal `riskLevel` label ("low/medium/high") from the intelligence service, where "high" = more risk.

---

## Ranking Engine Weights

**Source: `server/services/opportunity-ranking-engine.ts` — `DEFAULT_WEIGHTS`**

| Component | Weight |
|-----------|--------|
| Technical | 40% |
| Institutional | 20% |
| Fundamental | 15% |
| Risk | 15% |
| Regime Alignment | 10% |

These weights are documented in `ResearchGlossaryEntry.methodologySummary` for `research_score`. Do NOT change weights without updating both the server code and the glossary entry.

---

## Score Ownership

| Score | Owning Service |
|-------|---------------|
| Technical Score | `server/services/opportunity-ranking-engine.ts` |
| Institutional Score | `server/services/opportunity-ranking-engine.ts` + `server/services/institutional-signals-service.ts` |
| Fundamental Score | `server/services/opportunity-ranking-engine.ts` |
| Risk Score | `server/services/opportunity-ranking-engine.ts` |
| Regime Score | `server/services/opportunity-ranking-engine.ts` |
| Overall (Research) Score | `server/services/opportunity-ranking-engine.ts` |

---

## How UI Components Consume the Glossary

### ResearchDefinitionTooltip

```tsx
// Components reference a glossary key — never inline a definition
<ResearchDefinitionTooltip term="technical_score">
  Tech
</ResearchDefinitionTooltip>

// Standalone help icon
<ResearchHelpIcon term="evidence_confidence" />
```

The component:
1. Calls `getGlossaryEntry(term)` from `shared/research-glossary.ts`
2. Renders a `<button>` trigger (keyboard accessible, touch accessible)
3. Shows label + shortDefinition + optional caution in a Radix tooltip
4. Gracefully degrades when key is unknown (renders children as-is)

### ScoreExplanationModal / UnderstandingScoresLink

```tsx
// Full modal with all score categories
<ScoreExplanationModal />

// Inline link variant
<UnderstandingScoresLink />
```

The modal renders all glossary entries grouped by category (scores → confidence → evidence → market context → candidate types). It reads directly from `getScoreGlossaryEntries()` and `getCandidateTypeEntries()`.

### SCORE_LABEL_TO_GLOSSARY_KEY

Used by `ScorePill` (dashboard) and `ScoreBar` (opportunity-workspace) to automatically derive the glossary key from a display label string:

```typescript
{ "Tech": "technical_score", "Inst": "institutional_score", ... }
```

This means existing call sites (`<ScorePill label="Tech" score={85} />`) automatically gain tooltips without changing call signatures.

---

## How AI Consumes the Glossary

The AI Research Workspace (`server/routes/market-research-command-center.ts`, `server/services/research-workspace-service.ts`) should reference canonical glossary definitions rather than duplicating score definitions in system prompts.

Rules:
- Do NOT allow AI to redefine score semantics
- AI explanations should use the same terminology as the glossary labels
- If a system prompt needs to explain what "Technical Score" means, reference `getGlossaryEntry("technical_score").fullDefinition`
- Score thresholds in AI prompts must match actual server computation (see Score Semantic Direction table above)

---

## How to Safely Change Terminology

1. Update `shared/research-glossary.ts` — modify the affected entry
2. Run `npx vitest run --root . server/routes/__tests__/research-glossary.test.ts` to verify
3. Build: `npm run build` — all components will automatically reflect the change
4. If changing a `key` (not just label/definition): update `SCORE_LABEL_TO_GLOSSARY_KEY` and any `aliases[]` on the entry
5. Update this document (Section "All Canonical Terms" table)
6. Add a sprint changelog entry

**Do NOT change terminology by editing individual React components** — always update the glossary first.

---

## How Methodology Changes Must Trigger Glossary Review

Any change to the scoring functions listed in the "Score Ownership" table must trigger a review of:

1. `methodologySummary` in the affected glossary entry
2. `higherIsBetter` flag — verify it still matches computation direction
3. `interpretation` text — verify thresholds still match
4. This document's "Ranking Engine Weights" table

Use the test `"opportunity-ranking-engine weights are unchanged"` in `research-glossary.test.ts` as a CI canary — it will fail if weights change without a corresponding glossary update.

---

## Institutional 13F Delay Disclosure Requirements

The following entries contain mandatory 13F delay language:
- `institutional_score.caution` — "Form 13F data is delayed (filed 45 days after quarter end)"
- `institutional_activity.caution` — "SEC Form 13F data is delayed and does not represent current institutional positions"

These disclosures must always be present. Tests in `research-glossary.test.ts` enforce this.

---

## Commercial Experience (Documented Only — No Code Restrictions)

| Tier | What They Get |
|------|--------------|
| Free (Registered) | Understand what all research scores mean via tooltips and modal |
| Subscriber | Deeper evidence panels, historical score context (may be premium later) |
| Professional | Clear methodology explanations suitable for professional workflows |
| Enterprise / RIA | Org-specific explanatory layers over canonical definitions (future) |

Future editions may use different examples, additional explanatory copy, or different UI placement — but **core score definitions must remain consistent unless methodology itself changes**.

---

## Platform Reusability

The glossary is available to all current and future research surfaces:

| Surface | Current Usage |
|---------|--------------|
| Dashboard | ✓ ScorePill tooltips, confidence badge tooltip, overall score tooltip, Why This Qualified panel, ScoreExplanationModal |
| Opportunity Workspace | ✓ ScoreBar tooltips, UnderstandingScoresLink |
| Research Hub | ✓ Modal can be added to header |
| AI Research Workspace | ✓ Canonical definitions available to system prompts |
| Collections | Available — not yet wired |
| Portfolio Intelligence | Available — not yet wired |
| Alerts | Available — not yet wired |
| Agents | Available — not yet wired |
| RIA Edition | Future — edition-specific layers over canonical definitions |
| Institutional Edition | Future |
| Enterprise Edition | Future |

---

## Admin Search Terms

The following search terms in the Operations Manual search should surface this document:

- research score
- technical score
- fundamental score
- institutional score
- risk score
- confidence
- market regime
- why qualified
- candidate
- 13F delayed
- qualified opportunity
- glossary
- score definition
- score methodology
- evidence confidence
