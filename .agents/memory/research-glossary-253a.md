---
name: Research Glossary & Score Transparency (Sprint 2.5.3A)
description: Central Research Glossary architecture, risk score semantics, tooltip component contracts, and compliance changes.
---

## Core Rule
`shared/research-glossary.ts` is the SOLE definition of all research terms. Components never hardcode score definitions — always call `getGlossaryEntry(key)`.

## Risk Score Semantics (CRITICAL)
`riskScore` on `OpportunityScore` (from ranking engine) = **higher is better risk profile**.
Confirmed from `server/services/opportunity-ranking-engine.ts` `computeRiskScore()` comment: "Risk score — higher = better risk profile."
This is different from `riskLevel` in intelligence service where "high" = more risk.
Test `"risk_score has higherIsBetter=true"` in `research-glossary.test.ts` pins this — will fail if semantics change.

## Ranking Engine Weights (pinned by test)
Technical 40%, Institutional 20%, Fundamental 15%, Risk 15%, Regime 10%.
Test `"opportunity-ranking-engine weights are unchanged"` will catch any change.

## Component Contracts
- `ResearchDefinitionTooltip` — wraps children in a `<button>` trigger; `showCaution={false}` for compact contexts
- `ResearchHelpIcon` — standalone `?` icon (no children); use next to badges/numbers to avoid nesting buttons
- `ScoreExplanationModal` / `UnderstandingScoresLink` — full modal from glossary; use at section level, not per-card
- `SCORE_LABEL_TO_GLOSSARY_KEY` — maps display labels ("Tech", "Inst", "Fund", "Risk", "Overall", "Regime", "Confidence") to keys; auto-wires ScorePill/ScoreBar

## Compliance Changes Made
- Scanner "Top Picks" → "High-Scoring Setups"
- Options Scanner both "Top Picks" → "High-Confidence Results"
- Smart Panel "Top Pick" → "Highest Score"

**Why:** Sprint 2.5.3A compliance audit. These were internal scanner labels with no investment-advice implication but aligned with spec prohibition list for consistent user-facing language.

## How to Apply
- Any new score surface: wrap label text with `<ResearchDefinitionTooltip term="[key]">label</ResearchDefinitionTooltip>`
- Any new badge: add `<ResearchHelpIcon term="[key]" />` next to it (never wrap badge in tooltip button)
- Adding a new score: (1) add to glossary, (2) set `higherIsBetter` verified from server code, (3) add to `SCORE_LABEL_TO_GLOSSARY_KEY`, (4) update `18-research-glossary.md`
