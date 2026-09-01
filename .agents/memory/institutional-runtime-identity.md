---
name: Institutional runtime identity
description: Canonical identity boundary and population-acceptance rules for active Institutional Intelligence stock runtime.
---

Active stock Institutional Intelligence must resolve identity once from the canonical effective-holdings security context. Selected-filing ticker fields and row-level mapping evidence are not fallback identity sources.

**Why:** Independent ticker-based resolvers repeatedly diverged from accepted canonical identity and caused valid symbols to lose holdings, aggregates, or trend data at different runtime stages.

**How to apply:** Pass the canonical CUSIP set and effective period into downstream holdings, aggregate, signal, and trend reads. Population checks must call the same shared loaders in bounded, batched, read-only mode rather than reimplementing their SQL.