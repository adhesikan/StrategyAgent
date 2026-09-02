---
name: Historical 13F period repair
description: Safety boundary for detecting and repairing filing-period contamination in historical SEC 13F data.
---

Historical filing identity and period corrections must be derived from a unique authoritative SEC submissions record keyed by the canonical 18-digit accession. Requested catalog quarters select archives only and must never become filing metadata.

**Why:** A legacy per-filing XML path copied its requested target quarter into both filing and holding rows. Dashed/undashed accession duplicates can also hide conflicting holding sets, so canonicalization alone is not enough evidence for a safe merge.

**How to apply:** Keep production audits read-only and Railway-identity-bound. Correct a verified accession atomically; merge duplicates only when one holding set is empty or both fingerprints match. Otherwise roll back and require source replay. Recompute only affected periods and symbols.