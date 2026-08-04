---
name: MCP exclusion accounting contract
description: The ranked-search MCP service distinguishes pre-confluence exclusions from post-confluence rejections; our validator, headlines, LLM rules, and UI must use semantically distinct paths for each.
---

# MCP Exclusion Accounting Contract

## The Rule
`excludedCount` / `exclusionSummary` / `groupedCandidateCount` are **pre-confluence** fields.
An excluded opportunity never reached qualification — it is not a quality rejection or risk failure.
`rejectedCount` / `rejectionSummary` are post-confluence quality/risk verdicts.

**Why:** The deployed MCP now runs a "confluence grouping" step before qualification. If groupedCandidateCount=0 and excludedCount=N, the user sees "no trigger" — not "low quality." Conflating the two causes misleading UI copy and incorrect LLM explanations.

## Three Distinct Empty-Result Headlines
1. **All excluded (pre-confluence)** — headline driven by `exclusionSummary` primary reason, e.g. NOT_ACTIONABLE_NO_TRIGGER → "Stored setups were reviewed, but none had an actionable entry trigger."
2. **All unavailable** — "Candidates could not be qualified because required data was unavailable."
3. **All rejected (qualification ran)** — "Candidates were evaluated, but none currently qualify as trades."

## How to Apply
- `allExcludedBeforeGrouping()` guard: excludedCount>0, groupedCandidateCount==0, candidates/watch/rejected/unavailable all zero.
- Unavailable check must include `(search.excludedCount ?? 0) === 0` to avoid false positive when both are nonzero.
- LLM system rule must explicitly say exclusionSummary is pre-qualification, NOT quality rejections. Key phrases the test checks: "NOT quality rejections", "pre-qualification filtering", "not a quality verdict".
- NOT_ACTIONABLE_NO_TRIGGER suggestions: Scanner / Watchlist / Fresh Scan / Stored Setups — no Trade Builder.
- `translateExclusionReason`: always `.toLowerCase()` before title-casing to handle ALL-CAPS input codes.
