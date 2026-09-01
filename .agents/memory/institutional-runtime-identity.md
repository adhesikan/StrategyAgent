---
name: Institutional runtime identity
description: Canonical identity boundary and population-acceptance rules for active Institutional Intelligence stock runtime.
---

Active stock Institutional Intelligence must resolve identity once from the canonical effective-holdings security context. Selected-filing ticker fields and row-level mapping evidence are not fallback identity sources.

**Why:** Independent ticker-based resolvers repeatedly diverged from accepted canonical identity and caused valid symbols to lose holdings, aggregates, or trend data at different runtime stages.

**How to apply:** Resolve context at the top-level service boundary, then pass its CUSIPs and effective period through downstream reads. Population acceptance must call the actual Stock View and trend services; batched loaders may support classification but must not replace service availability semantics. Coverage audits must union exact/reviewed institutional mappings with reviewed security-master evidence before applying persisted stock-type eligibility; a direct reviewed-security-master join is too narrow.