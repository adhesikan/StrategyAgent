---
name: Institutional symbol availability
description: Trust boundary separating diagnostic symbol evidence from reliable identity and zero-position claims.
---

Load target-specific CUSIP evidence even when it is unresolved so mapping failures can be diagnosed, but only reviewed security-master evidence or exact/reviewed source evidence for the same symbol may establish reliable identity. Explicit ambiguity always blocks resolution even when another trusted record exists; disagreement between trusted symbols is conflicting. A genuine no-reported-position result requires reliable identity across the whole target-specific candidate population; unresolved target evidence is unmapped, and no evidence is unsupported. Incomplete coverage takes precedence over any numeric zero. Derived materialization is ordered aggregate → signal → sector/theme snapshots; any aggregate failure must block later stages.

**Why:** Using one candidate set for both diagnostic loading and trusted identity either hides ambiguous rows before analysis or promotes untrusted/conflicting evidence into a false zero-position claim. Continuing after an aggregate failure can republish stale numeric evidence through signals or discovery snapshots.

**How to apply:** Keep diagnostic candidates and reliable identity as separate provenance fields in all symbol-level institutional pipelines. Bind each status to the symbol emitted by that same source, preserve ambiguous rows for diagnostics, and suppress cached aggregates and zero counts when any target-specific candidate is ambiguous or conflicting. Validate the full paginated population that actually produced the aggregate: effective filings plus the matching position-type eligibility only. One trusted CUSIP cannot mask another disqualified CUSIP.