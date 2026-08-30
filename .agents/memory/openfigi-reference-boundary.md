---
name: OpenFIGI reference boundary
description: Approved provider and durable trust/licensing constraints for institutional security-reference enrichment.
---

OpenFIGI v3 is the approved canonical external reference source for institutional security-identity enrichment. Use exact `ID_CUSIP` requests only and persist only the modeled FIGI/OpenFIGI symbology metadata permitted by the applicable published terms. CUSIPs originate from SEC source rows and must not be represented as OpenFIGI-owned data. Never persist or redistribute unmodeled provider payload fields or proprietary third-party source data.

**Why:** The institutional product needed population-wide deterministic identity evidence, but provider approval was conditional on a narrow persistence boundary. Fuzzy issuer matching, inferred tickers, and unbounded provider operations would weaken both licensing and identity safety.

**How to apply:** Keep the shared Task #189 resolver as the sole promotion authority. Reviewed and rejected decisions remain owner-controlled; exact local/provider conflicts, ambiguity, unsupported instruments, missing results, partial responses, rate limits, and provider failures remain unresolved. Bound provider lookups before network calls and require a fresh hash plus explicit guards for any write-mode backfill.